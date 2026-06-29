import type {
  Dub,
  DubSegment,
  ProgressHandler,
  Settings,
  Transcript,
  TranscriptSegment,
  VideoContext
} from "../types";
import type { Platform } from "../platforms";
import { getProvider } from "../providers";
import { mapLimit, chunk } from "../concurrency";

export interface BuildDubOptions {
  context: VideoContext;
  platform: Platform;
  settings: Settings;
  onProgress: ProgressHandler;
  signal?: AbortSignal;
}

const TRANSLATE_BATCH = 40;
const TRANSLATE_CONCURRENCY = 2;
const TTS_CONCURRENCY = 3;

function requireKey(settings: Settings, provider: "openai" | "gemini"): string {
  const key = settings.keys[provider];
  if (!key) throw new Error(`Missing ${provider} API key. Add it in the extension options.`);
  return key;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

async function getTranscript(opts: BuildDubOptions): Promise<Transcript> {
  const { platform, settings, onProgress } = opts;
  onProgress({ phase: "transcript", current: 0, total: 1, message: "Reading captions" });

  const captions = await platform.getCaptionTranscript(settings.targetLang);
  if (captions && captions.segments.length > 0) {
    onProgress({
      phase: "transcript",
      current: 1,
      total: 1,
      message: `Captions found (${captions.segments.length} lines, ${captions.lang})`
    });
    return captions;
  }

  throw new Error(
    "No captions available for this video. Speech-to-text fallback needs the audio stream, " +
      "which is not wired up yet. Try a video that has captions."
  );
}

async function translateTranscript(transcript: Transcript, opts: BuildDubOptions): Promise<Map<number, string>> {
  const { settings, onProgress, signal } = opts;
  const provider = getProvider(settings.translateProvider);
  const key = requireKey(settings, settings.translateProvider);
  const batches = chunk(transcript.segments, TRANSLATE_BATCH);
  const translated = new Map<number, string>();
  let done = 0;

  await mapLimit(batches, TRANSLATE_CONCURRENCY, async (batch) => {
    throwIfAborted(signal);
    const result = await provider.translate(
      {
        segments: batch.map((s) => ({ idx: s.idx, text: s.text })),
        sourceLang: transcript.lang,
        targetLang: settings.targetLang,
        model: settings.translateModel
      },
      key
    );
    for (const item of result) {
      if (typeof item.idx === "number" && typeof item.text === "string") {
        translated.set(item.idx, item.text);
      }
    }
    done += batch.length;
    onProgress({
      phase: "translating",
      current: done,
      total: transcript.segments.length,
      message: "Translating"
    });
  });

  return translated;
}

async function synthesize(
  segments: TranscriptSegment[],
  translations: Map<number, string>,
  opts: BuildDubOptions
): Promise<DubSegment[]> {
  const { settings, onProgress, signal } = opts;
  const provider = getProvider(settings.ttsProvider);
  const key = requireKey(settings, settings.ttsProvider);
  let done = 0;

  const dubSegments = await mapLimit(segments, TTS_CONCURRENCY, async (seg) => {
    throwIfAborted(signal);
    const text = (translations.get(seg.idx) ?? "").trim();
    const base: DubSegment = {
      idx: seg.idx,
      startMs: seg.startMs,
      endMs: seg.endMs,
      originalText: seg.text,
      text,
      audioMime: "audio/mpeg"
    };
    if (!text) {
      done++;
      return base;
    }
    const result = await provider.tts({ text, voice: settings.voice, model: settings.ttsModel }, key);
    done++;
    onProgress({ phase: "synthesizing", current: done, total: segments.length, message: "Generating speech" });
    return {
      ...base,
      audio: result.audio,
      audioMime: result.mime,
      audioUrl: URL.createObjectURL(new Blob([result.audio], { type: result.mime }))
    };
  });

  return dubSegments;
}

export async function buildDub(opts: BuildDubOptions): Promise<Dub> {
  const { context, settings } = opts;
  const transcript = await getTranscript(opts);
  const translations = await translateTranscript(transcript, opts);
  const segments = await synthesize(transcript.segments, translations, opts);

  opts.onProgress({ phase: "ready", current: 1, total: 1, message: "Dub ready" });

  return {
    platform: context.platform,
    videoId: context.videoId,
    sourceLang: transcript.lang,
    targetLang: settings.targetLang,
    voice: settings.voice,
    provider: settings.ttsProvider,
    title: context.title,
    durationMs: context.durationMs,
    visibility: settings.defaultVisibility,
    segments
  };
}
