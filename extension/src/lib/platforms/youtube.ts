import type { Transcript, VideoContext } from "../types.ts";
import type { CaptionTrackList, Platform, TranscriptRequest } from "./index.ts";
import {
  BRIDGE_REQ,
  BRIDGE_RES,
  type BridgeEnvelope,
  type BridgeRequest,
  type BridgeResult
} from "../../content/bridge-protocol.ts";

let counter = 0;
const pending = new Map<number, (result: BridgeResult) => void>();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeEnvelope<BridgeResult> | undefined;
  if (!data || data.channel !== BRIDGE_RES) return;
  const cb = pending.get(data.id);
  if (cb) {
    pending.delete(data.id);
    cb(data.payload);
  }
});

function bridge(req: BridgeRequest, timeoutMs = 30000): Promise<BridgeResult> {
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("page bridge timeout"));
    }, timeoutMs);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    const envelope: BridgeEnvelope<BridgeRequest> = { channel: BRIDGE_REQ, id, payload: req };
    window.postMessage(envelope, "*");
  });
}

function videoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] ?? null;
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] ?? null;
    return null;
  } catch {
    return null;
  }
}

function channelFromDom(): { channelId: string; channelName: string } {
  const link = document.querySelector<HTMLAnchorElement>(
    "ytd-video-owner-renderer ytd-channel-name a, #owner ytd-channel-name a"
  );
  const href = link?.getAttribute("href") ?? "";
  const match = /^\/(channel\/[A-Za-z0-9_-]+|@[A-Za-z0-9_.-]+)/.exec(href);
  return {
    channelId: match ? match[1].replace(/^channel\//, "") : "",
    channelName: link?.textContent?.trim() ?? ""
  };
}

export const youtubePlatform: Platform = {
  id: "youtube",

  matches(url: string) {
    return /^https:\/\/(www\.)?youtube\.com\//.test(url);
  },

  async getVideoContext(): Promise<VideoContext | null> {
    const res = await bridge({ kind: "getPlayerInfo" });
    if (res.kind !== "playerInfo" || !res.info) {
      const fallbackId = videoIdFromUrl(location.href);
      if (!fallbackId) return null;
      const video = this.getVideoElement();
      const dom = channelFromDom();
      return {
        platform: "youtube",
        videoId: fallbackId,
        title: document.title.replace(/ - YouTube$/, ""),
        url: location.href,
        durationMs: video ? Math.round(video.duration * 1000) : 0,
        channelId: dom.channelId,
        channelName: dom.channelName
      };
    }
    return {
      platform: "youtube",
      videoId: res.info.videoId,
      title: res.info.title,
      url: location.href,
      durationMs: res.info.durationMs,
      channelId: res.info.channelId ?? "",
      channelName: res.info.channelName ?? ""
    };
  },

  getVideoElement(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>(".html5-main-video, #movie_player video");
  },

  getPlayerRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".html5-video-player");
  },

  getProgressBar(): HTMLElement | null {
    // .ytp-progress-bar spans the full duration even on chaptered videos, where each chapter
    // gets its own .ytp-progress-list and no single list covers the whole timeline.
    return (
      document.querySelector<HTMLElement>(".ytp-progress-bar") ??
      document.querySelector<HTMLElement>(".ytp-progress-bar-container")
    );
  },

  async listCaptionTracks(avoidLang?: string): Promise<CaptionTrackList> {
    const res = await bridge({ kind: "listCaptionTracks", avoidLang });
    if (res.kind !== "captionTracks") return { tracks: [], recommendedId: null };
    return { tracks: res.tracks, recommendedId: res.recommendedId };
  },

  async getCaptionTranscript(request?: TranscriptRequest): Promise<Transcript | null> {
    const res = await bridge({
      kind: "fetchTranscript",
      avoidLang: request?.avoidLang,
      trackId: request?.trackId
    });
    if (res.kind !== "transcript" || res.events.length === 0) return null;

    const segments = res.events.map((ev, idx) => ({
      idx,
      startMs: ev.startMs,
      endMs: ev.endMs,
      text: ev.text
    }));

    return {
      source: "captions",
      lang: res.lang,
      trackId: res.trackId,
      coverage: res.coverage,
      segments
    };
  }
};
