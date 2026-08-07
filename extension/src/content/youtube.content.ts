import { EvoOverlay, type OverlayAction } from "./overlay.ts";
import { DubTimeline } from "./timeline.ts";
import {
  channelTrackKey,
  getOwnerToken,
  getSettings,
  getTrackPreference,
  saveOwnerToken,
  saveTrackPreference,
  videoTrackKey
} from "../lib/storage.ts";
import { resolvePlatform } from "../lib/platforms/index.ts";
import { DubSession } from "../lib/dubbing/session.ts";
import { lookupDub, uploadDub, setVisibility, type RemoteDub } from "../lib/api/shareClient.ts";
import {
  ManagedClientError,
  managedAccount,
  managedCheckout,
  managedLookupDub,
  managedSignIn,
  reportPlaybackStarted,
  type ManagedSharedDub
} from "../lib/managed/messages.ts";
import { MANAGED_ACTION_COPY, MANAGED_ERROR_COPY } from "../lib/managed/onboarding.ts";
import { performShare } from "../lib/managed/share.ts";
import { t } from "../lib/i18n/index.ts";
import type { Dub, Settings, VideoContext } from "../lib/types.ts";

const platform = resolvePlatform(location.href);

let overlay: EvoOverlay | null = null;
let context: VideoContext | null = null;
let session: DubSession | null = null;
let timeline: DubTimeline | null = null;
let fromRemote = false;
let uploadedDubId: string | null = null;
const TRACK_LIST_RETRIES = 4;
const TRACK_LIST_RETRY_MS = 1200;

function trackKeys(ctx: VideoContext): string[] {
  const keys = [videoTrackKey(ctx.platform, ctx.videoId)];
  if (ctx.channelId) keys.push(channelTrackKey(ctx.platform, ctx.channelId));
  return keys;
}

async function refreshCaptionTracks(attempt = 0): Promise<void> {
  if (!platform || !context) {
    overlay?.setCaptionTracks([], "");
    return;
  }
  const videoId = context.videoId;
  const settings = await getSettings();
  const [list, preferred] = await Promise.all([
    platform.listCaptionTracks(settings.targetLang).catch(() => ({ tracks: [], recommendedId: null })),
    getTrackPreference(trackKeys(context))
  ]);
  if (context?.videoId !== videoId) return;

  overlay?.setCaptionTracks(list.tracks, preferred ?? "");

  if (list.tracks.length === 0 && attempt < TRACK_LIST_RETRIES) {
    window.setTimeout(() => {
      if (context?.videoId === videoId) void refreshCaptionTracks(attempt + 1);
    }, TRACK_LIST_RETRY_MS);
  }
}

async function onTrackChange(trackId: string): Promise<void> {
  if (context) await saveTrackPreference(trackKeys(context), trackId);
  cleanupSession();
  fromRemote = false;
  uploadedDubId = null;
  const settings = await getSettings();
  overlay?.reset(settings.targetLang);
}

function remoteToDub(remote: RemoteDub | ManagedSharedDub): Dub {
  return {
    id: remote.id,
    platform: remote.platform,
    videoId: remote.videoId,
    sourceLang: remote.sourceLang,
    targetLang: remote.targetLang,
    voice: remote.voice,
    provider: remote.provider as Dub["provider"],
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
  if (timeline) {
    timeline.destroy();
    timeline = null;
  }
}

function openOptionsPage(): void {
  void chrome.runtime.sendMessage({ type: "openOptionsPage" });
}

function visibilityLabel(visibility: "public" | "private"): string {
  return visibility === "public" ? t("overlay.visibilityPublic") : t("overlay.visibilityPrivate");
}

async function openPayosCheckout(settings: Settings): Promise<void> {
  overlay?.setShareStatus(t("status.payosCreating"));
  try {
    const result = await managedCheckout(settings.managedBaseUrl);
    window.open(result.checkoutUrl, "_blank");
    overlay?.setShareStatus(t("status.payosOpened"));
  } catch (err) {
    overlay?.setError(err instanceof Error ? err.message : String(err));
  }
}

function managedRecoveryActions(settings: Settings, status: number): OverlayAction[] {
  if (status === 401) {
    return [
      {
        label: MANAGED_ACTION_COPY.signInAgain,
        onClick: () => {
          void managedSignIn()
            .then(() => overlay?.setShareStatus(t("status.signedInAgain")))
            .catch((err) => overlay?.setError(err instanceof Error ? err.message : String(err)));
        }
      }
    ];
  }
  if (status === 402) {
    return [
      { label: MANAGED_ACTION_COPY.checkout, onClick: () => void openPayosCheckout(settings) },
      { label: MANAGED_ACTION_COPY.openByok, onClick: openOptionsPage }
    ];
  }
  if (status === 503) {
    return [{ label: MANAGED_ACTION_COPY.openByok, onClick: openOptionsPage }];
  }
  return [];
}

function showSessionError(settings: Settings, message: string, status?: number): void {
  if (settings.billingMode !== "managed" || !status || !(status in MANAGED_ERROR_COPY)) {
    overlay?.setError(message);
    return;
  }
  overlay?.setActionError(MANAGED_ERROR_COPY[status], managedRecoveryActions(settings, status));
}

function handleExportError(settings: Settings, err: unknown): void {
  const code = (err as { code?: unknown }).code;
  const message = err instanceof Error ? err.message : String(err);
  if (settings.billingMode === "managed" && code === "insufficient_quota") {
    overlay?.setActionError(message, [
      { label: MANAGED_ACTION_COPY.checkout, onClick: () => void openPayosCheckout(settings) },
      { label: MANAGED_ACTION_COPY.openByok, onClick: openOptionsPage }
    ]);
    return;
  }
  const status = err instanceof ManagedClientError ? err.status : undefined;
  showSessionError(settings, message, status);
}

async function onDub(targetLang: string, trackId: string): Promise<void> {
  if (!platform || !context) return;

  const video = platform.getVideoElement();
  if (!video) {
    overlay?.setError(t("status.videoElementMissing"));
    return;
  }

  const stored = await getSettings();
  const settings: Settings = { ...stored, targetLang };

  cleanupSession();
  uploadedDubId = null;
  timeline = new DubTimeline(platform, settings.showTimelineProgress);
  session = new DubSession({
    video,
    context,
    settings,
    onProgress: (p) => {
      if (p.phase === "holding") {
        timeline?.showNotice(t("status.holdingForFirstDub"));
        overlay?.setProgress({ ...p, message: t("status.holdingForFirstDub") });
        return;
      }
      timeline?.hideNotice();
      if (p.phase === "error") showSessionError(settings, p.message, p.status);
      else overlay?.setProgress(p);
    },
    onCoverage: (coverage) => timeline?.setCoverage(coverage),
    onReady: () => {
      overlay?.setReady();
      overlay?.setPlaying(true);
    },
    onTranscript: (info) => overlay?.setTranscriptInfo(info),
    getRemainingSourceMs:
      settings.billingMode === "managed"
        ? async () => {
            try {
              const account = await managedAccount(settings.managedBaseUrl);
              return account.remainingSourceMs;
            } catch {
              return null;
            }
          }
        : undefined
  });

  // Engaged before the lookup and the caption fetch: that wait is most of the un-dubbed
  // opening stretch the hold exists to remove.
  session.beginHold();

  try {
    if (settings.shareServerUrl) {
      overlay?.setProgress({ phase: "transcript", current: 0, total: 1, message: t("status.checkingLibrary") });
      let remote: RemoteDub | ManagedSharedDub | null;
      try {
        remote =
          settings.billingMode === "managed"
            ? await managedLookupDub({
                baseUrl: settings.managedBaseUrl,
                platform: context.platform,
                videoId: context.videoId,
                targetLang,
                voiceProfileId: settings.managedVoiceProfileId
              })
            : await lookupDub(settings.shareServerUrl, {
                platform: context.platform,
                videoId: context.videoId,
                targetLang,
                voice: settings.voice,
                provider: settings.ttsProvider
              });
      } catch (err) {
        overlay?.setError(
          t("status.lookupFailed", { reason: err instanceof Error ? err.message : String(err) })
        );
        // Nothing was started, so drop the session; that also lifts the hold on the video.
        cleanupSession();
        return;
      }
      if (remote && remote.segments.length > 0) {
        fromRemote = true;
        await session.startRemote(remoteToDub(remote));
        overlay?.setVisibility(remote.visibility);
        overlay?.setShareStatus(t("status.playingShared"));
        const eventsBaseUrl = settings.billingMode === "managed" ? settings.managedBaseUrl : settings.shareServerUrl;
        void reportPlaybackStarted({
          baseUrl: eventsBaseUrl,
          platform: context.platform,
          videoId: context.videoId,
          channelId: context.channelId,
          channelName: context.channelName
        }).catch(() => undefined);
        return;
      }
    }

    fromRemote = false;
    await session.startGenerated(platform, trackId || undefined);
  } catch (err) {
    handleExportError(settings, err);
    cleanupSession();
  }
}

async function runShare(visibility: "public" | "private", settings: Settings, rightsAssertion: boolean): Promise<void> {
  if (!session) return;
  try {
    const result = await performShare({
      visibility,
      billingMode: settings.billingMode,
      rightsAssertion,
      voiceProfileId: settings.managedVoiceProfileId,
      completeAll: () => session!.completeAll((p) => overlay?.setProgress(p)),
      upload: async (dub, meta) => {
        dub.visibility = visibility;
        overlay?.setShareStatus(t("status.uploading"));
        return uploadDub(settings.shareServerUrl, dub, meta);
      }
    });
    uploadedDubId = result.id;
    await saveOwnerToken(result.id, result.ownerToken);
    overlay?.setShareStatus(t("status.shared", { visibility: visibilityLabel(result.visibility) }));
  } catch (err) {
    handleExportError(settings, err);
  }
}

async function shareCurrent(visibility: "public" | "private", settings: Settings): Promise<void> {
  if (!session) return;
  if (!settings.shareServerUrl) {
    overlay?.setError(t("status.needShareServer"));
    return;
  }
  if (fromRemote) {
    overlay?.setShareStatus(t("status.alreadyShared"));
    return;
  }

  if (uploadedDubId) {
    const token = await getOwnerToken(uploadedDubId);
    if (token) {
      overlay?.setShareStatus(t("status.updatingVisibility"));
      try {
        await setVisibility(settings.shareServerUrl, uploadedDubId, visibility, token);
        overlay?.setShareStatus(t("status.visibilitySet", { visibility: visibilityLabel(visibility) }));
      } catch (err) {
        overlay?.setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
  }

  if (visibility === "public" && settings.billingMode === "managed") {
    const estimateMs = session.estimateExportSourceMs();
    let remainingMs: number | null = null;
    try {
      const account = await managedAccount(settings.managedBaseUrl);
      remainingMs = account.remainingSourceMs;
    } catch {
      remainingMs = null;
    }
    overlay?.showShareConfirmation(
      { estimateMs, remainingMs },
      {
        onConfirm: () => {
          overlay?.hideShareConfirmation();
          void runShare("public", settings, true);
        },
        onCancel: () => overlay?.hideShareConfirmation()
      }
    );
    return;
  }

  await runShare(visibility, settings, false);
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
  await refreshCaptionTracks();
}

async function init(): Promise<void> {
  if (!platform) return;
  const settings = await getSettings();
  overlay = new EvoOverlay({
    onDub,
    onTrackChange: (trackId) => void onTrackChange(trackId),
    onTogglePlay,
    onRedub,
    onShare,
    onOpenSettings: openOptionsPage
  });
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
