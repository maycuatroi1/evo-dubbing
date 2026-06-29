import { EvoOverlay } from "./overlay";
import { getSettings, saveOwnerToken, getOwnerToken } from "../lib/storage";
import { resolvePlatform } from "../lib/platforms";
import { DubSession } from "../lib/dubbing/session";
import { lookupDub, uploadDub, setVisibility, type RemoteDub } from "../lib/api/shareClient";
import type { Dub, Settings, VideoContext } from "../lib/types";

const platform = resolvePlatform(location.href);

let overlay: EvoOverlay | null = null;
let context: VideoContext | null = null;
let session: DubSession | null = null;
let fromRemote = false;
let uploadedDubId: string | null = null;

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

function cleanupSession(): void {
  if (session) {
    session.destroy();
    session = null;
  }
}

async function onDub(targetLang: string): Promise<void> {
  if (!platform || !context) return;

  const video = platform.getVideoElement();
  if (!video) {
    overlay?.setError("Could not find the video element.");
    return;
  }

  const stored = await getSettings();
  const settings: Settings = { ...stored, targetLang };

  cleanupSession();
  uploadedDubId = null;
  session = new DubSession({
    video,
    context,
    settings,
    onProgress: (p) => {
      if (p.phase === "error") overlay?.setError(p.message);
      else overlay?.setProgress(p);
    },
    onReady: () => {
      overlay?.setReady();
      overlay?.setPlaying(true);
    }
  });

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
        fromRemote = true;
        await session.startRemote(remoteToDub(remote));
        overlay?.setVisibility(remote.visibility);
        overlay?.setShareStatus("Playing a shared dub (free)");
        return;
      }
    }

    fromRemote = false;
    await session.startGenerated(platform);
  } catch (err) {
    overlay?.setError(err instanceof Error ? err.message : String(err));
  }
}

async function shareCurrent(visibility: "public" | "private", settings: Settings): Promise<void> {
  if (!session) return;
  if (!settings.shareServerUrl) {
    overlay?.setError("Set a share server URL in the extension options first.");
    return;
  }
  if (fromRemote) {
    overlay?.setShareStatus("This dub is already shared.");
    return;
  }

  if (uploadedDubId) {
    const token = await getOwnerToken(uploadedDubId);
    if (token) {
      overlay?.setShareStatus("Updating visibility...");
      try {
        await setVisibility(settings.shareServerUrl, uploadedDubId, visibility, token);
        overlay?.setShareStatus(`Visibility set to ${visibility}`);
      } catch (err) {
        overlay?.setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
  }

  try {
    const dub = await session.completeAll((p) => overlay?.setProgress(p));
    dub.visibility = visibility;
    overlay?.setShareStatus("Uploading dub...");
    const result = await uploadDub(settings.shareServerUrl, dub);
    uploadedDubId = result.id;
    await saveOwnerToken(result.id, result.ownerToken);
    overlay?.setShareStatus(`Shared (${result.visibility})`);
  } catch (err) {
    overlay?.setError(err instanceof Error ? err.message : String(err));
  }
}

function onTogglePlay(): void {
  if (!session) return;
  if (session.isActive()) {
    session.pause();
    overlay?.setPlaying(false);
  } else {
    session.resume();
    overlay?.setPlaying(true);
  }
}

async function onRedub(): Promise<void> {
  cleanupSession();
  fromRemote = false;
  uploadedDubId = null;
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
    cleanupSession();
    fromRemote = false;
    uploadedDubId = null;
    const latest = await getSettings();
    overlay?.reset(latest.targetLang);
    await refreshContext();
  });
}

init();
