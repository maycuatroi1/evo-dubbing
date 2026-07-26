import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";
import { AI_VOICE_DISCLOSURE, formatSourceMinutes } from "../src/lib/managed/onboarding.ts";
import { managedLookupDub } from "../src/lib/managed/messages.ts";
import { MANAGED_GENERATION_PROFILE, getManagedVoiceProfile } from "../src/lib/managed/profiles.ts";
import {
  RIGHTS_ASSERTION_COPY,
  RIGHTS_ASSERTION_ERROR,
  managedShareUploadMeta,
  performShare,
  renderShareConfirmation,
  shareConfirmationLines
} from "../src/lib/managed/share.ts";
import type { Dub } from "../src/lib/types.ts";

test("share confirmation shows the estimated remaining source minutes after the dub", () => {
  const lines = shareConfirmationLines({ estimateMs: 600_000, remainingMs: 3_600_000 });
  assert.ok(lines.some((line) => line.includes(formatSourceMinutes(600_000))));
  assert.ok(lines.some((line) => line.includes("còn khoảng") && line.includes(formatSourceMinutes(3_000_000))));

  const insufficient = shareConfirmationLines({ estimateMs: 3_600_000, remainingMs: 600_000 });
  assert.ok(insufficient.some((line) => line.includes("không đủ")));

  const unknown = shareConfirmationLines({ estimateMs: 600_000, remainingMs: null });
  assert.ok(unknown.some((line) => line.includes("Không đọc được quota")));
});

class FakeEl {
  tag = "";
  className = "";
  textContent = "";
  type = "";
  checked = false;
  disabled = false;
  children: FakeEl[] = [];
  listeners: Record<string, (() => void)[]> = {};
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn();
  }
  set innerHTML(value: string) {
    if (value === "") this.children = [];
  }
}

function installDocumentStub() {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => Object.assign(new FakeEl(), { tag })
  };
}

function textOf(node: FakeEl): string {
  return [node.textContent, ...node.children.map(textOf)].join(" ");
}

function findAll(node: FakeEl, pred: (el: FakeEl) => boolean): FakeEl[] {
  return [...(pred(node) ? [node] : []), ...node.children.flatMap((c) => findAll(c, pred))];
}

function renderConfirm(view: { estimateMs: number; remainingMs: number | null }) {
  installDocumentStub();
  const root = new FakeEl();
  const calls: string[] = [];
  renderShareConfirmation(root as unknown as HTMLElement, view, {
    onConfirm: () => calls.push("confirm"),
    onCancel: () => calls.push("cancel")
  });
  const checkbox = findAll(root, (el) => el.tag === "input")[0];
  const confirmBtn = findAll(root, (el) => el.tag === "button" && el.textContent.includes("Xác nhận"))[0];
  const cancelBtn = findAll(root, (el) => el.tag === "button" && el.textContent === "Hủy")[0];
  return { root, calls, checkbox, confirmBtn, cancelBtn, text: textOf(root) };
}

test("rights assertion checkbox is not pre-checked and gates the confirm action", () => {
  const { checkbox, confirmBtn, calls, text } = renderConfirm({ estimateMs: 600_000, remainingMs: 3_600_000 });
  assert.ok(checkbox);
  assert.equal(checkbox.checked, false, "assertion must not be pre-checked");
  assert.equal(confirmBtn.disabled, true, "confirm stays disabled until the assertion is ticked");
  assert.ok(text.includes(RIGHTS_ASSERTION_COPY));

  confirmBtn.dispatch("click");
  assert.deepEqual(calls, [], "clicking confirm without the assertion must not proceed");

  checkbox.checked = true;
  checkbox.dispatch("change");
  assert.equal(confirmBtn.disabled, false);
  confirmBtn.dispatch("click");
  assert.deepEqual(calls, ["confirm"]);
});

test("share confirmation renders the AI-generated voice disclosure", () => {
  const { text } = renderConfirm({ estimateMs: 600_000, remainingMs: 3_600_000 });
  assert.ok(text.includes(AI_VOICE_DISCLOSURE));
});

function fakeDub(): Dub {
  return {
    platform: "youtube",
    videoId: "abc123",
    sourceLang: "en",
    targetLang: "vi",
    voice: "Kore",
    provider: "openai",
    title: "Demo",
    durationMs: 2600,
    visibility: "public",
    segments: []
  };
}

test("missing rights assertion blocks the upload before generation starts", async () => {
  const calls: string[] = [];
  await assert.rejects(
    performShare({
      visibility: "public",
      billingMode: "managed",
      rightsAssertion: false,
      voiceProfileId: "vi-standard-female",
      completeAll: async () => {
        calls.push("completeAll");
        return fakeDub();
      },
      upload: async () => {
        calls.push("upload");
        return { id: "x" };
      }
    }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, RIGHTS_ASSERTION_ERROR);
      return true;
    }
  );
  assert.deepEqual(calls, [], "neither completeAll nor upload may run without the assertion");
});

test("confirmed managed public share uploads with profile metadata and the assertion", async () => {
  const uploaded: Array<Record<string, unknown>> = [];
  const result = await performShare({
    visibility: "public",
    billingMode: "managed",
    rightsAssertion: true,
    voiceProfileId: "vi-standard-female",
    completeAll: async () => fakeDub(),
    upload: async (dub, meta) => {
      uploaded.push({ dub, meta });
      return { id: "dub-1" };
    }
  });
  assert.equal(result.id, "dub-1");
  assert.equal(uploaded.length, 1);
  const meta = uploaded[0].meta as Record<string, unknown>;
  assert.equal(meta.generationProfile, MANAGED_GENERATION_PROFILE);
  assert.equal(meta.voiceProfile, getManagedVoiceProfile("vi-standard-female").version);
  assert.equal(meta.rightsAssertion, true);
});

test("byok and private shares never require the rights assertion", async () => {
  let uploads = 0;
  const run = (visibility: "public" | "private", billingMode: "byok" | "managed") =>
    performShare({
      visibility,
      billingMode,
      rightsAssertion: false,
      completeAll: async () => fakeDub(),
      upload: async () => {
        uploads += 1;
        return { id: "x" };
      }
    });
  await run("public", "byok");
  await run("private", "managed");
  assert.equal(uploads, 2);
  assert.equal(managedShareUploadMeta("vi-economy-female", false).voiceProfile, getManagedVoiceProfile("vi-economy-female").version);
});

test("managed lookupDub maps a 404 to null and returns profiled dubs otherwise", async () => {
  installChromeMock(async () => ({ ok: false, status: 404, code: "not_found", error: "no shared dub" }));
  const miss = await managedLookupDub({
    baseUrl: "https://managed.example.com",
    platform: "youtube",
    videoId: "abc123",
    targetLang: "vi",
    voiceProfileId: "vi-standard-female"
  });
  assert.equal(miss, null);

  installChromeMock(async (message) => {
    const m = message as { type: string };
    assert.equal(m.type, "managed.lookupDub");
    return {
      ok: true,
      data: {
        id: "dub-1",
        platform: "youtube",
        videoId: "abc123",
        sourceLang: "en",
        targetLang: "vi",
        voice: "Kore",
        provider: "google-gemini",
        title: "Demo",
        durationMs: 2600,
        visibility: "public",
        generationProfile: MANAGED_GENERATION_PROFILE,
        voiceProfile: getManagedVoiceProfile("vi-standard-female").version,
        rightsAssertedAt: "2026-07-20T00:00:00.000Z",
        aiVoiceDisclosure: AI_VOICE_DISCLOSURE,
        segments: [
          { idx: 0, startMs: 0, endMs: 1200, originalText: "hello", text: "xin chao", audioUrl: "https://r2.test/0.mp3", mime: "audio/mpeg" }
        ]
      }
    };
  });
  const hit = await managedLookupDub({
    baseUrl: "https://managed.example.com",
    platform: "youtube",
    videoId: "abc123",
    targetLang: "vi",
    voiceProfileId: "vi-standard-female"
  });
  assert.ok(hit);
  assert.equal(hit!.generationProfile, MANAGED_GENERATION_PROFILE);
  assert.equal(hit!.aiVoiceDisclosure, AI_VOICE_DISCLOSURE);
  assert.equal(hit!.segments.length, 1);
});

function makeManagedSettings() {
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

async function waitFor(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("completeAll with insufficient quota never calls the managed provider", async () => {
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
      return new Promise(() => undefined);
    }
    return undefined;
  });
  const { DubSession } = await import("../src/lib/dubbing/session.ts");
  const session = new DubSession({
    video: video as unknown as HTMLVideoElement,
    context: CONTEXT,
    settings: makeManagedSettings(),
    onProgress: () => undefined,
    onReady: () => undefined,
    getRemainingSourceMs: async () => 1000
  });
  const platform = { getCaptionTranscript: async () => ({ source: "captions" as const, ...TRANSCRIPT }) };
  await session.startGenerated(platform as never);
  await waitFor(() => ttsCalls.length === 2, "live tts dispatch to settle");
  const callsBefore = ttsCalls.length;
  await assert.rejects(
    session.completeAll(() => undefined),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "insufficient_quota");
      return true;
    }
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ttsCalls.length, callsBefore, "insufficient quota must not call the provider");
  session.destroy();
});
