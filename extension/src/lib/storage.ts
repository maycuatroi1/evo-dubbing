import type { Settings, ProviderKeys, DubbingSettings } from "./types.ts";
import { DEFAULT_SERVER_URL, SETTINGS_VERSION, normalizeBaseUrl } from "./config.ts";

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
  showTimelineProgress: true,
  holdUntilFirstDub: true,
  ttsModel: "gpt-4o-mini-tts",
  translateModel: "gpt-5.4-mini",
  shareServerUrl: DEFAULT_SERVER_URL,
  autoUpload: false,
  defaultVisibility: "public",
  billingMode: "byok",
  managedBaseUrl: DEFAULT_SERVER_URL,
  managedVoiceProfileId: "vi-standard-female",
  settingsVersion: SETTINGS_VERSION
};

/**
 * Adopt the baked-in default server for installs that predate it. Those blobs store "" for
 * both server fields, and an explicit "" beats a default in the spread below, so without this
 * an existing user would keep a dead server forever.
 *
 * Only blobs with no settingsVersion are rewritten. Anything written since carries the version,
 * so an empty field there is a deliberate opt-out (see the advanced disclosure in the options
 * page) and stays empty. Nothing is persisted here: the rewrite is deterministic on every read,
 * and the next save stamps the version.
 */
function migrateSettings(stored: Partial<DubbingSettings>): Partial<DubbingSettings> {
  if ((stored.settingsVersion ?? 0) >= SETTINGS_VERSION) return stored;
  return {
    ...stored,
    shareServerUrl: normalizeBaseUrl(stored.shareServerUrl ?? "") || DEFAULT_SERVER_URL,
    managedBaseUrl: normalizeBaseUrl(stored.managedBaseUrl ?? "") || DEFAULT_SERVER_URL,
    settingsVersion: SETTINGS_VERSION
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, KEYS_KEY]);
  const raw = stored[SETTINGS_KEY] as Partial<DubbingSettings> | undefined;
  const settings = { ...DEFAULT_SETTINGS, ...(raw ? migrateSettings(raw) : {}) };
  const keys: ProviderKeys = stored[KEYS_KEY] ?? {};
  return { ...settings, keys };
}

export async function saveSettings(settings: DubbingSettings): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...settings, settingsVersion: SETTINGS_VERSION }
  });
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

const TRACK_PREFS_KEY = "evoDubbingTrackPrefs";
const TRACK_PREFS_LIMIT = 200;

interface TrackPreference {
  trackId: string;
  at: number;
}

type TrackPreferences = Record<string, TrackPreference>;

async function readTrackPreferences(): Promise<TrackPreferences> {
  const stored = await chrome.storage.local.get(TRACK_PREFS_KEY);
  return (stored[TRACK_PREFS_KEY] ?? {}) as TrackPreferences;
}

export function videoTrackKey(platform: string, videoId: string): string {
  return `${platform}:v:${videoId}`;
}

export function channelTrackKey(platform: string, channelId: string): string {
  return `${platform}:c:${channelId}`;
}

export async function getTrackPreference(keys: string[]): Promise<string | null> {
  const prefs = await readTrackPreferences();
  for (const key of keys) {
    const hit = prefs[key];
    if (hit) return hit.trackId;
  }
  return null;
}

export async function saveTrackPreference(keys: string[], trackId: string): Promise<void> {
  const prefs = await readTrackPreferences();
  const at = Date.now();
  for (const key of keys) prefs[key] = { trackId, at };

  const entries = Object.entries(prefs);
  if (entries.length > TRACK_PREFS_LIMIT) {
    entries.sort((a, b) => b[1].at - a[1].at);
    await chrome.storage.local.set({
      [TRACK_PREFS_KEY]: Object.fromEntries(entries.slice(0, TRACK_PREFS_LIMIT))
    });
    return;
  }
  await chrome.storage.local.set({ [TRACK_PREFS_KEY]: prefs });
}

export function onSettingsChanged(handler: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY] || changes[KEYS_KEY]) {
      getSettings().then(handler);
    }
  });
}
