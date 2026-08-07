import { getSettings, saveSettings, saveKeys, DEFAULT_SETTINGS } from "../lib/storage.ts";
import { DEFAULT_SERVER_URL, isDefaultServer, normalizeBaseUrl, serverHost } from "../lib/config.ts";
import { listProviders, getProvider } from "../lib/providers/index.ts";
import { hydrate, t } from "../lib/i18n/index.ts";
import { targetLanguageOptions } from "../lib/i18n/languages.ts";
import type { ProviderId } from "../lib/types.ts";
import {
  ManagedClientError,
  managedAccount,
  managedAuthState,
  managedCheckout,
  managedSignIn,
  managedSignOut
} from "../lib/managed/messages.ts";
import { renderManagedCard, type ManagedCardHandlers } from "../lib/managed/onboarding.ts";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: ${id}`);
  return el as T;
}

function fillOptions(select: HTMLSelectElement, values: { value: string; label: string }[], selected: string) {
  select.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v.value;
    opt.textContent = v.label;
    if (v.value === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

function providerOptions() {
  return listProviders().map((p) => ({ value: p.id, label: p.label }));
}

function fillProviderModels(providerId: ProviderId, kind: "translate" | "tts") {
  const provider = getProvider(providerId);
  if (kind === "translate") {
    fillOptions(
      $("translateModel"),
      provider.translateModels.map((m) => ({ value: m, label: m })),
      ($("translateModel") as HTMLSelectElement).value
    );
  } else {
    fillOptions(
      $("ttsModel"),
      provider.ttsModels.map((m) => ({ value: m, label: m })),
      ($("ttsModel") as HTMLSelectElement).value
    );
    fillOptions(
      $("voice"),
      provider.voices.map((v) => ({ value: v.id, label: v.label })),
      ($("voice") as HTMLSelectElement).value
    );
  }
}

async function init() {
  hydrate(document);
  const settings = await getSettings();

  ($("openaiKey") as HTMLInputElement).value = settings.keys.openai ?? "";
  ($("geminiKey") as HTMLInputElement).value = settings.keys.gemini ?? "";
  fillOptions(
    $("targetLang"),
    targetLanguageOptions(settings.targetLang).map((l) => ({ value: l.code, label: l.label })),
    settings.targetLang
  );
  ($("showSubtitles") as HTMLInputElement).checked = settings.showSubtitles;
  ($("showTimelineProgress") as HTMLInputElement).checked = settings.showTimelineProgress;
  ($("holdUntilFirstDub") as HTMLInputElement).checked = settings.holdUntilFirstDub;
  ($("shareServerUrl") as HTMLInputElement).value = settings.shareServerUrl;
  ($("autoUpload") as HTMLInputElement).checked = settings.autoUpload;
  ($("defaultVisibility") as HTMLSelectElement).value = settings.defaultVisibility;
  ($("managedBaseUrl") as HTMLInputElement).value = settings.managedBaseUrl;
  ($("modeByok") as HTMLInputElement).checked = settings.billingMode !== "managed";
  ($("modeManaged") as HTMLInputElement).checked = settings.billingMode === "managed";

  const duck = $("duckVolume") as HTMLInputElement;
  duck.value = String(settings.duckVolume);
  const duckValue = $("duckValue");
  const showDuck = () =>
    (duckValue.textContent = t("options.dubbing.duckValue", {
      percent: Math.round(Number(duck.value) * 100)
    }));
  duck.addEventListener("input", showDuck);
  showDuck();

  fillOptions($("translateProvider"), providerOptions(), settings.translateProvider);
  fillOptions($("ttsProvider"), providerOptions(), settings.ttsProvider);
  fillOptions(
    $("sttProvider"),
    listProviders()
      .filter((p) => p.sttModels.length > 0)
      .map((p) => ({ value: p.id, label: p.label })),
    settings.sttProvider
  );

  fillProviderModels(settings.translateProvider, "translate");
  fillProviderModels(settings.ttsProvider, "tts");

  ($("translateModel") as HTMLSelectElement).value = settings.translateModel;
  ($("ttsModel") as HTMLSelectElement).value = settings.ttsModel;
  ($("voice") as HTMLSelectElement).value = settings.voice;

  ($("translateProvider") as HTMLSelectElement).addEventListener("change", (e) => {
    providerChosenByHand = true;
    fillProviderModels((e.target as HTMLSelectElement).value as ProviderId, "translate");
  });
  ($("ttsProvider") as HTMLSelectElement).addEventListener("change", (e) => {
    providerChosenByHand = true;
    fillProviderModels((e.target as HTMLSelectElement).value as ProviderId, "tts");
  });
  for (const id of ["sttProvider", "translateModel", "ttsModel", "voice"]) {
    $(id).addEventListener("change", () => {
      providerChosenByHand = true;
    });
  }

  initKeyProviderLink();
  initServerCard();

  $("save").addEventListener("click", onSave);
  $("managedBaseUrl").addEventListener("change", () => void refreshManagedCard());
  await refreshManagedCard();
}

// --- Keys drive the provider -------------------------------------------------------------
//
// A key is the decision; the provider dropdowns are its consequence. Someone who pastes a
// Gemini key has told us which pipeline to run, so pointing translate, TTS and voice at Gemini
// saves them three dropdowns and the failure mode of a key that is never read. It fires only
// when a field goes from empty to filled - rotating a key is not a choice of provider - and
// never after the user has picked a provider by hand, because that is a decision to respect.

const KEY_FIELDS: { id: string; provider: ProviderId }[] = [
  { id: "openaiKey", provider: "openai" },
  { id: "geminiKey", provider: "gemini" }
];

let providerChosenByHand = false;
const keyWasFilled: Record<string, boolean> = {};

function adoptProvider(target: ProviderId): void {
  const provider = getProvider(target);
  ($("translateProvider") as HTMLSelectElement).value = target;
  ($("ttsProvider") as HTMLSelectElement).value = target;
  fillProviderModels(target, "translate");
  fillProviderModels(target, "tts");
  ($("translateModel") as HTMLSelectElement).value = provider.translateModels[0];
  ($("ttsModel") as HTMLSelectElement).value = provider.ttsModels[0];
  ($("voice") as HTMLSelectElement).value = provider.voices[0].id;
  // STT is the caption fallback and only some providers transcribe; leave it where it works.
  if (provider.sttModels.length > 0) ($("sttProvider") as HTMLSelectElement).value = target;

  const note = $("keysAutoNote");
  setStatusLine(note, "info", t("options.keys.autoSwitch", { provider: provider.label }));
  note.classList.remove("evo-hidden");
}

function initKeyProviderLink(): void {
  for (const { id, provider } of KEY_FIELDS) {
    keyWasFilled[id] = ($(id) as HTMLInputElement).value.trim() !== "";
    $(id).addEventListener("input", () => {
      const filled = ($(id) as HTMLInputElement).value.trim() !== "";
      const added = filled && !keyWasFilled[id];
      keyWasFilled[id] = filled;
      if (added && !providerChosenByHand) adoptProvider(provider);
    });
  }
}

// --- Server card -------------------------------------------------------------------------
//
// The server is a default, not a decision. It renders as a read-only identity row, and the only
// way to a text field is a collapsed disclosure plus an explicit acknowledgement, because every
// custom value costs the user their paid plan, their quota and the shared library. Getting back
// is one click and saves immediately; getting out takes three deliberate ones.

interface ServerView {
  /** What we name and health-check: the managed base, or the share base when managed is empty. */
  base: string;
  /** Any configured field points somewhere other than the server we run. */
  custom: boolean;
  /** Shared-library lookups and uploads are disabled. */
  shareOff: boolean;
}

function serverView(): ServerView {
  const managed = normalizeBaseUrl(($("managedBaseUrl") as HTMLInputElement).value);
  const share = normalizeBaseUrl(($("shareServerUrl") as HTMLInputElement).value);
  const configured = [managed, share].filter(Boolean);
  return {
    base: managed || share,
    custom: configured.length > 0 && configured.some((url) => !isDefaultServer(url)),
    shareOff: share === ""
  };
}

function setStatusLine(el: HTMLElement, icon: string, text: string, error = false): void {
  el.textContent = "";
  el.classList.toggle("evo-status--error", error);
  const mark = document.createElement("span");
  mark.className = `evo-i evo-i-${icon} evo-i--sm`;
  mark.setAttribute("aria-hidden", "true");
  el.append(mark, document.createTextNode(text));
}

function renderServerCard(): void {
  const view = serverView();
  const badge = $("serverBadge");

  $("serverHost").textContent = view.base ? serverHost(view.base) : t("options.server.off");
  badge.classList.toggle("evo-hidden", !view.base);
  badge.classList.toggle("evo-badge--warn", view.custom);
  badge.textContent = view.custom ? t("options.server.custom") : t("options.server.default");

  const banner = $("serverBanner");
  if (view.custom) {
    $("serverBannerText").textContent = t("options.server.bannerCustom", {
      host: serverHost(view.base)
    });
    banner.classList.remove("evo-hidden");
  } else if (view.shareOff) {
    $("serverBannerText").textContent = t("options.server.bannerOff");
    banner.classList.remove("evo-hidden");
  } else {
    banner.classList.add("evo-hidden");
  }
}

function hostPattern(base: string): string | null {
  try {
    return `${new URL(base).origin}/*`;
  } catch {
    return null;
  }
}

async function pingServer(base: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Only the newest check may write the line; a slow ping on an abandoned URL must not overwrite it.
let healthToken = 0;

async function checkServerHealth(interactive = false): Promise<void> {
  const line = $("serverHealth");
  const { base } = serverView();
  if (!base) {
    setStatusLine(line, "info", t("options.server.offNote"));
    return;
  }
  const pattern = hostPattern(base);
  if (!pattern) {
    setStatusLine(line, "alert", t("options.server.offline"), true);
    return;
  }
  // permissions.request needs a user gesture, so it only runs from the test button.
  let granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted && interactive) granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    setStatusLine(line, "info", t("options.server.needsPermission"));
    return;
  }

  const token = ++healthToken;
  setStatusLine(line, "spinner", t("options.server.checking"));
  const ok = await pingServer(base);
  if (token !== healthToken) return;
  if (ok) setStatusLine(line, "check", t("options.server.online"));
  else setStatusLine(line, "alert", t("options.server.offline"), true);
}

function lockServerFields(locked: boolean): void {
  ($("managedBaseUrl") as HTMLInputElement).disabled = locked;
  ($("shareServerUrl") as HTMLInputElement).disabled = locked;
  ($("serverTest") as HTMLButtonElement).disabled = locked;
}

/** The way out: restore the default and persist it, so a broken server is never one forgotten save away. */
function resetServer(): void {
  ($("managedBaseUrl") as HTMLInputElement).value = DEFAULT_SERVER_URL;
  ($("shareServerUrl") as HTMLInputElement).value = DEFAULT_SERVER_URL;
  ($("serverUnlock") as HTMLInputElement).checked = false;
  ($("serverAdvanced") as HTMLDetailsElement).open = false;
  lockServerFields(true);
  renderServerCard();
  void onSave().then(() => {
    void checkServerHealth();
    void refreshManagedCard();
  });
}

function initServerCard(): void {
  const view = serverView();
  const offDefault = view.custom || view.shareOff || !view.base;

  ($("serverUnlock") as HTMLInputElement).checked = offDefault;
  ($("serverAdvanced") as HTMLDetailsElement).open = offDefault;
  lockServerFields(!offDefault);
  renderServerCard();

  $("serverUnlock").addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).checked) lockServerFields(false);
    else resetServer();
  });
  $("serverReset").addEventListener("click", resetServer);
  $("serverBannerReset").addEventListener("click", resetServer);
  $("serverTest").addEventListener("click", () => void checkServerHealth(true));

  for (const id of ["managedBaseUrl", "shareServerUrl"]) {
    $(id).addEventListener("input", renderServerCard);
    $(id).addEventListener("change", () => void checkServerHealth());
  }

  void checkServerHealth();
}

function managedBaseUrl(): string {
  return ($("managedBaseUrl") as HTMLInputElement).value.trim();
}

const managedHandlers: ManagedCardHandlers = {
  onSignIn() {
    void (async () => {
      try {
        await managedSignIn();
        await refreshManagedCard();
      } catch (err) {
        renderManagedCard($("managedState"), {
          signedIn: false,
          account: null,
          error: err instanceof Error ? err.message : String(err)
        }, managedHandlers);
      }
    })();
  },
  onSignOut() {
    void (async () => {
      await managedSignOut().catch(() => undefined);
      await refreshManagedCard();
    })();
  },
  onCheckout() {
    void (async () => {
      const root = $("managedState");
      try {
        const result = await managedCheckout(managedBaseUrl());
        window.open(result.checkoutUrl, "_blank");
      } catch (err) {
        renderManagedCard(root, {
          signedIn: true,
          account: null,
          error: err instanceof Error ? err.message : String(err)
        }, managedHandlers);
        return;
      }
      await refreshManagedCard();
    })();
  },
  onRefresh() {
    void refreshManagedCard();
  }
};

async function refreshManagedCard(): Promise<void> {
  const root = $("managedState");
  try {
    const auth = await managedAuthState();
    if (!auth.signedIn) {
      renderManagedCard(root, { signedIn: false, account: null }, managedHandlers);
      return;
    }
    const account = await managedAccount(managedBaseUrl());
    renderManagedCard(root, { signedIn: true, account }, managedHandlers);
  } catch (err) {
    const status = err instanceof ManagedClientError ? err.status : 0;
    if (status === 401) {
      renderManagedCard(root, { signedIn: false, account: null }, managedHandlers);
    } else {
      renderManagedCard(root, {
        signedIn: true,
        account: null,
        error: err instanceof Error ? err.message : String(err)
      }, managedHandlers);
    }
  }
}

async function onSave() {
  const status = $("status");
  await saveKeys({
    openai: ($("openaiKey") as HTMLInputElement).value.trim() || undefined,
    gemini: ($("geminiKey") as HTMLInputElement).value.trim() || undefined
  });
  const { keys: _keys, ...current } = await getSettings();
  await saveSettings({
    ...DEFAULT_SETTINGS,
    ...current,
    translateProvider: ($("translateProvider") as HTMLSelectElement).value as ProviderId,
    ttsProvider: ($("ttsProvider") as HTMLSelectElement).value as ProviderId,
    sttProvider: ($("sttProvider") as HTMLSelectElement).value as ProviderId,
    targetLang: ($("targetLang") as HTMLSelectElement).value.trim() || "vi",
    voice: ($("voice") as HTMLSelectElement).value,
    duckVolume: Number(($("duckVolume") as HTMLInputElement).value),
    showSubtitles: ($("showSubtitles") as HTMLInputElement).checked,
    showTimelineProgress: ($("showTimelineProgress") as HTMLInputElement).checked,
    holdUntilFirstDub: ($("holdUntilFirstDub") as HTMLInputElement).checked,
    ttsModel: ($("ttsModel") as HTMLSelectElement).value,
    translateModel: ($("translateModel") as HTMLSelectElement).value,
    shareServerUrl: ($("shareServerUrl") as HTMLInputElement).value.trim().replace(/\/$/, ""),
    autoUpload: ($("autoUpload") as HTMLInputElement).checked,
    defaultVisibility: ($("defaultVisibility") as HTMLSelectElement).value as "public" | "private",
    billingMode: ($("modeManaged") as HTMLInputElement).checked ? "managed" : "byok",
    managedBaseUrl: ($("managedBaseUrl") as HTMLInputElement).value.trim().replace(/\/+$/, "")
  });
  status.textContent = t("options.saved");
  setTimeout(() => (status.textContent = ""), 2000);
}

init();
