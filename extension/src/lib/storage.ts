import type { Settings, ProviderKeys, DubbingSettings } from "./types";

const SETTINGS_KEY = "evoDubbingSettings";
const KEYS_KEY = "evoDubbingKeys";

export const DEFAULT_SETTINGS: DubbingSettings = {
  translateProvider: "openai",
  ttsProvider: "openai",
  sttProvider: "openai",
  targetLang: "vi",
  voice: "alloy",
  duckVolume: 0.18,
  showSubtitles: true,
  ttsModel: "gpt-4o-mini-tts",
  translateModel: "gpt-5.4-mini",
  shareServerUrl: "",
  autoUpload: false,
  defaultVisibility: "public"
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, KEYS_KEY]);
  const settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
  const keys: ProviderKeys = stored[KEYS_KEY] ?? {};
  return { ...settings, keys };
}

export async function saveSettings(settings: DubbingSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getKeys(): Promise<ProviderKeys> {
  const stored = await chrome.storage.local.get(KEYS_KEY);
  return stored[KEYS_KEY] ?? {};
}

export async function saveKeys(keys: ProviderKeys): Promise<void> {
  await chrome.storage.local.set({ [KEYS_KEY]: keys });
}

const OWNERS_KEY = "evoDubbingOwners";

export async function getOwnerToken(dubId: string): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(OWNERS_KEY);
  return (stored[OWNERS_KEY] ?? {})[dubId];
}

export async function saveOwnerToken(dubId: string, token: string): Promise<void> {
  const stored = await chrome.storage.local.get(OWNERS_KEY);
  const owners = stored[OWNERS_KEY] ?? {};
  owners[dubId] = token;
  await chrome.storage.local.set({ [OWNERS_KEY]: owners });
}

export function onSettingsChanged(handler: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY] || changes[KEYS_KEY]) {
      getSettings().then(handler);
    }
  });
}
