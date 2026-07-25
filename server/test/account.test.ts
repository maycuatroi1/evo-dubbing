import test from "node:test";
import assert from "node:assert/strict";
import {
  TRIAL_QUOTA_MS,
  buildAccountPayload,
  parseManagedFlags
} from "../src/lib/account.ts";
import { v1Error, v1Json, V1_ERROR_CODES } from "../src/lib/api-error.ts";

const USER_ID = "0b7f3a2e-6c4d-4f1e-9a2b-1c2d3e4f5a6b";
const T0 = Date.UTC(2026, 6, 1);
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_FLAGS = { inference: false, trial: false, checkout: false };

function period(overrides: Record<string, unknown> = {}) {
  return {
    id: "period-1",
    startAt: new Date(T0),
    endAt: new Date(T0 + 30 * DAY_MS),
    quotaMs: 18_000_000,
    usedMs: 0,
    status: "active",
    ...overrides
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return buildAccountPayload({
    userId: USER_ID,
    periods: [],
    trialUsedMs: 0,
    flags: NO_FLAGS,
    now: new Date(T0 + DAY_MS),
    ...overrides
  });
}

test("trial quota is 15 minutes of source audio", () => {
  assert.equal(TRIAL_QUOTA_MS, 900_000);
});

test("fresh account gets a full one-time trial and is not subscribed", () => {
  const payload = build();
  assert.equal(payload.userId, USER_ID);
  assert.deepEqual(payload.trial, {
    quotaMs: 900_000,
    usedMs: 0,
    remainingMs: 900_000,
    exhausted: false
  });
  assert.equal(payload.periods.length, 0);
  assert.equal(payload.remainingSourceMs, 900_000);
  assert.deepEqual(payload.renewal, { status: "not_subscribed" });
});

test("trial usage is clamped and exhaustion is reported", () => {
  const partial = build({ trialUsedMs: 400_000 });
  assert.equal(partial.trial.remainingMs, 500_000);
  assert.equal(partial.trial.exhausted, false);
  const over = build({ trialUsedMs: 1_500_000 });
  assert.equal(over.trial.usedMs, 900_000);
  assert.equal(over.trial.remainingMs, 0);
  assert.equal(over.trial.exhausted, true);
});

test("active period adds remaining source_ms and requires manual renewal", () => {
  const payload = build({ periods: [period({ usedMs: 6_000_000 })] });
  assert.equal(payload.periods.length, 1);
  assert.equal(payload.periods[0].remainingMs, 12_000_000);
  assert.equal(payload.remainingSourceMs, 900_000 + 12_000_000);
  assert.deepEqual(payload.renewal, {
    status: "manual_renewal",
    currentPeriodEndAt: new Date(T0 + 30 * DAY_MS).toISOString()
  });
});

test("queued renewal is reported with the next period start", () => {
  const payload = build({
    periods: [
      period({ usedMs: 3_000_000 }),
      period({
        id: "period-2",
        startAt: new Date(T0 + 30 * DAY_MS),
        endAt: new Date(T0 + 60 * DAY_MS),
        status: "queued"
      })
    ]
  });
  assert.equal(payload.periods.length, 2);
  assert.equal(payload.remainingSourceMs, 900_000 + 15_000_000);
  assert.deepEqual(payload.renewal, {
    status: "renewal_scheduled",
    nextPeriodStartAt: new Date(T0 + 30 * DAY_MS).toISOString()
  });
});

test("expired active period contributes no remaining source_ms", () => {
  const payload = build({
    periods: [
      period({
        startAt: new Date(T0 - 40 * DAY_MS),
        endAt: new Date(T0 - 10 * DAY_MS),
        usedMs: 18_000_000
      })
    ],
    trialUsedMs: 900_000,
    now: new Date(T0)
  });
  assert.equal(payload.remainingSourceMs, 0);
  assert.deepEqual(payload.renewal, { status: "not_subscribed" });
});

test("managed feature flags parse from the environment", () => {
  assert.deepEqual(parseManagedFlags({}), NO_FLAGS);
  assert.deepEqual(
    parseManagedFlags({
      MANAGED_INFERENCE_ENABLED: "1",
      MANAGED_TRIAL_ENABLED: "true",
      MANAGED_CHECKOUT_ENABLED: "0"
    }),
    { inference: true, trial: true, checkout: false }
  );
  const payload = build({
    flags: parseManagedFlags({ MANAGED_INFERENCE_ENABLED: "1" })
  });
  assert.deepEqual(payload.flags, {
    managedInference: true,
    managedTrial: false,
    managedCheckout: false
  });
});

test("account payload never leaks provider, Supabase secret or payment credentials", () => {
  const payload = build({
    periods: [period(), period({ id: "period-2", status: "queued" })]
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /provider/i);
  assert.doesNotMatch(serialized, /secret|checksum|api_?key|password|service_role/i);
  assert.doesNotMatch(serialized, /payos|order_?code|amount|currency/i);
  assert.deepEqual(Object.keys(payload).sort(), [
    "flags",
    "periods",
    "remainingSourceMs",
    "renewal",
    "trial",
    "userId"
  ]);
});

test("v1 error envelope carries code and message with the v1 shape", async () => {
  const res = v1Error(V1_ERROR_CODES.missingToken, "missing bearer token", 401);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.deepEqual(body, { error: { code: "missing_token", message: "missing bearer token" } });
});

test("v1 rate-limit envelope can carry Retry-After", async () => {
  const res = v1Error(V1_ERROR_CODES.rateLimited, "rate limit exceeded", 429, {
    "retry-after": "42"
  });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "42");
  const body = await res.json();
  assert.equal(body.error.code, "rate_limited");
});

test("v1 success payload is plain JSON without an envelope wrapper", async () => {
  const payload = build();
  const res = v1Json(payload);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, USER_ID);
  assert.equal(body.error, undefined);
});
