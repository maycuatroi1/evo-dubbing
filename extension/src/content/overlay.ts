import type { CaptionTrackOption, DubbingProgress, TranscriptInfo, VideoContext } from "../lib/types.ts";
import { AI_VOICE_DISCLOSURE } from "../lib/managed/onboarding.ts";
import { t } from "../lib/i18n/index.ts";
import { targetLanguageOptions } from "../lib/i18n/languages.ts";
import {
  renderShareConfirmation,
  type ShareConfirmationHandlers,
  type ShareConfirmationView
} from "../lib/managed/share.ts";

export interface OverlayHandlers {
  onDub: (targetLang: string, trackId: string) => void;
  onTrackChange: (trackId: string) => void;
  onTogglePlay: () => void;
  onRedub: () => void;
  onShare: (visibility: "public" | "private") => void;
  onOpenSettings: () => void;
}

const LOW_COVERAGE = 0.5;

export interface OverlayAction {
  label: string;
  onClick: () => void;
}

type StatusTone = "idle" | "busy" | "info" | "error";

const PLATFORM_LABELS: Record<string, string> = { youtube: "YouTube" };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; attrs?: Record<string, string> } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, attrs, ...rest } = props;
  if (className) el.className = className;
  Object.assign(el, rest);
  for (const [name, value] of Object.entries(attrs ?? {})) el.setAttribute(name, value);
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

function icon(name: string, size?: "sm" | "lg"): HTMLSpanElement {
  const modifier = size ? ` evo-i--${size}` : "";
  return h("span", { class: `evo-i evo-i-${name}${modifier}`, attrs: { "aria-hidden": "true" } });
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export class EvoOverlay {
  private handlers: OverlayHandlers;
  private fab!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private sourceEl!: HTMLDivElement;
  private sourceTitle!: HTMLDivElement;
  private sourceMeta!: HTMLDivElement;
  private langSelect!: HTMLSelectElement;
  private trackSelect!: HTMLSelectElement;
  private trackField!: HTMLDivElement;
  private trackNote!: HTMLParagraphElement;
  private dubBtn!: HTMLButtonElement;
  private runEl!: HTMLDivElement;
  private runHead!: HTMLDivElement;
  private progressEl!: HTMLDivElement;
  private progressBar!: HTMLSpanElement;
  private progressPct!: HTMLSpanElement;
  private statusEl!: HTMLDivElement;
  private statusIcon!: HTMLSpanElement;
  private statusText!: HTMLSpanElement;
  private statusActions!: HTMLDivElement;
  private controls!: HTMLDivElement;
  private playBtn!: HTMLButtonElement;
  private playIcon!: HTMLSpanElement;
  private playLabel!: HTMLSpanElement;
  private shareSection!: HTMLDivElement;
  private shareConfirm!: HTMLDivElement;
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

    this.fab = h("button", {
      id: "evo-dub-fab",
      type: "button",
      title: t("overlay.open"),
      attrs: { "aria-label": t("overlay.open") }
    }, [h("span", { class: "evo-logo evo-logo--bare", attrs: { "aria-hidden": "true" } })]);
    this.fab.addEventListener("click", () => this.togglePanel(true));

    document.body.append(this.fab, this.buildPanel(defaultLang));
  }

  private buildPanel(defaultLang: string): HTMLDivElement {
    const settingsBtn = h("button", {
      class: "evo-btn evo-btn--ghost evo-btn--icon",
      type: "button",
      title: t("overlay.settings"),
      attrs: { "aria-label": t("overlay.settings") }
    }, [icon("settings")]);
    settingsBtn.addEventListener("click", () => this.handlers.onOpenSettings());

    const collapseBtn = h("button", {
      class: "evo-btn evo-btn--ghost evo-btn--icon",
      type: "button",
      title: t("overlay.collapse"),
      attrs: { "aria-label": t("overlay.collapse") }
    }, [icon("close")]);
    collapseBtn.addEventListener("click", () => this.togglePanel(false));

    const head = h("div", { class: "evo-head" }, [
      h("div", { class: "evo-brand" }, [
        h("span", { class: "evo-logo", attrs: { "aria-hidden": "true" } }),
        h("span", { textContent: t("app.name") })
      ]),
      settingsBtn,
      collapseBtn
    ]);

    this.sourceTitle = h("div", { class: "evo-source-title" });
    this.sourceMeta = h("div", { class: "evo-source-meta evo-num" });
    this.sourceEl = h("div", { class: "evo-source" }, [this.sourceTitle, this.sourceMeta]);

    this.langSelect = this.buildLanguageSelect(defaultLang);
    const langField = h("div", { class: "evo-field" }, [
      h("label", { class: "evo-label", htmlFor: "evo-target-lang", textContent: t("overlay.targetLabel") }),
      h("div", { class: "evo-select-wrap" }, [this.langSelect, icon("chevron")])
    ]);

    this.trackSelect = h("select", {
      class: "evo-select",
      id: "evo-caption-track",
      attrs: { "aria-label": t("overlay.trackLabel") }
    });
    this.trackSelect.addEventListener("change", () => this.handlers.onTrackChange(this.trackSelect.value));
    this.trackNote = h("p", { class: "evo-note evo-note--warn evo-hidden" });
    this.trackField = h("div", { class: "evo-field evo-hidden" }, [
      h("label", { class: "evo-label", htmlFor: "evo-caption-track", textContent: t("overlay.trackLabel") }),
      h("div", { class: "evo-select-wrap" }, [this.trackSelect, icon("chevron")]),
      this.trackNote
    ]);

    this.dubBtn = h("button", {
      class: "evo-btn evo-btn--solid evo-btn--block",
      type: "button"
    }, [icon("audio"), h("span", { textContent: t("overlay.dub") })]);
    this.dubBtn.addEventListener("click", () =>
      this.handlers.onDub(this.langSelect.value || "vi", this.trackSelect.value)
    );

    this.progressBar = h("span");
    this.progressEl = h("div", {
      class: "evo-progress",
      attrs: {
        role: "progressbar",
        "aria-label": t("overlay.progressLabel"),
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": "0"
      }
    }, [this.progressBar]);
    this.progressPct = h("span", { class: "evo-run-pct evo-num", textContent: "0%" });

    this.statusIcon = icon("info", "sm");
    this.statusText = h("span");
    this.statusEl = h("div", {
      class: "evo-status",
      attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" }
    }, [this.statusIcon, this.statusText]);

    this.runHead = h("div", { class: "evo-run-head evo-hidden" }, [this.progressEl, this.progressPct]);
    this.runEl = h("div", { class: "evo-run evo-hidden" }, [this.runHead, this.statusEl]);

    this.statusActions = h("div", { class: "evo-actions evo-hidden" });

    this.playIcon = icon("pause");
    this.playLabel = h("span", { textContent: t("overlay.pause") });
    this.playBtn = h("button", { class: "evo-btn evo-btn--outline", type: "button" }, [
      this.playIcon,
      this.playLabel
    ]);
    this.playBtn.addEventListener("click", () => this.handlers.onTogglePlay());

    const redubBtn = h("button", {
      class: "evo-btn evo-btn--outline",
      type: "button"
    }, [icon("redo"), h("span", { textContent: t("overlay.redub") })]);
    redubBtn.addEventListener("click", () => this.handlers.onRedub());
    this.controls = h("div", { class: "evo-controls evo-hidden" }, [this.playBtn, redubBtn]);

    this.visibilitySelect = h("select", {
      class: "evo-select",
      id: "evo-visibility",
      attrs: { "aria-label": t("overlay.visibility") }
    }, [
      h("option", { value: "public", textContent: t("overlay.visibilityPublic") }),
      h("option", { value: "private", textContent: t("overlay.visibilityPrivate") })
    ]);
    this.shareBtn = h("button", {
      class: "evo-btn evo-btn--outline evo-btn--block",
      type: "button"
    }, [icon("share"), h("span", { textContent: t("overlay.share") })]);
    this.shareBtn.addEventListener("click", () =>
      this.handlers.onShare(this.visibilitySelect.value as "public" | "private")
    );
    this.shareSection = h("div", { class: "evo-share evo-hidden" }, [
      h("hr", { class: "evo-divider" }),
      h("label", { class: "evo-label", htmlFor: "evo-visibility", textContent: t("overlay.shareLabel") }),
      h("div", { class: "evo-select-wrap" }, [this.visibilitySelect, icon("chevron")]),
      this.shareBtn
    ]);

    this.shareConfirm = h("div", { class: "evo-share-confirm evo-hidden" });

    const body = h("div", { class: "evo-body" }, [
      this.sourceEl,
      langField,
      this.trackField,
      this.dubBtn,
      this.runEl,
      this.statusActions,
      this.controls,
      this.shareSection,
      this.shareConfirm
    ]);

    const foot = h("div", { class: "evo-foot" }, [
      h("p", { class: "evo-note", textContent: AI_VOICE_DISCLOSURE })
    ]);

    this.panel = h("div", {
      id: "evo-dub-panel",
      class: "evo-hidden",
      attrs: { role: "region", "aria-label": t("app.name"), tabindex: "-1" }
    }, [head, body, foot]);

    return this.panel;
  }

  private buildLanguageSelect(defaultLang: string): HTMLSelectElement {
    const select = h("select", {
      class: "evo-select",
      id: "evo-target-lang"
    }, targetLanguageOptions(defaultLang).map((lang) =>
      h("option", { value: lang.code, textContent: lang.label, selected: lang.code === defaultLang })
    ));
    select.value = defaultLang;
    return select;
  }

  private setTargetLang(lang: string): void {
    const known = Array.from(this.langSelect.options).some((option) => option.value === lang);
    if (!known && lang) {
      this.langSelect.prepend(h("option", { value: lang, textContent: lang }));
    }
    this.langSelect.value = lang;
  }

  private togglePanel(open: boolean): void {
    this.panel.classList.toggle("evo-hidden", !open);
    this.fab.classList.toggle("evo-hidden", open);
    if (open) this.panel.focus();
  }

  private setStatus(message: string, tone: StatusTone): void {
    this.statusText.textContent = message;
    this.statusEl.classList.toggle("evo-status--error", tone === "error");
    const iconName = tone === "busy" ? "spinner" : tone === "error" ? "alert" : "info";
    this.statusIcon.className = `evo-i evo-i-${iconName} evo-i--sm`;
    this.runEl.classList.toggle("evo-hidden", tone === "idle" && !message);
  }

  private setProgressValue(percent: number): void {
    this.progressBar.style.width = `${percent}%`;
    this.progressPct.textContent = `${percent}%`;
    this.progressEl.setAttribute("aria-valuenow", String(percent));
  }

  setVideoContext(ctx: VideoContext | null): void {
    this.sourceEl.classList.toggle("evo-source--empty", !ctx);
    this.sourceTitle.textContent = ctx ? ctx.title : t("overlay.noVideo");
    this.sourceMeta.textContent = ctx
      ? t("overlay.sourceMeta", {
          duration: formatDuration(ctx.durationMs),
          platform: platformLabel(ctx.platform)
        })
      : "";
    this.dubBtn.disabled = !ctx;
  }

  setCaptionTracks(tracks: CaptionTrackOption[], selectedId: string): void {
    this.trackField.classList.toggle("evo-hidden", tracks.length === 0);
    this.trackSelect.innerHTML = "";
    this.trackSelect.append(h("option", { value: "", textContent: t("overlay.trackAuto") }));
    for (const track of tracks) {
      const label = track.primary ? track.name : `${track.name} - ${t("overlay.trackForeign")}`;
      this.trackSelect.append(h("option", { value: track.id, textContent: label }));
    }
    const known = tracks.some((track) => track.id === selectedId);
    this.trackSelect.value = known ? selectedId : "";
    this.hideTrackNote();
  }

  setTranscriptInfo(info: TranscriptInfo | null): void {
    if (!info || info.coverage >= LOW_COVERAGE) {
      this.hideTrackNote();
      return;
    }
    this.trackNote.textContent = t("overlay.trackLowCoverage", {
      percent: String(Math.max(1, Math.round(info.coverage * 100)))
    });
    this.trackNote.classList.remove("evo-hidden");
    this.trackField.classList.remove("evo-hidden");
  }

  private hideTrackNote(): void {
    this.trackNote.textContent = "";
    this.trackNote.classList.add("evo-hidden");
  }

  setProgress(progress: DubbingProgress): void {
    const busy = progress.phase !== "idle" && progress.phase !== "ready" && progress.phase !== "error";
    this.dubBtn.disabled = busy;
    this.runHead.classList.toggle("evo-hidden", !busy);
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    this.setProgressValue(percent);
    this.clearActions();
    const message =
      progress.total > 1 ? `${progress.message} ${progress.current}/${progress.total}` : progress.message;
    this.setStatus(message, busy ? "busy" : "info");
  }

  setReady(): void {
    this.playing = true;
    this.dubBtn.classList.add("evo-hidden");
    this.controls.classList.remove("evo-hidden");
    this.shareSection.classList.remove("evo-hidden");
    this.runHead.classList.add("evo-hidden");
    this.updatePlayLabel();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.updatePlayLabel();
  }

  private updatePlayLabel(): void {
    this.playLabel.textContent = this.playing ? t("overlay.pause") : t("overlay.resume");
    this.playIcon.className = `evo-i evo-i-${this.playing ? "pause" : "play"}`;
  }

  setError(message: string): void {
    this.dubBtn.disabled = false;
    this.runHead.classList.add("evo-hidden");
    this.setStatus(message, "error");
  }

  setActionError(message: string, actions: OverlayAction[]): void {
    this.setError(message);
    this.statusActions.innerHTML = "";
    for (const action of actions) {
      const btn = h("button", {
        class: "evo-btn evo-btn--outline evo-btn--sm",
        type: "button",
        textContent: action.label
      });
      btn.addEventListener("click", () => action.onClick());
      this.statusActions.append(btn);
    }
    this.statusActions.classList.remove("evo-hidden");
  }

  private clearActions(): void {
    this.statusActions.classList.add("evo-hidden");
    this.statusActions.innerHTML = "";
  }

  setShareStatus(message: string): void {
    this.clearActions();
    this.runHead.classList.add("evo-hidden");
    this.setStatus(message, "info");
  }

  setVisibility(visibility: "public" | "private"): void {
    this.visibilitySelect.value = visibility;
  }

  showShareConfirmation(view: ShareConfirmationView, handlers: ShareConfirmationHandlers): void {
    this.shareConfirm.classList.remove("evo-hidden");
    renderShareConfirmation(this.shareConfirm, view, handlers);
  }

  hideShareConfirmation(): void {
    this.shareConfirm.classList.add("evo-hidden");
    this.shareConfirm.innerHTML = "";
  }

  reset(defaultLang: string): void {
    this.playing = false;
    this.setTargetLang(defaultLang);
    this.hideTrackNote();
    this.dubBtn.classList.remove("evo-hidden");
    this.dubBtn.disabled = false;
    this.controls.classList.add("evo-hidden");
    this.shareSection.classList.add("evo-hidden");
    this.hideShareConfirmation();
    this.runHead.classList.add("evo-hidden");
    this.setProgressValue(0);
    this.clearActions();
    this.setStatus("", "idle");
  }
}
