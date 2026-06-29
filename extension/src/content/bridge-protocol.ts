export const BRIDGE_REQ = "evo-dub-req";
export const BRIDGE_RES = "evo-dub-res";

export interface CaptionTrack {
  languageCode: string;
  name: string;
  baseUrl: string;
  kind: string;
}

export interface PlayerInfo {
  videoId: string;
  title: string;
  durationMs: number;
}

export type BridgeRequest =
  | { kind: "getPlayerInfo" }
  | { kind: "getCaptionTracks" }
  | { kind: "fetchCaption"; baseUrl: string };

export interface CaptionEvent {
  startMs: number;
  endMs: number;
  text: string;
}

export type BridgeResult =
  | { kind: "playerInfo"; info: PlayerInfo | null }
  | { kind: "captionTracks"; tracks: CaptionTrack[] }
  | { kind: "caption"; events: CaptionEvent[] }
  | { kind: "error"; message: string };

export interface BridgeEnvelope<T> {
  channel: typeof BRIDGE_REQ | typeof BRIDGE_RES;
  id: number;
  payload: T;
}
