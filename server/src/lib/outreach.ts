import { createHmac, timingSafeEqual } from "node:crypto";
import { V1_ERROR_CODES, v1Error, v1Json } from "./api-error.ts";
import { bearerToken } from "./auth.ts";
import type { SupabaseAuthenticator } from "./auth.ts";

export interface AdminConfig {
  adminEmails: string[];
}

export function parseAdminConfig(env: Record<string, string | undefined>): AdminConfig {
  return {
    adminEmails: (env.ADMIN_EMAIL_ALLOWLIST ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  };
}

export function adminConfig(): AdminConfig {
  return parseAdminConfig(process.env);
}

export interface MailgunConfig {
  apiKey: string;
  domain: string;
  from: string;
}

export function parseMailgunConfig(env: Record<string, string | undefined>): MailgunConfig {
  return {
    apiKey: env.MAILGUN_API_KEY ?? "",
    domain: env.MAILGUN_DOMAIN ?? "",
    from: env.MAILGUN_FROM ?? ""
  };
}

export function mailgunConfig(): MailgunConfig {
  return parseMailgunConfig(process.env);
}

export interface TakedownConfig {
  secret: string;
  baseUrl: string;
  tokenTtlMs: number;
}

export function parseTakedownConfig(env: Record<string, string | undefined>): TakedownConfig {
  return {
    secret: env.TAKEDOWN_TOKEN_SECRET ?? "",
    baseUrl: (env.OUTREACH_BASE_URL ?? "").replace(/\/+$/, ""),
    tokenTtlMs: Number(env.TAKEDOWN_TOKEN_TTL_HOURS ?? 24 * 30) * 3_600_000
  };
}

export function takedownConfig(): TakedownConfig {
  return parseTakedownConfig(process.env);
}

export type AdminCheckResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; code: string; message: string };

export async function requireAdmin(
  request: Request,
  authenticator: SupabaseAuthenticator,
  config: AdminConfig
): Promise<AdminCheckResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, status: 401, code: V1_ERROR_CODES.missingToken, message: "missing bearer token" };
  }
  const identity = await authenticator.verifyIdentity(token);
  if (!identity.ok) {
    return { ok: false, status: 401, code: identity.code, message: identity.message };
  }
  if (!identity.email || !config.adminEmails.includes(identity.email)) {
    return { ok: false, status: 403, code: "not_admin", message: "admin allowlist required" };
  }
  return { ok: true, userId: identity.userId, email: identity.email };
}

export interface TakedownTokenPayload {
  platform: string;
  videoId: string;
  exp: number;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function tokenSignature(secret: string, payloadB64: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function signTakedownToken(
  secret: string,
  claims: { platform: string; videoId: string },
  expiresAt: Date
): string {
  const payloadB64 = base64url(
    JSON.stringify({ platform: claims.platform, videoId: claims.videoId, exp: expiresAt.getTime() })
  );
  return `${payloadB64}.${tokenSignature(secret, payloadB64)}`;
}

export type TakedownTokenCheck =
  | { ok: true; payload: TakedownTokenPayload }
  | { ok: false; reason: "invalid" | "expired" };

export function verifyTakedownToken(secret: string, token: string, now: Date = new Date()): TakedownTokenCheck {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = tokenSignature(secret, payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" };
  }
  let payload: TakedownTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as TakedownTokenPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!payload || typeof payload.platform !== "string" || typeof payload.videoId !== "string" || !payload.exp) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.exp <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export function buildTakedownUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/v1/takedown?token=${encodeURIComponent(token)}`;
}

export interface OutreachEmailContent {
  subject: string;
  text: string;
}

export function buildOutreachEmail(input: {
  channelName: string;
  videoId: string;
  takedownUrl: string;
}): OutreachEmailContent {
  const videoUrl = `https://www.youtube.com/watch?v=${input.videoId}`;
  return {
    subject: "AI dubbing notice for your YouTube video",
    text: [
      `Hello ${input.channelName || "creator"},`,
      "",
      "This is a factual notice from the evo-dubbing project.",
      `Your video ${videoUrl} is still fully available and playing on YouTube as usual. Nothing about your video or channel has changed.`,
      "Some viewers watch it with an AI-generated dub provided by the open-source evo-dubbing browser extension. The dub plays only on the viewer's own device; it is not uploaded anywhere and does not modify your video.",
      "",
      "If you would prefer that evo-dubbing stops serving dubs of this video, open the signed link below. It immediately un-publishes every dub of this video from our shared library:",
      input.takedownUrl,
      "",
      "If you are fine with it, you can simply ignore this email.",
      "",
      "evo-dubbing"
    ].join("\n")
  };
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}

export type MailgunFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function createMailgunMailer(config: MailgunConfig, fetchImpl?: MailgunFetch): Mailer {
  const doFetch: MailgunFetch =
    fetchImpl ??
    (async (url, init) => {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, json: () => res.json() };
    });
  return {
    async send(message) {
      if (!config.apiKey || !config.domain || !config.from) {
        throw new Error("mailgun is not configured");
      }
      const body = new URLSearchParams({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text
      }).toString();
      const res = await doFetch(`https://api.mailgun.net/v3/${config.domain}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
      if (!res.ok) {
        throw new Error(`mailgun send failed with status ${res.status}`);
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: data.id ?? "" };
    }
  };
}

export interface OutreachRecord {
  id: string;
  platform: string;
  handle: string;
  channelUrl: string;
  channelId: string;
  videoId: string;
  creatorEmail: string;
  status: string;
}

export interface OutreachStore {
  listPending(): Promise<OutreachRecord[]>;
  findById(id: string): Promise<OutreachRecord | null>;
  setCreatorEmail(id: string, email: string): Promise<void>;
  markSent(id: string, at: Date): Promise<void>;
}

export const OUTREACH_ERROR_CODES = {
  notAdmin: "not_admin",
  notFound: "not_found",
  unknownAction: "unknown_action",
  mailUnavailable: "mail_unavailable"
} as const;

export interface AdminOutreachDeps {
  authenticator: SupabaseAuthenticator;
  admin: AdminConfig;
  store: OutreachStore;
  mailer: Mailer | null;
  takedown: TakedownConfig;
  now?: () => Date;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authFailure(check: { status: number; code: string; message: string }): Response {
  return v1Error(check.code, check.message, check.status);
}

export function createAdminOutreachHandlers(deps: AdminOutreachDeps) {
  async function guard(request: Request): Promise<AdminCheckResult> {
    return requireAdmin(request, deps.authenticator, deps.admin);
  }

  function takedownUrlFor(record: OutreachRecord): string {
    const now = deps.now ? deps.now() : new Date();
    const token = signTakedownToken(
      deps.takedown.secret,
      { platform: record.platform, videoId: record.videoId },
      new Date(now.getTime() + deps.takedown.tokenTtlMs)
    );
    return buildTakedownUrl(deps.takedown.baseUrl, token);
  }

  function previewFor(record: OutreachRecord): OutreachEmailContent {
    return buildOutreachEmail({
      channelName: record.handle,
      videoId: record.videoId,
      takedownUrl: takedownUrlFor(record)
    });
  }

  async function list(request: Request): Promise<Response> {
    const check = await guard(request);
    if (!check.ok) return authFailure(check);
    const rows = await deps.store.listPending();
    return v1Json({
      items: rows.map((row) => ({
        id: row.id,
        platform: row.platform,
        handle: row.handle,
        channelUrl: row.channelUrl,
        channelId: row.channelId,
        videoId: row.videoId,
        creatorEmail: row.creatorEmail,
        status: row.status,
        businessInquiryUrl: row.channelId
          ? `https://www.youtube.com/channel/${row.channelId}/about`
          : row.channelUrl
      }))
    });
  }

  async function action(request: Request, id: string): Promise<Response> {
    const check = await guard(request);
    if (!check.ok) return authFailure(check);
    const record = await deps.store.findById(id);
    if (!record) {
      return v1Error(OUTREACH_ERROR_CODES.notFound, "outreach row not found", 404);
    }
    const body = (await request.json().catch(() => ({}))) as { action?: string; email?: string };

    if (body.action === "preview") {
      return v1Json(previewFor(record));
    }

    if (body.action === "setEmail") {
      const email = (body.email ?? "").trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        return v1Error(V1_ERROR_CODES.invalidPayload, "invalid creator email", 400);
      }
      await deps.store.setCreatorEmail(record.id, email);
      return v1Json({ id: record.id, creatorEmail: email });
    }

    if (body.action === "send") {
      if (!EMAIL_PATTERN.test(record.creatorEmail)) {
        return v1Error(V1_ERROR_CODES.invalidPayload, "set the publicly listed creator email first", 409);
      }
      if (!deps.mailer) {
        return v1Error(OUTREACH_ERROR_CODES.mailUnavailable, "mailgun is not configured", 503);
      }
      const content = previewFor(record);
      await deps.mailer.send({ to: record.creatorEmail, subject: content.subject, text: content.text });
      const now = deps.now ? deps.now() : new Date();
      await deps.store.markSent(record.id, now);
      return v1Json({ id: record.id, status: "sent", lastContactedAt: now.toISOString() });
    }

    return v1Error(OUTREACH_ERROR_CODES.unknownAction, "action must be preview, setEmail or send", 400);
  }

  return { list, action };
}

export interface TakedownStore {
  unpublishDubs(platform: string, videoId: string): Promise<{ id: string; previousVisibility: string }[]>;
  insertAudit(rows: {
    platform: string;
    videoId: string;
    dubId: string;
    previousVisibility: string;
    idempotencyKey: string;
    reporterEmail: string;
    reason: string;
    status: string;
  }[]): Promise<void>;
  appliedAudits(platform: string, videoId: string): Promise<{ id: string; dubId: string; previousVisibility: string }[]>;
  restoreDub(dubId: string, visibility: string): Promise<void>;
  markAuditRestored(id: string): Promise<void>;
}

export interface TakedownDeps {
  takedown: TakedownConfig;
  store: TakedownStore;
  reporterEmail?: string;
  now?: () => Date;
}

export function createTakedownHandlers(deps: TakedownDeps) {
  async function apply(request: Request): Promise<Response> {
    if (!deps.takedown.secret) {
      return v1Error(V1_ERROR_CODES.internal, "takedown is not configured", 503);
    }
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const now = deps.now ? deps.now() : new Date();
    const check = verifyTakedownToken(deps.takedown.secret, token, now);
    if (!check.ok) {
      if (check.reason === "expired") {
        return v1Error(V1_ERROR_CODES.tokenExpired, "takedown link expired", 401);
      }
      return v1Error(V1_ERROR_CODES.invalidToken, "invalid takedown link", 401);
    }
    const { platform, videoId } = check.payload;
    const unpublished = await deps.store.unpublishDubs(platform, videoId);
    if (unpublished.length > 0) {
      await deps.store.insertAudit(
        unpublished.map((dub) => ({
          platform,
          videoId,
          dubId: dub.id,
          previousVisibility: dub.previousVisibility,
          idempotencyKey: `takedown:${platform}:${videoId}:${dub.id}`,
          reporterEmail: deps.reporterEmail ?? "",
          reason: "creator takedown via signed outreach link",
          status: "applied"
        }))
      );
    }
    return v1Json({ platform, videoId, unpublished: unpublished.length });
  }

  return { apply };
}

export interface TakedownRestoreDeps {
  authenticator: SupabaseAuthenticator;
  admin: AdminConfig;
  store: TakedownStore;
}

export function createTakedownRestoreHandlers(deps: TakedownRestoreDeps) {
  async function restore(request: Request): Promise<Response> {
    const check = await requireAdmin(request, deps.authenticator, deps.admin);
    if (!check.ok) return authFailure(check);
    const body = (await request.json().catch(() => ({}))) as { platform?: string; videoId?: string };
    if (!body.platform || !body.videoId) {
      return v1Error(V1_ERROR_CODES.invalidPayload, "platform and videoId are required", 400);
    }
    const audits = await deps.store.appliedAudits(body.platform, body.videoId);
    for (const audit of audits) {
      await deps.store.restoreDub(audit.dubId, audit.previousVisibility || "public");
      await deps.store.markAuditRestored(audit.id);
    }
    return v1Json({ platform: body.platform, videoId: body.videoId, restored: audits.length });
  }

  return { restore };
}
