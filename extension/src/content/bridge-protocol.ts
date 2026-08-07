export const BRIDGE_REQ = "evo-dub-req";
export const BRIDGE_RES = "evo-dub-res";

export interface PlayerInfo {
  videoId: string;
  title: string;
  durationMs: number;
  channelId?: string;
  channelName?: string;
}

export interface CaptionEvent {
  startMs: number;
  endMs: number;
  text: string;
}

export interface CaptionTrackInfo {
  id: string;
  lang: string;
  name: string;
  auto: boolean;
  primary: boolean;
}

export type BridgeRequest =
  | { kind: "getPlayerInfo" }
  | { kind: "listCaptionTracks"; avoidLang?: string }
  | { kind: "fetchTranscript"; avoidLang?: string; trackId?: string };

export type BridgeResult =
  | { kind: "playerInfo"; info: PlayerInfo | null }
  | { kind: "captionTracks"; tracks: CaptionTrackInfo[]; recommendedId: string | null }
  | { kind: "transcript"; lang: string; trackId: string; coverage: number; events: CaptionEvent[] }
  | { kind: "error"; message: string };

export interface BridgeEnvelope<T> {
  channel: typeof BRIDGE_REQ | typeof BRIDGE_RES;
  id: number;
  payload: T;
}
