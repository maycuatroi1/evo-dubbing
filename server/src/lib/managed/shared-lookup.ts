import { V1_ERROR_CODES, v1Error, v1Json } from "../api-error.ts";
import { requireV1Auth } from "../auth.ts";
import type { SupabaseAuthenticator, UserOperationRateLimiter } from "../auth.ts";

export const AI_VOICE_DISCLOSURE_TEXT = "Giọng đọc do AI tạo ra, không phải giọng ngườ" + "i thật.";
export const SHARED_LOOKUP_ERROR_CODES = {
  notFound: "not_found"
} as const;

export interface SharedLookupQuery {
  platform: string;
  videoId: string;
  targetLang: string;
  generationProfile: string;
  voiceProfile: string;
}

export interface SharedDubCandidate {
  id: string;
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: string;
  title: string;
  durationMs: number;
  generationProfile: string | null;
  voiceProfile: string | null;
  rightsAssertedAt: Date | string | null;
}

export interface SharedSegmentRow {
  idx: number;
  startMs: number;
  endMs: number;
  originalText: string;
  text: string;
  mime: string;
  audioKey: string;
}

export function matchesGenerationProfile(
  candidate: SharedDubCandidate,
  query: SharedLookupQuery
): boolean {
  return (
    candidate.platform === query.platform &&
    candidate.videoId === query.videoId &&
    candidate.targetLang === query.targetLang &&
    candidate.generationProfile === query.generationProfile &&
    candidate.voiceProfile === query.voiceProfile
  );
}

export function selectProfileMatch(
  candidates: SharedDubCandidate[],
  query: SharedLookupQuery
): SharedDubCandidate | null {
  return candidates.find((candidate) => matchesGenerationProfile(candidate, query)) ?? null;
}

export interface SharedLookupDeps {
  authenticator: SupabaseAuthenticator;
  limiter: UserOperationRateLimiter;
  findCandidates(query: {
    platform: string;
    videoId: string;
    targetLang: string;
  }): Promise<SharedDubCandidate[]>;
  findSegments(dubId: string): Promise<SharedSegmentRow[]>;
  presign(key: string): Promise<string>;
}

export interface SharedLookupHandlers {
  lookup: (request: Request) => Promise<Response>;
}

function authFailure(auth: {
  status: number;
  code: string;
  message: string;
  retryAfterSec?: number;
}): Response {
  const headers: Record<string, string> = {};
  if (auth.retryAfterSec) headers["retry-after"] = String(auth.retryAfterSec);
  return v1Error(auth.code, auth.message, auth.status, headers);
}

export function createSharedLookupHandlers(deps: SharedLookupDeps): SharedLookupHandlers {
  async function lookup(request: Request): Promise<Response> {
    const auth = await requireV1Auth(request, deps.authenticator, deps.limiter, "dubs.lookup");
    if (!auth.ok) return authFailure(auth);

    const url = new URL(request.url);
    const query: SharedLookupQuery = {
      platform: url.searchParams.get("platform") ?? "",
      videoId: url.searchParams.get("videoId") ?? "",
      targetLang: url.searchParams.get("targetLang") ?? "",
      generationProfile: url.searchParams.get("generationProfile") ?? "",
      voiceProfile: url.searchParams.get("voiceProfile") ?? ""
    };
    if (
      !query.platform ||
      !query.videoId ||
      !query.targetLang ||
      !query.generationProfile ||
      !query.voiceProfile
    ) {
      return v1Error(
        V1_ERROR_CODES.invalidPayload,
        "platform, videoId, targetLang, generationProfile and voiceProfile are required",
        400
      );
    }

    const candidates = await deps.findCandidates({
      platform: query.platform,
      videoId: query.videoId,
      targetLang: query.targetLang
    });
    const dub = selectProfileMatch(candidates, query);
    if (!dub) {
      return v1Error(
        SHARED_LOOKUP_ERROR_CODES.notFound,
        "no shared dub matches this generation profile",
        404
      );
    }

    const rows = await deps.findSegments(dub.id);
    const segments = await Promise.all(
      rows.map(async (row) => ({
        idx: row.idx,
        startMs: row.startMs,
        endMs: row.endMs,
        originalText: row.originalText,
        text: row.text,
        mime: row.mime,
        audioUrl: await deps.presign(row.audioKey)
      }))
    );

    return v1Json({
      id: dub.id,
      platform: dub.platform,
      videoId: dub.videoId,
      sourceLang: dub.sourceLang,
      targetLang: dub.targetLang,
      voice: dub.voice,
      provider: dub.provider,
      title: dub.title,
      durationMs: dub.durationMs,
      visibility: "public",
      generationProfile: dub.generationProfile,
      voiceProfile: dub.voiceProfile,
      rightsAssertedAt: dub.rightsAssertedAt ? new Date(dub.rightsAssertedAt).toISOString() : null,
      aiVoiceDisclosure: AI_VOICE_DISCLOSURE_TEXT,
      segments
    });
  }

  return { lookup };
}
