import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { DEFAULT_SUPABASE_AUDIENCE, DEFAULT_SUPABASE_ISSUER } from "../src/lib/auth.ts";
import { SupabaseAuthenticator, UserOperationRateLimiter, parseAuthConfig } from "../src/lib/auth.ts";
import { TRIAL_QUOTA_MS } from "../src/lib/account.ts";
import type { ManagedFlags } from "../src/lib/account.ts";
import { parseBudgetConfig } from "../src/lib/managed/budget.ts";
import type { CacheEntry, CacheStore } from "../src/lib/managed/cache.ts";
import {
  MANAGED_VOICE_PROFILES,
  createInferenceHandlers,
  parseInferenceConstraints
} from "../src/lib/managed/inference-api.ts";
import type { InferenceApiDeps } from "../src/lib/managed/inference-api.ts";
import { InMemoryLedgerStore, ManagedLedger } from "../src/lib/managed/ledger.ts";
import { ManagedRouter, ProviderClient } from "../src/lib/managed/provider-router.ts";
import type { FetchImpl } from "../src/lib/managed/provider-router.ts";
import { TTS_PRIMARY } from "../src/lib/managed/catalog.ts";

const ISSUER = DEFAULT_SUPABASE_ISSUER;
const AUDIENCE = DEFAULT_SUPABASE_AUDIENCE;
const KEY_ID = "test-signing-key";
const USER_ID = "0b7f3a2e-6c4d-4f1e-9a2b-1c2d3e4f5a6b";
const T0 = new Date(Date.UTC(2026, 6, 10, 12));
const ENV = { GOOGLE_API_KEY: "g-key", GOOGLE_TTS_API_KEY: "tts-key", OPENAI_API_KEY: "o-key" };
const ALL_FLAGS: ManagedFlags = { inference: true, trial: true, checkout: false };

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "ES256" };
const testJwks = createLocalJWKSet({ keys: [publicJwk] });

async function signToken(sub: string = USER_ID) {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + 600)
    .sign(privateKey);
}

class MapCacheStore implements CacheStore {
  entries = new Map<string, CacheEntry>();
  async get(key: string): Promise<CacheEntry | null> {
    return this.entries.get(key) ?? null;
  }
  async put(key: string, entry: { audioBase64: string }): Promise<CacheEntry> {
    const stored = { audioKey: `mem/${key}`, url: `https://cache.test/${key}` };
    void entry;
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
    return { ok: outcome.ok, status: outcome.status, json: async () => outcome.data };
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

function trialUsedMsOf(store: InMemoryLedgerStore) {
  return async (accountId: string): Promise<number> => {
    const settled = store.usages
      .filter((u) => u.accountId === accountId && u.periodId === null)
      .reduce((sum, u) => sum + u.sourceMs, 0);
    const reserved = [...store.requests.values()]
      .filter((r) => r.accountId === accountId && r.periodId === null && r.status === "reserved")
      .reduce((sum, r) => sum + r.reservedMs, 0);
    return settled + reserved;
  };
}

interface Harness {
  store: InMemoryLedgerStore;
  handlers: ReturnType<typeof createInferenceHandlers>;
}

function harness(
  fetchImpl: FetchImpl,
  overrides: Partial<InferenceApiDeps> = {},
  cache?: CacheStore
): Harness {
  const store = new InMemoryLedgerStore();
  const ledger = new ManagedLedger(store, () => T0);
  const router = new ManagedRouter({
    ledger,
    budget: parseBudgetConfig({ MANAGED_INFERENCE_ENABLED: "1" }),
    cache,
    env: ENV,
    now: () => T0,
    client: new ProviderClient({ fetchImpl, sleep: async () => {} })
  });
  const handlers = createInferenceHandlers({
    authenticator: new SupabaseAuthenticator(
      parseAuthConfig({ SUPABASE_ISSUER: ISSUER, SUPABASE_AUDIENCE: AUDIENCE }),
      testJwks
    ),
    limiter: new UserOperationRateLimiter(1000),
    router,
    ledger,
    flags: () => ALL_FLAGS,
    trialUsedMs: trialUsedMsOf(store),
    constraints: parseInferenceConstraints({}),
    ...overrides
  });
  return { store, handlers };
}

function apiRequest(path: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://server.test${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function translateBody(segments: unknown, overrides: Record<string, unknown> = {}) {
  return {
    targetLang: "vi",
    sourceLang: "en",
    batchId: "batch-1",
    segments,
    ...overrides
  };
}

function seg(id: string, text: string, startMs: number, endMs: number) {
  return { id, text, cue: { startMs, endMs } };
}

function ttsBody(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "idem-key-0001",
    voiceProfileId: MANAGED_VOICE_PROFILES[0].id,
    targetLang: "vi-VN",
    text: "xin chao",
    cue: { startMs: 0, endMs: 5_000 },
    ...overrides
  };
}

async function errorOf(res: Response) {
  const body = await res.json();
  return { status: res.status, code: body.error?.code, message: body.error?.message };
}

test("missing token returns 401 missing_token on both routes", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTextPayload("a") }));
  const { handlers } = harness(fetchImpl);
  for (const call of [handlers.translate, handlers.tts]) {
    const res = await call(apiRequest("/api/v1/inference/translate", {}));
    const err = await errorOf(res);
    assert.equal(err.status, 401);
    assert.equal(err.code, "missing_token");
  }
});

test("kill switch returns 403 inference_disabled before touching providers", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { handlers } = harness(fetchImpl, { flags: () => ({ ...ALL_FLAGS, inference: false }) });
  const token = await signToken();
  const res = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  const err = await errorOf(res);
  assert.equal(err.status, 403);
  assert.equal(err.code, "inference_disabled");
  assert.equal(calls.length, 0);
});

test("invalid batch shapes return 400 invalid_batch", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTextPayload("a") }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  const cases: unknown[] = [
    translateBody([]),
    translateBody("not-an-array"),
    translateBody([seg("s1", "hello", 0, 1_000)], { segments: [...Array(40)].map((_, i) => seg(`s${i}`, "hi", i * 2_000, i * 2_000 + 1_000)) }),
    translateBody([{ id: "s1", cue: { startMs: 0, endMs: 1_000 } }]),
    translateBody([seg("s1", "hello", 1_000, 1_000)])
  ];
  for (const body of cases) {
    const res = await handlers.translate(apiRequest("/api/v1/inference/translate", body, token));
    const err = await errorOf(res);
    assert.equal(err.status, 400, JSON.stringify(body));
    assert.equal(err.code, "invalid_batch", JSON.stringify(body));
  }
});

test("oversized text returns 400 text_too_large", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTextPayload("a") }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  const big = translateBody([seg("s1", "x".repeat(9_000), 0, 60_000)]);
  const res = await handlers.translate(apiRequest("/api/v1/inference/translate", big, token));
  const err = await errorOf(res);
  assert.equal(err.status, 400);
  assert.equal(err.code, "text_too_large");
  const ttsRes = await handlers.tts(
    apiRequest("/api/v1/inference/tts", ttsBody({ text: "x".repeat(2_000) }), token)
  );
  const ttsErr = await errorOf(ttsRes);
  assert.equal(ttsErr.status, 400);
  assert.equal(ttsErr.code, "text_too_large");
});

test("overlapping cue timing returns 400 invalid_batch", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTextPayload("a") }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  const overlap = translateBody([seg("s1", "hello", 0, 2_000), seg("s2", "world", 1_500, 3_000)]);
  const res = await handlers.translate(apiRequest("/api/v1/inference/translate", overlap, token));
  const err = await errorOf(res);
  assert.equal(err.status, 400);
  assert.equal(err.code, "invalid_batch");
  assert.match(err.message, /overlap/);
  assert.equal(calls.length, 0);
});

test("successful translate returns translations with request IDs and replays by batchId", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({
    ok: true,
    status: 200,
    data: geminiTextPayload("xin chao")
  }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  const body = translateBody([seg("s1", "hello", 0, 5_000), seg("s2", "friend", 5_000, 10_000)]);
  const res = await handlers.translate(apiRequest("/api/v1/inference/translate", body, token));
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.batchId, "batch-1");
  assert.equal(payload.translations.length, 2);
  assert.equal(payload.translations[0].text, "xin chao");
  assert.equal(payload.translations[0].startMs, 0);
  assert.equal(payload.translations[0].endMs, 5_000);
  assert.match(payload.translations[0].requestId, /^tr:/);
  assert.equal(calls.length, 2);
  const replay = await handlers.translate(apiRequest("/api/v1/inference/translate", body, token));
  assert.equal(replay.status, 200);
  const replayPayload = await replay.json();
  assert.equal(replayPayload.translations[0].text, "xin chao");
  assert.equal(calls.length, 2);
});

test("unsupported voice returns 400 unsupported_voice", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  const res = await handlers.tts(
    apiRequest("/api/v1/inference/tts", ttsBody({ voiceProfileId: "morgan-freeman" }), token)
  );
  const err = await errorOf(res);
  assert.equal(err.status, 400);
  assert.equal(err.code, "unsupported_voice");
});

test("client-supplied provider, model, key, url or price fields are rejected", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  for (const field of ["apiKey", "provider", "model", "url", "price"]) {
    const res = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody({ [field]: "evil" }), token));
    const err = await errorOf(res);
    assert.equal(err.status, 400, field);
    assert.equal(err.code, "invalid_payload", field);
  }
});

test("no entitlement returns 402 no_entitlement when trial is off and no period exists", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { handlers } = harness(fetchImpl, { flags: () => ({ ...ALL_FLAGS, trial: false }) });
  const token = await signToken();
  const res = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  const err = await errorOf(res);
  assert.equal(err.status, 402);
  assert.equal(err.code, "no_entitlement");
  assert.equal(calls.length, 0);
});

test("exhausted quota returns 402 quota_exceeded and no provider call", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { store, handlers } = harness(fetchImpl);
  store.periods.set("period-small", {
    id: "period-small",
    accountId: USER_ID,
    quotaMs: 4_000,
    usedMs: 0,
    status: "active",
    startAt: new Date(T0.getTime() - 1_000).toISOString(),
    endAt: new Date(T0.getTime() + 86_400_000).toISOString()
  });
  const token = await signToken();
  const res = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  const err = await errorOf(res);
  assert.equal(err.status, 402);
  assert.equal(err.code, "quota_exceeded");
  assert.equal(calls.length, 0);
  assert.equal(store.periods.get("period-small")?.usedMs, 0);
});

test("successful tts returns audio, charged source_ms, remaining_ms and profile version", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { handlers } = harness(fetchImpl);
  const token = await signToken();
  const res = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.audioBase64, "QUJD");
  assert.equal(payload.chargedSourceMs, 5_000);
  assert.equal(payload.remainingMs, TRIAL_QUOTA_MS - 5_000);
  assert.equal(payload.voiceProfileVersion, TTS_PRIMARY.voiceProfileVersion);
  assert.equal(payload.cacheHit, false);
  assert.equal(payload.replayed, false);
  assert.match(payload.requestId, /^tts:/);
  assert.equal(calls.length, 1);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /api_?key|secret/i);
});

test("tts returns a managed-cache URL when the cache store signs one", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const cache = new MapCacheStore();
  const { handlers } = harness(fetchImpl, {}, cache);
  const token = await signToken();
  const first = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.chargedSourceMs, 5_000);
  assert.match(String(firstPayload.audioUrl ?? ""), /^https:\/\/cache\.test\//);
  const second = await handlers.tts(
    apiRequest(
      "/api/v1/inference/tts",
      ttsBody({ idempotencyKey: "idem-key-0002" }),
      token
    )
  );
  const secondPayload = await second.json();
  assert.equal(secondPayload.cacheHit, true);
  assert.equal(secondPayload.chargedSourceMs, 0);
  assert.match(String(secondPayload.audioUrl ?? ""), /^https:\/\/cache\.test\//);
  assert.equal(secondPayload.remainingMs, TRIAL_QUOTA_MS - 5_000);
});

test("duplicate idempotency returns the recorded result without a second charge", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: true, status: 200, data: geminiTtsPayload("QUJD") }));
  const { store, handlers } = harness(fetchImpl);
  const token = await signToken();
  const first = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  const second = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  assert.equal(second.status, 200);
  const secondPayload = await second.json();
  assert.equal(secondPayload.replayed, true);
  assert.equal(secondPayload.audioBase64, "QUJD");
  assert.equal(secondPayload.chargedSourceMs, 0);
  assert.equal(secondPayload.remainingMs, firstPayload.remainingMs);
  assert.equal(calls.length, 1);
  assert.equal(store.usages.length, 1);
});

test("provider 5xx refunds the reserve and returns 502 provider_unavailable", async () => {
  const { calls, fetchImpl } = makeFetch(() => ({ ok: false, status: 500 }));
  const { store, handlers } = harness(fetchImpl);
  const token = await signToken();
  const res = await handlers.tts(apiRequest("/api/v1/inference/tts", ttsBody(), token));
  const err = await errorOf(res);
  assert.equal(err.status, 502);
  assert.equal(err.code, "provider_unavailable");
  assert.ok(calls.length > 0);
  const request = store.requests.get(`tts:${USER_ID}:idem-key-0001`);
  assert.equal(request?.status, "refunded");
  assert.equal(store.usages.length, 0);
});

test("translate provider failure returns a stable 5xx envelope", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: false, status: 503 }));
  const { store, handlers } = harness(fetchImpl);
  const token = await signToken();
  const res = await handlers.translate(
    apiRequest("/api/v1/inference/translate", translateBody([seg("s1", "hello", 0, 5_000)]), token)
  );
  const err = await errorOf(res);
  assert.equal(err.status, 502);
  assert.equal(err.code, "provider_unavailable");
  assert.equal(store.usages.length, 0);
});
