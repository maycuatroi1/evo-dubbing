import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { DEFAULT_SUPABASE_AUDIENCE, DEFAULT_SUPABASE_ISSUER } from "../src/lib/auth.ts";
import { SupabaseAuthenticator, UserOperationRateLimiter, parseAuthConfig } from "../src/lib/auth.ts";
import { shapeDubResponse } from "../src/lib/dubResponse.ts";
import { MANAGED_GENERATION_PROFILE, TTS_PRIMARY } from "../src/lib/managed/catalog.ts";
import { InMemoryLedgerStore } from "../src/lib/managed/ledger.ts";
import {
  AI_VOICE_DISCLOSURE_TEXT,
  createSharedLookupHandlers,
  matchesGenerationProfile,
  selectProfileMatch
} from "../src/lib/managed/shared-lookup.ts";
import type { SharedDubCandidate, SharedSegmentRow } from "../src/lib/managed/shared-lookup.ts";
import { profileMetadataFromInit, validateInit } from "../src/lib/shareSecurity.ts";

const ISSUER = DEFAULT_SUPABASE_ISSUER;
const AUDIENCE = DEFAULT_SUPABASE_AUDIENCE;
const KEY_ID = "test-signing-key";
const USER_ID = "0b7f3a2e-6c4d-4f1e-9a2b-1c2d3e4f5a6b";
const VOICE_PROFILE = TTS_PRIMARY.voiceProfileVersion ?? "";

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

function candidate(overrides: Partial<SharedDubCandidate> = {}): SharedDubCandidate {
  return {
    id: "dub-1",
    platform: "youtube",
    videoId: "abc123",
    sourceLang: "en",
    targetLang: "vi",
    voice: "Kore",
    provider: "google-gemini",
    title: "Demo",
    durationMs: 2600,
    generationProfile: MANAGED_GENERATION_PROFILE,
    voiceProfile: VOICE_PROFILE,
    rightsAssertedAt: new Date("2026-07-20T00:00:00Z"),
    ...overrides
  };
}

const SEGMENTS: SharedSegmentRow[] = [
  { idx: 0, startMs: 0, endMs: 1200, originalText: "hello", text: "xin chao", mime: "audio/mpeg", audioKey: "dubs/dub-1/0.mp3" },
  { idx: 1, startMs: 1200, endMs: 2600, originalText: "world", text: "the gioi", mime: "audio/mpeg", audioKey: "dubs/dub-1/1.mp3" }
];

function lookupHarness(candidates: SharedDubCandidate[]) {
  const store = new InMemoryLedgerStore();
  const handlers = createSharedLookupHandlers({
    authenticator: new SupabaseAuthenticator(
      parseAuthConfig({ SUPABASE_ISSUER: ISSUER, SUPABASE_AUDIENCE: AUDIENCE }),
      testJwks
    ),
    limiter: new UserOperationRateLimiter(1000),
    findCandidates: async () => candidates,
    findSegments: async () => SEGMENTS,
    presign: async (key) => `https://r2.test/${key}`
  });
  return { store, handlers };
}

function lookupRequest(query: Record<string, string>, token?: string): Request {
  const params = new URLSearchParams(query);
  const headers = new Headers();
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://server.test/api/v1/dubs/lookup?${params.toString()}`, { headers });
}

const PROFILE_QUERY = {
  platform: "youtube",
  videoId: "abc123",
  targetLang: "vi",
  generationProfile: MANAGED_GENERATION_PROFILE,
  voiceProfile: VOICE_PROFILE
};

test("provider-neutral profile match ignores the upstream provider id", () => {
  const geminiDub = candidate({ id: "dub-gemini", provider: "google-gemini" });
  const wavenetDub = candidate({ id: "dub-wavenet", provider: "google" });
  const match = selectProfileMatch([geminiDub, wavenetDub], PROFILE_QUERY);
  assert.equal(match?.id, "dub-gemini");
  assert.equal(matchesGenerationProfile(wavenetDub, PROFILE_QUERY), true);
  const otherVoice = selectProfileMatch([candidate()], { ...PROFILE_QUERY, voiceProfile: "vi-VN.wavenet-a.2026-07-25" });
  assert.equal(otherVoice, null);
  const legacyDub = candidate({ generationProfile: null, voiceProfile: null });
  assert.equal(selectProfileMatch([legacyDub], PROFILE_QUERY), null);
});

test("shared v1 hit returns the dub with disclosure and never touches usage or cost ledger", async () => {
  const { store, handlers } = lookupHarness([candidate({ provider: "google" })]);
  const res = await handlers.lookup(lookupRequest(PROFILE_QUERY, await signToken()));
  assert.equal(res.status, 200);
  const data = (await res.json()) as Record<string, unknown>;
  assert.equal(data.id, "dub-1");
  assert.equal(data.provider, "google");
  assert.equal(data.generationProfile, MANAGED_GENERATION_PROFILE);
  assert.equal(data.voiceProfile, VOICE_PROFILE);
  assert.equal(data.aiVoiceDisclosure, AI_VOICE_DISCLOSURE_TEXT);
  assert.equal(data.rightsAssertedAt, "2026-07-20T00:00:00.000Z");
  const segments = data.segments as Array<Record<string, unknown>>;
  assert.equal(segments.length, 2);
  assert.equal(segments[0].audioUrl, "https://r2.test/dubs/dub-1/0.mp3");
  assert.equal(store.usages.length, 0, "a shared hit must not record usage");
  assert.equal(store.requests.size, 0, "a shared hit must not create inference requests");
});

test("shared v1 lookup without a profile match returns 404 in the v1 envelope", async () => {
  const { handlers } = lookupHarness([candidate({ voiceProfile: "vi-VN.wavenet-a.2026-07-25" })]);
  const res = await handlers.lookup(lookupRequest(PROFILE_QUERY, await signToken()));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "not_found");
});

test("shared v1 lookup requires a bearer token", async () => {
  const { handlers } = lookupHarness([candidate()]);
  const res = await handlers.lookup(lookupRequest(PROFILE_QUERY));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "missing_token");
});

test("old lookup response shape is unchanged for old extension clients", () => {
  const dub = candidate({ rightsAssertedAt: null });
  const response = shapeDubResponse(
    { ...dub, visibility: "public" },
    SEGMENTS.map((s) => ({
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      originalText: s.originalText,
      text: s.text,
      mime: s.mime,
      audioUrl: `https://r2.test/${s.audioKey}`
    }))
  );
  assert.deepEqual(Object.keys(response), [
    "id",
    "platform",
    "videoId",
    "sourceLang",
    "targetLang",
    "voice",
    "provider",
    "title",
    "durationMs",
    "visibility",
    "segments"
  ]);
  assert.deepEqual(Object.keys(response.segments[0]), [
    "idx",
    "startMs",
    "endMs",
    "originalText",
    "text",
    "mime",
    "audioUrl"
  ]);
  assert.equal(response.provider, "google-gemini");
  assert.equal(response.segments[1].audioUrl, "https://r2.test/dubs/dub-1/1.mp3");
});

function profiledInitBody(overrides: Record<string, unknown> = {}) {
  return {
    platform: "youtube",
    videoId: "abc123",
    sourceLang: "en",
    targetLang: "vi",
    voice: "Kore",
    provider: "google-gemini",
    visibility: "public",
    generationProfile: MANAGED_GENERATION_PROFILE,
    voiceProfile: VOICE_PROFILE,
    segments: [{ idx: 0, startMs: 0, endMs: 1200, text: "xin chao", mime: "audio/mpeg" }],
    ...overrides
  };
}

test("public profiled share without a rights assertion is rejected", () => {
  const missing = validateInit(profiledInitBody(), 2000);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.message, /rights assertion/);
  const asserted = validateInit(profiledInitBody({ rightsAssertion: true }), 2000);
  assert.deepEqual(asserted, { ok: true });
  const privateShare = validateInit(profiledInitBody({ visibility: "private" }), 2000);
  assert.deepEqual(privateShare, { ok: true });
});

test("profileMetadataFromInit stores the assertion timestamp only when asserted", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const asserted = profileMetadataFromInit(profiledInitBody({ rightsAssertion: true }), now);
  assert.equal(asserted.generationProfile, MANAGED_GENERATION_PROFILE);
  assert.equal(asserted.voiceProfile, VOICE_PROFILE);
  assert.equal(asserted.rightsAssertedAt?.toISOString(), now.toISOString());
  const legacy = profileMetadataFromInit(
    { platform: "youtube", videoId: "abc123", sourceLang: "en", targetLang: "vi", voice: "alloy", provider: "openai" },
    now
  );
  assert.deepEqual(legacy, { generationProfile: null, voiceProfile: null, rightsAssertedAt: null });
});

test("old extension init payload without profiles stays accepted", () => {
  const legacy = validateInit(
    {
      platform: "youtube",
      videoId: "abc123",
      sourceLang: "en",
      targetLang: "vi",
      voice: "alloy",
      provider: "openai",
      visibility: "public",
      segments: [{ idx: 0, startMs: 0, endMs: 1200, text: "xin chao", mime: "audio/mpeg" }]
    },
    2000
  );
  assert.deepEqual(legacy, { ok: true });
});
