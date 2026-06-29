import type { Transcript, VideoContext } from "../types";
import { youtubePlatform } from "./youtube";

export interface Platform {
  id: string;
  matches(url: string): boolean;
  getVideoContext(): Promise<VideoContext | null>;
  getVideoElement(): HTMLVideoElement | null;
  getCaptionTranscript(preferAgainstLang?: string): Promise<Transcript | null>;
}

const platforms: Platform[] = [youtubePlatform];

export function resolvePlatform(url: string): Platform | null {
  return platforms.find((p) => p.matches(url)) ?? null;
}
