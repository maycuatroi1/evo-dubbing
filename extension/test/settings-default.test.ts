import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";

test("fresh install defaults to BYOK with no managed config", async () => {
  installChromeMock();
  const { getSettings, DEFAULT_SETTINGS } = await import("../src/lib/storage.ts");
  const settings = await getSettings();
  assert.equal(settings.billingMode, "byok");
  assert.equal(settings.managedBaseUrl, "");
  assert.equal(settings.managedVoiceProfileId, "vi-standard-female");
  assert.equal(settings.translateProvider, DEFAULT_SETTINGS.translateProvider);
  assert.equal(settings.ttsProvider, DEFAULT_SETTINGS.ttsProvider);
  assert.deepEqual(settings.keys, {});
});

test("old stored settings without billingMode stay BYOK", async () => {
  const mock = installChromeMock();
  mock.storage.local.data["evoDubbingSettings"] = {
    translateProvider: "gemini",
    ttsProvider: "gemini",
    sttProvider: "openai",
    targetLang: "vi",
    voice: "alloy",
    duckVolume: 0.18,
    showSubtitles: true,
    ttsModel: "gemini-2.5-flash-preview-tts",
    translateModel: "gemini-3.1-flash-lite",
    shareServerUrl: "https://share.example.com",
    autoUpload: false,
    defaultVisibility: "private"
  };
  mock.storage.local.data["evoDubbingKeys"] = { gemini: "user-owned-key" };
  const { getSettings } = await import("../src/lib/storage.ts");
  const settings = await getSettings();
  assert.equal(settings.billingMode, "byok");
  assert.equal(settings.translateProvider, "gemini");
  assert.equal(settings.shareServerUrl, "https://share.example.com");
  assert.equal(settings.keys.gemini, "user-owned-key");
});
