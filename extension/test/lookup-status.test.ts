import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers.ts";

const QUERY = {
  platform: "youtube",
  videoId: "abc123",
  targetLang: "vi",
  voice: "alloy",
  provider: "openai"
};

test("lookup 404 is a cache miss and returns null", async () => {
  installChromeMock(async () => ({ ok: false, status: 404, error: "not found" }));
  const { lookupDub } = await import("../src/lib/api/shareClient.ts");
  const result = await lookupDub("https://share.example.com", QUERY);
  assert.equal(result, null);
});

test("lookup 5xx throws instead of silently falling through to generation", async () => {
  installChromeMock(async () => ({ ok: false, status: 500, error: "internal" }));
  const { lookupDub } = await import("../src/lib/api/shareClient.ts");
  await assert.rejects(
    () => lookupDub("https://share.example.com", QUERY),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as { status?: number }).status, 500);
      return true;
    }
  );
});

test("lookup network failure (status 0) also throws", async () => {
  installChromeMock(async () => ({ ok: false, status: 0, error: "connection refused" }));
  const { lookupDub } = await import("../src/lib/api/shareClient.ts");
  await assert.rejects(() => lookupDub("https://share.example.com", QUERY));
});
