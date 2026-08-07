import type { DubCoverage } from "../lib/types.ts";
import type { Platform } from "../lib/platforms/index.ts";

/** A range narrower than this is still worth a visible tick on a two-hour video. */
const MIN_RANGE_PERCENT = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Two things drawn on the player itself rather than in the panel: a lane under the scrubber
 * showing how far the dub is prepared, and a notice explaining a held video.
 *
 * Both are measured against the player box instead of being appended inside YouTube's own
 * progress DOM. YouTube's internal positioning is not ours to depend on, and on chaptered
 * videos the bar is split into per-chapter lists that no longer map to the whole duration.
 */
export class DubTimeline {
  private platform: Platform;
  private lane: HTMLDivElement | null = null;
  private notice: HTMLDivElement | null = null;
  private noticeText: HTMLSpanElement | null = null;
  private player: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private coverage: DubCoverage | null = null;
  private enabled: boolean;

  constructor(platform: Platform, enabled = true) {
    this.platform = platform;
    this.enabled = enabled;
  }

  setCoverage(coverage: DubCoverage): void {
    if (!this.enabled) return;
    this.coverage = coverage;
    this.render();
  }

  showNotice(message: string): void {
    const player = this.mountPlayer() ? this.player : null;
    if (!player) return;
    if (!this.notice || !this.noticeText) {
      const text = document.createElement("span");
      const notice = document.createElement("div");
      notice.className = "evo-dub-notice";
      notice.setAttribute("aria-hidden", "true");
      const spinner = document.createElement("span");
      spinner.className = "evo-i evo-i-spinner evo-i--sm";
      notice.append(spinner, text);
      player.append(notice);
      this.notice = notice;
      this.noticeText = text;
    }
    this.noticeText.textContent = message;
    this.notice.classList.remove("evo-hidden");
  }

  hideNotice(): void {
    this.notice?.classList.add("evo-hidden");
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.lane?.remove();
    this.notice?.remove();
    this.lane = null;
    this.notice = null;
    this.noticeText = null;
    this.player = null;
    this.bar = null;
    this.coverage = null;
  }

  /** Resolve the player root, remounting after a YouTube SPA navigation replaced it. */
  private mountPlayer(): boolean {
    if (this.player?.isConnected) return true;
    const player = this.platform.getPlayerRoot();
    if (!player) return false;
    this.observer?.disconnect();
    this.observer = null;
    this.lane?.remove();
    this.lane = null;
    this.notice?.remove();
    this.notice = null;
    this.noticeText = null;
    this.bar = null;
    this.player = player;
    return true;
  }

  private mountLane(): boolean {
    const player = this.mountPlayer() ? this.player : null;
    if (!player) return false;
    if (this.lane?.isConnected && this.bar?.isConnected) return true;
    const bar = this.platform.getProgressBar();
    if (!bar) return false;
    this.bar = bar;
    if (!this.lane) {
      const lane = document.createElement("div");
      lane.className = "evo-dub-lane";
      lane.setAttribute("aria-hidden", "true");
      player.append(lane);
      this.lane = lane;
    }
    this.observer?.disconnect();
    if (typeof ResizeObserver === "function") {
      // The bar grows from 3px to 5px on hover and moves in fullscreen or theater mode; both
      // show up here as a resize.
      this.observer = new ResizeObserver(() => this.position());
      this.observer.observe(player);
      this.observer.observe(bar);
    }
    return true;
  }

  private position(): void {
    if (!this.lane || !this.player || !this.bar) return;
    const playerRect = this.player.getBoundingClientRect();
    const barRect = this.bar.getBoundingClientRect();
    if (barRect.width < 8 || playerRect.width < 8) {
      this.lane.classList.add("evo-hidden");
      return;
    }
    this.lane.classList.remove("evo-hidden");
    this.lane.style.left = `${Math.round(barRect.left - playerRect.left)}px`;
    this.lane.style.width = `${Math.round(barRect.width)}px`;
    this.lane.style.top = `${Math.round(barRect.bottom - playerRect.top) + 2}px`;
  }

  private render(): void {
    if (!this.mountLane() || !this.lane) return;
    const coverage = this.coverage;
    if (!coverage || coverage.durationMs <= 0) {
      this.lane.replaceChildren();
      this.lane.classList.add("evo-hidden");
      return;
    }
    const duration = coverage.durationMs;
    const spans = coverage.ranges.map((range) => {
      const span = document.createElement("span");
      span.className = "evo-dub-lane-range";
      const left = clamp((range.startMs / duration) * 100, 0, 100);
      const width = clamp(((range.endMs - range.startMs) / duration) * 100, MIN_RANGE_PERCENT, 100 - left);
      span.style.left = `${left.toFixed(3)}%`;
      span.style.width = `${width.toFixed(3)}%`;
      return span;
    });
    this.lane.replaceChildren(...spans);
    this.position();
  }
}
