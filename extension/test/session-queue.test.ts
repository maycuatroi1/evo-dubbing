import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";

interface Deferred {
  promise: Promise<unknown>;
  resolve(value: unknown): void;
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

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
      chargedSourceMs: 0,
      remainingMs: 1000,
      voiceProfileVersion: "v",
      audioBase64: "AAE="
    }
  };
}

test("pause stops dispatching queued cues and resume picks them up again", async () => {
  const video = installDomFakes();
  const ttsCalls: unknown[] = [];
  const pending: Deferred[] = [];
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
      if (ttsCalls.length <= 2) {
        const d = deferred();
        pending.push(d);
        return d.promise;
      }
      return ttsOk();
    }
    return undefined;
  });

  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const progress: { phase: string; message: string }[] = [];
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings(),
    onProgress: (p) => progress.push({ phase: p.phase, message: p.message }),
    onReady: () => undefined
  });
  const platform = { getCaptionTranscript: async () => ({ source: "captions" as const, ...TRANSCRIPT }) };
  await session.startGenerated(platform as never);

  await waitFor(() => ttsCalls.length === 2, "two in-flight tts calls");
  session.pause();
  for (const d of pending) d.resolve(ttsOk());
  await waitFor(() => progress.filter((p) => p.phase === "ready").length >= 3, "in-flight cues to finish");
  assert.equal(ttsCalls.length, 2, "pause must not dispatch more queued cues");

  session.resume();
  await waitFor(() => ttsCalls.length === 4, "resume dispatches the remaining cues");
  assert.equal(ttsCalls.length, 4);
  session.destroy();
});

test("fatal 401 blocks the queue and surfaces an error instead of charging ahead", async () => {
  const video = installDomFakes();
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
      return { ok: false, status: 401, code: "invalid_token", error: "token expired" };
    }
    return undefined;
  });

  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const progress: { phase: string; message: string }[] = [];
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings(),
    onProgress: (p) => progress.push({ phase: p.phase, message: p.message }),
    onReady: () => undefined
  });
  const platform = { getCaptionTranscript: async () => ({ source: "captions" as const, ...TRANSCRIPT }) };
  await session.startGenerated(platform as never);

  await waitFor(() => progress.some((p) => p.phase === "error"), "fatal error surfaced");
  assert.equal(ttsCalls.length, 2, "queue must stop after the fatal 401, not drain all 4 cues");
  const error = progress.find((p) => p.phase === "error")!;
  assert.ok(error.message.includes("token expired"));

  session.resume();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ttsCalls.length, 2, "resume must not retry after a fatal 401");
  session.destroy();
});
