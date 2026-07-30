import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";

function makeSettings() {
  return {
    translateProvider: "openai" as const,
    ttsProvider: "openai" as const,
    sttProvider: "openai" as const,
    targetLang: "vi",
    voice: "alloy",
    duckVolume: 0.18,
    showSubtitles: false,
    ttsModel: "gpt-4o-mini-tts",
    translateModel: "gpt-5.4-mini",
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "public" as const,
    billingMode: "managed" as const,
    managedBaseUrl: "https://managed.example.com",
    managedVoiceProfileId: "vi-standard-female",
    keys: {}
  };
}

function installDomFakes() {
  (globalThis as { window?: unknown }).window = {
    setInterval: () => 1,
    clearInterval: () => undefined
  };
  (globalThis as { AudioContext?: unknown }).AudioContext = class {
    destination = {};
    createGain() {
      return { connect() {} };
    }
    async resume() {}
    async decodeAudioData() {
      return { duration: 1 };
    }
    async close() {}
  };
  return {
    currentTime: 0,
    volume: 1,
    paused: false,
    addEventListener() {},
    removeEventListener() {},
    closest: () => null,
    parentElement: null
  };
}

const TRANSCRIPT = {
  lang: "en",
  segments: [0, 1, 2, 3].map((i) => ({
    idx: i,
    startMs: i * 4000,
    endMs: i * 4000 + 2000,
    text: `Line ${i}.`
  }))
};

const CONTEXT = { platform: "youtube", videoId: "vid", title: "t", url: "u", durationMs: 16000 };

function ttsOk() {
  return {
    ok: true,
    data: {
      requestId: "r",
      chargedSourceMs: 2000,
      remainingMs: 10_000_000,
      voiceProfileVersion: "v",
      audioBase64: "AAE="
    }
  };
}

function installManagedMock(hangTts: boolean) {
  const ttsCalls: unknown[] = [];
  installChromeMock(async (message) => {
    const m = message as { type: string; payload?: { segments?: { idx: number; text: string }[] } };
    if (m.type === "managed.translate") {
      const segments = m.payload?.segments ?? [];
      return {
        ok: true,
        data: {
          batchId: "b",
          translations: segments.map((s) => ({ id: `s${s.idx}`, text: `vi ${s.text}`, startMs: 0, endMs: 1 }))
        }
      };
    }
    if (m.type === "managed.tts") {
      ttsCalls.push(message);
      if (hangTts) return new Promise(() => undefined);
      return ttsOk();
    }
    return undefined;
  });
  return ttsCalls;
}

async function startSession(getRemainingSourceMs: () => Promise<number | null>, hangTts: boolean) {
  const video = installDomFakes();
  const ttsCalls = installManagedMock(hangTts);
  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings(),
    onProgress: () => undefined,
    onReady: () => undefined,
    getRemainingSourceMs
  });
  const platform = { getCaptionTranscript: async () => ({ source: "captions" as const, ...TRANSCRIPT }) };
  await session.startGenerated(platform as never);
  return { session, ttsCalls };
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("completeAll blocks when the quota estimate exceeds the remaining source ms", async () => {
  const { session, ttsCalls } = await startSession(async () => 1000, true);
  await waitFor(() => ttsCalls.length === 2, "live tts dispatch to settle");
  const callsBefore = ttsCalls.length;
  await assert.rejects(
    session.completeAll(() => undefined),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "insufficient_quota");
      assert.ok(err.message.includes("PayOS"));
      assert.ok(err.message.includes("BYOK"));
      return true;
    }
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ttsCalls.length, callsBefore, "blocked export must not start new managed generation");
  session.destroy();
});

test("completeAll proceeds when the remaining quota covers the estimate", async () => {
  const { session } = await startSession(async () => 10_000_000, false);
  const dub = await session.completeAll(() => undefined);
  assert.equal(dub.segments.length, 4);
  session.destroy();
});
