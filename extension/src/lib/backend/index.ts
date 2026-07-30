import type { Settings } from "../types.ts";
import {
  getProvider,
  type TranslateBatch,
  type TranslatedSegment,
  type TtsRequest,
  type TtsResult
} from "../providers/index.ts";
import { managedTranslate, managedTts } from "../managed/messages.ts";
import { MANAGED_TRANSLATE_NAMESPACE, managedTtsNamespace } from "../managed/profiles.ts";
import { fetchArrayBuffer } from "../net.ts";

export interface BackendTranslateCue {
  idx: number;
  startMs: number;
  endMs: number;
}

export interface BackendTtsContext {
  cue: { startMs: number; endMs: number };
  idempotencyKey: string;
}

export interface BackendNamespace {
  translate: string;
  tts: string;
}

export interface InferenceBackend {
  namespace(): BackendNamespace;
  translate(batch: TranslateBatch, cues?: BackendTranslateCue[]): Promise<TranslatedSegment[]>;
  tts(req: TtsRequest, context?: BackendTtsContext): Promise<TtsResult>;
}

function requireKey(settings: Settings, provider: "openai" | "gemini"): string {
  const key = settings.keys[provider];
  if (!key) throw new Error(`Missing ${provider} API key. Add it in the extension options.`);
  return key;
}

function createByokBackend(settings: Settings): InferenceBackend {
  const translateProvider = getProvider(settings.translateProvider);
  const ttsProvider = getProvider(settings.ttsProvider);
  return {
    namespace() {
      return { translate: settings.translateProvider, tts: settings.ttsProvider };
    },
    translate(batch) {
      return translateProvider.translate(batch, requireKey(settings, settings.translateProvider));
    },
    tts(req) {
      return ttsProvider.tts(req, requireKey(settings, settings.ttsProvider));
    }
  };
}

function createManagedBackend(settings: Settings): InferenceBackend {
  const baseUrl = settings.managedBaseUrl;
  const voiceProfileId = settings.managedVoiceProfileId;
  return {
    namespace() {
      return { translate: MANAGED_TRANSLATE_NAMESPACE, tts: managedTtsNamespace(voiceProfileId) };
    },
    async translate(batch, cues) {
      const timing = new Map((cues ?? []).map((c) => [c.idx, c]));
      const result = await managedTranslate({
        baseUrl,
        sourceLang: batch.sourceLang,
        targetLang: batch.targetLang,
        segments: batch.segments.map((seg) => {
          const cue = timing.get(seg.idx);
          return {
            idx: seg.idx,
            text: seg.text,
            startMs: cue?.startMs ?? 0,
            endMs: cue?.endMs ?? 1
          };
        })
      });
      return result.translations;
    },
    async tts(req, context) {
      if (!context) {
        throw new Error("Managed TTS requires cue timing and an idempotency key.");
      }
      const result = await managedTts({
        baseUrl,
        idempotencyKey: context.idempotencyKey,
        voiceProfileId,
        targetLang: settings.targetLang,
        text: req.text,
        cue: context.cue
      });
      if (result.audio) {
        return { audio: result.audio, mime: result.mime };
      }
      const audio = await fetchArrayBuffer(result.audioUrl!);
      return { audio, mime: result.mime };
    }
  };
}

export function createInferenceBackend(settings: Settings): InferenceBackend {
  return settings.billingMode === "managed" ? createManagedBackend(settings) : createByokBackend(settings);
}
