import type { Transcript } from "../types";
import { fetchJson, base64ToArrayBuffer } from "../net";
import type {
  Provider,
  TranslateBatch,
  TranslatedSegment,
  TtsRequest,
  TtsResult,
  SttRequest
} from "./index";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GenerateResponse {
  candidates?: {
    content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] };
  }[];
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
    "You are a professional subtitle translator. Translate each numbered line into the target language. " +
    "Keep the meaning natural and spoken, preserve the line numbering, do not merge or split lines.\n" +
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

  const text = res.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text) as { translations?: TranslatedSegment[] };
  return parsed.translations ?? [];
}

async function tts(req: TtsRequest, key: string): Promise<TtsResult> {
  const res = await fetchJson<GenerateResponse>(`${BASE}/${req.model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: req.text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } }
        }
      }
    })
  });

  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) throw new Error("gemini tts returned no audio");
  const pcm = base64ToArrayBuffer(data);
  const wav = pcm16ToWav(pcm, parseRate(part?.inlineData?.mimeType));
  return { audio: wav, mime: "audio/wav" };
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
