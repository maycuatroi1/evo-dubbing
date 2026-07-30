import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock, dispatchMessage } from "./helpers.ts";

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function seedServiceWorker() {
  const calls: FetchCall[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    calls.push({ url, headers: init.headers, body: init.body ?? "" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ counted: true }),
      text: async () => JSON.stringify({ counted: true })
    };
  };
  const mock = installChromeMock();
  await import("../src/background/service-worker.ts");
  return { mock, calls };
}

const PAYLOAD = {
  baseUrl: "https://dub.example.com",
  platform: "youtube",
  videoId: "vid-1",
  channelId: "UC123",
  channelName: "Demo Channel"
};

test("events.playback posts playback_started with a random installation ID stored once", async () => {
  const { mock, calls } = await seedServiceWorker();
  const first = (await dispatchMessage(mock, { type: "events.playback", payload: PAYLOAD })) as { ok: boolean };
  assert.equal(first.ok, true);
  const second = (await dispatchMessage(mock, { type: "events.playback", payload: PAYLOAD })) as { ok: boolean };
  assert.equal(second.ok, true);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://dub.example.com/api/v1/events/playback");
  const bodyA = JSON.parse(calls[0].body) as Record<string, string>;
  const bodyB = JSON.parse(calls[1].body) as Record<string, string>;
  assert.equal(bodyA.platform, "youtube");
  assert.equal(bodyA.videoId, "vid-1");
  assert.equal(bodyA.channelId, "UC123");
  assert.equal(bodyA.channelName, "Demo Channel");
  assert.ok(bodyA.installId.length >= 8);
  assert.equal(bodyB.installId, bodyA.installId, "install ID is generated once and reused");
  assert.equal(
    (mock.storage.local.data["evoDubbingInstallId"] as string) === bodyA.installId,
    true,
    "install ID persists in chrome.storage.local"
  );
  assert.ok(!calls[0].headers.Authorization, "playback events carry no auth token");
});

test("events.playback without a base URL never calls the server", async () => {
  const { mock, calls } = await seedServiceWorker();
  const res = (await dispatchMessage(mock, {
    type: "events.playback",
    payload: { baseUrl: "", platform: "youtube", videoId: "vid-1" }
  })) as { ok: boolean; code: string };
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});
