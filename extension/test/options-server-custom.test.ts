import test from "node:test";
import assert from "node:assert/strict";
import {
  installChromeMock,
  installDocumentStub,
  installFetchStub,
  flushMicrotasks,
  type FakeElement
} from "./helpers.ts";

const DEFAULT_SERVER = "https://nghe.omelet.tech";

test("a custom server is surfaced, not hidden, and one click restores the default", async () => {
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
    shareServerUrl: "https://self-hosted.example.com",
    autoUpload: false,
    defaultVisibility: "public",
    billingMode: "byok",
    managedBaseUrl: "https://self-hosted.example.com",
    managedVoiceProfileId: "vi-standard-female",
    settingsVersion: 1
  };

  await import("../src/options/options.ts");
  await flushMicrotasks();

  const el = (id: string) => elements.get(id) as FakeElement;

  // Already off-default: the disclosure opens itself and the banner names the host, so a user
  // who inherited a custom server can see why the paid plan is missing.
  assert.equal(el("serverAdvanced").open, true);
  assert.equal(el("serverUnlock").checked, true);
  assert.equal(el("managedBaseUrl").disabled, false);
  assert.equal(el("serverBanner").classes.has("evo-hidden"), false);
  assert.equal(el("serverHost").textContent, "self-hosted.example.com");
  assert.match(el("serverBannerText").textContent, /self-hosted\.example\.com/);
  assert.equal(el("serverBadge").classes.has("evo-badge--warn"), true);

  el("serverBannerReset").dispatch("click");
  await flushMicrotasks();

  assert.equal(el("managedBaseUrl").value, DEFAULT_SERVER);
  assert.equal(el("shareServerUrl").value, DEFAULT_SERVER);
  assert.equal(el("serverUnlock").checked, false);
  assert.equal(el("serverAdvanced").open, false);
  assert.equal(el("managedBaseUrl").disabled, true);
  assert.equal(el("serverBanner").classes.has("evo-hidden"), true);

  // Restoring persists on its own; a broken server must not survive a forgotten save.
  const stored = mock.storage.local.data["evoDubbingSettings"] as {
    managedBaseUrl: string;
    shareServerUrl: string;
  };
  assert.equal(stored.managedBaseUrl, DEFAULT_SERVER);
  assert.equal(stored.shareServerUrl, DEFAULT_SERVER);
});
