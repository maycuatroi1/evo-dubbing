import { normalizeBaseUrl } from "./config.ts";
import type { EventsPlaybackPayload, RuntimeResponse } from "./protocol.ts";

const INSTALL_ID_KEY = "evoDubbingInstallId";

export async function getOrCreateInstallId(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTALL_ID_KEY);
  const existing = stored[INSTALL_ID_KEY];
  if (typeof existing === "string" && existing.length >= 8) return existing;
  const installId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_ID_KEY]: installId });
  return installId;
}

export async function handlePlaybackEvent(payload: EventsPlaybackPayload): Promise<RuntimeResponse> {
  const base = normalizeBaseUrl(payload.baseUrl);
  if (!base || !payload.platform || !payload.videoId) {
    return { ok: false, status: 0, code: "invalid_payload", error: "baseUrl, platform and videoId are required" };
  }
  const installId = await getOrCreateInstallId();
  try {
    const res = await fetch(`${base}/api/v1/events/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: payload.platform,
        videoId: payload.videoId,
        installId,
        channelId: payload.channelId ?? "",
        channelName: payload.channelName ?? ""
      })
    });
    if (!res.ok) {
      return { ok: false, status: res.status, code: "http_error", error: `HTTP ${res.status}` };
    }
    return { ok: true, data: await res.json().catch(() => ({})) };
  } catch (err) {
    return { ok: false, status: 0, code: "network_error", error: err instanceof Error ? err.message : String(err) };
  }
}
