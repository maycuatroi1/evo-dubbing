import type { CaptionTrackOption, Transcript, VideoContext } from "../types.ts";
import { youtubePlatform } from "./youtube.ts";

export interface CaptionTrackList {
  tracks: CaptionTrackOption[];
  recommendedId: string | null;
}

export interface TranscriptRequest {
  avoidLang?: string;
  trackId?: string;
}

export interface Platform {
  id: string;
  matches(url: string): boolean;
  getVideoContext(): Promise<VideoContext | null>;
  getVideoElement(): HTMLVideoElement | null;
  listCaptionTracks(avoidLang?: string): Promise<CaptionTrackList>;
  getCaptionTranscript(request?: TranscriptRequest): Promise<Transcript | null>;
}

const platforms: Platform[] = [youtubePlatform];

export function resolvePlatform(url: string): Platform | null {
  return platforms.find((p) => p.matches(url)) ?? null;
}
