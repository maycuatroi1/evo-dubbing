import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateInit, profileMetadataFromInit } from "../src/lib/shareSecurity.ts";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/old-extension-share.json", import.meta.url)), "utf8")
);

test("old extension init payload is accepted without managed-only fields", () => {
  for (const field of fixture.init.absentFields) {
    assert.equal(fixture.init.body[field], undefined, `fixture must not include ${field}`);
  }
  const result = validateInit(fixture.init.body, 2000);
  assert.deepEqual(result, { ok: true });
});

test("old extension init payload maps to empty profile metadata", () => {
  const profiles = profileMetadataFromInit(fixture.init.body);
  assert.equal(profiles.generationProfile, null);
  assert.equal(profiles.voiceProfile, null);
  assert.equal(profiles.rightsAssertedAt, null);
});

test("old extension lookup query carries every parameter the route requires", () => {
  const params = new URLSearchParams(fixture.lookup.query);
  for (const required of ["platform", "videoId", "targetLang", "voice", "provider"]) {
    assert.ok(params.get(required), `lookup query must include ${required}`);
  }
});

test("old extension complete payload shape is a bare ownerToken", () => {
  assert.deepEqual(Object.keys(fixture.complete.body), ["ownerToken"]);
  assert.equal(typeof fixture.complete.body.ownerToken, "string");
});
