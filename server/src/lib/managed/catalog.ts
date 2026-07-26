import { createHash } from "node:crypto";

export class ManagedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ManagedError";
    this.code = code;
  }
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  retryStatuses: number[];
}

export interface CatalogPricing {
  currency: "USD";
  priceDate: string;
  inputPerMillionTokensUsd?: number;
  outputPerMillionTokensUsd?: number;
  perMillionCharsUsd?: number;
  measuredCostPerSourceMsMicrousd?: number;
}

export interface CatalogEntry {
  id: string;
  kind: "tts" | "translation";
  role: "primary" | "economy";
  provider: string;
  model: string;
  endpoint: string;
  apiKeyEnv: string;
  voice?: string;
  voiceProfileVersion?: string;
  timeoutMs: number;
  retry: RetryPolicy;
  pricing: CatalogPricing;
}

export const CATALOG_PRICE_DATE = "2026-07-25";
export const MANAGED_CACHE_VERSION = 1;
export const MANAGED_GENERATION_PROFILE = "managed.gen.v1";
export const SPEECH_CHARS_PER_SECOND = 15;
export const LENGTH_GUARD_TOLERANCE = 1.2;
export const CHARS_PER_TOKEN = 3;

export const TTS_PRIMARY: CatalogEntry = {
  id: "google-gemini-tts",
  kind: "tts",
  role: "primary",
  provider: "google-gemini",
  model: "gemini-2.5-flash-preview-tts",
  voice: "Kore",
  voiceProfileVersion: "vi-VN.kore.2026-07-25",
  endpoint:
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
  apiKeyEnv: "GOOGLE_API_KEY",
  timeoutMs: 30_000,
  retry: { maxAttempts: 3, backoffMs: 500, retryStatuses: [429, 500, 502, 503, 504] },
  pricing: {
    currency: "USD",
    priceDate: CATALOG_PRICE_DATE,
    measuredCostPerSourceMsMicrousd: 0.2365
  }
};

export const TTS_ECONOMY: CatalogEntry = {
  id: "google-wavenet",
  kind: "tts",
  role: "economy",
  provider: "google",
  model: "WaveNet",
  voice: "vi-VN-Wavenet-A",
  voiceProfileVersion: "vi-VN.wavenet-a.2026-07-25",
  endpoint: "https://texttospeech.googleapis.com/v1/text:synthesize",
  apiKeyEnv: "GOOGLE_TTS_API_KEY",
  timeoutMs: 15_000,
  retry: { maxAttempts: 2, backoffMs: 400, retryStatuses: [429, 500, 502, 503, 504] },
  pricing: {
    currency: "USD",
    priceDate: CATALOG_PRICE_DATE,
    perMillionCharsUsd: 4
  }
};

export const TRANSLATION_PRIMARY: CatalogEntry = {
  id: "gemini-flash-lite",
  kind: "translation",
  role: "primary",
  provider: "gemini",
  model: "gemini-3.1-flash-lite",
  endpoint:
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
  apiKeyEnv: "GOOGLE_API_KEY",
  timeoutMs: 20_000,
  retry: { maxAttempts: 3, backoffMs: 400, retryStatuses: [429, 500, 502, 503, 504] },
  pricing: {
    currency: "USD",
    priceDate: CATALOG_PRICE_DATE,
    inputPerMillionTokensUsd: 0.25,
    outputPerMillionTokensUsd: 1.5
  }
};

export const TRANSLATION_ECONOMY: CatalogEntry = {
  id: "openai-economy",
  kind: "translation",
  role: "economy",
  provider: "openai",
  model: "gpt-5.4-nano",
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKeyEnv: "OPENAI_API_KEY",
  timeoutMs: 20_000,
  retry: { maxAttempts: 2, backoffMs: 400, retryStatuses: [429, 500, 502, 503, 504] },
  pricing: {
    currency: "USD",
    priceDate: CATALOG_PRICE_DATE,
    inputPerMillionTokensUsd: 0.2,
    outputPerMillionTokensUsd: 1.25
  }
};

export const MANAGED_CATALOG: CatalogEntry[] = [
  TTS_PRIMARY,
  TTS_ECONOMY,
  TRANSLATION_PRIMARY,
  TRANSLATION_ECONOMY
];

export function providerChain(kind: "tts" | "translation"): CatalogEntry[] {
  const chain = MANAGED_CATALOG.filter((entry) => entry.kind === kind).sort((a, b) =>
    a.role === b.role ? 0 : a.role === "primary" ? -1 : 1
  );
  if (chain.length === 0) {
    throw new ManagedError("catalog_empty", `no managed provider registered for kind ${kind}`);
  }
  return chain;
}

export function estimateTtsCostMicrousd(
  entry: CatalogEntry,
  input: { sourceMs: number; chars: number }
): number {
  if (entry.pricing.measuredCostPerSourceMsMicrousd !== undefined) {
    return Math.max(
      0,
      Math.ceil(input.sourceMs * entry.pricing.measuredCostPerSourceMsMicrousd)
    );
  }
  if (entry.pricing.perMillionCharsUsd !== undefined) {
    return Math.max(0, Math.ceil((input.chars / 1_000_000) * entry.pricing.perMillionCharsUsd * 1_000_000));
  }
  return 0;
}

export function estimateTranslationCostMicrousd(
  entry: CatalogEntry,
  input: { inputChars: number; outputChars: number }
): number {
  const inputTokens = input.inputChars / CHARS_PER_TOKEN;
  const outputTokens = input.outputChars / CHARS_PER_TOKEN;
  const usd =
    (inputTokens / 1_000_000) * (entry.pricing.inputPerMillionTokensUsd ?? 0) +
    (outputTokens / 1_000_000) * (entry.pricing.outputPerMillionTokensUsd ?? 0);
  return Math.max(0, Math.ceil(usd * 1_000_000));
}

export function estimateSpeechMs(text: string): number {
  return Math.ceil((text.length / SPEECH_CHARS_PER_SECOND) * 1000);
}

export function assertGeneratedTextFits(
  text: string,
  cueDurationMs: number,
  tolerance = LENGTH_GUARD_TOLERANCE
): void {
  const estimatedMs = estimateSpeechMs(text);
  if (estimatedMs > cueDurationMs * tolerance) {
    throw new ManagedError(
      "text_exceeds_cue",
      `generated text estimates to ${estimatedMs} ms of speech, exceeding cue duration ${cueDurationMs} ms beyond tolerance ${tolerance}`
    );
  }
}

export function managedCacheKey(input: {
  kind: "tts" | "translation";
  entryId: string;
  voiceProfileVersion?: string;
  targetLang: string;
  text: string;
}): string {
  const payload = JSON.stringify([
    input.kind,
    input.entryId,
    input.voiceProfileVersion ?? "",
    input.targetLang,
    input.text
  ]);
  return `v${MANAGED_CACHE_VERSION}:${createHash("sha256").update(payload).digest("hex")}`;
}
