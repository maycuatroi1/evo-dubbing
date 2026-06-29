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

interface MoviePlayer extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse;
  getVideoData?: () => { video_id?: string; title?: string };
  getDuration?: () => number;
}

interface YtCfg {
  get?: (key: string) => unknown;
}

function moviePlayer(): MoviePlayer | null {
  return document.getElementById("movie_player") as MoviePlayer | null;
}

function getPlayerResponse(): PlayerResponse | null {
  const player = moviePlayer();
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

function captionsFromResponse(pr: PlayerResponse | null | undefined): CaptionTrack[] {
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return tracks
    .filter((t) => t.baseUrl)
    .map((t) => ({
      languageCode: t.languageCode,
      name: trackName(t),
      baseUrl: t.baseUrl,
      kind: t.kind ?? "standard"
    }));
}

function currentVideoId(): string | null {
  const data = moviePlayer()?.getVideoData?.();
  if (data?.video_id) return data.video_id;
  const pr = getPlayerResponse();
  if (pr?.videoDetails?.videoId) return pr.videoDetails.videoId;
  try {
    return new URL(location.href).searchParams.get("v");
  } catch {
    return null;
  }
}

async function fetchPlayerViaInnertube(videoId: string): Promise<PlayerResponse | null> {
  try {
    const cfg = (window as unknown as { ytcfg?: YtCfg }).ytcfg;
    const key = cfg?.get?.("INNERTUBE_API_KEY") as string | undefined;
    const context = cfg?.get?.("INNERTUBE_CONTEXT");
    if (!key || !context) return null;
    const res = await fetch(`/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ videoId, context, contentCheckOk: true, racyCheckOk: true })
    });
    if (!res.ok) return null;
    return (await res.json()) as PlayerResponse;
  } catch {
    return null;
  }
}

function readPlayerInfo(): PlayerInfo | null {
  const pr = getPlayerResponse();
  const d = pr?.videoDetails;
  const vid = d?.videoId ?? currentVideoId();
  if (!vid) return null;
  const durationFromPlayer = moviePlayer()?.getDuration?.();
  return {
    videoId: vid,
    title: d?.title ?? moviePlayer()?.getVideoData?.()?.title ?? "",
    durationMs: d?.lengthSeconds
      ? Number(d.lengthSeconds) * 1000
      : durationFromPlayer
      ? Math.round(durationFromPlayer * 1000)
      : 0
  };
}

async function readCaptionTracks(): Promise<CaptionTrack[]> {
  let tracks = captionsFromResponse(getPlayerResponse());
  if (tracks.length) return tracks;

  const initial = (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  tracks = captionsFromResponse(initial);
  if (tracks.length) return tracks;

  const vid = currentVideoId();
  if (vid) {
    tracks = captionsFromResponse(await fetchPlayerViaInnertube(vid));
    if (tracks.length) return tracks;
  }

  return [];
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
    if (req.kind === "getCaptionTracks") return { kind: "captionTracks", tracks: await readCaptionTracks() };
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
