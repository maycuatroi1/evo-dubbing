import test from "node:test";
import assert from "node:assert/strict";
import {
  installChromeMock,
  installDocumentStub,
  installFetchStub,
  flushMicrotasks,
  type FakeElement
} from "./helpers.ts";

test("pasting a Gemini key points translation, TTS and voice at Gemini", async () => {
  const elements = installDocumentStub();
  installFetchStub();
  const mock = installChromeMock(async () => ({ ok: false, status: 401, code: "not_signed_in", error: "no" }));
  mock.storage.local.data["evoDubbingSettings"] = {
    translateProvider: "openai",
    ttsProvider: "openai",
    sttProvider: "openai",
    targetLang: "vi",
    voice: "alloy",
    duckVolume: 0.18,
    showSubtitles: true,
    ttsModel: "gpt-4o-mini-tts",
    translateModel: "gpt-5.4-mini",
    shareServerUrl: "https://nghe.omelet.tech",
    autoUpload: false,
    defaultVisibility: "public",
    billingMode: "byok",
    managedBaseUrl: "https://nghe.omelet.tech",
    managedVoiceProfileId: "vi-standard-female",
    settingsVersion: 1
  };

  await import("../src/options/options.ts");
  await flushMicrotasks();

  const el = (id: string) => elements.get(id) as FakeElement;
  assert.equal(el("translateProvider").value, "openai");

  el("geminiKey").value = "AIzaSomethingSomething";
  el("geminiKey").dispatch("input");

  assert.equal(el("translateProvider").value, "gemini");
  assert.equal(el("ttsProvider").value, "gemini");
  assert.equal(el("translateModel").value, "gemini-3.5-flash");
  assert.equal(el("ttsModel").value, "gemini-3.1-flash-tts-preview");
  assert.equal(el("voice").value, "Kore");
  // Gemini has no STT models, so the caption fallback stays where it works.
  assert.equal(el("sttProvider").value, "openai");
  assert.equal(el("keysAutoNote").classes.has("evo-hidden"), false);

  // A provider picked by hand outranks any later key: adding an OpenAI key must not flip it back.
  el("translateProvider").dispatch("change", { target: el("translateProvider") });
  el("openaiKey").value = "sk-abc";
  el("openaiKey").dispatch("input");
  assert.equal(el("translateProvider").value, "gemini");
  assert.equal(el("ttsProvider").value, "gemini");
});
