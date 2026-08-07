import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";
import type { DubCoverage } from "../src/lib/types.ts";

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

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    translateProvider: "openai" as const,
    ttsProvider: "openai" as const,
    sttProvider: "openai" as const,
    targetLang: "vi",
    voice: "alloy",
    duckVolume: 0.18,
    showSubtitles: false,
    showTimelineProgress: true,
    holdUntilFirstDub: true,
    ttsModel: "gpt-4o-mini-tts",
    translateModel: "gpt-5.4-mini",
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "public" as const,
    billingMode: "managed" as const,
    managedBaseUrl: "https://managed.example.com",
    managedVoiceProfileId: "vi-standard-female",
    keys: {},
    ...overrides
  };
}

class FakeVideo {
  currentTime = 0;
  duration = 16;
  volume = 1;
  paused = false;
  playCalls = 0;
  pauseCalls = 0;
  parentElement = null;
  private listeners: Record<string, (() => void)[]> = {};

  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn);
  }

  private emit(type: string): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn();
  }

  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    this.emit("play");
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls++;
    this.paused = true;
    this.emit("pause");
  }

  closest(): null {
    return null;
  }
}

/** Real timers, so the 200ms hold poll and the 60ms playback tick actually run. */
function installDomFakes(): FakeVideo {
  (globalThis as { window?: unknown }).window = {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>)
  };
  (globalThis as { AudioContext?: unknown }).AudioContext = class {
    destination = {};
    createGain() {
      return { connect() {} };
    }
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start() {},
        stop() {}
      };
    }
    async resume() {}
    async decodeAudioData() {
      return { duration: 1 };
    }
    async close() {}
  };
  return new FakeVideo();
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

function installBackend(onTts: () => Promise<unknown> | unknown) {
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
    if (m.type === "managed.tts") return onTts();
    return undefined;
  });
}

const platform = { getCaptionTranscript: async () => ({ source: "captions" as const, ...TRANSCRIPT }) };

test("hold pauses the video on Dub and resumes it only once the first line is ready", async () => {
  const video = installDomFakes();
  const pending: Deferred[] = [];
  installBackend(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });

  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const phases: string[] = [];
  const coverages: DubCoverage[] = [];
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings(),
    onProgress: (p) => phases.push(p.phase),
    onCoverage: (c) => coverages.push(c),
    onReady: () => undefined
  });

  session.beginHold();
  assert.equal(video.paused, true, "pressing Dub must stop the video before captions are even fetched");
  assert.equal(video.pauseCalls, 1);
  assert.ok(phases.includes("holding"), "the viewer has to be told why the video stopped");

  await session.startGenerated(platform as never);
  await waitFor(() => pending.length >= 1, "the first tts call");
  assert.equal(video.paused, true, "still held while the first line is being synthesized");
  assert.equal(session.isHolding(), true);

  for (const d of pending) d.resolve(ttsOk());
  await waitFor(() => video.playCalls === 1, "playback to resume once the first line is ready");
  assert.equal(video.paused, false);
  assert.equal(session.isHolding(), false);

  await waitFor(() => coverages.some((c) => c.ranges.length > 0), "coverage for the scrubber lane");
  const last = coverages[coverages.length - 1];
  assert.equal(last.durationMs, 16000, "coverage is measured against the video duration");
  assert.equal(last.ranges[0].startMs, 0);

  session.destroy();
});

test("hold off leaves playback alone", async () => {
  const video = installDomFakes();
  installBackend(() => ttsOk());

  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings({ holdUntilFirstDub: false }),
    onProgress: () => undefined,
    onReady: () => undefined
  });

  session.beginHold();
  assert.equal(video.paused, false, "with the mode off the video keeps playing");
  assert.equal(video.pauseCalls, 0);
  assert.equal(session.isHolding(), false);
  session.destroy();
});

test("a viewer who presses play wins over the hold", async () => {
  const video = installDomFakes();
  const pending: Deferred[] = [];
  installBackend(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });

  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings(),
    onProgress: () => undefined,
    onReady: () => undefined
  });

  session.beginHold();
  assert.equal(video.paused, true);

  await video.play();
  assert.equal(session.isHolding(), false, "the hold must let go rather than fight the play button");
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(video.paused, false, "and must not re-pause on the next poll");

  for (const d of pending) d.resolve(ttsOk());
  session.destroy();
});

test("a dub that never produces audio still hands the video back", async () => {
  const video = installDomFakes();
  installBackend(() => ({ ok: false, status: 401, code: "invalid_token", error: "token expired" }));

  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeSettings(),
    onProgress: () => undefined,
    onReady: () => undefined
  });

  session.beginHold();
  assert.equal(video.paused, true);
  await session.startGenerated(platform as never);
  await waitFor(() => video.paused === false, "the fatal error to release the hold");
  assert.equal(session.isHolding(), false);
  session.destroy();
});
