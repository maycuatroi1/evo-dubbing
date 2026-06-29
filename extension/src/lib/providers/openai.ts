import type { Transcript } from "../types";
import { fetchJson, fetchArrayBuffer, postForm, arrayBufferToBase64 } from "../net";
import type {
  Provider,
  TranslateBatch,
  TranslatedSegment,
  TtsRequest,
  TtsResult,
  SttRequest
} from "./index";

const BASE = "https://api.openai.com/v1";

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

interface ChatResponse {
  choices: { message: { content: string } }[];
}

async function translate(batch: TranslateBatch, key: string): Promise<TranslatedSegment[]> {
  const numbered = batch.segments.map((s) => `${s.idx}: ${s.text}`).join("\n");
  const system =
    "You are a professional subtitle translator. Translate each numbered line into the target language. " +
    "Keep the meaning natural and spoken, preserve the line numbering, do not merge or split lines, " +
    "and return strictly valid JSON.";
  const user =
    `Source language: ${batch.sourceLang}\n` +
    `Target language: ${batch.targetLang}\n` +
    `Return JSON of the form {"translations":[{"idx":<number>,"text":"<translation>"}]}.\n\n` +
    numbered;

  const isReasoning = /^(gpt-5|o[0-9])/.test(batch.model);
  const body: Record<string, unknown> = {
    model: batch.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  if (isReasoning) {
    body.reasoning_effort = "low";
  } else {
    body.temperature = 0.3;
  }

  const res = await fetchJson<ChatResponse>(`${BASE}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify(body)
  });

  const content = res.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { translations?: TranslatedSegment[] };
  return parsed.translations ?? [];
}

async function tts(req: TtsRequest, key: string): Promise<TtsResult> {
  const audio = await fetchArrayBuffer(`${BASE}/audio/speech`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({
      model: req.model,
      voice: req.voice,
      input: req.text,
      response_format: "mp3"
    })
  });
  return { audio, mime: "audio/mpeg" };
}

interface VerboseTranscription {
  language?: string;
  segments?: { start: number; end: number; text: string }[];
  text?: string;
}

async function stt(req: SttRequest, key: string): Promise<Transcript> {
  const res = await postForm<VerboseTranscription>(
    `${BASE}/audio/transcriptions`,
    { Authorization: `Bearer ${key}` },
    {
      fields: {
        model: req.model,
        response_format: "verbose_json",
        ...(req.language ? { language: req.language } : {})
      },
      file: {
        field: "file",
        filename: req.filename,
        mime: req.mime,
        base64: arrayBufferToBase64(req.audio)
      }
    }
  );

  const segments = (res.segments ?? []).map((s, i) => ({
    idx: i,
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    text: s.text.trim()
  }));

  return { source: "stt", lang: res.language ?? req.language ?? "auto", segments };
}

export const openaiProvider: Provider = {
  id: "openai",
  label: "OpenAI",
  translateModels: ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5", "gpt-5.4"],
  ttsModels: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
  sttModels: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  voices: [
    { id: "alloy", label: "Alloy" },
    { id: "ash", label: "Ash" },
    { id: "ballad", label: "Ballad" },
    { id: "coral", label: "Coral" },
    { id: "echo", label: "Echo" },
    { id: "fable", label: "Fable" },
    { id: "onyx", label: "Onyx" },
    { id: "nova", label: "Nova" },
    { id: "sage", label: "Sage" },
    { id: "shimmer", label: "Shimmer" },
    { id: "verse", label: "Verse" }
  ],
  translate,
  tts,
  stt
};
