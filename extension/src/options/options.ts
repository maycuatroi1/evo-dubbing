import { getSettings, saveSettings, saveKeys, DEFAULT_SETTINGS } from "../lib/storage";
import { listProviders, getProvider } from "../lib/providers";
import type { ProviderId } from "../lib/types";

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
  const settings = await getSettings();

  ($("openaiKey") as HTMLInputElement).value = settings.keys.openai ?? "";
  ($("geminiKey") as HTMLInputElement).value = settings.keys.gemini ?? "";
  ($("targetLang") as HTMLInputElement).value = settings.targetLang;
  ($("showSubtitles") as HTMLInputElement).checked = settings.showSubtitles;
  ($("shareServerUrl") as HTMLInputElement).value = settings.shareServerUrl;
  ($("autoUpload") as HTMLInputElement).checked = settings.autoUpload;
  ($("defaultVisibility") as HTMLSelectElement).value = settings.defaultVisibility;

  const duck = $("duckVolume") as HTMLInputElement;
  duck.value = String(settings.duckVolume);
  const duckValue = $("duckValue");
  const showDuck = () => (duckValue.textContent = `${Math.round(Number(duck.value) * 100)}% original volume`);
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

  ($("translateModel") as HTMLSelectElement).value = settings.translateModel;
  ($("ttsModel") as HTMLSelectElement).value = settings.ttsModel;
  ($("voice") as HTMLSelectElement).value = settings.voice;

  fillProviderModels(settings.translateProvider, "translate");
  fillProviderModels(settings.ttsProvider, "tts");

  ($("translateProvider") as HTMLSelectElement).addEventListener("change", (e) => {
    fillProviderModels((e.target as HTMLSelectElement).value as ProviderId, "translate");
  });
  ($("ttsProvider") as HTMLSelectElement).addEventListener("change", (e) => {
    fillProviderModels((e.target as HTMLSelectElement).value as ProviderId, "tts");
  });

  $("save").addEventListener("click", onSave);
}

async function onSave() {
  const status = $("status");
  await saveKeys({
    openai: ($("openaiKey") as HTMLInputElement).value.trim() || undefined,
    gemini: ($("geminiKey") as HTMLInputElement).value.trim() || undefined
  });
  await saveSettings({
    ...DEFAULT_SETTINGS,
    translateProvider: ($("translateProvider") as HTMLSelectElement).value as ProviderId,
    ttsProvider: ($("ttsProvider") as HTMLSelectElement).value as ProviderId,
    sttProvider: ($("sttProvider") as HTMLSelectElement).value as ProviderId,
    targetLang: ($("targetLang") as HTMLInputElement).value.trim() || "vi",
    voice: ($("voice") as HTMLSelectElement).value,
    duckVolume: Number(($("duckVolume") as HTMLInputElement).value),
    showSubtitles: ($("showSubtitles") as HTMLInputElement).checked,
    ttsModel: ($("ttsModel") as HTMLSelectElement).value,
    translateModel: ($("translateModel") as HTMLSelectElement).value,
    shareServerUrl: ($("shareServerUrl") as HTMLInputElement).value.trim().replace(/\/$/, ""),
    autoUpload: ($("autoUpload") as HTMLInputElement).checked,
    defaultVisibility: ($("defaultVisibility") as HTMLSelectElement).value as "public" | "private"
  });
  status.textContent = "Saved";
  setTimeout(() => (status.textContent = ""), 1500);
}

init();
