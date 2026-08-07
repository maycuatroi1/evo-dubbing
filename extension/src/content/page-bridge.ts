import {
  BRIDGE_REQ,
  BRIDGE_RES,
  type BridgeEnvelope,
  type BridgeRequest,
  type BridgeResult,
  type CaptionEvent,
  type PlayerInfo
} from "./bridge-protocol.ts";
import {
  MAX_TRACK_ATTEMPTS,
  coverageOf,
  describeTracks,
  isUsable,
  rankTracks,
  type CaptionsTracklist,
  type RankedTrack,
  type RawCaptionTrack
} from "./caption-tracks.ts";

interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; lengthSeconds?: string; channelId?: string; author?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: CaptionsTracklist;
  };
}

interface MoviePlayer extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse;
  getVideoData?: () => { video_id?: string; title?: string };
  getDuration?: () => number;
  loadModule?: (module: string) => void;
  setOption?: (module: string, name: string, value: unknown) => void;
  getOption?: (module: string, name: string) => unknown;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

let capturedPot: string | null = null;
let capturedTimedTextUrl: string | null = null;

function captureFromUrl(raw: string): void {
  try {
    if (!raw.includes("timedtext")) return;
    capturedTimedTextUrl = raw;
    const pot = new URL(raw, location.origin).searchParams.get("pot");
    if (pot) capturedPot = pot;
  } catch {
    // ignore
  }
}

(function installNetworkHook() {
  const w = window as unknown as {
    __evoDubHooked?: boolean;
    fetch: typeof fetch;
    XMLHttpRequest: typeof XMLHttpRequest;
  };
  if (w.__evoDubHooked) return;
  w.__evoDubHooked = true;

  const originalFetch = w.fetch;
  w.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url) captureFromUrl(url);
    } catch {
      // ignore
    }
    return originalFetch.apply(this as typeof globalThis, [input, init]);
  };

  const open = w.XMLHttpRequest?.prototype?.open;
  if (open) {
    w.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, _method: string, url: string | URL) {
      try {
        captureFromUrl(typeof url === "string" ? url : url.href);
      } catch {
        // ignore
      }
      return open.apply(this, arguments as unknown as Parameters<typeof open>);
    };
  }
})();

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

function readTracklist(): CaptionsTracklist {
  const fromPlayer = getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer;
  if (fromPlayer?.captionTracks?.length) return fromPlayer;
  const initial = (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  return initial?.captions?.playerCaptionsTracklistRenderer ?? {};
}

function readTracks(): RawCaptionTrack[] {
  return (readTracklist().captionTracks ?? []).filter((t) => t.baseUrl);
}

function rankCurrentTracks(tracks: RawCaptionTrack[], avoidLang?: string): RankedTrack[] {
  return rankTracks(readTracklist(), tracks, avoidLang);
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

function readPlayerInfo(): PlayerInfo | null {
  const pr = getPlayerResponse();
  const d = pr?.videoDetails;
  const vid = d?.videoId ?? currentVideoId();
  if (!vid) return null;
  const playerDuration = moviePlayer()?.getDuration?.();
  return {
    videoId: vid,
    title: d?.title ?? moviePlayer()?.getVideoData?.()?.title ?? "",
    durationMs: d?.lengthSeconds
      ? Number(d.lengthSeconds) * 1000
      : playerDuration
      ? Math.round(playerDuration * 1000)
      : 0,
    channelId: d?.channelId ?? "",
    channelName: d?.author ?? ""
  };
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

async function ensurePot(chosenLang: string, tracks: RawCaptionTrack[]): Promise<void> {
  if (capturedPot) return;
  const mp = moviePlayer();
  if (!mp?.setOption) return;

  let previous: unknown;
  try {
    previous = mp.getOption?.("captions", "track");
  } catch {
    previous = undefined;
  }

  try {
    mp.loadModule?.("captions");
  } catch {
    // ignore
  }

  const trigger = tracks.find((t) => t.languageCode !== chosenLang) ?? tracks[0];
  try {
    mp.setOption("captions", "track", { languageCode: trigger.languageCode });
  } catch {
    // ignore
  }
  await waitFor(() => !!capturedPot, 4000);

  if (!capturedPot) {
    try {
      mp.setOption("captions", "track", { languageCode: chosenLang });
    } catch {
      // ignore
    }
    await waitFor(() => !!capturedPot, 3000);
  }

  try {
    mp.setOption("captions", "track", previous && typeof previous === "object" ? previous : {});
  } catch {
    // ignore
  }
}

function buildTimedTextUrl(baseUrl: string): string {
  let url = baseUrl;
  if (!/[?&]fmt=/.test(url)) url += "&fmt=json3";
  if (!/[?&]c=/.test(url)) url += "&c=WEB";
  if (capturedPot && !/[?&]pot=/.test(url)) url += "&potc=1&pot=" + encodeURIComponent(capturedPot);
  return url;
}

function withLang(fullUrl: string, lang: string): string {
  try {
    const u = new URL(fullUrl, location.origin);
    u.searchParams.set("lang", lang);
    u.searchParams.set("fmt", "json3");
    return u.toString();
  } catch {
    return fullUrl;
  }
}

function parseJson3(data: { events?: Json3Event[] }): CaptionEvent[] {
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

async function loadEvents(url: string): Promise<CaptionEvent[]> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text) return [];
    return parseJson3(JSON.parse(text) as { events?: Json3Event[] });
  } catch {
    return [];
  }
}

async function loadTrackEvents(track: RawCaptionTrack): Promise<CaptionEvent[]> {
  const events = await loadEvents(buildTimedTextUrl(track.baseUrl));
  if (events.length > 0 || !capturedTimedTextUrl) return events;
  return loadEvents(withLang(capturedTimedTextUrl, track.languageCode));
}

function listCaptionTracks(avoidLang?: string): BridgeResult {
  const ranked = rankCurrentTracks(readTracks(), avoidLang);
  return {
    kind: "captionTracks",
    tracks: describeTracks(ranked),
    recommendedId: ranked[0]?.id ?? null
  };
}

async function fetchTranscript(avoidLang?: string, trackId?: string): Promise<BridgeResult> {
  const tracks = readTracks();
  if (tracks.length === 0) return { kind: "error", message: "no-captions" };

  const ranked = rankCurrentTracks(tracks, avoidLang);
  const pinned = trackId ? ranked.find((entry) => entry.id === trackId) : undefined;
  const candidates = pinned ? [pinned] : ranked.slice(0, MAX_TRACK_ATTEMPTS);
  const durationMs = readPlayerInfo()?.durationMs ?? 0;

  await ensurePot(candidates[0].track.languageCode, tracks);

  let best: { entry: RankedTrack; events: CaptionEvent[]; coverage: number } | null = null;
  for (const entry of candidates) {
    const events = await loadTrackEvents(entry.track);
    const coverage = coverageOf(events, durationMs);
    if (!best || coverage > best.coverage) best = { entry, events, coverage };
    if (isUsable(events, coverage, durationMs)) break;
  }

  if (!best || best.events.length === 0) return { kind: "error", message: "empty-timedtext" };
  return {
    kind: "transcript",
    lang: best.entry.track.languageCode,
    trackId: best.entry.id,
    coverage: best.coverage,
    events: best.events
  };
}

async function handle(req: BridgeRequest): Promise<BridgeResult> {
  try {
    if (req.kind === "getPlayerInfo") return { kind: "playerInfo", info: readPlayerInfo() };
    if (req.kind === "listCaptionTracks") return listCaptionTracks(req.avoidLang);
    if (req.kind === "fetchTranscript") return await fetchTranscript(req.avoidLang, req.trackId);
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
