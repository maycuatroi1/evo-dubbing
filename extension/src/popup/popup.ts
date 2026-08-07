import { getSettings } from "../lib/storage.ts";
import { isDefaultServer, serverHost } from "../lib/config.ts";
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

/** Names the host rather than saying "configured": a custom server has to be visible from here. */
function serverState(url: string): StateView {
  const host = serverHost(url);
  if (!host) return { label: t("popup.serverOff"), icon: null, on: false };
  if (isDefaultServer(url)) return { label: host, icon: "check", on: true };
  return { label: `${host} (${t("popup.serverCustom")})`, icon: "alert", on: true };
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
  render("serverState", serverState(settings.shareServerUrl));

  document.getElementById("openOptions")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

void init();
