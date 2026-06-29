import type { ProviderId, Transcript } from "../types";
import { openaiProvider } from "./openai";
import { geminiProvider } from "./gemini";

export interface TranslateBatch {
  segments: { idx: number; text: string }[];
  sourceLang: string;
  targetLang: string;
  model: string;
}

export interface TranslatedSegment {
  idx: number;
  text: string;
}

export interface TtsRequest {
  text: string;
  voice: string;
  model: string;
}

export interface TtsResult {
  audio: ArrayBuffer;
  mime: string;
}

export interface SttRequest {
  audio: ArrayBuffer;
  mime: string;
  filename: string;
  model: string;
  language?: string;
}

export interface VoiceOption {
  id: string;
  label: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  translateModels: string[];
  ttsModels: string[];
  sttModels: string[];
  voices: VoiceOption[];
  translate(batch: TranslateBatch, key: string): Promise<TranslatedSegment[]>;
  tts(req: TtsRequest, key: string): Promise<TtsResult>;
  stt(req: SttRequest, key: string): Promise<Transcript>;
}

const registry: Record<ProviderId, Provider> = {
  openai: openaiProvider,
  gemini: geminiProvider
};

export function getProvider(id: ProviderId): Provider {
  const provider = registry[id];
  if (!provider) throw new Error(`unknown provider: ${id}`);
  return provider;
}

export function listProviders(): Provider[] {
  return Object.values(registry);
}
