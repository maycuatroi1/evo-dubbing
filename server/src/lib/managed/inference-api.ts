import { randomUUID } from "node:crypto";
import { TRIAL_QUOTA_MS } from "../account.ts";
import type { ManagedFlags } from "../account.ts";
import { v1Error, v1Json, V1_ERROR_CODES } from "../api-error.ts";
import { requireV1Auth } from "../auth.ts";
import type { SupabaseAuthenticator, UserOperationRateLimiter } from "../auth.ts";
import { MANAGED_CATALOG, ManagedError, TTS_ECONOMY, TTS_PRIMARY } from "./catalog.ts";
import type { ManagedLedger } from "./ledger.ts";
import type { ManagedRouter } from "./provider-router.ts";

export const INFERENCE_ERROR_CODES = {
  invalidBatch: "invalid_batch",
  textTooLarge: "text_too_large",
  unsupportedVoice: "unsupported_voice",
  noEntitlement: "no_entitlement",
  providerUnavailable: "provider_unavailable"
} as const;

export interface InferenceConstraints {
  maxSegments: number;
  maxBatchChars: number;
  maxSegmentChars: number;
  maxTtsChars: number;
  maxCueMs: number;
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseInferenceConstraints(
  env: Record<string, string | undefined>
): InferenceConstraints {
  return {
    maxSegments: intEnv(env.MANAGED_TRANSLATE_MAX_SEGMENTS, 32),
    maxBatchChars: intEnv(env.MANAGED_TRANSLATE_MAX_BATCH_CHARS, 8_000),
    maxSegmentChars: intEnv(env.MANAGED_TRANSLATE_MAX_SEGMENT_CHARS, 1_000),
    maxTtsChars: intEnv(env.MANAGED_TTS_MAX_CHARS, 1_000),
    maxCueMs: intEnv(env.MANAGED_TTS_MAX_CUE_MS, 300_000)
  };
}

export interface VoiceProfile {
  id: string;
  catalogEntryId: string;
  version: string;
}

export const MANAGED_VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "vi-standard-female",
    catalogEntryId: TTS_PRIMARY.id,
    version: TTS_PRIMARY.voiceProfileVersion ?? ""
  },
  {
    id: "vi-economy-female",
    catalogEntryId: TTS_ECONOMY.id,
    version: TTS_ECONOMY.voiceProfileVersion ?? ""
  }
];

const FORBIDDEN_FIELDS = [
  "apiKey",
  "providerKey",
  "key",
  "model",
  "modelId",
  "provider",
  "endpoint",
  "url",
  "price",
  "priceUsd",
  "costMicrousd"
];

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SEGMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface TranslateSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ParsedTranslateBody {
  batchId: string;
  sourceLang: string;
  targetLang: string;
  segments: TranslateSegment[];
}

export interface ParsedTtsBody {
  idempotencyKey: string;
  voiceProfileId: string;
  targetLang: string;
  text: string;
  startMs: number;
  endMs: number;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function forbiddenField(body: Record<string, unknown>): string | null {
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) return field;
  }
  return null;
}

export function parseTranslateBody(
  body: unknown,
  constraints: InferenceConstraints
): ParseResult<ParsedTranslateBody> {
  if (!isRecord(body)) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "body must be a JSON object" };
  }
  const forbidden = forbiddenField(body);
  if (forbidden) {
    return {
      ok: false,
      code: V1_ERROR_CODES.invalidPayload,
      message: `field ${forbidden} is not accepted; provider, model and pricing come from the server catalog`
    };
  }
  const targetLang = body.targetLang;
  if (typeof targetLang !== "string" || targetLang.length < 2 || targetLang.length > 35) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "targetLang is required" };
  }
  const sourceLang = body.sourceLang;
  if (sourceLang !== undefined && (typeof sourceLang !== "string" || sourceLang.length > 35)) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "sourceLang must be a string" };
  }
  let batchId = body.batchId;
  if (batchId === undefined) {
    batchId = randomUUID();
  } else if (typeof batchId !== "string" || !SEGMENT_ID_PATTERN.test(batchId)) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "batchId must match [A-Za-z0-9_-]{1,64}" };
  }
  const rawSegments = body.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return {
      ok: false,
      code: INFERENCE_ERROR_CODES.invalidBatch,
      message: "segments must be a non-empty array"
    };
  }
  if (rawSegments.length > constraints.maxSegments) {
    return {
      ok: false,
      code: INFERENCE_ERROR_CODES.invalidBatch,
      message: `segments exceeds the batch limit of ${constraints.maxSegments}`
    };
  }
  let totalChars = 0;
  let previousEndMs = 0;
  const segments: TranslateSegment[] = [];
  for (let i = 0; i < rawSegments.length; i += 1) {
    const raw = rawSegments[i];
    if (!isRecord(raw)) {
      return { ok: false, code: INFERENCE_ERROR_CODES.invalidBatch, message: `segment ${i} must be an object` };
    }
    const id = raw.id;
    if (typeof id !== "string" || !SEGMENT_ID_PATTERN.test(id)) {
      return {
        ok: false,
        code: INFERENCE_ERROR_CODES.invalidBatch,
        message: `segment ${i} id must match [A-Za-z0-9_-]{1,64}`
      };
    }
    const text = raw.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, code: INFERENCE_ERROR_CODES.invalidBatch, message: `segment ${i} text is required` };
    }
    if (text.length > constraints.maxSegmentChars) {
      return {
        ok: false,
        code: INFERENCE_ERROR_CODES.textTooLarge,
        message: `segment ${i} text exceeds ${constraints.maxSegmentChars} chars`
      };
    }
    totalChars += text.length;
    const cue = raw.cue;
    if (!isRecord(cue) || !isMs(cue.startMs) || !isMs(cue.endMs) || cue.endMs <= cue.startMs) {
      return {
        ok: false,
        code: INFERENCE_ERROR_CODES.invalidBatch,
        message: `segment ${i} cue must have 0 <= startMs < endMs`
      };
    }
    if (cue.endMs - cue.startMs > constraints.maxCueMs) {
      return {
        ok: false,
        code: INFERENCE_ERROR_CODES.invalidBatch,
        message: `segment ${i} cue exceeds ${constraints.maxCueMs} ms`
      };
    }
    if (i > 0 && cue.startMs < previousEndMs) {
      return {
        ok: false,
        code: INFERENCE_ERROR_CODES.invalidBatch,
        message: `segment ${i} overlaps the previous cue; segments must be monotonic and non-overlapping`
      };
    }
    previousEndMs = cue.endMs;
    segments.push({ id, text, startMs: cue.startMs, endMs: cue.endMs });
  }
  if (totalChars > constraints.maxBatchChars) {
    return {
      ok: false,
      code: INFERENCE_ERROR_CODES.textTooLarge,
      message: `batch totals ${totalChars} chars, exceeding the limit of ${constraints.maxBatchChars}`
    };
  }
  return {
    ok: true,
    value: {
      batchId: batchId as string,
      sourceLang: typeof sourceLang === "string" ? sourceLang : "auto",
      targetLang,
      segments
    }
  };
}

export function parseTtsBody(body: unknown, constraints: InferenceConstraints): ParseResult<ParsedTtsBody> {
  if (!isRecord(body)) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "body must be a JSON object" };
  }
  const forbidden = forbiddenField(body);
  if (forbidden) {
    return {
      ok: false,
      code: V1_ERROR_CODES.invalidPayload,
      message: `field ${forbidden} is not accepted; provider, model and pricing come from the server catalog`
    };
  }
  const idempotencyKey = body.idempotencyKey;
  if (typeof idempotencyKey !== "string" || !KEY_PATTERN.test(idempotencyKey)) {
    return {
      ok: false,
      code: V1_ERROR_CODES.invalidPayload,
      message: "idempotencyKey must match [A-Za-z0-9_-]{8,128}"
    };
  }
  const voiceProfileId = body.voiceProfileId;
  if (typeof voiceProfileId !== "string" || !MANAGED_VOICE_PROFILES.some((p) => p.id === voiceProfileId)) {
    return {
      ok: false,
      code: INFERENCE_ERROR_CODES.unsupportedVoice,
      message: `voiceProfileId must be one of: ${MANAGED_VOICE_PROFILES.map((p) => p.id).join(", ")}`
    };
  }
  const targetLang = body.targetLang;
  if (typeof targetLang !== "string" || targetLang.length < 2 || targetLang.length > 35) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "targetLang is required" };
  }
  const text = body.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, code: V1_ERROR_CODES.invalidPayload, message: "text is required" };
  }
  if (text.length > constraints.maxTtsChars) {
    return {
      ok: false,
      code: INFERENCE_ERROR_CODES.textTooLarge,
      message: `text exceeds ${constraints.maxTtsChars} chars`
    };
  }
  const cue = body.cue;
  if (!isRecord(cue) || !isMs(cue.startMs) || !isMs(cue.endMs) || cue.endMs <= cue.startMs) {
    return {
      ok: false,
      code: V1_ERROR_CODES.invalidPayload,
      message: "cue must have 0 <= startMs < endMs"
    };
  }
  if (cue.endMs - cue.startMs > constraints.maxCueMs) {
    return {
      ok: false,
      code: V1_ERROR_CODES.invalidPayload,
      message: `cue exceeds ${constraints.maxCueMs} ms`
    };
  }
  return {
    ok: true,
    value: {
      idempotencyKey,
      voiceProfileId,
      targetLang,
      text,
      startMs: cue.startMs,
      endMs: cue.endMs
    }
  };
}

export function managedErrorResponse(err: unknown): Response {
  if (err instanceof ManagedError) {
    switch (err.code) {
      case "inference_disabled":
        return v1Error(err.code, err.message, 403);
      case "quota_exceeded":
        return v1Error(err.code, err.message, 402);
      case "budget_exceeded":
        return v1Error(err.code, err.message, 503);
      case "text_exceeds_cue":
        return v1Error(err.code, err.message, 400);
      case "request_in_progress":
      case "reservation_conflict":
      case "invalid_state":
        return v1Error(err.code, err.message, 409);
      case "provider_http_error":
      case "provider_unreachable":
      case "provider_bad_response":
        return v1Error(INFERENCE_ERROR_CODES.providerUnavailable, err.message, 502);
      default:
        return v1Error(V1_ERROR_CODES.internal, "managed inference failed", 500);
    }
  }
  return v1Error(V1_ERROR_CODES.internal, "managed inference failed", 500);
}

export interface InferenceApiDeps {
  authenticator: SupabaseAuthenticator;
  limiter: UserOperationRateLimiter;
  router: ManagedRouter;
  ledger: ManagedLedger;
  flags: () => ManagedFlags;
  trialUsedMs: (accountId: string) => Promise<number>;
  constraints?: InferenceConstraints;
}

export interface InferenceHandlers {
  translate: (request: Request) => Promise<Response>;
  tts: (request: Request) => Promise<Response>;
}

function authFailure(auth: { status: number; code: string; message: string; retryAfterSec?: number }): Response {
  const headers: Record<string, string> = {};
  if (auth.retryAfterSec) headers["retry-after"] = String(auth.retryAfterSec);
  return v1Error(auth.code, auth.message, auth.status, headers);
}

export function createInferenceHandlers(deps: InferenceApiDeps): InferenceHandlers {
  const constraints = deps.constraints ?? parseInferenceConstraints(process.env);

  async function gate(userId: string): Promise<Response | null> {
    if (!deps.flags().inference) {
      return v1Error("inference_disabled", "managed inference is not enabled", 403);
    }
    const period = await deps.ledger.activePeriod(userId);
    if (!period && !deps.flags().trial) {
      return v1Error(
        INFERENCE_ERROR_CODES.noEntitlement,
        "no active subscription period and managed trial is disabled",
        402
      );
    }
    return null;
  }

  async function remainingSourceMs(userId: string): Promise<number> {
    const period = await deps.ledger.activePeriod(userId);
    const periodRemaining = period ? Math.max(0, period.quotaMs - period.usedMs) : 0;
    const trialRemaining = deps.flags().trial
      ? Math.max(0, TRIAL_QUOTA_MS - (await deps.trialUsedMs(userId)))
      : 0;
    return periodRemaining + trialRemaining;
  }

  async function translate(request: Request): Promise<Response> {
    const auth = await requireV1Auth(request, deps.authenticator, deps.limiter, "inference.translate");
    if (!auth.ok) return authFailure(auth);
    const gated = await gate(auth.userId);
    if (gated) return gated;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = parseTranslateBody(body, constraints);
    if (!parsed.ok) return v1Error(parsed.code, parsed.message, 400);

    const translations: Array<{
      id: string;
      requestId: string;
      text: string;
      startMs: number;
      endMs: number;
    }> = [];
    for (const segment of parsed.value.segments) {
      const requestId = `tr:${auth.userId}:${parsed.value.batchId}:${segment.id}`;
      try {
        const result = await deps.router.translateText({
          accountId: auth.userId,
          requestKey: requestId,
          text: segment.text,
          sourceLang: parsed.value.sourceLang,
          targetLang: parsed.value.targetLang,
          cueDurationMs: segment.endMs - segment.startMs
        });
        translations.push({
          id: segment.id,
          requestId,
          text: result.text,
          startMs: segment.startMs,
          endMs: segment.endMs
        });
      } catch (err) {
        return managedErrorResponse(err);
      }
    }
    return v1Json({ batchId: parsed.value.batchId, translations });
  }

  async function tts(request: Request): Promise<Response> {
    const auth = await requireV1Auth(request, deps.authenticator, deps.limiter, "inference.tts");
    if (!auth.ok) return authFailure(auth);
    const gated = await gate(auth.userId);
    if (gated) return gated;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = parseTtsBody(body, constraints);
    if (!parsed.ok) return v1Error(parsed.code, parsed.message, 400);

    const cueDurationMs = parsed.value.endMs - parsed.value.startMs;
    const requestId = `tts:${auth.userId}:${parsed.value.idempotencyKey}`;
    try {
      const result = await deps.router.synthesizeSpeech({
        accountId: auth.userId,
        requestKey: requestId,
        text: parsed.value.text,
        targetLang: parsed.value.targetLang,
        cueDurationMs
      });
      const serving = MANAGED_CATALOG.find((entry) => entry.id === result.provider);
      const chargedSourceMs = result.replay || result.cacheHit ? 0 : cueDurationMs;
      const payload: Record<string, unknown> = {
        requestId,
        chargedSourceMs,
        remainingMs: await remainingSourceMs(auth.userId),
        voiceProfileVersion: serving?.voiceProfileVersion ?? "",
        cacheHit: result.cacheHit,
        replayed: result.replay
      };
      if (result.url) {
        payload.audioUrl = result.url;
      } else if (result.audioBase64) {
        payload.audioBase64 = result.audioBase64;
      } else if (result.audioKey) {
        payload.audioKey = result.audioKey;
      }
      return v1Json(payload);
    } catch (err) {
      return managedErrorResponse(err);
    }
  }

  return { translate, tts };
}
