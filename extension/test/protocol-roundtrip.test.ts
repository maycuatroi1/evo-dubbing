import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock, dispatchMessage } from "./helpers.ts";

const SESSION = {
  accessToken: "managed-access-token-xyz",
  refreshToken: "managed-refresh-token-xyz",
  expiresAt: Date.now() + 3600_000,
  tokenType: "bearer"
};

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function seedServiceWorker(fetchImpl: (call: FetchCall) => unknown) {
  const calls: FetchCall[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    const call: FetchCall = { url, headers: init.headers, body: init.body ?? "" };
    calls.push(call);
    const payload = fetchImpl(call);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };
  const mock = installChromeMock();
  mock.storage.local.data["evoDubbingManagedSession"] = { ...SESSION };
  await import("../src/background/service-worker.ts");
  return { mock, calls };
}

test("managed.translate round trip injects bearer token only inside the service worker", async () => {
  const { mock, calls } = await seedServiceWorker(() => ({
    batchId: "b1",
    translations: [{ id: "s0", text: "xin chao", startMs: 0, endMs: 2000 }]
  }));
  const response = (await dispatchMessage(mock, {
    type: "managed.translate",
    payload: {
      baseUrl: "https://managed.example.com",
      sourceLang: "en",
      targetLang: "vi",
      segments: [{ idx: 0, text: "hello", startMs: 0, endMs: 2000 }]
    }
  })) as { ok: boolean; data: { translations: { id: string; text: string }[] } };

  assert.equal(response.ok, true);
  assert.equal(response.data.translations[0].text, "xin chao");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://managed.example.com/api/v1/inference/translate");
  assert.equal(calls[0].headers.Authorization, `Bearer ${SESSION.accessToken}`);
  assert.deepEqual(JSON.parse(calls[0].body).segments, [{ id: "s0", text: "hello", cue: { startMs: 0, endMs: 2000 } }]);
  assert.ok(!JSON.stringify(response).includes(SESSION.accessToken));
  assert.ok(!JSON.stringify(response).includes(SESSION.refreshToken));
});

test("managed.tts without a session answers 401 without calling the server", async () => {
  const calls: FetchCall[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    calls.push({ url, headers: init.headers, body: init.body ?? "" });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };
  const mock = installChromeMock();
  await import("../src/background/service-worker.ts");
  const response = (await dispatchMessage(mock, {
    type: "managed.tts",
    payload: {
      baseUrl: "https://managed.example.com",
      idempotencyKey: "k-12345678",
      voiceProfileId: "vi-standard-female",
      targetLang: "vi",
      text: "xin chao",
      cue: { startMs: 0, endMs: 2000 }
    }
  })) as { ok: boolean; status: number; code: string };
  assert.equal(response.ok, false);
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("auth.getState never leaks tokens to the sender", async () => {
  const { mock } = await seedServiceWorker(() => ({}));
  const response = (await dispatchMessage(mock, { type: "auth.getState" })) as {
    ok: boolean;
    data: Record<string, unknown>;
  };
  assert.equal(response.ok, true);
  assert.equal(response.data.signedIn, true);
  assert.ok(!("accessToken" in response.data));
  assert.ok(!("refreshToken" in response.data));
  assert.ok(!JSON.stringify(response).includes(SESSION.accessToken));
});

test("auth.signIn parses the Supabase redirect fragment and stores the session in the worker", async () => {
  const mock = installChromeMock();
  (globalThis as { fetch?: unknown }).fetch = async () => {
    throw new Error("no fetch expected");
  };
  mock.__authResponseUrl =
    "https://ligchebgiheiildjcnndjoalkpiamgko.chromiumapp.org/#access_token=tok-aaa&refresh_token=ref-bbb&expires_in=3600&token_type=bearer";
  await import("../src/background/service-worker.ts");
  const response = (await dispatchMessage(mock, { type: "auth.signIn" })) as {
    ok: boolean;
    data: { signedIn: boolean };
  };
  assert.equal(response.ok, true);
  assert.equal(response.data.signedIn, true);
  assert.ok(mock.__authFlow);
  assert.ok(mock.__authFlow!.url.startsWith("https://lrypactuodbguwncoomc.supabase.co/auth/v1/authorize?provider=google"));
  assert.ok(mock.__authFlow!.url.includes(encodeURIComponent("https://ligchebgiheiildjcnndjoalkpiamgko.chromiumapp.org/")));
  const stored = mock.storage.local.data["evoDubbingManagedSession"] as { accessToken: string; refreshToken: string };
  assert.equal(stored.accessToken, "tok-aaa");
  assert.equal(stored.refreshToken, "ref-bbb");
});

test("content-script message payloads never carry tokens", async () => {
  const mock = installChromeMock(async (message) => {
    const m = message as { type: string };
    if (m.type === "managed.translate") {
      return { ok: true, data: { batchId: "b", translations: [{ id: "s0", text: "x", startMs: 0, endMs: 1 }] } };
    }
    if (m.type === "managed.tts") {
      return {
        ok: true,
        data: {
          requestId: "r",
          chargedSourceMs: 0,
          remainingMs: 1000,
          voiceProfileVersion: "v",
          audioBase64: "AAE="
        }
      };
    }
    return { ok: true, data: { signedIn: false } };
  });
  const { managedTranslate, managedTts, managedAuthState } = await import("../src/lib/managed/messages.ts");
  await managedTranslate({
    baseUrl: "https://managed.example.com",
    sourceLang: "en",
    targetLang: "vi",
    segments: [{ idx: 0, text: "hello", startMs: 0, endMs: 1000 }]
  });
  await managedTts({
    baseUrl: "https://managed.example.com",
    idempotencyKey: "k-12345678",
    voiceProfileId: "vi-standard-female",
    targetLang: "vi",
    text: "hello",
    cue: { startMs: 0, endMs: 1000 }
  });
  const state = await managedAuthState();
  assert.equal(state.signedIn, false);
  for (const message of mock.__messages) {
    const wire = JSON.stringify(message);
    assert.ok(!wire.includes("accessToken"), wire);
    assert.ok(!wire.includes("refreshToken"), wire);
    assert.ok(!wire.includes("Bearer"), wire);
    assert.ok(!wire.includes("Authorization"), wire);
  }
});
