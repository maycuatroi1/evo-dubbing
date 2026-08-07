import type {
  Dub,
  DubSegment,
  ProgressHandler,
  Settings,
  TranscriptInfo,
  TranscriptSegment,
  VideoContext
} from "../types.ts";
import type { Platform } from "../platforms/index.ts";
import { createInferenceBackend, type InferenceBackend } from "../backend/index.ts";
import { mergeCues } from "./merge.ts";
import {
  ttsCacheKey,
  getCachedAudio,
  putCachedAudio,
  translationCacheKey,
  getCachedTranslation,
  putCachedTranslation
} from "./cache.ts";
import { timeCompress } from "./stretch.ts";
import { fetchArrayBuffer } from "../net.ts";
import { isQuotaInsufficient, quotaBlockMessage } from "../managed/onboarding.ts";

const LOOKAHEAD_MS = 30000;
const BEHIND_MS = 2000;
const TTS_CONCURRENCY = 2;
const TRANSLATE_CHUNK = 10;
const MAX_PLAYBACK_RATE = 2;

type CueStatus = "idle" | "pending" | "ready" | "empty" | "error";

interface CueState {
  status: CueStatus;
  translated: string | null;
  data: ArrayBuffer | null;
  mime: string;
  buffer: AudioBuffer | null;
  playBuffer: AudioBuffer | null;
  remoteUrl?: string;
}

export interface SessionOptions {
  video: HTMLVideoElement;
  context: VideoContext;
  settings: Settings;
  onProgress: ProgressHandler;
  onReady: () => void;
  getRemainingSourceMs?: () => Promise<number | null>;
  onTranscript?: (info: TranscriptInfo) => void;
}

export class DubSession {
  private video: HTMLVideoElement;
  private context: VideoContext;
  private settings: Settings;
  private onProgress: ProgressHandler;
  private onReady: () => void;
  private getRemainingSourceMs?: () => Promise<number | null>;
  private onTranscript?: (info: TranscriptInfo) => void;

  private cues: TranscriptSegment[] = [];
  private states: CueState[] = [];
  private sourceLang = "auto";
  private mode: "generate" | "remote" = "generate";

  private backend!: InferenceBackend;
  private chunkPromises = new Map<number, Promise<void>>();

  private ctx: AudioContext;
  private gain: GainNode;
  private currentSource: AudioBufferSourceNode | null = null;
  private activePlaying = false;
  private playingIdx = -2;
  private originalVolume = 1;
  private ticker: number | null = null;

  private active = false;
  private destroyed = false;
  private fatalBlocked = false;
  private activeGen = 0;
  private queue: number[] = [];
  private readyCount = 0;
  private firstError: string | null = null;
  private subtitleEl: HTMLDivElement | null = null;
  private lastSubText = "";
  private boundReset = () => this.forceReevaluate();

  constructor(opts: SessionOptions) {
    this.video = opts.video;
    this.context = opts.context;
    this.settings = opts.settings;
    this.onProgress = opts.onProgress;
    this.onReady = opts.onReady;
    this.getRemainingSourceMs = opts.getRemainingSourceMs;
    this.onTranscript = opts.onTranscript;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  private requireKey(provider: "openai" | "gemini"): string {
    const key = this.settings.keys[provider];
    if (!key) throw new Error(`Missing ${provider} API key. Add it in the extension options.`);
    return key;
  }

  async startGenerated(platform: Platform, trackId?: string): Promise<void> {
    this.mode = "generate";
    this.backend = createInferenceBackend(this.settings);
    if (this.settings.billingMode !== "managed") {
      this.requireKey(this.settings.translateProvider);
      this.requireKey(this.settings.ttsProvider);
    }

    this.onProgress({ phase: "transcript", current: 0, total: 1, message: "Reading captions" });
    const transcript = await platform.getCaptionTranscript({
      avoidLang: this.settings.targetLang,
      trackId
    });
    if (!transcript || transcript.segments.length === 0) {
      throw new Error(
        "Could not load captions for this video. If it has a CC button, turn captions on once and try again. " +
          "Videos with no captions at all are not supported yet."
      );
    }
    this.onTranscript?.({
      lang: transcript.lang,
      trackId: transcript.trackId ?? "",
      coverage: transcript.coverage ?? 1
    });
    this.sourceLang = transcript.lang;
    this.cues = mergeCues(transcript.segments);
    this.states = this.cues.map(() => ({
      status: "idle",
      translated: null,
      data: null,
      mime: "audio/mpeg",
      buffer: null,
      playBuffer: null
    }));

    this.onProgress({ phase: "ready", current: 0, total: this.cues.length, message: "Dubbing live as you watch" });
    this.attach();
    this.onReady();
  }

  async startRemote(dub: Dub): Promise<void> {
    this.mode = "remote";
    this.sourceLang = dub.sourceLang;
    this.cues = dub.segments.map((s) => ({ idx: s.idx, startMs: s.startMs, endMs: s.endMs, text: s.originalText }));
    this.states = dub.segments.map((s) => ({
      status: "idle",
      translated: s.text,
      data: null,
      mime: s.audioMime,
      buffer: null,
      playBuffer: null,
      remoteUrl: s.audioUrl
    }));
    this.onProgress({ phase: "ready", current: 0, total: this.cues.length, message: "Playing shared dub" });
    this.attach();
    this.onReady();
  }

  private attach(): void {
    if (this.active) return;
    this.active = true;
    this.originalVolume = this.video.volume;
    this.ctx.resume().catch(() => undefined);
    this.video.addEventListener("seeking", this.boundReset);
    this.video.addEventListener("seeked", this.boundReset);
    this.video.addEventListener("play", this.boundReset);
    this.video.addEventListener("pause", this.boundReset);
    this.playingIdx = -2;
    this.mountSubtitle();
    this.ticker = window.setInterval(() => this.tick(), 60);
    this.pump();
  }

  private mountSubtitle(): void {
    if (!this.settings.showSubtitles || this.subtitleEl) return;
    const host = (this.video.closest(".html5-video-player") as HTMLElement | null) ?? this.video.parentElement;
    if (!host) return;
    const el = document.createElement("div");
    el.className = "evo-subtitle";
    host.appendChild(el);
    this.subtitleEl = el;
    this.lastSubText = "";
  }

  private removeSubtitle(): void {
    if (this.subtitleEl) {
      this.subtitleEl.remove();
      this.subtitleEl = null;
    }
    this.lastSubText = "";
  }

  private updateSubtitle(idx: number): void {
    if (!this.subtitleEl) return;
    const text = idx >= 0 ? this.states[idx]?.translated ?? "" : "";
    if (text !== this.lastSubText) {
      this.subtitleEl.textContent = text;
      this.lastSubText = text;
    }
  }

  pause(): void {
    if (!this.active) return;
    this.active = false;
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
    this.video.removeEventListener("seeking", this.boundReset);
    this.video.removeEventListener("seeked", this.boundReset);
    this.video.removeEventListener("play", this.boundReset);
    this.video.removeEventListener("pause", this.boundReset);
    this.stopSource();
    this.removeSubtitle();
    this.video.volume = this.originalVolume;
  }

  resume(): void {
    if (this.active || this.destroyed) return;
    this.attach();
  }

  isActive(): boolean {
    return this.active;
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
    for (const st of this.states) {
      if (st.remoteUrl && st.remoteUrl.startsWith("blob:")) URL.revokeObjectURL(st.remoteUrl);
    }
    this.ctx.close().catch(() => undefined);
  }

  private forceReevaluate(): void {
    this.stopSource();
    this.playingIdx = -2;
  }

  private spanSeconds(i: number): number {
    const start = this.cues[i].startMs;
    const nextStart = i + 1 < this.cues.length ? this.cues[i + 1].startMs : this.cues[i].endMs;
    return Math.max(0.001, (nextStart - start) / 1000);
  }

  private preparePlayback(idx: number): void {
    const st = this.states[idx];
    if (!st.buffer) return;
    const rate = st.buffer.duration / this.spanSeconds(idx);
    st.playBuffer = rate > 1.03 ? timeCompress(this.ctx, st.buffer, Math.min(MAX_PLAYBACK_RATE, rate)) : st.buffer;
  }

  private findWindow(ms: number): number {
    let lo = 0;
    let hi = this.cues.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid].startMs <= ms) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (result === -1) return -1;
    return ms < this.cues[result].endMs ? result : -1;
  }

  private tick(): void {
    if (!this.active) return;

    const ms = this.video.currentTime * 1000;
    const idx = this.findWindow(ms);
    const subIdx = idx >= 0 ? idx : this.activePlaying ? this.playingIdx : -1;
    this.updateSubtitle(subIdx);

    if (this.video.paused) {
      if (this.activePlaying) this.stopSource();
      this.playingIdx = -2;
      this.applyDuck();
      return;
    }

    if (idx >= 0 && idx !== this.playingIdx) {
      const buffer = this.states[idx]?.playBuffer ?? this.states[idx]?.buffer;
      if (buffer) {
        this.stopSource();
        const audioPos = (ms - this.cues[idx].startMs) / 1000;
        if (audioPos < buffer.duration - 0.04) this.startSource(buffer, Math.max(0, audioPos));
        this.playingIdx = idx;
      }
    }

    this.applyDuck();
    this.pump();
  }

  private startSource(buffer: AudioBuffer, offset: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
        this.activePlaying = false;
        this.applyDuck();
      }
    };
    this.currentSource = source;
    this.activePlaying = true;
    source.start(0, offset);
    this.applyDuck();
  }

  private stopSource(): void {
    if (this.currentSource) {
      this.currentSource.onended = null;
      try {
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this.activePlaying = false;
  }

  private applyDuck(): void {
    this.video.volume = this.activePlaying ? this.settings.duckVolume : this.originalVolume;
  }

  private pump(): void {
    if (!this.active || this.destroyed || this.fatalBlocked) return;
    const ms = this.video.currentTime * 1000;
    for (let i = 0; i < this.cues.length; i++) {
      const cue = this.cues[i];
      if (cue.endMs < ms - BEHIND_MS) continue;
      if (cue.startMs > ms + LOOKAHEAD_MS) break;
      const st = this.states[i];
      if (st.status === "idle") {
        st.status = "pending";
        this.queue.push(i);
      }
    }
    this.fillSlots();
  }

  private fillSlots(): void {
    if (!this.active || this.destroyed || this.fatalBlocked) return;
    while (this.activeGen < TTS_CONCURRENCY && this.queue.length > 0) {
      const idx = this.queue.shift()!;
      this.activeGen++;
      this.generateCue(idx).finally(() => {
        this.activeGen--;
        if (!this.destroyed && this.active && !this.fatalBlocked) this.fillSlots();
      });
    }
  }

  private async ensureTranslatedChunk(chunkIdx: number): Promise<void> {
    const existing = this.chunkPromises.get(chunkIdx);
    if (existing) return existing;
    const promise = (async () => {
      const start = chunkIdx * TRANSLATE_CHUNK;
      const batch = this.cues.slice(start, start + TRANSLATE_CHUNK);
      const segments = batch.map((c) => ({ idx: c.idx, text: c.text }));
      const key = translationCacheKey(
        this.backend.namespace().translate,
        this.settings.translateModel,
        this.sourceLang,
        this.settings.targetLang,
        segments
      );
      let result = await getCachedTranslation(key);
      if (!result) {
        result = await this.backend.translate(
          {
            segments,
            sourceLang: this.sourceLang,
            targetLang: this.settings.targetLang,
            model: this.settings.translateModel
          },
          batch.map((c) => ({ idx: c.idx, startMs: c.startMs, endMs: c.endMs }))
        );
        await putCachedTranslation(key, result);
      }
      const map = new Map(result.map((r) => [r.idx, r.text]));
      for (const cue of batch) {
        this.states[cue.idx].translated = (map.get(cue.idx) ?? "").trim();
      }
    })();
    this.chunkPromises.set(chunkIdx, promise);
    return promise;
  }

  private async generateCue(idx: number): Promise<void> {
    const st = this.states[idx];
    try {
      if (this.mode === "remote") {
        if (!st.remoteUrl) {
          st.status = "empty";
          return;
        }
        const data = st.remoteUrl.startsWith("blob:")
          ? await (await fetch(st.remoteUrl)).arrayBuffer()
          : await fetchArrayBuffer(st.remoteUrl);
        st.buffer = await this.ctx.decodeAudioData(data.slice(0));
        this.preparePlayback(idx);
        st.status = "ready";
        this.reportReady();
        return;
      }

      if (st.translated === null) {
        await this.ensureTranslatedChunk(Math.floor(idx / TRANSLATE_CHUNK));
      }
      const text = (st.translated ?? "").trim();
      if (!text) {
        st.status = "empty";
        if (this.cues[idx].text.trim()) {
          console.warn(`[evo-dubbing] cue ${idx} translated to empty text (original: "${this.cues[idx].text.slice(0, 40)}")`);
        }
        return;
      }

      const key = ttsCacheKey(this.backend.namespace().tts, this.settings.ttsModel, this.settings.voice, text);
      const cached = await getCachedAudio(key);
      if (cached) {
        st.data = cached.data;
        st.mime = cached.mime;
      } else {
        const result = await this.backend.tts(
          { text, voice: this.settings.voice, model: this.settings.ttsModel },
          {
            cue: { startMs: this.cues[idx].startMs, endMs: this.cues[idx].endMs },
            idempotencyKey: key
          }
        );
        st.data = result.audio;
        st.mime = result.mime;
        await putCachedAudio(key, result.audio, result.mime);
      }

      st.buffer = await this.ctx.decodeAudioData(st.data.slice(0));
      this.preparePlayback(idx);
      st.status = "ready";
      this.reportReady();
    } catch (err) {
      st.status = "error";
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[evo-dubbing] cue ${idx} generation failed:`, msg);
      const status = (err as { status?: unknown }).status;
      if (status === 401 || status === 402) {
        this.fatalBlocked = true;
        this.queue.length = 0;
        for (const other of this.states) {
          if (other.status === "pending") other.status = "idle";
        }
      }
      this.reportError(msg, typeof status === "number" ? status : undefined);
    }
  }

  private reportError(message: string, status?: number): void {
    if (this.firstError) return;
    this.firstError = message;
    this.onProgress({
      phase: "error",
      current: this.readyCount,
      total: this.cues.length,
      message: `Dubbing failed: ${message}`,
      status
    });
  }

  private reportReady(): void {
    this.readyCount++;
    this.onProgress({
      phase: "ready",
      current: this.readyCount,
      total: this.cues.length,
      message: "Dubbing live"
    });
  }

  async completeAll(onProgress: ProgressHandler): Promise<Dub> {
    if (this.mode === "generate") {
      this.backend = this.backend ?? createInferenceBackend(this.settings);
      if (this.settings.billingMode !== "managed") {
        this.requireKey(this.settings.translateProvider);
        this.requireKey(this.settings.ttsProvider);
      } else {
        await this.assertQuotaForExport();
      }
    }

    let done = 0;
    for (let i = 0; i < this.cues.length; i++) {
      const st = this.states[i];
      if (st.status === "idle" || st.status === "pending") {
        await this.generateCueForExport(i);
      }
      done++;
      onProgress({ phase: "synthesizing", current: done, total: this.cues.length, message: "Finalizing full dub" });
    }

    const segments: DubSegment[] = this.cues.map((cue, i) => {
      const st = this.states[i];
      return {
        idx: cue.idx,
        startMs: cue.startMs,
        endMs: cue.endMs,
        originalText: cue.text,
        text: st.translated ?? "",
        audio: st.data ?? undefined,
        audioMime: st.mime
      };
    });

    return {
      platform: this.context.platform,
      videoId: this.context.videoId,
      sourceLang: this.sourceLang,
      targetLang: this.settings.targetLang,
      voice: this.settings.voice,
      provider: this.settings.ttsProvider,
      title: this.context.title,
      durationMs: this.context.durationMs,
      visibility: this.settings.defaultVisibility,
      segments
    };
  }

  estimateExportSourceMs(): number {
    let total = 0;
    for (let i = 0; i < this.cues.length; i++) {
      const st = this.states[i];
      if (st.data || st.status === "empty" || !this.cues[i].text.trim()) continue;
      total += Math.max(0, this.cues[i].endMs - this.cues[i].startMs);
    }
    return total;
  }

  private async assertQuotaForExport(): Promise<void> {
    if (!this.getRemainingSourceMs) return;
    const neededMs = this.estimateExportSourceMs();
    if (neededMs <= 0) return;
    const remainingMs = await this.getRemainingSourceMs();
    if (isQuotaInsufficient(neededMs, remainingMs)) {
      const err = new Error(quotaBlockMessage(neededMs, remainingMs as number)) as Error & { code: string };
      err.code = "insufficient_quota";
      throw err;
    }
  }

  private async generateCueForExport(idx: number): Promise<void> {
    const st = this.states[idx];
    if (st.translated === null) {
      await this.ensureTranslatedChunk(Math.floor(idx / TRANSLATE_CHUNK));
    }
    const text = (st.translated ?? "").trim();
    if (!text) {
      st.status = "empty";
      return;
    }
    if (st.data) return;
    const key = ttsCacheKey(this.backend.namespace().tts, this.settings.ttsModel, this.settings.voice, text);
    const cached = await getCachedAudio(key);
    if (cached) {
      st.data = cached.data;
      st.mime = cached.mime;
    } else {
      const result = await this.backend.tts(
        { text, voice: this.settings.voice, model: this.settings.ttsModel },
        {
          cue: { startMs: this.cues[idx].startMs, endMs: this.cues[idx].endMs },
          idempotencyKey: key
        }
      );
      st.data = result.audio;
      st.mime = result.mime;
      await putCachedAudio(key, result.audio, result.mime);
    }
    st.status = "ready";
  }
}
