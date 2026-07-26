import { getValidAccessToken } from "./auth.ts";
import { normalizeBaseUrl } from "./config.ts";
import { MANAGED_GENERATION_PROFILE, getManagedVoiceProfile } from "./profiles.ts";
import type { ManagedLookupDubPayload, ManagedTranslatePayload, ManagedTtsPayload, RuntimeResponse } from "./protocol.ts";

async function ensureHostPermission(baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin + "/*";
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    await chrome.permissions.request({ origins: [origin] });
  }
}

export async function managedAuthedFetch(
  baseUrl: string,
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown> }
): Promise<RuntimeResponse> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return { ok: false, status: 0, code: "missing_base_url", error: "Set the managed server URL first." };
  }
  const token = await getValidAccessToken();
  if (!token) {
    return { ok: false, status: 401, code: "not_signed_in", error: "Sign in with Google to use managed dubbing." };
  }
  await ensureHostPermission(base);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    });
  } catch (err) {
    return { ok: false, status: 0, code: "network_error", error: err instanceof Error ? err.message : String(err) };
  }
  const parsed = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | Record<string, unknown>
    | null;
  if (!res.ok) {
    const envelope =
      parsed && typeof parsed === "object" && "error" in parsed
        ? (parsed as { error?: { code?: string; message?: string } }).error
        : undefined;
    const code = envelope?.code ?? "http_error";
    const message = envelope?.message ?? res.statusText;
    return { ok: false, status: res.status, code, error: message || `HTTP ${res.status}` };
  }
  return { ok: true, data: parsed };
}

async function managedFetch(baseUrl: string, path: string, body: Record<string, unknown>): Promise<RuntimeResponse> {
  return managedAuthedFetch(baseUrl, path, { method: "POST", body });
}

const SEGMENT_ID_PATTERN = /[^A-Za-z0-9_-]/g;

export async function handleManagedTranslate(payload: ManagedTranslatePayload): Promise<RuntimeResponse> {
  let previousEndMs = 0;
  const segments = payload.segments.map((seg, i) => {
    const startMs = Math.max(seg.startMs, previousEndMs);
    const endMs = Math.max(seg.endMs, startMs + 1);
    previousEndMs = endMs;
    return {
      id: `s${seg.idx}`.replace(SEGMENT_ID_PATTERN, "_") || `s${i}`,
      text: seg.text,
      cue: { startMs, endMs }
    };
  });
  return managedFetch(payload.baseUrl, "/api/v1/inference/translate", {
    sourceLang: payload.sourceLang,
    targetLang: payload.targetLang,
    segments
  });
}

export async function handleManagedTts(payload: ManagedTtsPayload): Promise<RuntimeResponse> {
  const startMs = Math.max(0, Math.floor(payload.cue.startMs));
  const endMs = Math.max(startMs + 1, Math.floor(payload.cue.endMs));
  return managedFetch(payload.baseUrl, "/api/v1/inference/tts", {
    idempotencyKey: payload.idempotencyKey.replace(SEGMENT_ID_PATTERN, "_").slice(0, 128),
    voiceProfileId: payload.voiceProfileId,
    targetLang: payload.targetLang,
    text: payload.text,
    cue: { startMs, endMs }
  });
}

export async function handleManagedLookupDub(payload: ManagedLookupDubPayload): Promise<RuntimeResponse> {
  const profile = getManagedVoiceProfile(payload.voiceProfileId);
  const params = new URLSearchParams({
    platform: payload.platform,
    videoId: payload.videoId,
    targetLang: payload.targetLang,
    generationProfile: MANAGED_GENERATION_PROFILE,
    voiceProfile: profile.version
  });
  return managedAuthedFetch(payload.baseUrl, `/api/v1/dubs/lookup?${params.toString()}`, { method: "GET" });
}
