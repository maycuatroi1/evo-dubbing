import type {
  Dub,
  DubSegment,
  ProgressHandler,
  Settings,
  TranscriptSegment,
  VideoContext
} from "../types";
import type { Platform } from "../platforms";
import { getProvider, type Provider } from "../providers";
import { mergeCues } from "./merge";
import { ttsCacheKey, getCachedAudio, putCachedAudio } from "./cache";
import { fetchArrayBuffer } from "../net";

const LOOKAHEAD_MS = 30000;
const BEHIND_MS = 2000;
const TTS_CONCURRENCY = 2;
const TRANSLATE_CHUNK = 10;

type CueStatus = "idle" | "pending" | "ready" | "empty" | "error";

interface CueState {
  status: CueStatus;
  translated: string | null;
  data: ArrayBuffer | null;
  mime: string;
  buffer: AudioBuffer | null;
  remoteUrl?: string;
}

export interface SessionOptions {
  video: HTMLVideoElement;
  context: VideoContext;
  settings: Settings;
  onProgress: ProgressHandler;
  onReady: () => void;
}

export class DubSession {
  private video: HTMLVideoElement;
  private context: VideoContext;
  private settings: Settings;
  private onProgress: ProgressHandler;
  private onReady: () => void;

  private cues: TranscriptSegment[] = [];
  private states: CueState[] = [];
  private sourceLang = "auto";
  private mode: "generate" | "remote" = "generate";

  private translateProvider!: Provider;
  private ttsProvider!: Provider;
  private translateKey = "";
  private ttsKey = "";
  private chunkPromises = new Map<number, Promise<void>>();

  private ctx: AudioContext;
  private gain: GainNode;
  private currentSource: AudioBufferSourceNode | null = null;
  private activePlaying = false;
  private lastIdx = -2;
  private startedForWindow = false;
  private originalVolume = 1;
  private ticker: number | null = null;

  private active = false;
  private destroyed = false;
  private activeGen = 0;
  private queue: number[] = [];
  private readyCount = 0;
  private boundReset = () => this.forceReevaluate();

  constructor(opts: SessionOptions) {
    this.video = opts.video;
    this.context = opts.context;
    this.settings = opts.settings;
    this.onProgress = opts.onProgress;
    this.onReady = opts.onReady;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  private requireKey(provider: "openai" | "gemini"): string {
    const key = this.settings.keys[provider];
    if (!key) throw new Error(`Missing ${provider} API key. Add it in the extension options.`);
    return key;
  }

  async startGenerated(platform: Platform): Promise<void> {
    this.mode = "generate";
    this.translateProvider = getProvider(this.settings.translateProvider);
    this.ttsProvider = getProvider(this.settings.ttsProvider);
    this.translateKey = this.requireKey(this.settings.translateProvider);
    this.ttsKey = this.requireKey(this.settings.ttsProvider);

    this.onProgress({ phase: "transcript", current: 0, total: 1, message: "Reading captions" });
    const transcript = await platform.getCaptionTranscript(this.settings.targetLang);
    if (!transcript || transcript.segments.length === 0) {
      throw new Error(
        "Could not load captions for this video. If it has a CC button, turn captions on once and try again. " +
          "Videos with no captions at all are not supported yet."
      );
    }
    this.sourceLang = transcript.lang;
    this.cues = mergeCues(transcript.segments);
    this.states = this.cues.map(() => ({ status: "idle", translated: null, data: null, mime: "audio/mpeg", buffer: null }));

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
    this.lastIdx = -2;
    this.ticker = window.setInterval(() => this.tick(), 60);
    this.pump();
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
    this.lastIdx = -2;
    this.startedForWindow = false;
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
    if (this.video.paused) {
      if (this.activePlaying) this.stopSource();
      this.applyDuck();
      return;
    }

    const ms = this.video.currentTime * 1000;
    const idx = this.findWindow(ms);

    if (idx !== this.lastIdx) {
      this.stopSource();
      this.lastIdx = idx;
      this.startedForWindow = false;
    }

    if (idx >= 0 && !this.startedForWindow) {
      const buffer = this.states[idx]?.buffer;
      if (buffer) {
        const offset = (ms - this.cues[idx].startMs) / 1000;
        if (offset < buffer.duration - 0.04) this.startSource(buffer, Math.max(0, offset));
        this.startedForWindow = true;
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
    if (!this.active || this.destroyed) return;
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
    while (this.activeGen < TTS_CONCURRENCY && this.queue.length > 0) {
      const idx = this.queue.shift()!;
      this.activeGen++;
      this.generateCue(idx).finally(() => {
        this.activeGen--;
        if (!this.destroyed) this.fillSlots();
      });
    }
  }

  private async ensureTranslatedChunk(chunkIdx: number): Promise<void> {
    const existing = this.chunkPromises.get(chunkIdx);
    if (existing) return existing;
    const promise = (async () => {
      const start = chunkIdx * TRANSLATE_CHUNK;
      const batch = this.cues.slice(start, start + TRANSLATE_CHUNK);
      const result = await this.translateProvider.translate(
        {
          segments: batch.map((c) => ({ idx: c.idx, text: c.text })),
          sourceLang: this.sourceLang,
          targetLang: this.settings.targetLang,
          model: this.settings.translateModel
        },
        this.translateKey
      );
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
        return;
      }

      const key = ttsCacheKey(this.settings.ttsProvider, this.settings.ttsModel, this.settings.voice, text);
      const cached = await getCachedAudio(key);
      if (cached) {
        st.data = cached.data;
        st.mime = cached.mime;
      } else {
        const result = await this.ttsProvider.tts(
          { text, voice: this.settings.voice, model: this.settings.ttsModel },
          this.ttsKey
        );
        st.data = result.audio;
        st.mime = result.mime;
        await putCachedAudio(key, result.audio, result.mime);
      }

      st.buffer = await this.ctx.decodeAudioData(st.data.slice(0));
      st.status = "ready";
      this.reportReady();
    } catch {
      st.status = "error";
    }
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
      this.translateProvider = this.translateProvider ?? getProvider(this.settings.translateProvider);
      this.ttsProvider = this.ttsProvider ?? getProvider(this.settings.ttsProvider);
      this.translateKey = this.translateKey || this.requireKey(this.settings.translateProvider);
      this.ttsKey = this.ttsKey || this.requireKey(this.settings.ttsProvider);
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
    const key = ttsCacheKey(this.settings.ttsProvider, this.settings.ttsModel, this.settings.voice, text);
    const cached = await getCachedAudio(key);
    if (cached) {
      st.data = cached.data;
      st.mime = cached.mime;
    } else {
      const result = await this.ttsProvider.tts(
        { text, voice: this.settings.voice, model: this.settings.ttsModel },
        this.ttsKey
      );
      st.data = result.audio;
      st.mime = result.mime;
      await putCachedAudio(key, result.audio, result.mime);
    }
    st.status = "ready";
  }
}
