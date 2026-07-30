import type { ProviderId, Transcript } from "../types.ts";
import { openaiProvider } from "./openai.ts";
import { geminiProvider } from "./gemini.ts";

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

export function parseTranslationsResponse(text: string): TranslatedSegment[] {
  try {
    const parsed = JSON.parse(text) as { translations?: TranslatedSegment[] };
    return Array.isArray(parsed.translations) ? parsed.translations : [];
  } catch {
  }
  const salvaged: TranslatedSegment[] = [];
  const re = /\{\s*"idx"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    try {
      salvaged.push({ idx: Number(match[1]), text: JSON.parse(`"${match[2]}"`) as string });
    } catch {
    }
  }
  if (salvaged.length > 0) {
    console.warn(`[evo-dubbing] translation JSON was truncated; salvaged ${salvaged.length} segments`);
    return salvaged;
  }
  throw new Error("translation response was not valid JSON");
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
