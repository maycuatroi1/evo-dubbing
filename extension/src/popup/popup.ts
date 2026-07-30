import { getSettings } from "../lib/storage.ts";
import { hydrate, t, type StringKey } from "../lib/i18n/index.ts";
import { languageLabel } from "../lib/i18n/languages.ts";

interface StateView {
  label: string;
  icon: string | null;
  on: boolean;
}

function render(id: string, view: StateView): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = "";
  el.classList.toggle("evo-kv--off", !view.on);
  if (view.icon) {
    const mark = document.createElement("span");
    mark.className = `evo-i evo-i-${view.icon} evo-i--sm`;
    mark.setAttribute("aria-hidden", "true");
    el.append(mark);
  }
  el.append(document.createTextNode(view.label));
}

function flag(present: boolean, onKey: StringKey, offKey: StringKey): StateView {
  return {
    label: present ? t(onKey) : t(offKey),
    icon: present ? "check" : null,
    on: present
  };
}

async function init(): Promise<void> {
  hydrate(document);
  const settings = await getSettings();

  render("modeState", {
    label: settings.billingMode === "managed" ? t("popup.modeManaged") : t("popup.modeByok"),
    icon: null,
    on: true
  });
  render("langState", { label: languageLabel(settings.targetLang), icon: null, on: true });
  render("openaiState", flag(Boolean(settings.keys.openai), "popup.keySet", "popup.keyMissing"));
  render("geminiState", flag(Boolean(settings.keys.gemini), "popup.keySet", "popup.keyMissing"));
  render(
    "serverState",
    flag(Boolean(settings.shareServerUrl), "popup.serverConfigured", "popup.serverOff")
  );

  document.getElementById("openOptions")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

void init();
