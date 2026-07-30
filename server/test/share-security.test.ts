import test from "node:test";
import assert from "node:assert/strict";
import {
  shareConfig,
  parseShareConfig,
  newOwnerToken,
  hashToken,
  validateInit,
  decideInit,
  pendingCutoff,
  authorizeGet,
  verifyUploadsComplete,
  RateLimiter
} from "../src/lib/shareSecurity.ts";

function oldExtensionInitBody() {
  const voiced = [
    { idx: 0, startMs: 0, endMs: 1200, originalText: "hello", text: "xin chao", mime: "audio/mpeg" },
    { idx: 1, startMs: 1200, endMs: 2600, originalText: "world", text: "the gioi", mime: "audio/mpeg" }
  ];
  return {
    platform: "youtube",
    videoId: "abc123",
    sourceLang: "en",
    targetLang: "vi",
    voice: "alloy",
    provider: "openai",
    title: "Demo",
    durationMs: 2600,
    visibility: "public",
    segments: voiced
  };
}

test("old extension init payload shape is accepted unchanged", () => {
  const result = validateInit(oldExtensionInitBody(), 2000);
  assert.deepEqual(result, { ok: true });
});

test("init validation rejects over MAX_SEGMENTS with 413", () => {
  const body = oldExtensionInitBody();
  body.segments = Array.from({ length: 11 }, (_, i) => ({
    idx: i,
    startMs: i * 1000,
    endMs: i * 1000 + 500,
    text: "x",
    mime: "audio/mpeg"
  }));
  const result = validateInit(body, 10);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.match(result.message, /too many segments/);
  }
});

test("init validation rejects duplicate and invalid segment idx", () => {
  const body = oldExtensionInitBody();
  body.segments = [
    { idx: 0, startMs: 0, endMs: 1, text: "a", mime: "audio/mpeg" },
    { idx: 0, startMs: 1, endMs: 2, text: "b", mime: "audio/mpeg" }
  ];
  const dup = validateInit(body, 2000);
  assert.equal(dup.ok, false);
  body.segments = [{ idx: -1, startMs: 0, endMs: 1, text: "a", mime: "audio/mpeg" }];
  const neg = validateInit(body, 2000);
  assert.equal(neg.ok, false);
});

test("malicious overwrite: ready dub of another owner cannot be replaced via init", () => {
  const existing = {
    id: "dub-1",
    status: "ready",
    ownerTokenHash: hashToken("the-real-owner-token"),
    createdAt: new Date()
  };
  const noToken = decideInit(existing, undefined, new Date(), 86_400_000);
  assert.equal(noToken.action, "reject");
  if (noToken.action === "reject") assert.equal(noToken.status, 409);
  const wrongToken = decideInit(existing, "attacker-token", new Date(), 86_400_000);
  assert.equal(wrongToken.action, "reject");
});

test("owner can replace its own ready dub by presenting ownerToken", () => {
  const token = newOwnerToken();
  const existing = {
    id: "dub-1",
    status: "ready",
    ownerTokenHash: hashToken(token),
    createdAt: new Date()
  };
  const decision = decideInit(existing, token, new Date(), 86_400_000);
  assert.deepEqual(decision, { action: "replace", previousId: "dub-1" });
});

test("foreign pending dub blocks init until it expires", () => {
  const now = new Date();
  const pending = {
    id: "dub-2",
    status: "pending",
    ownerTokenHash: hashToken("someone-else"),
    createdAt: new Date(now.getTime() - 60_000)
  };
  const blocked = decideInit(pending, undefined, now, 86_400_000);
  assert.equal(blocked.action, "reject");
  if (blocked.action === "reject") assert.equal(blocked.status, 409);

  const expired = { ...pending, createdAt: new Date(now.getTime() - 86_400_001) };
  const reclaimed = decideInit(expired, undefined, now, 86_400_000);
  assert.deepEqual(reclaimed, { action: "replace", previousId: "dub-2" });
});

test("pendingCutoff marks expired pending dubs for cleanup", () => {
  const now = new Date("2026-07-26T00:00:00Z");
  const cutoff = pendingCutoff(now, 86_400_000);
  assert.equal(cutoff.toISOString(), "2026-07-25T00:00:00.000Z");
});

test("unauthenticated private GET is rejected, public GET is not", () => {
  const token = newOwnerToken();
  const priv = { visibility: "private", ownerTokenHash: hashToken(token) };
  const noToken = authorizeGet(priv, null);
  assert.equal(noToken.ok, false);
  if (!noToken.ok) assert.equal(noToken.status, 401);
  const wrong = authorizeGet(priv, "nope");
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.status, 403);
  assert.deepEqual(authorizeGet(priv, token), { ok: true });
  assert.deepEqual(authorizeGet({ visibility: "public", ownerTokenHash: "x" }, null), { ok: true });
});

test("complete rejects when an R2 object is missing", async () => {
  const segments = [
    { idx: 0, audioKey: "dubs/d/seg/0" },
    { idx: 1, audioKey: "dubs/d/seg/1" }
  ];
  const head = async (key: string) => (key.endsWith("/1") ? null : { size: 1000 });
  const result = await verifyUploadsComplete(segments, head, 5_242_880);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.message, /missing audio for 1 segment/);
  }
});

test("complete rejects oversized R2 object bytes with 413", async () => {
  const segments = [
    { idx: 0, audioKey: "dubs/d/seg/0" },
    { idx: 1, audioKey: "dubs/d/seg/1" }
  ];
  const head = async (key: string) => ({ size: key.endsWith("/1") ? 6_000_000 : 1000 });
  const result = await verifyUploadsComplete(segments, head, 5_242_880);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 413);
});

test("complete accepts when every object exists within the byte limit", async () => {
  const segments = [
    { idx: 0, audioKey: "dubs/d/seg/0" },
    { idx: 1, audioKey: "dubs/d/seg/1" }
  ];
  const head = async () => ({ size: 1000 });
  const result = await verifyUploadsComplete(segments, head, 5_242_880);
  assert.deepEqual(result, { ok: true });
});

test("rate limiter rejects requests past the per-minute limit", () => {
  const limiter = new RateLimiter(3, 60_000);
  const t0 = 1_000_000;
  assert.equal(limiter.check("ip1", t0).allowed, true);
  assert.equal(limiter.check("ip1", t0 + 1).allowed, true);
  assert.equal(limiter.check("ip1", t0 + 2).allowed, true);
  const denied = limiter.check("ip1", t0 + 3);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSec > 0);
  assert.equal(limiter.check("ip2", t0 + 4).allowed, true);
  assert.equal(limiter.check("ip1", t0 + 61_000).allowed, true);
});

test("kill switch and config parsing", () => {
  assert.equal(parseShareConfig({}).uploadsDisabled, false);
  assert.equal(parseShareConfig({ SHARE_UPLOADS_DISABLED: "1" }).uploadsDisabled, true);
  assert.equal(parseShareConfig({ SHARE_UPLOADS_DISABLED: "true" }).uploadsDisabled, true);
  assert.equal(parseShareConfig({}).pendingTtlMs, 24 * 3_600_000);
  assert.equal(parseShareConfig({ PENDING_DUB_TTL_HOURS: "2" }).pendingTtlMs, 2 * 3_600_000);
  assert.equal(parseShareConfig({ RATE_LIMIT_INIT_PER_MINUTE: "5" }).rateLimitPerMinute, 5);
  assert.equal(parseShareConfig({ MAX_SEGMENTS: "50" }).maxSegments, 50);
  assert.equal(parseShareConfig({ MAX_SEGMENT_BYTES: "1024" }).maxSegmentBytes, 1024);
  assert.deepEqual(shareConfig(), parseShareConfig(process.env));
});

test("all rejections carry a displayable error message for old clients", async () => {
  const rejected = decideInit(
    { id: "x", status: "ready", ownerTokenHash: "h", createdAt: new Date() },
    undefined,
    new Date(),
    1000
  );
  assert.equal(rejected.action, "reject");
  if (rejected.action === "reject") {
    assert.ok(rejected.message.length > 0);
    assert.equal(rejected.status, 409);
  }
  const results = [
    validateInit({}, 2000),
    authorizeGet({ visibility: "private", ownerTokenHash: "h" }, null),
    await verifyUploadsComplete([{ idx: 0, audioKey: "k" }], async () => null, 100)
  ];
  for (const r of results) {
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(typeof r.message, "string");
      assert.ok(r.message.length > 0);
      assert.ok(r.status >= 400 && r.status < 600);
    }
  }
});
