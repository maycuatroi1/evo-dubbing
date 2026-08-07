import type { Transcript } from "../types.ts";
import { fetchJson, base64ToArrayBuffer } from "../net.ts";
import { delay } from "../concurrency.ts";
import type {
  Provider,
  TranslateBatch,
  TranslatedSegment,
  TtsRequest,
  TtsResult,
  SttRequest
} from "./index.ts";
import { parseTranslationsResponse } from "./index.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
}

interface GenerateResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * A candidate is a list of parts, not one part. Reasoning models put a thought part first, and
 * a long answer can arrive split across several parts, so reading parts[0] alone hands the
 * parser either a thought or a prefix of the JSON.
 */
function joinTextParts(parts: GeminiPart[] | undefined): string {
  const all = parts ?? [];
  const answer = all.filter((p) => p.thought !== true && typeof p.text === "string");
  const chosen = answer.length > 0 ? answer : all.filter((p) => typeof p.text === "string");
  return chosen.map((p) => p.text as string).join("");
}

function parseRate(mime: string | undefined): number {
  if (!mime) return 24000;
  const match = mime.match(/rate=(\d+)/);
  return match ? Number(match[1]) : 24000;
}

function pcm16ToWav(pcm: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(new Uint8Array(pcm));
  return buffer;
}

async function translate(batch: TranslateBatch, key: string): Promise<TranslatedSegment[]> {
  const numbered = batch.segments.map((s) => `${s.idx}: ${s.text}`).join("\n");
  const prompt =
    "You are a professional dubbing translator. Translate each numbered line into the target language for voice-over. " +
    "Keep the meaning natural and spoken, and prefer concise phrasing that can be spoken in roughly the same time as the " +
    "source line, so it dubs cleanly without rushing. Keep terminology, names, register and tone consistent across all lines. " +
    "Preserve the line numbering, do not merge or split lines.\n" +
    `Source language: ${batch.sourceLang}\n` +
    `Target language: ${batch.targetLang}\n` +
    `Return JSON of the form {"translations":[{"idx":<number>,"text":"<translation>"}]}.\n\n` +
    numbered;

  const res = await fetchJson<GenerateResponse>(`${BASE}/${batch.model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
    })
  });

  const text = joinTextParts(res.candidates?.[0]?.content?.parts) || "{}";
  return parseTranslationsResponse(text, batch.segments.length);
}

const TTS_ATTEMPTS = 3;
const TTS_BACKOFF_MS = [400, 1200];

/** Refusals and hard stops repeat on the same text; anything else is worth another try. */
const TTS_PERMANENT_FINISH = new Set([
  "SAFETY",
  "RECITATION",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "MAX_TOKENS"
]);

class NoAudioError extends Error {
  permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.permanent = permanent;
  }
}

function describeMissingAudio(res: GenerateResponse): NoAudioError {
  const blockReason = res.promptFeedback?.blockReason;
  if (blockReason) return new NoAudioError(`gemini tts refused the text (blockReason=${blockReason})`, true);

  const candidate = res.candidates?.[0];
  if (!candidate) return new NoAudioError("gemini tts returned no audio (empty response, no candidate)", false);

  const finishReason = candidate.finishReason ?? "";
  const spoken = candidate.content?.parts?.find((p) => typeof p.text === "string" && p.text.trim())?.text;
  const detail = [
    finishReason ? `finishReason=${finishReason}` : "no finishReason",
    spoken ? `model replied with text instead: "${spoken.trim().slice(0, 120)}"` : ""
  ]
    .filter(Boolean)
    .join("; ");
  return new NoAudioError(`gemini tts returned no audio (${detail})`, TTS_PERMANENT_FINISH.has(finishReason));
}

async function tts(req: TtsRequest, key: string): Promise<TtsResult> {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: req.text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } }
      }
    }
  });

  let lastError = new NoAudioError("gemini tts returned no audio", false);
  for (let attempt = 0; attempt < TTS_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(TTS_BACKOFF_MS[attempt - 1] ?? 1200);

    const res = await fetchJson<GenerateResponse>(`${BASE}/${req.model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });

    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const data = part?.inlineData?.data;
    if (data) {
      const pcm = base64ToArrayBuffer(data);
      return { audio: pcm16ToWav(pcm, parseRate(part?.inlineData?.mimeType)), mime: "audio/wav" };
    }

    lastError = describeMissingAudio(res);
    if (lastError.permanent) throw lastError;
  }
  throw lastError;
}

async function stt(_req: SttRequest, _key: string): Promise<Transcript> {
  throw new Error("Gemini STT with timestamps is not supported. Use OpenAI for speech-to-text fallback.");
}

export const geminiProvider: Provider = {
  id: "gemini",
  label: "Gemini",
  translateModels: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
  ttsModels: ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"],
  sttModels: [],
  voices: [
    { id: "Kore", label: "Kore" },
    { id: "Puck", label: "Puck" },
    { id: "Charon", label: "Charon" },
    { id: "Aoede", label: "Aoede" },
    { id: "Fenrir", label: "Fenrir" },
    { id: "Leda", label: "Leda" },
    { id: "Orus", label: "Orus" },
    { id: "Zephyr", label: "Zephyr" }
  ],
  translate,
  tts,
  stt
};
