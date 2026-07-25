import {
  ManagedError,
  assertGeneratedTextFits,
  estimateTtsCostMicrousd,
  estimateTranslationCostMicrousd,
  managedCacheKey,
  providerChain
} from "./catalog.ts";
import type { CatalogEntry } from "./catalog.ts";
import { assertBudgetAllowed, monthStartUtc } from "./budget.ts";
import type { BudgetConfig, TrafficClass } from "./budget.ts";
import type { CacheStore } from "./cache.ts";
import type { ManagedLedger } from "./ledger.ts";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export class ProviderError extends ManagedError {
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(code, message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export interface ProviderCallInput {
  text: string;
  sourceLang?: string;
  targetLang?: string;
  apiKey: string;
}

export interface ProviderCallOutput {
  latencyMs: number;
  audioBase64?: string;
  text?: string;
  inputChars: number;
  outputChars: number;
}

interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function translationPrompt(input: ProviderCallInput): string {
  return `Translate the following text from ${input.sourceLang ?? "auto"} to ${
    input.targetLang ?? "vi"
  }. Return only the translation, without quotes or commentary.\n\n${input.text}`;
}

function prepareRequest(entry: CatalogEntry, input: ProviderCallInput): PreparedRequest {
  if (entry.provider === "google-gemini") {
    return {
      url: `${entry.endpoint}?key=${input.apiKey}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: entry.voice ?? "Kore" } }
          }
        }
      })
    };
  }
  if (entry.provider === "gemini") {
    return {
      url: `${entry.endpoint}?key=${input.apiKey}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: translationPrompt(input) }] }]
      })
    };
  }
  if (entry.provider === "google") {
    return {
      url: `${entry.endpoint}?key=${input.apiKey}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { text: input.text },
        voice: { languageCode: input.targetLang ?? "vi-VN", name: entry.voice ?? "" },
        audioConfig: { audioEncoding: "MP3" }
      })
    };
  }
  if (entry.provider === "openai") {
    return {
      url: entry.endpoint,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: entry.model,
        messages: [{ role: "user", content: translationPrompt(input) }]
      })
    };
  }
  throw new ManagedError("provider_unknown", `no request builder for provider ${entry.provider}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function parseResponse(
  entry: CatalogEntry,
  data: unknown,
  input: ProviderCallInput
): Omit<ProviderCallOutput, "latencyMs"> {
  const root = asRecord(data);
  if (entry.provider === "google-gemini" || entry.provider === "gemini") {
    const candidates = (root.candidates ?? []) as Array<Record<string, unknown>>;
    const content = asRecord(candidates[0]?.content);
    const parts = (content.parts ?? []) as Array<Record<string, unknown>>;
    if (entry.kind === "tts") {
      const inlineData = asRecord(parts[0]?.inlineData ?? parts[0]?.inline_data);
      const audioBase64 = typeof inlineData.data === "string" ? inlineData.data : "";
      if (!audioBase64) {
        throw new ProviderError("provider_bad_response", `provider ${entry.id} returned no audio`);
      }
      return { audioBase64, inputChars: input.text.length, outputChars: input.text.length };
    }
    const text = typeof parts[0]?.text === "string" ? (parts[0].text as string).trim() : "";
    if (!text) {
      throw new ProviderError("provider_bad_response", `provider ${entry.id} returned no text`);
    }
    return { text, inputChars: input.text.length, outputChars: text.length };
  }
  if (entry.provider === "google") {
    const audioBase64 = typeof root.audioContent === "string" ? (root.audioContent as string) : "";
    if (!audioBase64) {
      throw new ProviderError("provider_bad_response", `provider ${entry.id} returned no audio`);
    }
    return { audioBase64, inputChars: input.text.length, outputChars: input.text.length };
  }
  if (entry.provider === "openai") {
    const choices = (root.choices ?? []) as Array<Record<string, unknown>>;
    const message = asRecord(choices[0]?.message);
    const text = typeof message.content === "string" ? (message.content as string).trim() : "";
    if (!text) {
      throw new ProviderError("provider_bad_response", `provider ${entry.id} returned no text`);
    }
    return { text, inputChars: input.text.length, outputChars: text.length };
  }
  throw new ManagedError("provider_unknown", `no response parser for provider ${entry.provider}`);
}

export class ProviderClient {
  private fetchImpl: FetchImpl;
  private sleepImpl: (ms: number) => Promise<void>;

  constructor(deps: { fetchImpl?: FetchImpl; sleep?: (ms: number) => Promise<void> } = {}) {
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleepImpl = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async call(entry: CatalogEntry, input: ProviderCallInput): Promise<ProviderCallOutput> {
    const prepared = prepareRequest(entry, input);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= entry.retry.maxAttempts; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), entry.timeoutMs);
      try {
        const res = await this.fetchImpl(prepared.url, {
          method: "POST",
          headers: prepared.headers,
          body: prepared.body,
          signal: controller.signal
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          lastError = new ProviderError(
            "provider_http_error",
            `provider ${entry.id} returned status ${res.status}`,
            res.status
          );
          if (attempt < entry.retry.maxAttempts && entry.retry.retryStatuses.includes(res.status)) {
            await this.sleepImpl(entry.retry.backoffMs * attempt);
            continue;
          }
          throw lastError;
        }
        const data = await res.json();
        return { ...parseResponse(entry, data, input), latencyMs };
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof ProviderError || err instanceof ManagedError) throw err;
        lastError = err;
        if (attempt < entry.retry.maxAttempts) {
          await this.sleepImpl(entry.retry.backoffMs * attempt);
          continue;
        }
        throw new ProviderError(
          "provider_unreachable",
          `provider ${entry.id} failed after ${attempt} attempts: ${String(err)}`
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ProviderError("provider_unreachable", `provider ${entry.id} failed`);
  }
}

export interface TtsRequest {
  accountId: string;
  requestKey: string;
  text: string;
  targetLang: string;
  cueDurationMs: number;
}

export interface TtsResult {
  provider: string;
  model: string;
  costMicrousd: number;
  latencyMs: number;
  cacheHit: boolean;
  replay: boolean;
  audioBase64?: string;
  audioKey?: string;
  url?: string;
}

export interface TranslationRequestInput {
  accountId: string;
  requestKey: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  cueDurationMs?: number;
}

export interface TranslationResult {
  text: string;
  provider: string;
  model: string;
  costMicrousd: number;
  latencyMs: number;
  replay: boolean;
}

export interface RouterDeps {
  ledger: ManagedLedger;
  budget: BudgetConfig;
  cache?: CacheStore;
  client?: ProviderClient;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

export class ManagedRouter {
  private ledger: ManagedLedger;
  private budget: BudgetConfig;
  private cache: CacheStore | null;
  private client: ProviderClient;
  private env: Record<string, string | undefined>;
  private now: () => Date;

  constructor(deps: RouterDeps) {
    this.ledger = deps.ledger;
    this.budget = deps.budget;
    this.cache = deps.cache ?? null;
    this.client = deps.client ?? new ProviderClient();
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? (() => new Date());
  }

  private async gate(
    accountId: string,
    estimatedCostMicrousd: number
  ): Promise<{ trafficClass: TrafficClass; periodId: string | null }> {
    const period = await this.ledger.activePeriod(accountId);
    const trafficClass: TrafficClass = period ? "paid" : "trial";
    const spend = await this.ledger.monthlySpend(monthStartUtc(this.now()));
    assertBudgetAllowed(this.budget, spend, trafficClass, estimatedCostMicrousd);
    return { trafficClass, periodId: period?.id ?? null };
  }

  private apiKey(entry: CatalogEntry): string {
    return this.env[entry.apiKeyEnv] ?? "";
  }

  async synthesizeSpeech(input: TtsRequest): Promise<TtsResult> {
    const chain = providerChain("tts");
    const primary = chain[0];
    assertGeneratedTextFits(input.text, input.cueDurationMs);

    const cacheKey = managedCacheKey({
      kind: "tts",
      entryId: primary.id,
      voiceProfileVersion: primary.voiceProfileVersion,
      targetLang: input.targetLang,
      text: input.text
    });
    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit) {
        return {
          provider: primary.id,
          model: primary.model,
          costMicrousd: 0,
          latencyMs: 0,
          cacheHit: true,
          replay: false,
          audioBase64: hit.audioBase64,
          audioKey: hit.audioKey,
          url: hit.url
        };
      }
    }

    const estimate = estimateTtsCostMicrousd(primary, {
      sourceMs: input.cueDurationMs,
      chars: input.text.length
    });
    await this.gate(input.accountId, estimate);

    const reservation = await this.ledger.reserve({
      requestKey: input.requestKey,
      accountId: input.accountId,
      kind: "tts",
      provider: primary.id,
      model: primary.model,
      estimateMs: input.cueDurationMs,
      costMicrousd: estimate,
      inputChars: input.text.length
    });
    if (reservation.replay) {
      const record = reservation.record;
      if (record.status === "settled" && record.result) {
        const stored = JSON.parse(record.result) as { audioBase64?: string; audioKey?: string };
        return {
          provider: record.provider,
          model: record.model,
          costMicrousd: record.costMicrousd,
          latencyMs: record.latencyMs,
          cacheHit: false,
          replay: true,
          audioBase64: stored.audioBase64,
          audioKey: stored.audioKey
        };
      }
      throw new ManagedError(
        "request_in_progress",
        `request ${input.requestKey} is already in flight`
      );
    }

    let lastError: unknown = null;
    for (const entry of chain) {
      try {
        const outcome = await this.client.call(entry, {
          text: input.text,
          targetLang: input.targetLang,
          apiKey: this.apiKey(entry)
        });
        const costMicrousd = estimateTtsCostMicrousd(entry, {
          sourceMs: input.cueDurationMs,
          chars: input.text.length
        });
        const result = JSON.stringify({ audioBase64: outcome.audioBase64 ?? "" });
        await this.ledger.settle(input.requestKey, {
          actualMs: input.cueDurationMs,
          costMicrousd,
          generatedChars: input.text.length,
          latencyMs: outcome.latencyMs,
          provider: entry.id,
          model: entry.model,
          result
        });
        let cached: { audioKey?: string; url?: string } = {};
        if (this.cache) {
          cached = await this.cache.put(cacheKey, { audioBase64: outcome.audioBase64 ?? "" });
        }
        return {
          provider: entry.id,
          model: entry.model,
          costMicrousd,
          latencyMs: outcome.latencyMs,
          cacheHit: false,
          replay: false,
          audioBase64: outcome.audioBase64,
          audioKey: cached.audioKey,
          url: cached.url
        };
      } catch (err) {
        lastError = err;
      }
    }
    await this.ledger.refund(input.requestKey);
    throw lastError instanceof Error
      ? lastError
      : new ProviderError("provider_unreachable", "all managed tts providers failed");
  }

  async translateText(input: TranslationRequestInput): Promise<TranslationResult> {
    const chain = providerChain("translation");
    const primary = chain[0];
    const estimate = estimateTranslationCostMicrousd(primary, {
      inputChars: input.text.length,
      outputChars: input.text.length * 2
    });
    const { periodId } = await this.gate(input.accountId, estimate);

    const existing = await this.ledger.getRequest(input.requestKey);
    if (existing) {
      if (existing.status === "settled" && existing.result) {
        const stored = JSON.parse(existing.result) as { text?: string };
        return {
          text: stored.text ?? "",
          provider: existing.provider,
          model: existing.model,
          costMicrousd: existing.costMicrousd,
          latencyMs: existing.latencyMs,
          replay: true
        };
      }
      throw new ManagedError(
        "request_in_progress",
        `request ${input.requestKey} is already in flight`
      );
    }

    let lastError: unknown = null;
    for (const entry of chain) {
      try {
        const outcome = await this.client.call(entry, {
          text: input.text,
          sourceLang: input.sourceLang,
          targetLang: input.targetLang,
          apiKey: this.apiKey(entry)
        });
        const translated = outcome.text ?? "";
        if (input.cueDurationMs !== undefined) {
          assertGeneratedTextFits(translated, input.cueDurationMs);
        }
        const costMicrousd = estimateTranslationCostMicrousd(entry, {
          inputChars: outcome.inputChars,
          outputChars: outcome.outputChars
        });
        await this.ledger.recordTranslation({
          requestKey: input.requestKey,
          accountId: input.accountId,
          periodId,
          provider: entry.id,
          model: entry.model,
          inputChars: outcome.inputChars,
          outputChars: outcome.outputChars,
          costMicrousd,
          latencyMs: outcome.latencyMs,
          result: JSON.stringify({ text: translated })
        });
        return {
          text: translated,
          provider: entry.id,
          model: entry.model,
          costMicrousd,
          latencyMs: outcome.latencyMs,
          replay: false
        };
      } catch (err) {
        if (err instanceof ManagedError && err.code === "text_exceeds_cue") throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ProviderError("provider_unreachable", "all managed translation providers failed");
  }
}
