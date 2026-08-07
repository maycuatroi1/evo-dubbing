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

function toSegment(value: unknown): TranslatedSegment | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { idx?: unknown; text?: unknown };
  if (typeof raw.text !== "string") return null;
  const idx = Number(raw.idx);
  if (!Number.isFinite(idx)) return null;
  return { idx, text: raw.text };
}

/** Models wrap the object in a markdown fence or in prose even when asked not to. */
function jsonCandidates(raw: string): string[] {
  const out: string[] = [];
  const text = raw.trim();
  if (text) out.push(text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenced?.[1]?.trim()) out.push(fenced[1].trim());
  for (const candidate of [...out]) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start && (start > 0 || end < candidate.length - 1)) {
      out.push(candidate.slice(start, end + 1));
    }
  }
  return out;
}

/**
 * Last resort: walk the text and JSON.parse every object that actually closes. Unlike a shaped
 * regex this survives extra keys, reordered keys and nesting, and it naturally drops the
 * half-written object at a truncation point.
 */
function salvageSegments(text: string): TranslatedSegment[] {
  const out: TranslatedSegment[] = [];
  const stack: number[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push(i);
    } else if (ch === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      try {
        const segment = toSegment(JSON.parse(text.slice(start, i + 1)));
        if (segment) out.push(segment);
      } catch {
        // Not a segment object; keep scanning.
      }
    }
  }
  return out;
}

export function parseTranslationsResponse(text: string, expected?: number): TranslatedSegment[] {
  for (const candidate of jsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { translations?: unknown })?.translations;
    if (!Array.isArray(list)) return [];
    return list.map(toSegment).filter((s): s is TranslatedSegment => s !== null);
  }

  const salvaged = salvageSegments(text);
  if (salvaged.length > 0) {
    const total = expected ?? salvaged.length;
    const lost = Math.max(0, total - salvaged.length);
    console.warn(
      lost > 0
        ? `[evo-dubbing] translation JSON did not parse; recovered ${salvaged.length}/${total} segments, ${lost} line(s) will be silent`
        : `[evo-dubbing] translation JSON did not parse; fallback recovered all ${salvaged.length} segments`
    );
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
