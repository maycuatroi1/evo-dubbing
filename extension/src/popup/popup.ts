import { getSettings } from "../lib/storage";

function set(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function init(): Promise<void> {
  const settings = await getSettings();
  set("openaiState", settings.keys.openai ? "set" : "missing");
  set("geminiState", settings.keys.gemini ? "set" : "missing");
  set("langState", settings.targetLang);
  set("serverState", settings.shareServerUrl ? "configured" : "off");

  document.getElementById("openOptions")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
