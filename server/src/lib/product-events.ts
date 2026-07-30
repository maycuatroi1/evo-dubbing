import { createHmac } from "node:crypto";
import { V1_ERROR_CODES, v1Error, v1Json } from "./api-error.ts";

export const PLAYBACK_OUTREACH_THRESHOLD = 1000;

export interface ProductEventConfig {
  hmacSecret: string;
}

export function parseProductEventConfig(env: Record<string, string | undefined>): ProductEventConfig {
  return { hmacSecret: env.PRODUCT_EVENT_HMAC_SECRET ?? "" };
}

export function productEventConfig(): ProductEventConfig {
  return parseProductEventConfig(process.env);
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function dailyInstallKey(secret: string, day: string): string {
  return createHmac("sha256", secret).update(`evo-playback-day:${day}`).digest("hex");
}

export function hashInstallId(secret: string, day: string, installId: string): string {
  return createHmac("sha256", dailyInstallKey(secret, day)).update(installId).digest("hex");
}

export interface PlaybackEventInput {
  platform?: string;
  videoId?: string;
  installId?: string;
  channelId?: string;
  channelName?: string;
}

const INSTALL_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_@-]{0,64}$/;

export function validatePlaybackEvent(body: PlaybackEventInput): { ok: true } | { ok: false; message: string } {
  if (!body.platform || typeof body.platform !== "string" || !VIDEO_ID_PATTERN.test(body.platform)) {
    return { ok: false, message: "invalid platform" };
  }
  if (!body.videoId || typeof body.videoId !== "string" || !VIDEO_ID_PATTERN.test(body.videoId)) {
    return { ok: false, message: "invalid videoId" };
  }
  if (!body.installId || typeof body.installId !== "string" || !INSTALL_ID_PATTERN.test(body.installId)) {
    return { ok: false, message: "invalid installId" };
  }
  if (body.channelId !== undefined && (typeof body.channelId !== "string" || !CHANNEL_ID_PATTERN.test(body.channelId))) {
    return { ok: false, message: "invalid channelId" };
  }
  if (body.channelName !== undefined && (typeof body.channelName !== "string" || body.channelName.length > 200)) {
    return { ok: false, message: "invalid channelName" };
  }
  return { ok: true };
}

export interface PlaybackEventStore {
  tryInsertDedupe(row: { platform: string; videoId: string; day: string; installHash: string }): Promise<boolean>;
  incrementDaily(platform: string, videoId: string, day: string): Promise<void>;
  totalStarts(platform: string, videoId: string): Promise<number>;
  findOutreach(platform: string, videoId: string): Promise<{ id: string } | null>;
  insertOutreach(row: {
    platform: string;
    videoId: string;
    handle: string;
    channelId: string;
    channelUrl: string;
    status: string;
  }): Promise<void>;
}

export interface PlaybackEventResult {
  counted: boolean;
  totalStarts: number;
  outreachQueued: boolean;
}

export async function recordPlaybackStarted(
  store: PlaybackEventStore,
  secret: string,
  event: Required<Pick<PlaybackEventInput, "platform" | "videoId" | "installId">> &
    Pick<PlaybackEventInput, "channelId" | "channelName">,
  now: Date = new Date()
): Promise<PlaybackEventResult> {
  const day = utcDay(now);
  const installHash = hashInstallId(secret, day, event.installId);
  const fresh = await store.tryInsertDedupe({
    platform: event.platform,
    videoId: event.videoId,
    day,
    installHash
  });
  if (!fresh) {
    return { counted: false, totalStarts: await store.totalStarts(event.platform, event.videoId), outreachQueued: false };
  }
  await store.incrementDaily(event.platform, event.videoId, day);
  const total = await store.totalStarts(event.platform, event.videoId);
  if (total < PLAYBACK_OUTREACH_THRESHOLD) {
    return { counted: true, totalStarts: total, outreachQueued: false };
  }
  const existing = await store.findOutreach(event.platform, event.videoId);
  if (existing) {
    return { counted: true, totalStarts: total, outreachQueued: false };
  }
  const channelId = event.channelId ?? "";
  await store.insertOutreach({
    platform: event.platform,
    videoId: event.videoId,
    handle: event.channelName?.trim() || event.videoId,
    channelId,
    channelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : "",
    status: "pending"
  });
  return { counted: true, totalStarts: total, outreachQueued: true };
}

export interface PlaybackEventDeps {
  store: PlaybackEventStore;
  config: ProductEventConfig;
  now?: () => Date;
}

export function createPlaybackEventHandlers(deps: PlaybackEventDeps) {
  async function report(request: Request): Promise<Response> {
    if (!deps.config.hmacSecret) {
      return v1Error(V1_ERROR_CODES.internal, "playback events are not configured", 503);
    }
    const body = (await request.json().catch(() => null)) as PlaybackEventInput | null;
    if (!body || typeof body !== "object") {
      return v1Error(V1_ERROR_CODES.invalidPayload, "invalid JSON body", 400);
    }
    const valid = validatePlaybackEvent(body);
    if (!valid.ok) {
      return v1Error(V1_ERROR_CODES.invalidPayload, valid.message, 400);
    }
    const result = await recordPlaybackStarted(
      deps.store,
      deps.config.hmacSecret,
      {
        platform: body.platform!,
        videoId: body.videoId!,
        installId: body.installId!,
        channelId: body.channelId,
        channelName: body.channelName
      },
      deps.now ? deps.now() : new Date()
    );
    return v1Json(result);
  }

  return { report };
}
