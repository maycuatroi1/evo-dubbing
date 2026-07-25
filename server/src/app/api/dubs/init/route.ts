import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { dubs, dubSegments } from "@/db/schema";
import { json, error, preflight, newOwnerToken, hashToken } from "@/lib/http";
import { presignPut, segmentKey, deleteKeys } from "@/lib/r2";
import {
  shareConfig,
  validateInit,
  decideInit,
  pendingCutoff,
  RateLimiter,
  type InitInput
} from "@/lib/shareSecurity";

export const runtime = "nodejs";

const limiter = new RateLimiter(shareConfig().rateLimitPerMinute);

export function OPTIONS() {
  return preflight();
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function deleteDubWithAudio(dubId: string): Promise<void> {
  const segs = await db.query.dubSegments.findMany({ where: eq(dubSegments.dubId, dubId) });
  await deleteKeys(segs.map((s) => s.audioKey)).catch(() => undefined);
  await db.delete(dubs).where(eq(dubs.id, dubId));
}

export async function POST(request: Request) {
  const cfg = shareConfig();

  if (cfg.uploadsDisabled) return error("public uploads are temporarily disabled", 503);

  const rl = limiter.check(clientIp(request));
  if (!rl.allowed) return error(`rate limit exceeded; retry in ${rl.retryAfterSec}s`, 429);

  let body: InitInput;
  try {
    body = (await request.json()) as InitInput;
  } catch {
    return error("invalid json");
  }

  const valid = validateInit(body, cfg.maxSegments);
  if (!valid.ok) return error(valid.message, valid.status);

  const cutoff = pendingCutoff(new Date(), cfg.pendingTtlMs);
  const expired = await db
    .select({ id: dubs.id })
    .from(dubs)
    .where(and(eq(dubs.status, "pending"), lt(dubs.createdAt, cutoff)))
    .limit(50);
  for (const row of expired) {
    await deleteDubWithAudio(row.id);
  }

  const existing = await db.query.dubs.findFirst({
    where: and(
      eq(dubs.platform, body.platform!),
      eq(dubs.videoId, body.videoId!),
      eq(dubs.targetLang, body.targetLang!),
      eq(dubs.voice, body.voice!),
      eq(dubs.provider, body.provider!)
    )
  });

  const decision = decideInit(existing ?? null, body.ownerToken, new Date(), cfg.pendingTtlMs);
  if (decision.action === "reject") return error(decision.message, decision.status);
  if (decision.action === "replace") {
    await deleteDubWithAudio(decision.previousId);
  }

  const ownerToken = newOwnerToken();
  const visibility = body.visibility === "private" ? "private" : "public";
  const segments = body.segments!;

  let dubId: string;
  try {
    const [row] = await db
      .insert(dubs)
      .values({
        platform: body.platform!,
        videoId: body.videoId!,
        sourceLang: body.sourceLang!,
        targetLang: body.targetLang!,
        voice: body.voice!,
        provider: body.provider!,
        title: body.title ?? "",
        visibility,
        status: "pending",
        ownerTokenHash: hashToken(ownerToken),
        durationMs: body.durationMs ?? 0,
        segmentCount: segments.length
      })
      .returning({ id: dubs.id });
    dubId = row.id;
  } catch {
    return error("a dub for this video, language, voice and provider already exists", 409);
  }

  await db.insert(dubSegments).values(
    segments.map((s) => ({
      dubId,
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      originalText: s.originalText ?? "",
      text: s.text,
      audioKey: segmentKey(dubId, s.idx),
      mime: s.mime
    }))
  );

  const uploads = await Promise.all(
    segments.map(async (s) => ({
      idx: s.idx,
      putUrl: await presignPut(segmentKey(dubId, s.idx), s.mime)
    }))
  );

  return json({ id: dubId, ownerToken, uploads });
}
