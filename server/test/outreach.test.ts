import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import {
  DEFAULT_SUPABASE_AUDIENCE,
  DEFAULT_SUPABASE_ISSUER,
  SupabaseAuthenticator,
  parseAuthConfig
} from "../src/lib/auth.ts";
import {
  buildOutreachEmail,
  buildTakedownUrl,
  createAdminOutreachHandlers,
  createMailgunMailer,
  parseAdminConfig,
  parseMailgunConfig,
  parseTakedownConfig,
  signTakedownToken,
  verifyTakedownToken
} from "../src/lib/outreach.ts";
import type { MailMessage, Mailer, OutreachRecord, OutreachStore } from "../src/lib/outreach.ts";

const ISSUER = DEFAULT_SUPABASE_ISSUER;
const AUDIENCE = DEFAULT_SUPABASE_AUDIENCE;
const KEY_ID = "test-signing-key";
const ADMIN_EMAIL = "owner@example.com";
const T0 = new Date(Date.UTC(2026, 6, 26, 12));
const TAKEDOWN = parseTakedownConfig({
  TAKEDOWN_TOKEN_SECRET: "takedown-secret",
  OUTREACH_BASE_URL: "https://dub.example.com"
});

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "ES256" };
const testJwks = createLocalJWKSet({ keys: [publicJwk] });

async function signToken(email: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setSubject("0b7f3a2e-6c4d-4f1e-9a2b-1c2d3e4f5a6b")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + 600)
    .sign(privateKey);
}

class InMemoryOutreachStore implements OutreachStore {
  rows: OutreachRecord[];
  sentLog: { id: string; at: Date }[] = [];

  constructor(rows: OutreachRecord[]) {
    this.rows = rows;
  }

  async listPending() {
    return this.rows.filter((r) => r.status === "pending");
  }

  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async setCreatorEmail(id: string, email: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.creatorEmail = email;
  }

  async markSent(id: string, at: Date) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = "sent";
    this.sentLog.push({ id, at });
  }
}

class RecordingMailer implements Mailer {
  messages: MailMessage[] = [];
  async send(message: MailMessage) {
    this.messages.push(message);
    return { id: "mail-1" };
  }
}

function outreachRow(overrides: Partial<OutreachRecord> = {}): OutreachRecord {
  return {
    id: "out-1",
    platform: "youtube",
    handle: "Demo Channel",
    channelUrl: "https://www.youtube.com/channel/UC123",
    channelId: "UC123",
    videoId: "vid-1",
    creatorEmail: "",
    status: "pending",
    ...overrides
  };
}

function harness(rows: OutreachRecord[], mailer: Mailer | null = new RecordingMailer()) {
  const store = new InMemoryOutreachStore(rows);
  const handlers = createAdminOutreachHandlers({
    authenticator: new SupabaseAuthenticator(
      parseAuthConfig({ SUPABASE_ISSUER: ISSUER, SUPABASE_AUDIENCE: AUDIENCE }),
      testJwks
    ),
    admin: parseAdminConfig({ ADMIN_EMAIL_ALLOWLIST: ADMIN_EMAIL }),
    store,
    mailer,
    takedown: TAKEDOWN,
    now: () => T0
  });
  return { store, handlers, mailer };
}

function adminRequest(url: string, token?: string, body?: Record<string, unknown>): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body) headers.set("content-type", "application/json");
  return new Request(url, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
}

test("non-admin cannot list outreach or view creator emails", async () => {
  const { handlers } = harness([outreachRow({ creatorEmail: "creator@example.com" })]);
  const outsider = await handlers.list(adminRequest("https://server.test/api/v1/admin/outreach", await signToken("fan@example.com")));
  assert.equal(outsider.status, 403);
  const anonymous = await handlers.list(adminRequest("https://server.test/api/v1/admin/outreach"));
  assert.equal(anonymous.status, 401);
  const admin = await handlers.list(adminRequest("https://server.test/api/v1/admin/outreach", await signToken(ADMIN_EMAIL)));
  assert.equal(admin.status, 200);
  const data = (await admin.json()) as { items: { creatorEmail: string; businessInquiryUrl: string }[] };
  assert.equal(data.items[0].creatorEmail, "creator@example.com");
  assert.equal(data.items[0].businessInquiryUrl, "https://www.youtube.com/channel/UC123/about");
});

test("non-admin cannot preview the email template either", async () => {
  const { handlers } = harness([outreachRow()]);
  const res = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", await signToken("fan@example.com"), { action: "preview" }),
    "out-1"
  );
  assert.equal(res.status, 403);
});

test("operator sets the publicly listed email manually; no scraping path exists", async () => {
  const { store, handlers } = harness([outreachRow()]);
  const token = await signToken(ADMIN_EMAIL);
  const bad = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", token, { action: "setEmail", email: "not-an-email" }),
    "out-1"
  );
  assert.equal(bad.status, 400);
  const ok = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", token, { action: "setEmail", email: "Creator@Example.com" }),
    "out-1"
  );
  assert.equal(ok.status, 200);
  assert.equal(store.rows[0].creatorEmail, "creator@example.com");
});

test("preview contains a factual notice that the video still plays on YouTube plus a signed takedown URL", async () => {
  const { handlers } = harness([outreachRow({ creatorEmail: "creator@example.com" })]);
  const res = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", await signToken(ADMIN_EMAIL), { action: "preview" }),
    "out-1"
  );
  assert.equal(res.status, 200);
  const preview = (await res.json()) as { subject: string; text: string };
  assert.match(preview.text, /still fully available and playing on YouTube/);
  assert.match(preview.text, /https:\/\/www\.youtube\.com\/watch\?v=vid-1/);
  const urlMatch = preview.text.match(/https:\/\/dub\.example\.com\/api\/v1\/takedown\?token=(\S+)/);
  assert.ok(urlMatch, "template must carry the signed takedown URL");
  const token = decodeURIComponent(urlMatch[1]);
  const check = verifyTakedownToken("takedown-secret", token, T0);
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.payload.platform, "youtube");
    assert.equal(check.payload.videoId, "vid-1");
  }
});

test("send requires a stored email, then goes through Mailgun once and marks the row sent", async () => {
  const recording = new RecordingMailer();
  const { store, handlers } = harness([outreachRow()], recording);
  const token = await signToken(ADMIN_EMAIL);
  const early = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", token, { action: "send" }),
    "out-1"
  );
  assert.equal(early.status, 409);
  assert.equal(recording.messages.length, 0);

  await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", token, { action: "setEmail", email: "creator@example.com" }),
    "out-1"
  );
  const sent = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", token, { action: "send" }),
    "out-1"
  );
  assert.equal(sent.status, 200);
  assert.equal(recording.messages.length, 1);
  assert.equal(recording.messages[0].to, "creator@example.com");
  assert.match(recording.messages[0].text, /takedown\?token=/);
  assert.equal(store.rows[0].status, "sent");
  assert.equal(store.sentLog[0].at.toISOString(), T0.toISOString());
});

test("send reports 503 when Mailgun is not configured", async () => {
  const { handlers } = harness([outreachRow({ creatorEmail: "creator@example.com" })], null);
  const res = await handlers.action(
    adminRequest("https://server.test/api/v1/admin/outreach/out-1", await signToken(ADMIN_EMAIL), { action: "send" }),
    "out-1"
  );
  assert.equal(res.status, 503);
});

test("mailgun mailer posts form-encoded basic-auth request to the domain messages endpoint", async () => {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const mailer = createMailgunMailer(
    parseMailgunConfig({ MAILGUN_API_KEY: "key-123", MAILGUN_DOMAIN: "mg.example.com", MAILGUN_FROM: "Evo <hi@mg.example.com>" }),
    async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: "<msg-1@mg.example.com>" }) };
    }
  );
  const result = await mailer.send({ to: "creator@example.com", subject: "subject", text: "line1\nline2" });
  assert.equal(result.id, "<msg-1@mg.example.com>");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mailgun.net/v3/mg.example.com/messages");
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from("api:key-123").toString("base64")}`);
  const params = new URLSearchParams(calls[0].init.body);
  assert.equal(params.get("from"), "Evo <hi@mg.example.com>");
  assert.equal(params.get("to"), "creator@example.com");
  assert.equal(params.get("text"), "line1\nline2");
});

test("outreach email copy stays factual and never claims the video was re-uploaded", () => {
  const token = signTakedownToken("s", { platform: "youtube", videoId: "v" }, new Date(T0.getTime() + 3600_000));
  const content = buildOutreachEmail({
    channelName: "Demo Channel",
    videoId: "v",
    takedownUrl: buildTakedownUrl("https://dub.example.com", token)
  });
  assert.match(content.text, /still fully available and playing on YouTube/);
  assert.doesNotMatch(content.text, /re-?upload/i);
  assert.match(content.text, /un-publishes every dub of this video/);
});
