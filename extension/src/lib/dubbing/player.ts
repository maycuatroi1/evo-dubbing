import type { Dub, DubSegment } from "../types";
import { fetchArrayBuffer } from "../net";

interface PlayerOptions {
  video: HTMLVideoElement;
  dub: Dub;
  duckVolume: number;
}

export class DubPlayer {
  private video: HTMLVideoElement;
  private dub: Dub;
  private duckVolume: number;
  private ctx: AudioContext;
  private gain: GainNode;
  private buffers: (AudioBuffer | null)[] = [];
  private starts: number[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private activePlaying = false;
  private lastIdx = -2;
  private startedForWindow = false;
  private originalVolume = 1;
  private ticker: number | null = null;
  private enabled = false;
  private boundTick = () => this.tick();
  private boundReset = () => this.forceReevaluate();

  constructor(opts: PlayerOptions) {
    this.video = opts.video;
    this.dub = opts.dub;
    this.duckVolume = opts.duckVolume;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.starts = this.dub.segments.map((s) => s.startMs);
  }

  async prepare(onProgress?: (done: number, total: number) => void): Promise<void> {
    const total = this.dub.segments.length;
    let done = 0;
    this.buffers = await Promise.all(
      this.dub.segments.map(async (seg) => {
        const buf = await this.decodeSegment(seg).catch(() => null);
        done++;
        onProgress?.(done, total);
        return buf;
      })
    );
  }

  private async decodeSegment(seg: DubSegment): Promise<AudioBuffer | null> {
    let data: ArrayBuffer | null = null;
    if (seg.audio) {
      data = seg.audio.slice(0);
    } else if (seg.audioUrl) {
      data = seg.audioUrl.startsWith("blob:")
        ? await (await fetch(seg.audioUrl)).arrayBuffer()
        : await fetchArrayBuffer(seg.audioUrl);
    }
    if (!data) return null;
    return this.ctx.decodeAudioData(data);
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;
    this.originalVolume = this.video.volume;
    await this.ctx.resume();
    this.video.addEventListener("seeking", this.boundReset);
    this.video.addEventListener("seeked", this.boundReset);
    this.video.addEventListener("play", this.boundReset);
    this.video.addEventListener("pause", this.boundReset);
    this.lastIdx = -2;
    this.ticker = window.setInterval(this.boundTick, 60);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
    this.video.removeEventListener("seeking", this.boundReset);
    this.video.removeEventListener("seeked", this.boundReset);
    this.video.removeEventListener("play", this.boundReset);
    this.video.removeEventListener("pause", this.boundReset);
    this.stopSource();
    this.video.volume = this.originalVolume;
  }

  destroy(): void {
    this.disable();
    for (const seg of this.dub.segments) {
      if (seg.audioUrl) URL.revokeObjectURL(seg.audioUrl);
    }
    this.ctx.close().catch(() => undefined);
  }

  private forceReevaluate(): void {
    this.stopSource();
    this.lastIdx = -2;
    this.startedForWindow = false;
  }

  private findWindow(ms: number): number {
    const segments = this.dub.segments;
    let lo = 0;
    let hi = segments.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= ms) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (result === -1) return -1;
    const seg = segments[result];
    return ms < seg.endMs ? result : -1;
  }

  private tick(): void {
    if (!this.enabled) return;
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
      const buf = this.buffers[idx];
      const seg = this.dub.segments[idx];
      if (buf) {
        const offset = (ms - seg.startMs) / 1000;
        if (offset < buf.duration - 0.04) {
          this.startSource(buf, Math.max(0, offset));
        }
      }
      this.startedForWindow = true;
    }

    this.applyDuck();
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
    this.video.volume = this.activePlaying ? this.duckVolume : this.originalVolume;
  }
}
