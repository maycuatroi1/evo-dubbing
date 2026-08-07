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

test("options init restores model and voice selection after filling options", async () => {
  const elements = installDocumentStub();
  installFetchStub();
  const mock = installChromeMock(async () => ({ ok: false, status: 401, code: "not_signed_in", error: "no" }));
  mock.storage.local.data["evoDubbingSettings"] = {
    translateProvider: "gemini",
    ttsProvider: "gemini",
    sttProvider: "openai",
    targetLang: "vi",
    voice: "Kore",
    duckVolume: 0.18,
    showSubtitles: true,
    ttsModel: "gemini-2.5-pro-preview-tts",
    translateModel: "gemini-3.1-flash-lite",
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "private",
    billingMode: "byok",
    managedBaseUrl: "",
    managedVoiceProfileId: "vi-standard-female"
  };

  await import("../src/options/options.ts");
  await flushMicrotasks();

  const el = (id: string) => elements.get(id) as FakeElement;

  assert.equal(el("translateProvider").value, "gemini");
  assert.equal(el("ttsProvider").value, "gemini");
  assert.equal(el("translateModel").value, "gemini-3.1-flash-lite");
  assert.equal(el("ttsModel").value, "gemini-2.5-pro-preview-tts");
  assert.equal(el("voice").value, "Kore");
  assert.equal(el("modeByok").checked, true);
  assert.equal(el("modeManaged").checked, false);

  // A settings blob from before the baked-in default lands on it, and the server card stays
  // shut: nothing to read, nothing to type, no disclosure open.
  assert.equal(el("managedBaseUrl").value, DEFAULT_SERVER);
  assert.equal(el("shareServerUrl").value, DEFAULT_SERVER);
  assert.equal(el("managedBaseUrl").disabled, true);
  assert.equal(el("shareServerUrl").disabled, true);
  assert.equal(el("serverTest").disabled, true);
  assert.equal(el("serverUnlock").checked, false);
  assert.equal(el("serverAdvanced").open, false);
  assert.equal(el("serverBanner").classes.has("evo-hidden"), true);
});
