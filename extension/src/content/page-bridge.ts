import {
  BRIDGE_REQ,
  BRIDGE_RES,
  type BridgeEnvelope,
  type BridgeRequest,
  type BridgeResult,
  type CaptionTrack,
  type CaptionEvent,
  type PlayerInfo
} from "./bridge-protocol";

interface RawCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; lengthSeconds?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: RawCaptionTrack[] };
  };
}

function getPlayerResponse(): PlayerResponse | null {
  const player = document.getElementById("movie_player") as
    | (HTMLElement & { getPlayerResponse?: () => PlayerResponse })
    | null;
  if (player?.getPlayerResponse) {
    try {
      const pr = player.getPlayerResponse();
      if (pr?.videoDetails?.videoId) return pr;
    } catch {
      // fall through
    }
  }
  const initial = (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  return initial ?? null;
}

function trackName(track: RawCaptionTrack): string {
  return track.name?.simpleText ?? track.name?.runs?.map((r) => r.text).join("") ?? track.languageCode;
}

function readPlayerInfo(): PlayerInfo | null {
  const pr = getPlayerResponse();
  const d = pr?.videoDetails;
  if (!d?.videoId) return null;
  return {
    videoId: d.videoId,
    title: d.title ?? "",
    durationMs: d.lengthSeconds ? Number(d.lengthSeconds) * 1000 : 0
  };
}

function readCaptionTracks(): CaptionTrack[] {
  const pr = getPlayerResponse();
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return tracks.map((t) => ({
    languageCode: t.languageCode,
    name: trackName(t),
    baseUrl: t.baseUrl,
    kind: t.kind ?? "standard"
  }));
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

async function fetchCaption(baseUrl: string): Promise<CaptionEvent[]> {
  const url = baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}&fmt=json3`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`timedtext ${res.status}`);
  const data = (await res.json()) as { events?: Json3Event[] };
  const out: CaptionEvent[] = [];
  for (const ev of data.events ?? []) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = ev.tStartMs ?? 0;
    out.push({ startMs: start, endMs: start + (ev.dDurationMs ?? 0), text });
  }
  return out;
}

async function handle(req: BridgeRequest): Promise<BridgeResult> {
  try {
    if (req.kind === "getPlayerInfo") return { kind: "playerInfo", info: readPlayerInfo() };
    if (req.kind === "getCaptionTracks") return { kind: "captionTracks", tracks: readCaptionTracks() };
    if (req.kind === "fetchCaption") return { kind: "caption", events: await fetchCaption(req.baseUrl) };
    return { kind: "error", message: "unknown request" };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeEnvelope<BridgeRequest> | undefined;
  if (!data || data.channel !== BRIDGE_REQ) return;
  handle(data.payload).then((result) => {
    const envelope: BridgeEnvelope<BridgeResult> = {
      channel: BRIDGE_RES,
      id: data.id,
      payload: result
    };
    window.postMessage(envelope, "*");
  });
});
