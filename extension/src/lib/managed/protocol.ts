import type { BillingMode } from "../types.ts";

export interface ManagedTranslateSegment {
  idx: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ManagedTranslatePayload {
  baseUrl: string;
  sourceLang: string;
  targetLang: string;
  segments: ManagedTranslateSegment[];
}

export interface ManagedTtsPayload {
  baseUrl: string;
  idempotencyKey: string;
  voiceProfileId: string;
  targetLang: string;
  text: string;
  cue: { startMs: number; endMs: number };
}

export type AuthMessage =
  | { type: "auth.signIn" }
  | { type: "auth.signOut" }
  | { type: "auth.refresh" }
  | { type: "auth.getState" };

export type ManagedMessage =
  | { type: "managed.translate"; payload: ManagedTranslatePayload }
  | { type: "managed.tts"; payload: ManagedTtsPayload }
  | { type: "managed.account"; payload: ManagedAccountPayload }
  | { type: "managed.checkout"; payload: ManagedCheckoutPayload }
  | { type: "managed.lookupDub"; payload: ManagedLookupDubPayload }
  | { type: "events.playback"; payload: EventsPlaybackPayload };

export interface EventsPlaybackPayload {
  baseUrl: string;
  platform: string;
  videoId: string;
  channelId?: string;
  channelName?: string;
}

export interface ManagedLookupDubPayload {
  baseUrl: string;
  platform: string;
  videoId: string;
  targetLang: string;
  voiceProfileId: string;
}

export interface ManagedAccountPayload {
  baseUrl: string;
}

export interface ManagedCheckoutPayload {
  baseUrl: string;
  planId?: string;
}

export type RuntimeMessage = AuthMessage | ManagedMessage;

export type RuntimeMessageType = RuntimeMessage["type"];

export const RUNTIME_MESSAGE_TYPES: RuntimeMessageType[] = [
  "auth.signIn",
  "auth.signOut",
  "auth.refresh",
  "auth.getState",
  "managed.translate",
  "managed.tts",
  "managed.account",
  "managed.checkout",
  "managed.lookupDub",
  "events.playback"
];

export type RuntimeResponse =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: string; error: string };

export interface ManagedTranslateResult {
  translations: { idx: number; text: string }[];
}

export interface ManagedTtsResult {
  audio?: ArrayBuffer;
  audioUrl?: string;
  mime: string;
  chargedSourceMs: number;
  remainingMs: number;
  voiceProfileVersion: string;
}

export interface ManagedBackendContext {
  billingMode: BillingMode;
  managedBaseUrl: string;
  managedVoiceProfileId: string;
}
