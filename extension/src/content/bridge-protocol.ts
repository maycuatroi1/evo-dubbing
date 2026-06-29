export const BRIDGE_REQ = "evo-dub-req";
export const BRIDGE_RES = "evo-dub-res";

export interface PlayerInfo {
  videoId: string;
  title: string;
  durationMs: number;
}

export interface CaptionEvent {
  startMs: number;
  endMs: number;
  text: string;
}

export type BridgeRequest =
  | { kind: "getPlayerInfo" }
  | { kind: "fetchTranscript"; avoidLang?: string };

export type BridgeResult =
  | { kind: "playerInfo"; info: PlayerInfo | null }
  | { kind: "transcript"; lang: string; events: CaptionEvent[] }
  | { kind: "error"; message: string };

export interface BridgeEnvelope<T> {
  channel: typeof BRIDGE_REQ | typeof BRIDGE_RES;
  id: number;
  payload: T;
}
