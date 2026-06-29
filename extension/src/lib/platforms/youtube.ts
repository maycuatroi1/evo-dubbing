import type { Transcript, VideoContext } from "../types";
import type { Platform } from "./index";
import {
  BRIDGE_REQ,
  BRIDGE_RES,
  type BridgeEnvelope,
  type BridgeRequest,
  type BridgeResult
} from "../../content/bridge-protocol";

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
      return {
        platform: "youtube",
        videoId: fallbackId,
        title: document.title.replace(/ - YouTube$/, ""),
        url: location.href,
        durationMs: video ? Math.round(video.duration * 1000) : 0
      };
    }
    return {
      platform: "youtube",
      videoId: res.info.videoId,
      title: res.info.title,
      url: location.href,
      durationMs: res.info.durationMs
    };
  },

  getVideoElement(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>(".html5-main-video, #movie_player video");
  },

  async getCaptionTranscript(preferAgainstLang?: string): Promise<Transcript | null> {
    const res = await bridge({ kind: "fetchTranscript", avoidLang: preferAgainstLang });
    if (res.kind !== "transcript" || res.events.length === 0) return null;

    const segments = res.events.map((ev, idx) => ({
      idx,
      startMs: ev.startMs,
      endMs: ev.endMs,
      text: ev.text
    }));

    return { source: "captions", lang: res.lang, segments };
  }
};
