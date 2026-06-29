import type { DubbingProgress, VideoContext } from "../lib/types";

export interface OverlayHandlers {
  onDub: (targetLang: string) => void;
  onTogglePlay: () => void;
  onRedub: () => void;
  onShare: (visibility: "public" | "private") => void;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) el.className = className;
  Object.assign(el, rest);
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export class EvoOverlay {
  private handlers: OverlayHandlers;
  private fab!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private metaEl!: HTMLDivElement;
  private langInput!: HTMLInputElement;
  private dubBtn!: HTMLButtonElement;
  private progressBar!: HTMLSpanElement;
  private statusEl!: HTMLDivElement;
  private readyControls!: HTMLDivElement;
  private playBtn!: HTMLButtonElement;
  private shareSection!: HTMLDivElement;
  private visibilitySelect!: HTMLSelectElement;
  private shareBtn!: HTMLButtonElement;
  private mounted = false;
  private playing = false;

  constructor(handlers: OverlayHandlers) {
    this.handlers = handlers;
  }

  mount(defaultLang: string): void {
    if (this.mounted) return;
    this.mounted = true;

    this.fab = h("button", { id: "evo-dub-fab", title: "evo-dubbing", textContent: "E" });
    this.fab.addEventListener("click", () => this.togglePanel(true));

    this.metaEl = h("div", { class: "evo-meta" });
    this.langInput = h("input", { class: "evo-input", value: defaultLang, placeholder: "vi" });
    this.dubBtn = h("button", { class: "evo-btn", textContent: "Dub this video" });
    this.dubBtn.addEventListener("click", () => this.handlers.onDub(this.langInput.value.trim() || "vi"));

    this.progressBar = h("span");
    const progressWrap = h("div", { class: "evo-progress evo-hidden" }, [this.progressBar]);
    this.statusEl = h("div", { class: "evo-status" });

    this.playBtn = h("button", { class: "evo-btn", textContent: "Pause dub" });
    this.playBtn.addEventListener("click", () => this.handlers.onTogglePlay());
    const redubBtn = h("button", { class: "evo-btn secondary", textContent: "Re-dub" });
    redubBtn.addEventListener("click", () => this.handlers.onRedub());
    this.readyControls = h("div", { class: "evo-row evo-hidden" }, [this.playBtn, redubBtn]);

    this.visibilitySelect = h("select", { class: "evo-select" }, [
      h("option", { value: "public", textContent: "Public" }),
      h("option", { value: "private", textContent: "Private" })
    ]);
    this.shareBtn = h("button", { class: "evo-btn secondary", textContent: "Share this dub" });
    this.shareBtn.addEventListener("click", () =>
      this.handlers.onShare(this.visibilitySelect.value as "public" | "private")
    );
    this.shareSection = h("div", { class: "evo-share evo-hidden" }, [
      h("div", { class: "evo-row" }, [h("label", { textContent: "Visibility" }), this.visibilitySelect]),
      this.shareBtn
    ]);

    const collapseBtn = h("button", { class: "evo-icon-btn", textContent: "-", title: "Collapse" });
    collapseBtn.addEventListener("click", () => this.togglePanel(false));

    const head = h("div", { class: "evo-head" }, [
      h("div", { class: "evo-logo", textContent: "E" }),
      h("div", { class: "evo-title", textContent: "evo-dubbing" }),
      collapseBtn
    ]);

    const body = h("div", { class: "evo-body" }, [
      this.metaEl,
      h("div", { class: "evo-row" }, [h("label", { textContent: "To" }), this.langInput]),
      this.dubBtn,
      progressWrap,
      this.statusEl,
      this.readyControls,
      this.shareSection
    ]);

    this.panel = h("div", { id: "evo-dub-panel", class: "evo-hidden" }, [head, body]);

    document.body.append(this.fab, this.panel);
  }

  private togglePanel(open: boolean): void {
    this.panel.classList.toggle("evo-hidden", !open);
    this.fab.classList.toggle("evo-hidden", open);
  }

  setVideoContext(ctx: VideoContext | null): void {
    this.metaEl.textContent = ctx ? ctx.title : "No video detected on this page.";
    this.dubBtn.disabled = !ctx;
  }

  setProgress(progress: DubbingProgress): void {
    const wrap = this.progressBar.parentElement as HTMLElement;
    const busy = progress.phase !== "idle" && progress.phase !== "ready" && progress.phase !== "error";
    wrap.classList.toggle("evo-hidden", !busy);
    this.dubBtn.disabled = busy;
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    this.progressBar.style.width = `${pct}%`;
    this.statusEl.classList.remove("error");
    this.statusEl.textContent = progress.total > 1 ? `${progress.message} (${progress.current}/${progress.total})` : progress.message;
  }

  setReady(): void {
    this.playing = true;
    this.dubBtn.classList.add("evo-hidden");
    this.readyControls.classList.remove("evo-hidden");
    this.shareSection.classList.remove("evo-hidden");
    this.updatePlayLabel();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.updatePlayLabel();
  }

  private updatePlayLabel(): void {
    this.playBtn.textContent = this.playing ? "Pause dub" : "Resume dub";
  }

  setError(message: string): void {
    const wrap = this.progressBar.parentElement as HTMLElement;
    wrap.classList.add("evo-hidden");
    this.dubBtn.disabled = false;
    this.statusEl.classList.add("error");
    this.statusEl.textContent = message;
  }

  setShareStatus(message: string): void {
    this.statusEl.classList.remove("error");
    this.statusEl.textContent = message;
  }

  setVisibility(visibility: "public" | "private"): void {
    this.visibilitySelect.value = visibility;
  }

  reset(defaultLang: string): void {
    this.playing = false;
    this.langInput.value = defaultLang;
    this.dubBtn.classList.remove("evo-hidden");
    this.dubBtn.disabled = false;
    this.readyControls.classList.add("evo-hidden");
    this.shareSection.classList.add("evo-hidden");
    (this.progressBar.parentElement as HTMLElement).classList.add("evo-hidden");
    this.progressBar.style.width = "0%";
    this.statusEl.classList.remove("error");
    this.statusEl.textContent = "";
  }
}
