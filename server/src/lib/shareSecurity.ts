import { createHash, randomBytes } from "node:crypto";

export interface ShareConfig {
  maxSegments: number;
  maxSegmentBytes: number;
  pendingTtlMs: number;
  rateLimitPerMinute: number;
  uploadsDisabled: boolean;
}

export function parseShareConfig(env: Record<string, string | undefined>): ShareConfig {
  return {
    maxSegments: Number(env.MAX_SEGMENTS ?? 2000),
    maxSegmentBytes: Number(env.MAX_SEGMENT_BYTES ?? 5_242_880),
    pendingTtlMs: Number(env.PENDING_DUB_TTL_HOURS ?? 24) * 3_600_000,
    rateLimitPerMinute: Number(env.RATE_LIMIT_INIT_PER_MINUTE ?? 10),
    uploadsDisabled: env.SHARE_UPLOADS_DISABLED === "1" || env.SHARE_UPLOADS_DISABLED === "true"
  };
}

export function shareConfig(): ShareConfig {
  return parseShareConfig({
    MAX_SEGMENTS: process.env.MAX_SEGMENTS,
    MAX_SEGMENT_BYTES: process.env.MAX_SEGMENT_BYTES,
    PENDING_DUB_TTL_HOURS: process.env.PENDING_DUB_TTL_HOURS,
    RATE_LIMIT_INIT_PER_MINUTE: process.env.RATE_LIMIT_INIT_PER_MINUTE,
    SHARE_UPLOADS_DISABLED: process.env.SHARE_UPLOADS_DISABLED
  });
}

export function newOwnerToken(): string {
  return randomBytes(24).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CheckResult = { ok: true } | { ok: false; status: number; message: string };

export interface InitSegmentInput {
  idx: number;
  startMs: number;
  endMs: number;
  originalText?: string;
  text: string;
  mime: string;
}

export interface InitInput {
  platform?: string;
  videoId?: string;
  sourceLang?: string;
  targetLang?: string;
  voice?: string;
  provider?: string;
  title?: string;
  durationMs?: number;
  visibility?: string;
  ownerToken?: string;
  generationProfile?: string;
  voiceProfile?: string;
  rightsAssertion?: boolean;
  segments?: InitSegmentInput[];
}

const PROFILE_PATTERN = /^[A-Za-z0-9_.:@-]{1,128}$/;

export function validateInit(body: InitInput, maxSegments: number): CheckResult {
  const required = [body.platform, body.videoId, body.sourceLang, body.targetLang, body.voice, body.provider];
  if (required.some((v) => !v)) return { ok: false, status: 400, message: "missing required fields" };
  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    return { ok: false, status: 400, message: "no segments" };
  }
  if (body.segments.length > maxSegments) {
    return { ok: false, status: 413, message: `too many segments: the limit is ${maxSegments}` };
  }
  const seen = new Set<number>();
  for (const s of body.segments) {
    if (!s || !Number.isInteger(s.idx) || s.idx < 0) {
      return { ok: false, status: 400, message: "invalid segment idx" };
    }
    if (seen.has(s.idx)) return { ok: false, status: 400, message: "duplicate segment idx" };
    seen.add(s.idx);
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) {
      return { ok: false, status: 400, message: "invalid segment timing" };
    }
    if (typeof s.text !== "string") return { ok: false, status: 400, message: "invalid segment text" };
    if (typeof s.mime !== "string" || !s.mime) return { ok: false, status: 400, message: "invalid segment mime" };
  }
  if (
    body.generationProfile !== undefined &&
    (typeof body.generationProfile !== "string" || !PROFILE_PATTERN.test(body.generationProfile))
  ) {
    return { ok: false, status: 400, message: "invalid generationProfile" };
  }
  if (
    body.voiceProfile !== undefined &&
    (typeof body.voiceProfile !== "string" || !PROFILE_PATTERN.test(body.voiceProfile))
  ) {
    return { ok: false, status: 400, message: "invalid voiceProfile" };
  }
  if (body.rightsAssertion !== undefined && typeof body.rightsAssertion !== "boolean") {
    return { ok: false, status: 400, message: "invalid rightsAssertion" };
  }
  const profiledShare = body.generationProfile !== undefined || body.voiceProfile !== undefined;
  if (profiledShare && body.visibility !== "private" && body.rightsAssertion !== true) {
    return {
      ok: false,
      status: 400,
      message: "rights assertion required for public profiled shares"
    };
  }
  return { ok: true };
}

export interface InitProfileMetadata {
  generationProfile: string | null;
  voiceProfile: string | null;
  rightsAssertedAt: Date | null;
}

export function profileMetadataFromInit(body: InitInput, now: Date = new Date()): InitProfileMetadata {
  return {
    generationProfile: typeof body.generationProfile === "string" ? body.generationProfile : null,
    voiceProfile: typeof body.voiceProfile === "string" ? body.voiceProfile : null,
    rightsAssertedAt: body.rightsAssertion === true ? now : null
  };
}

export interface ExistingDubRef {
  id: string;
  status: string;
  ownerTokenHash: string;
  createdAt: Date | string;
}

export type InitDecision =
  | { action: "create" }
  | { action: "replace"; previousId: string }
  | { action: "reject"; status: number; message: string };

export function decideInit(
  existing: ExistingDubRef | null | undefined,
  ownerToken: string | undefined,
  now: Date,
  pendingTtlMs: number
): InitDecision {
  if (!existing) return { action: "create" };
  const owned = ownerToken ? hashToken(ownerToken) === existing.ownerTokenHash : false;
  if (existing.status === "ready") {
    if (owned) return { action: "replace", previousId: existing.id };
    return {
      action: "reject",
      status: 409,
      message: "a ready dub already exists for this video, language, voice and provider; only its owner can replace it"
    };
  }
  const createdAt = existing.createdAt instanceof Date ? existing.createdAt : new Date(existing.createdAt);
  if (now.getTime() - createdAt.getTime() > pendingTtlMs) {
    return { action: "replace", previousId: existing.id };
  }
  if (owned) return { action: "replace", previousId: existing.id };
  return {
    action: "reject",
    status: 409,
    message: "an upload for this video, language, voice and provider is already in progress; try again later"
  };
}

export function pendingCutoff(now: Date, pendingTtlMs: number): Date {
  return new Date(now.getTime() - pendingTtlMs);
}

export function authorizeGet(
  dub: { visibility: string; ownerTokenHash: string },
  ownerToken: string | null | undefined
): CheckResult {
  if (dub.visibility !== "private") return { ok: true };
  if (!ownerToken) return { ok: false, status: 401, message: "owner token required: this dub is private" };
  if (hashToken(ownerToken) !== dub.ownerTokenHash) return { ok: false, status: 403, message: "invalid owner token" };
  return { ok: true };
}

export interface SegmentRef {
  idx: number;
  audioKey: string;
}

export type HeadFn = (key: string) => Promise<{ size: number } | null>;

export async function verifyUploadsComplete(
  segments: SegmentRef[],
  head: HeadFn,
  maxSegmentBytes: number
): Promise<CheckResult> {
  const heads = await Promise.all(
    segments.map(async (s) => ({ idx: s.idx, head: await head(s.audioKey).catch(() => null) }))
  );
  const missing = heads.filter((h) => !h.head).map((h) => h.idx);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      message: `missing audio for ${missing.length} segment(s); upload every segment before completing`
    };
  }
  const oversized = heads.filter((h) => h.head && h.head.size > maxSegmentBytes).map((h) => h.idx);
  if (oversized.length > 0) {
    return {
      ok: false,
      status: 413,
      message: `${oversized.length} segment(s) exceed the ${maxSegmentBytes} byte limit`
    };
  }
  return { ok: true };
}

export class RateLimiter {
  private limit: number;
  private windowMs: number;
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(limit: number, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  private prune(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }
}
