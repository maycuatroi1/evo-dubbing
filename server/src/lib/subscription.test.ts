import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERIOD_LENGTH_MS, PERIOD_QUOTA_MS } from "../db/schema.ts";
import { isEarlyRenewal, planSubscriptionPeriod } from "./subscription.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

describe("planSubscriptionPeriod", () => {
  it("activates immediately when the account has no periods", () => {
    const planned = planSubscriptionPeriod([], T0);
    assert.equal(planned.status, "active");
    assert.equal(planned.startAt.getTime(), T0);
    assert.equal(planned.endAt.getTime(), T0 + PERIOD_LENGTH_MS);
    assert.equal(planned.quotaMs, PERIOD_QUOTA_MS);
    assert.equal(planned.usedMs, 0);
  });

  it("period length is exactly 30 days and quota is 18,000,000 ms", () => {
    assert.equal(PERIOD_LENGTH_MS, 30 * DAY_MS);
    assert.equal(PERIOD_QUOTA_MS, 18_000_000);
  });

  it("queues early renewal after the active period with no quota rollover", () => {
    const active = { startMs: T0, endMs: T0 + 30 * DAY_MS, status: "active" as const };
    const paidAt = T0 + 10 * DAY_MS;
    const planned = planSubscriptionPeriod([active], paidAt);
    assert.equal(planned.status, "queued");
    assert.equal(planned.startAt.getTime(), active.endMs);
    assert.equal(planned.endAt.getTime(), active.endMs + PERIOD_LENGTH_MS);
    assert.equal(planned.quotaMs, PERIOD_QUOTA_MS);
    assert.equal(isEarlyRenewal([active], paidAt), true);
  });

  it("chains a second early renewal after the queued period", () => {
    const active = { startMs: T0, endMs: T0 + 30 * DAY_MS, status: "active" as const };
    const queued = { startMs: T0 + 30 * DAY_MS, endMs: T0 + 60 * DAY_MS, status: "queued" as const };
    const paidAt = T0 + 20 * DAY_MS;
    const planned = planSubscriptionPeriod([active, queued], paidAt);
    assert.equal(planned.status, "queued");
    assert.equal(planned.startAt.getTime(), queued.endMs);
    assert.equal(planned.endAt.getTime(), queued.endMs + PERIOD_LENGTH_MS);
  });

  it("activates immediately after the last period expired", () => {
    const expired = { startMs: T0, endMs: T0 + 30 * DAY_MS, status: "expired" as const };
    const paidAt = T0 + 45 * DAY_MS;
    const planned = planSubscriptionPeriod([expired], paidAt);
    assert.equal(planned.status, "active");
    assert.equal(planned.startAt.getTime(), paidAt);
  });

  it("ignores cancelled and expired periods when placing the next one", () => {
    const cancelled = { startMs: T0, endMs: T0 + 90 * DAY_MS, status: "cancelled" as const };
    const expired = { startMs: T0, endMs: T0 + 30 * DAY_MS, status: "expired" as const };
    const paidAt = T0 + 40 * DAY_MS;
    const planned = planSubscriptionPeriod([cancelled, expired], paidAt);
    assert.equal(planned.status, "active");
    assert.equal(planned.startAt.getTime(), paidAt);
  });

  it("never overlaps an active period even if payment is backdated", () => {
    const active = { startMs: T0, endMs: T0 + 30 * DAY_MS, status: "active" as const };
    const paidAt = T0 - 5 * DAY_MS;
    const planned = planSubscriptionPeriod([active], paidAt);
    assert.equal(planned.status, "queued");
    assert.equal(planned.startAt.getTime(), active.endMs);
  });
});
