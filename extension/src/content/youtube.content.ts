import { EvoOverlay } from "./overlay";
import { getSettings, saveOwnerToken, getOwnerToken } from "../lib/storage";
import { resolvePlatform } from "../lib/platforms";
import { buildDub } from "../lib/dubbing/engine";
import { DubPlayer } from "../lib/dubbing/player";
import { lookupDub, uploadDub, setVisibility, type RemoteDub } from "../lib/api/shareClient";
import type { Dub, Settings, VideoContext } from "../lib/types";

const platform = resolvePlatform(location.href);

let overlay: EvoOverlay | null = null;
let context: VideoContext | null = null;
let player: DubPlayer | null = null;
let currentDub: Dub | null = null;
let fromRemote = false;
let playing = false;
let abort: AbortController | null = null;

function remoteToDub(remote: RemoteDub): Dub {
  return {
    id: remote.id,
    platform: remote.platform,
    videoId: remote.videoId,
    sourceLang: remote.sourceLang,
    targetLang: remote.targetLang,
    voice: remote.voice,
    provider: remote.provider,
    title: remote.title,
    durationMs: remote.durationMs,
    visibility: remote.visibility,
    segments: remote.segments.map((s) => ({
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      originalText: s.originalText,
      text: s.text,
      audioUrl: s.audioUrl,
      audioMime: s.mime
    }))
  };
}

function cleanupPlayer(): void {
  if (player) {
    player.destroy();
    player = null;
  }
  playing = false;
}

async function startPlayback(dub: Dub, settings: Settings): Promise<void> {
  cleanupPlayer();
  const video = platform?.getVideoElement() ?? null;
  if (!video) {
    overlay?.setError("Could not find the video element.");
    return;
  }
  player = new DubPlayer({ video, dub, duckVolume: settings.duckVolume });
  await player.prepare((done, total) =>
    overlay?.setProgress({ phase: "synthesizing", current: done, total, message: "Preparing audio" })
  );
  await player.enable();
  playing = true;
  overlay?.setReady();
  overlay?.setPlaying(true);
}

async function onDub(targetLang: string): Promise<void> {
  if (!platform || !context) return;
  abort?.abort();
  abort = new AbortController();

  const stored = await getSettings();
  const settings: Settings = { ...stored, targetLang };

  try {
    if (settings.shareServerUrl) {
      overlay?.setProgress({ phase: "transcript", current: 0, total: 1, message: "Checking shared library" });
      const remote = await lookupDub(settings.shareServerUrl, {
        platform: context.platform,
        videoId: context.videoId,
        targetLang,
        voice: settings.voice,
        provider: settings.ttsProvider
      });
      if (remote && remote.segments.length > 0) {
        currentDub = remoteToDub(remote);
        fromRemote = true;
        overlay?.setShareStatus("Loaded a shared dub");
        await startPlayback(currentDub, settings);
        overlay?.setVisibility(remote.visibility);
        return;
      }
    }

    const dub = await buildDub({
      context,
      platform,
      settings,
      signal: abort.signal,
      onProgress: (p) => overlay?.setProgress(p)
    });
    currentDub = dub;
    fromRemote = false;
    await startPlayback(dub, settings);

    if (settings.autoUpload && settings.shareServerUrl) {
      await shareCurrent(settings.defaultVisibility, settings);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    overlay?.setError(err instanceof Error ? err.message : String(err));
  }
}

async function shareCurrent(visibility: "public" | "private", settings: Settings): Promise<void> {
  if (!currentDub) return;
  if (!settings.shareServerUrl) {
    overlay?.setError("Set a share server URL in the extension options first.");
    return;
  }

  if (currentDub.id && !fromRemote) {
    const token = await getOwnerToken(currentDub.id);
    if (token) {
      overlay?.setShareStatus("Updating visibility...");
      try {
        await setVisibility(settings.shareServerUrl, currentDub.id, visibility, token);
        currentDub.visibility = visibility;
        overlay?.setShareStatus(`Visibility set to ${visibility}`);
      } catch (err) {
        overlay?.setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
  }

  if (fromRemote) {
    overlay?.setShareStatus("This dub is already shared.");
    return;
  }

  currentDub.visibility = visibility;
  overlay?.setShareStatus("Uploading dub...");
  try {
    const result = await uploadDub(settings.shareServerUrl, currentDub);
    currentDub.id = result.id;
    await saveOwnerToken(result.id, result.ownerToken);
    overlay?.setShareStatus(`Shared (${result.visibility})`);
  } catch (err) {
    overlay?.setError(err instanceof Error ? err.message : String(err));
  }
}

function onTogglePlay(): void {
  if (!player) return;
  if (playing) {
    player.disable();
    playing = false;
    overlay?.setPlaying(false);
  } else {
    player.enable();
    playing = true;
    overlay?.setPlaying(true);
  }
}

async function onRedub(): Promise<void> {
  cleanupPlayer();
  currentDub = null;
  fromRemote = false;
  const settings = await getSettings();
  overlay?.reset(settings.targetLang);
}

async function onShare(visibility: "public" | "private"): Promise<void> {
  const settings = await getSettings();
  await shareCurrent(visibility, settings);
}

async function refreshContext(): Promise<void> {
  if (!platform) return;
  context = await platform.getVideoContext();
  overlay?.setVideoContext(context);
}

async function init(): Promise<void> {
  if (!platform) return;
  const settings = await getSettings();
  overlay = new EvoOverlay({ onDub, onTogglePlay, onRedub, onShare });
  overlay.mount(settings.targetLang);
  overlay.setVisibility(settings.defaultVisibility);
  await refreshContext();

  document.addEventListener("yt-navigate-finish", async () => {
    cleanupPlayer();
    currentDub = null;
    fromRemote = false;
    const latest = await getSettings();
    overlay?.reset(latest.targetLang);
    await refreshContext();
  });
}

init();
