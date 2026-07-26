import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYBACK_OUTREACH_THRESHOLD,
  createPlaybackEventHandlers,
  dailyInstallKey,
  hashInstallId,
  parseProductEventConfig,
  recordPlaybackStarted
} from "../src/lib/product-events.ts";
import type { PlaybackEventStore } from "../src/lib/product-events.ts";

const SECRET = "test-product-event-secret";
const T0 = new Date(Date.UTC(2026, 6, 26, 12));

class InMemoryPlaybackStore implements PlaybackEventStore {
  dedupe = new Set<string>();
  daily = new Map<string, number>();
  outreach: { platform: string; videoId: string; handle: string; status: string }[] = [];

  seedTotals(platform: string, videoId: string, total: number, day = "2026-07-25") {
    this.daily.set(`${platform}${videoId}${day}`, total);
  }

  async tryInsertDedupe(row: { platform: string; videoId: string; day: string; installHash: string }) {
    const key = `${row.platform}${row.videoId}${row.day}${row.installHash}`;
    if (this.dedupe.has(key)) return false;
    this.dedupe.add(key);
    return true;
  }

  async incrementDaily(platform: string, videoId: string, day: string) {
    const key = `${platform}${videoId}${day}`;
    this.daily.set(key, (this.daily.get(key) ?? 0) + 1);
  }

  async totalStarts(platform: string, videoId: string) {
    let total = 0;
    for (const [key, count] of this.daily) {
      if (key.startsWith(`${platform}${videoId}`)) total += count;
    }
    return total;
  }

  async findOutreach(platform: string, videoId: string) {
    const found = this.outreach.find((o) => o.platform === platform && o.videoId === videoId);
    return found ? { id: "outreach-1" } : null;
  }

  async insertOutreach(row: { platform: string; videoId: string; handle: string; status: string }) {
    this.outreach.push(row);
  }
}

function event(installId: string, videoId = "vid-1") {
  return { platform: "youtube", videoId, installId, channelId: "UC123", channelName: "Demo Channel" };
}

test("duplicate install on the same day does not count twice", async () => {
  const store = new InMemoryPlaybackStore();
  const first = await recordPlaybackStarted(store, SECRET, event("install-a"), T0);
  const second = await recordPlaybackStarted(store, SECRET, event("install-a"), T0);
  assert.equal(first.counted, true);
  assert.equal(second.counted, false);
  assert.equal(await store.totalStarts("youtube", "vid-1"), 1);
  const other = await recordPlaybackStarted(store, SECRET, event("install-b"), T0);
  assert.equal(other.counted, true);
  assert.equal(await store.totalStarts("youtube", "vid-1"), 2);
});

test("install id is HMACed with a daily-rotating key so the same install counts again on a new day", async () => {
  const store = new InMemoryPlaybackStore();
  const day1 = hashInstallId(SECRET, "2026-07-26", "install-a");
  const day2 = hashInstallId(SECRET, "2026-07-27", "install-a");
  assert.notEqual(day1, day2);
  assert.notEqual(dailyInstallKey(SECRET, "2026-07-26"), dailyInstallKey(SECRET, "2026-07-27"));
  await recordPlaybackStarted(store, SECRET, event("install-a"), new Date(Date.UTC(2026, 6, 26, 23)));
  const nextDay = await recordPlaybackStarted(store, SECRET, event("install-a"), new Date(Date.UTC(2026, 6, 27, 1)));
  assert.equal(nextDay.counted, true);
  assert.equal(await store.totalStarts("youtube", "vid-1"), 2);
  assert.ok(!JSON.stringify([...store.dedupe]).includes("install-a"));
});

test("999 deduped starts queue nothing, 1.000 queues exactly one pending outreach", async () => {
  const store = new InMemoryPlaybackStore();
  store.seedTotals("youtube", "vid-hot", PLAYBACK_OUTREACH_THRESHOLD - 2);
  const at999 = await recordPlaybackStarted(store, SECRET, event("install-a", "vid-hot"), T0);
  assert.equal(at999.totalStarts, PLAYBACK_OUTREACH_THRESHOLD - 1);
  assert.equal(at999.outreachQueued, false);
  assert.equal(store.outreach.length, 0);

  const at1000 = await recordPlaybackStarted(store, SECRET, event("install-b", "vid-hot"), T0);
  assert.equal(at1000.totalStarts, PLAYBACK_OUTREACH_THRESHOLD);
  assert.equal(at1000.outreachQueued, true);
  assert.equal(store.outreach.length, 1);
  assert.equal(store.outreach[0].status, "pending");
  assert.equal(store.outreach[0].handle, "Demo Channel");

  const after = await recordPlaybackStarted(store, SECRET, event("install-c", "vid-hot"), T0);
  assert.equal(after.outreachQueued, false);
  assert.equal(store.outreach.length, 1);
  const dupe = await recordPlaybackStarted(store, SECRET, event("install-a", "vid-hot"), T0);
  assert.equal(dupe.counted, false);
  assert.equal(store.outreach.length, 1);
});

test("playback route validates the payload and reports 503 without a secret", async () => {
  const store = new InMemoryPlaybackStore();
  const handlers = createPlaybackEventHandlers({
    store,
    config: parseProductEventConfig({ PRODUCT_EVENT_HMAC_SECRET: SECRET }),
    now: () => T0
  });
  const bad = await handlers.report(
    new Request("https://server.test/api/v1/events/playback", {
      method: "POST",
      body: JSON.stringify({ platform: "youtube", videoId: "vid-1" })
    })
  );
  assert.equal(bad.status, 400);

  const ok = await handlers.report(
    new Request("https://server.test/api/v1/events/playback", {
      method: "POST",
      body: JSON.stringify(event("install-a"))
    })
  );
  assert.equal(ok.status, 200);
  const data = (await ok.json()) as { counted: boolean };
  assert.equal(data.counted, true);

  const unconfigured = createPlaybackEventHandlers({
    store,
    config: parseProductEventConfig({ PRODUCT_EVENT_HMAC_SECRET: "" })
  });
  const res = await unconfigured.report(
    new Request("https://server.test/api/v1/events/playback", {
      method: "POST",
      body: JSON.stringify(event("install-a"))
    })
  );
  assert.equal(res.status, 503);
});
