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
  buildTakedownUrl,
  createTakedownHandlers,
  createTakedownRestoreHandlers,
  parseAdminConfig,
  parseTakedownConfig,
  signTakedownToken,
  verifyTakedownToken
} from "../src/lib/outreach.ts";
import type { TakedownStore } from "../src/lib/outreach.ts";

const ISSUER = DEFAULT_SUPABASE_ISSUER;
const AUDIENCE = DEFAULT_SUPABASE_AUDIENCE;
const KEY_ID = "test-signing-key";
const ADMIN_EMAIL = "owner@example.com";
const SECRET = "takedown-secret";
const T0 = new Date(Date.UTC(2026, 6, 26, 12));

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "ES256" };
const testJwks = createLocalJWKSet({ keys: [publicJwk] });

async function signAdminToken(email: string) {
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

interface FakeDub {
  id: string;
  platform: string;
  videoId: string;
  visibility: string;
}

interface AuditRow {
  id: string;
  platform: string;
  videoId: string;
  dubId: string;
  previousVisibility: string;
  idempotencyKey: string;
  status: string;
}

class InMemoryTakedownStore implements TakedownStore {
  dubs: FakeDub[];
  audits: AuditRow[] = [];
  private auditSeq = 0;

  constructor(dubs: FakeDub[]) {
    this.dubs = dubs;
  }

  async unpublishDubs(platform: string, videoId: string) {
    const targets = this.dubs.filter((d) => d.platform === platform && d.videoId === videoId && d.visibility === "public");
    for (const dub of targets) dub.visibility = "unpublished";
    return targets.map((d) => ({ id: d.id, previousVisibility: "public" }));
  }

  async insertAudit(rows: Omit<AuditRow, "id">[]) {
    for (const row of rows) {
      if (this.audits.some((a) => a.idempotencyKey === row.idempotencyKey)) continue;
      this.audits.push({ ...row, id: `audit-${++this.auditSeq}` });
    }
  }

  async appliedAudits(platform: string, videoId: string) {
    return this.audits
      .filter((a) => a.platform === platform && a.videoId === videoId && a.status === "applied")
      .map((a) => ({ id: a.id, dubId: a.dubId, previousVisibility: a.previousVisibility }));
  }

  async restoreDub(dubId: string, visibility: string) {
    const dub = this.dubs.find((d) => d.id === dubId);
    if (dub) dub.visibility = visibility;
  }

  async markAuditRestored(id: string) {
    const audit = this.audits.find((a) => a.id === id);
    if (audit) audit.status = "restored";
  }
}

const DUBS: FakeDub[] = [
  { id: "dub-1", platform: "youtube", videoId: "vid-1", visibility: "public" },
  { id: "dub-2", platform: "youtube", videoId: "vid-1", visibility: "public" },
  { id: "dub-3", platform: "youtube", videoId: "vid-2", visibility: "public" },
  { id: "dub-4", platform: "youtube", videoId: "vid-1", visibility: "private" }
];

function takedownHarness(dubs: FakeDub[] = DUBS.map((d) => ({ ...d }))) {
  const store = new InMemoryTakedownStore(dubs);
  const handlers = createTakedownHandlers({
    takedown: parseTakedownConfig({ TAKEDOWN_TOKEN_SECRET: SECRET, OUTREACH_BASE_URL: "https://dub.example.com" }),
    store,
    now: () => T0
  });
  return { store, handlers };
}

function takedownRequest(token: string): Request {
  return new Request(buildTakedownUrl("https://dub.example.com", token));
}

test("expired takedown token fails and unpublishes nothing", async () => {
  const { store, handlers } = takedownHarness();
  const expired = signTakedownToken(SECRET, { platform: "youtube", videoId: "vid-1" }, new Date(T0.getTime() - 1000));
  const res = await handlers.apply(takedownRequest(expired));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "token_expired");
  assert.equal(store.dubs.filter((d) => d.visibility === "unpublished").length, 0);
  assert.equal(store.audits.length, 0);
});

test("tampered takedown token fails", async () => {
  const { handlers } = takedownHarness();
  const valid = signTakedownToken(SECRET, { platform: "youtube", videoId: "vid-1" }, new Date(T0.getTime() + 3600_000));
  const tampered = `${valid.slice(0, -2)}xx`;
  const res = await handlers.apply(takedownRequest(tampered));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "invalid_token");
});

test("valid token unpublishes every public dub of the correct video only and writes audit rows", async () => {
  const { store, handlers } = takedownHarness();
  const token = signTakedownToken(SECRET, { platform: "youtube", videoId: "vid-1" }, new Date(T0.getTime() + 3600_000));
  const res = await handlers.apply(takedownRequest(token));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { unpublished: number };
  assert.equal(body.unpublished, 2);

  const byId = new Map(store.dubs.map((d) => [d.id, d.visibility]));
  assert.equal(byId.get("dub-1"), "unpublished");
  assert.equal(byId.get("dub-2"), "unpublished");
  assert.equal(byId.get("dub-3"), "public", "other videos must stay published");
  assert.equal(byId.get("dub-4"), "private", "private dubs are untouched");

  assert.equal(store.audits.length, 2);
  assert.deepEqual(
    store.audits.map((a) => a.idempotencyKey).sort(),
    ["takedown:youtube:vid-1:dub-1", "takedown:youtube:vid-1:dub-2"]
  );
  assert.ok(store.audits.every((a) => a.status === "applied" && a.previousVisibility === "public"));

  const replay = await handlers.apply(takedownRequest(token));
  const replayBody = (await replay.json()) as { unpublished: number };
  assert.equal(replayBody.unpublished, 0);
  assert.equal(store.audits.length, 2, "replaying the same link must not duplicate audit rows");
});

test("manual restore is admin-only, audited, and brings the video's dubs back", async () => {
  const { store, handlers } = takedownHarness();
  const token = signTakedownToken(SECRET, { platform: "youtube", videoId: "vid-1" }, new Date(T0.getTime() + 3600_000));
  await handlers.apply(takedownRequest(token));

  const restore = createTakedownRestoreHandlers({
    authenticator: new SupabaseAuthenticator(
      parseAuthConfig({ SUPABASE_ISSUER: ISSUER, SUPABASE_AUDIENCE: AUDIENCE }),
      testJwks
    ),
    admin: parseAdminConfig({ ADMIN_EMAIL_ALLOWLIST: ADMIN_EMAIL }),
    store
  });

  const outsider = await restore.restore(
    new Request("https://server.test/api/v1/admin/takedown/restore", {
      method: "POST",
      headers: { authorization: `Bearer ${await signAdminToken("fan@example.com")}`, "content-type": "application/json" },
      body: JSON.stringify({ platform: "youtube", videoId: "vid-1" })
    })
  );
  assert.equal(outsider.status, 403);

  const res = await restore.restore(
    new Request("https://server.test/api/v1/admin/takedown/restore", {
      method: "POST",
      headers: { authorization: `Bearer ${await signAdminToken(ADMIN_EMAIL)}`, "content-type": "application/json" },
      body: JSON.stringify({ platform: "youtube", videoId: "vid-1" })
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { restored: number };
  assert.equal(body.restored, 2);

  const byId = new Map(store.dubs.map((d) => [d.id, d.visibility]));
  assert.equal(byId.get("dub-1"), "public");
  assert.equal(byId.get("dub-2"), "public");
  assert.equal(byId.get("dub-3"), "public");
  assert.ok(store.audits.every((a) => a.status === "restored"));
});

test("verifyTakedownToken round-trips and rejects wrong secrets", () => {
  const token = signTakedownToken(SECRET, { platform: "youtube", videoId: "vid-9" }, new Date(T0.getTime() + 60_000));
  const ok = verifyTakedownToken(SECRET, token, T0);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.payload.videoId, "vid-9");
  assert.equal(verifyTakedownToken("other-secret", token, T0).ok, false);
  assert.equal(verifyTakedownToken(SECRET, "garbage", T0).ok, false);
});
