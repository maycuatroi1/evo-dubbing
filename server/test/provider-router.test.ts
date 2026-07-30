import test from "node:test";
import assert from "node:assert/strict";
import {
  TTS_PRIMARY,
  TRANSLATION_PRIMARY,
  managedCacheKey
} from "../src/lib/managed/catalog.ts";
import { parseBudgetConfig } from "../src/lib/managed/budget.ts";
import type { CacheEntry, CacheStore } from "../src/lib/managed/cache.ts";
import { InMemoryLedgerStore, ManagedLedger } from "../src/lib/managed/ledger.ts";
import { ManagedRouter, ProviderClient } from "../src/lib/managed/provider-router.ts";
import type { FetchImpl } from "../src/lib/managed/provider-router.ts";

const ACCOUNT = "acct-router";
const T0 = new Date(Date.UTC(2026, 6, 10, 12));
const ENABLED_BUDGET = parseBudgetConfig({
  MANAGED_INFERENCE_ENABLED: "1",
  MANAGED_MONTHLY_BUDGET_USD: "100",
  MANAGED_TRIAL_BUDGET_USD: "10"
});
const ENV = { GOOGLE_API_KEY: "g-key", GOOGLE_TTS_API_KEY: "tts-key", OPENAI_API_KEY: "o-key" };

class MapCacheStore implements CacheStore {
  entries = new Map<string, CacheEntry>();
  async get(key: string): Promise<CacheEntry | null> {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, entry: { audioBase64: string }): Promise<CacheEntry> {
    const stored = { audioBase64: entry.audioBase64, audioKey: `mem/${key}` };
    this.entries.set(key, stored);
    return stored;
  }
}

interface FetchCall {
  url: string;
  body: string;
}

function makeFetch(handler: (call: FetchCall, index: number) => { ok: boolean; status: number; data?: unknown }) {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    const outcome = handler({ url, body: init.body }, calls.length - 1);
    return {
      ok: outcome.ok,
      status: outcome.status,
      json: async () => outcome.data
    };
  };
  return { calls, fetchImpl };
}

function geminiTtsPayload(audio: string) {
  return {
    candidates: [{ content: { parts: [{ inlineData: { data: audio, mimeType: "audio/mp3" } }] } }]
  };
}

function geminiTextPayload(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function routerWith(fetchImpl: FetchImpl, cache?: CacheStore) {
  const store = new InMemoryLedgerStore();
  const ledger = new ManagedLedger(store, () => T0);
  const router = new ManagedRouter({
    ledger,
    budget: ENABLED_BUDGET,
    cache,
    env: ENV,
    now: () => T0,
    client: new ProviderClient({ fetchImpl, sleep: async () => {} })
  });
  return { store, ledger, router };
}

const SHORT_TEXT = "Xin chao";

function ttsInput(key: string, text = SHORT_TEXT, cueDurationMs = 5_000) {
  return {
    accountId: ACCOUNT,
    requestKey: key,
    text,
    targetLang: "vi-VN",
    cueDurationMs
  };
}

test("successful tts settles once with provider cost captured", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { store, router } = routerWith(fetchImpl);
  const result = await router.synthesizeSpeech(ttsInput("tts-ok"));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /gemini-2\.5-flash-preview-tts/);
  assert.equal(result.provider, TTS_PRIMARY.id);
  assert.equal(result.audioBase64, "QUJD");
  assert.ok(result.costMicrousd > 0);
  assert.equal(store.usages.length, 1);
  assert.equal(store.usages[0].sourceMs, 5_000);
  assert.equal(store.usages[0].costMicrousd, result.costMicrousd);
});

test("provider retry succeeds without double-charging quota or cost", async () => {
  const { calls, fetchImpl } = makeFetch((_call, index) =>
    index < 2 ? { ok: false, status: 500 } : { ok: true, status: 200, data: geminiTtsPayload("QUJD") }
  );
  const { store, router } = routerWith(fetchImpl);
  const result = await router.synthesizeSpeech(ttsInput("tts-retry"));
  assert.equal(calls.length, 3);
  assert.equal(result.provider, TTS_PRIMARY.id);
  assert.equal(store.usages.length, 1);
  const request = store.requests.get("tts-retry");
  assert.equal(request?.status, "settled");
});

test("primary failure falls back to the measured economy provider", async () => {
  const { calls, fetchImpl } = makeFetch((call) => {
    if (call.url.includes("generativelanguage")) {
      return { ok: false, status: 503 };
    }
    return { ok: true, status: 200, data: { audioContent: "RkFMTEJBQ0s=" } };
  });
  const { store, router } = routerWith(fetchImpl);
  const result = await router.synthesizeSpeech(ttsInput("tts-fallback"));
  assert.equal(result.provider, "google-wavenet");
  assert.equal(result.audioBase64, "RkFMTEJBQ0s=");
  assert.equal(calls.filter((c) => c.url.includes("texttospeech")).length, 1);
  assert.equal(store.usages.length, 1);
  assert.equal(store.usages[0].provider, "google-wavenet");
});

test("total provider failure refunds the reserve exactly once", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: false, status: 500 }));
  const { store, ledger, router } = routerWith(fetchImpl);
  await assert.rejects(() => router.synthesizeSpeech(ttsInput("tts-fail")));
  const request = store.requests.get("tts-fail");
  assert.equal(request?.status, "refunded");
  assert.equal(store.usages.length, 0);
  const again = await ledger.refund("tts-fail");
  assert.equal(again.refunded, false);
  const spend = await ledger.monthlySpend(new Date(T0.getTime() - 1000));
  assert.equal(spend.totalMicrousd, 0);
});

test("cache replay returns the stored response without calling the provider", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const cache = new MapCacheStore();
  const { router } = routerWith(fetchImpl, cache);
  const first = await router.synthesizeSpeech(ttsInput("tts-cache"));
  assert.equal(first.cacheHit, false);
  assert.equal(calls.length, 1);
  const key = managedCacheKey({
    kind: "tts",
    entryId: TTS_PRIMARY.id,
    voiceProfileVersion: TTS_PRIMARY.voiceProfileVersion,
    targetLang: "vi-VN",
    text: SHORT_TEXT
  });
  assert.ok(cache.entries.has(key));
  const second = await router.synthesizeSpeech(ttsInput("tts-cache-2"));
  assert.equal(second.cacheHit, true);
  assert.equal(second.audioBase64, "QUJD");
  assert.equal(calls.length, 1);
});

test("idempotency replay returns the recorded result without calling the provider again", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { router } = routerWith(fetchImpl);
  const first = await router.synthesizeSpeech(ttsInput("tts-idem"));
  const second = await router.synthesizeSpeech(ttsInput("tts-idem"));
  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.equal(second.audioBase64, "QUJD");
  assert.equal(calls.length, 1);
});

test("generated-text length guard rejects oversized text before any provider call", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { router } = routerWith(fetchImpl);
  const longText = "a".repeat(200);
  await assert.rejects(
    () => router.synthesizeSpeech(ttsInput("tts-long", longText, 1_000)),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "text_exceeds_cue");
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test("translation logs cost but does not settle user-visible source_ms quota", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({
    ok: true,
    status: 200,
    data: geminiTextPayload("xin chao ban")
  }));
  const { store, router } = routerWith(fetchImpl);
  const result = await router.translateText({
    accountId: ACCOUNT,
    requestKey: "tr-ok",
    text: "hello my friend",
    sourceLang: "en",
    targetLang: "vi",
    cueDurationMs: 60_000
  });
  assert.equal(result.text, "xin chao ban");
  assert.equal(result.provider, TRANSLATION_PRIMARY.id);
  assert.ok(result.costMicrousd > 0);
  assert.equal(calls.length, 1);
  assert.equal(store.usages.length, 1);
  assert.equal(store.usages[0].sourceMs, 0);
  assert.equal(store.usages[0].costMicrousd, result.costMicrousd);
  const replay = await router.translateText({
    accountId: ACCOUNT,
    requestKey: "tr-ok",
    text: "hello my friend",
    sourceLang: "en",
    targetLang: "vi"
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.text, "xin chao ban");
  assert.equal(calls.length, 1);
});

test("translation length guard rejects output exceeding the cue duration", async () => {
  const { fetchImpl } = makeFetch(() => ({
    ok: true,
    status: 200,
    data: geminiTextPayload("b".repeat(500))
  }));
  const { store, router } = routerWith(fetchImpl);
  await assert.rejects(
    () =>
      router.translateText({
        accountId: ACCOUNT,
        requestKey: "tr-long",
        text: "short",
        sourceLang: "en",
        targetLang: "vi",
        cueDurationMs: 1_000
      }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "text_exceeds_cue");
      return true;
    }
  );
  assert.equal(store.usages.length, 0);
});
