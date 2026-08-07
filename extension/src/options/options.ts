import { getSettings, saveSettings, saveKeys, DEFAULT_SETTINGS } from "../lib/storage.ts";
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
    fillProviderModels((e.target as HTMLSelectElement).value as ProviderId, "translate");
  });
  ($("ttsProvider") as HTMLSelectElement).addEventListener("change", (e) => {
    fillProviderModels((e.target as HTMLSelectElement).value as ProviderId, "tts");
  });

  $("save").addEventListener("click", onSave);
  $("managedBaseUrl").addEventListener("change", () => void refreshManagedCard());
  await refreshManagedCard();
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
