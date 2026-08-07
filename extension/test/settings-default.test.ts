import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";

const DEFAULT_SERVER = "https://nghe.omelet.tech";

test("fresh install points at the deployed server in BYOK mode", async () => {
  installChromeMock();
  const { getSettings, DEFAULT_SETTINGS } = await import("../src/lib/storage.ts");
  const settings = await getSettings();
  assert.equal(settings.billingMode, "byok");
  assert.equal(settings.managedBaseUrl, DEFAULT_SERVER);
  assert.equal(settings.shareServerUrl, DEFAULT_SERVER);
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

test("settings written before the baked-in default adopt the deployed server", async () => {
  const mock = installChromeMock();
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
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "public",
    billingMode: "byok",
    managedBaseUrl: ""
  };
  const { getSettings } = await import("../src/lib/storage.ts");
  const settings = await getSettings();
  assert.equal(settings.shareServerUrl, DEFAULT_SERVER);
  assert.equal(settings.managedBaseUrl, DEFAULT_SERVER);
  assert.equal(settings.settingsVersion, 1);
});

test("an empty server on a versioned blob is a deliberate opt-out and is left alone", async () => {
  const mock = installChromeMock();
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
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "public",
    billingMode: "byok",
    managedBaseUrl: "https://self-hosted.example.com",
    settingsVersion: 1
  };
  const { getSettings } = await import("../src/lib/storage.ts");
  const settings = await getSettings();
  assert.equal(settings.shareServerUrl, "");
  assert.equal(settings.managedBaseUrl, "https://self-hosted.example.com");
});

test("saving stamps the settings version so later empties are respected", async () => {
  const mock = installChromeMock();
  const { getSettings, saveSettings, DEFAULT_SETTINGS } = await import("../src/lib/storage.ts");
  await saveSettings({ ...DEFAULT_SETTINGS, shareServerUrl: "", managedBaseUrl: "" });
  const stored = mock.storage.local.data["evoDubbingSettings"] as { settingsVersion?: number };
  assert.equal(stored.settingsVersion, 1);
  const settings = await getSettings();
  assert.equal(settings.shareServerUrl, "");
  assert.equal(settings.managedBaseUrl, "");
});
