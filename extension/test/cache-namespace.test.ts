import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";

test("BYOK namespace equals the upstream provider id, managed namespace carries the voice profile version", async () => {
  installChromeMock();
  const { createInferenceBackend } = await import("../src/lib/backend/index.ts");
  const base = {
    translateProvider: "openai" as const,
    ttsProvider: "openai" as const,
    sttProvider: "openai" as const,
    targetLang: "vi",
    voice: "alloy",
    duckVolume: 0.18,
    showSubtitles: true,
    ttsModel: "gpt-4o-mini-tts",
    translateModel: "gpt-5.4-mini",
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "public" as const,
    managedBaseUrl: "",
    managedVoiceProfileId: "vi-standard-female",
    keys: { openai: "sk-test" }
  };
  const byok = createInferenceBackend({ ...base, billingMode: "byok" });
  assert.equal(byok.namespace().tts, "openai");
  assert.equal(byok.namespace().translate, "openai");

  const managed = createInferenceBackend({
    ...base,
    billingMode: "managed",
    managedBaseUrl: "https://managed.example.com"
  });
  assert.equal(managed.namespace().tts, "managed:tts:vi-standard-female@vi-VN.kore.2026-07-25");
  assert.equal(managed.namespace().translate, "managed:translate:v1");

  const { ttsCacheKey, translationCacheKey } = await import("../src/lib/dubbing/cache.ts");
  const byokAudioKey = ttsCacheKey(byok.namespace().tts, base.ttsModel, base.voice, "hello");
  const managedAudioKey = ttsCacheKey(managed.namespace().tts, base.ttsModel, base.voice, "hello");
  assert.notEqual(byokAudioKey, managedAudioKey);
  const segments = [{ idx: 0, text: "hello" }];
  const byokTrKey = translationCacheKey(byok.namespace().translate, base.translateModel, "en", "vi", segments);
  const managedTrKey = translationCacheKey(managed.namespace().translate, base.translateModel, "en", "vi", segments);
  assert.notEqual(byokTrKey, managedTrKey);

  const economy = createInferenceBackend({
    ...base,
    billingMode: "managed",
    managedBaseUrl: "https://managed.example.com",
    managedVoiceProfileId: "vi-economy-female"
  });
  assert.notEqual(managed.namespace().tts, economy.namespace().tts);
});
