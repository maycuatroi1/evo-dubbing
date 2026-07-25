import test from "node:test";
import assert from "node:assert/strict";
import { TRIAL_QUOTA_MS } from "../src/lib/account.ts";
import {
  InMemoryLedgerStore,
  ManagedLedger
} from "../src/lib/managed/ledger.ts";
import type { StoredPeriod } from "../src/lib/managed/ledger.ts";

const ACCOUNT = "acct-ledger";
const T0 = new Date(Date.UTC(2026, 6, 10, 12));

function makeLedger() {
  const store = new InMemoryLedgerStore();
  const ledger = new ManagedLedger(store, () => T0);
  return { store, ledger };
}

function addPeriod(store: InMemoryLedgerStore, overrides: Partial<StoredPeriod> = {}): StoredPeriod {
  const period: StoredPeriod = {
    id: overrides.id ?? "period-1",
    accountId: overrides.accountId ?? ACCOUNT,
    quotaMs: overrides.quotaMs ?? 18_000_000,
    usedMs: overrides.usedMs ?? 0,
    status: overrides.status ?? "active",
    startAt: overrides.startAt ?? new Date(T0.getTime() - 1000).toISOString(),
    endAt: overrides.endAt ?? new Date(T0.getTime() + 30 * 24 * 3600 * 1000).toISOString()
  };
  store.periods.set(period.id, period);
  return period;
}

function reserveInput(key: string, estimateMs: number, accountId = ACCOUNT) {
  return {
    requestKey: key,
    accountId,
    kind: "tts" as const,
    provider: "google-gemini-tts",
    model: "gemini-2.5-flash-preview-tts",
    estimateMs,
    costMicrousd: 100
  };
}

test("reserve on trial deducts from the 900,000 ms trial cap", async () => {
  const { store, ledger } = makeLedger();
  const first = await ledger.reserve(reserveInput("k1", 400_000));
  assert.equal(first.replay, false);
  const second = await ledger.reserve(reserveInput("k2", 400_000));
  assert.equal(second.replay, false);
  await assert.rejects(() => ledger.reserve(reserveInput("k3", 200_000)), /quota_exceeded|trial quota/);
  assert.equal(store.requests.size, 2);
});

test("concurrent paid reserves never drive period quota negative", async () => {
  const { store, ledger } = makeLedger();
  const period = addPeriod(store, { quotaMs: 18_000_000 });
  const attempts = Array.from({ length: 50 }, (_, i) =>
    ledger.reserve(reserveInput(`paid-${i}`, 1_000_000)).then(
      () => true,
      () => false
    )
  );
  const results = await Promise.all(attempts);
  const succeeded = results.filter(Boolean).length;
  assert.equal(succeeded, 18);
  assert.equal(period.usedMs, 18_000_000);
  assert.ok(period.usedMs >= 0 && period.usedMs <= period.quotaMs);
});

test("concurrent trial reserves never exceed the trial cap", async () => {
  const { ledger } = makeLedger();
  const attempts = Array.from({ length: 20 }, (_, i) =>
    ledger.reserve(reserveInput(`trial-${i}`, 100_000)).then(
      () => true,
      () => false
    )
  );
  const results = await Promise.all(attempts);
  const succeeded = results.filter(Boolean).length;
  assert.equal(succeeded, Math.floor(TRIAL_QUOTA_MS / 100_000));
});

test("same request key replays the recorded reservation once", async () => {
  const { store, ledger } = makeLedger();
  const period = addPeriod(store);
  const first = await ledger.reserve(reserveInput("dup", 5_000));
  const second = await ledger.reserve(reserveInput("dup", 5_000));
  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.equal(period.usedMs, 5_000);
  assert.equal(store.requests.size, 1);
});

test("settle converts reserve to actual usage and writes a usage event with provider cost", async () => {
  const { store, ledger } = makeLedger();
  const period = addPeriod(store);
  await ledger.reserve(reserveInput("settle-1", 10_000));
  const settled = await ledger.settle("settle-1", {
    actualMs: 8_000,
    costMicrousd: 42,
    generatedChars: 120,
    latencyMs: 900,
    provider: "google-gemini-tts",
    model: "gemini-2.5-flash-preview-tts",
    result: JSON.stringify({ audioBase64: "AAAA" })
  });
  assert.equal(settled.replay, false);
  assert.equal(period.usedMs, 8_000);
  assert.equal(store.usages.length, 1);
  assert.equal(store.usages[0].sourceMs, 8_000);
  assert.equal(store.usages[0].costMicrousd, 42);
  assert.equal(store.usages[0].periodId, period.id);
});

test("settle replay does not write a second usage event", async () => {
  const { store, ledger } = makeLedger();
  const period = addPeriod(store);
  await ledger.reserve(reserveInput("settle-2", 10_000));
  await ledger.settle("settle-2", {
    actualMs: 10_000,
    costMicrousd: 42,
    generatedChars: 120,
    latencyMs: 900,
    provider: "google-gemini-tts",
    model: "gemini-2.5-flash-preview-tts",
    result: "{}"
  });
  const replay = await ledger.settle("settle-2", {
    actualMs: 10_000,
    costMicrousd: 42,
    generatedChars: 120,
    latencyMs: 900,
    provider: "google-gemini-tts",
    model: "gemini-2.5-flash-preview-tts",
    result: "{}"
  });
  assert.equal(replay.replay, true);
  assert.equal(store.usages.length, 1);
  assert.equal(period.usedMs, 10_000);
});

test("provider failure refund releases a paid reserve exactly once", async () => {
  const { store, ledger } = makeLedger();
  const period = addPeriod(store);
  await ledger.reserve(reserveInput("refund-1", 7_000));
  assert.equal(period.usedMs, 7_000);
  const first = await ledger.refund("refund-1");
  const second = await ledger.refund("refund-1");
  assert.equal(first.refunded, true);
  assert.equal(second.refunded, false);
  assert.equal(period.usedMs, 0);
});

test("trial refund frees the reservation so the cap is available again", async () => {
  const { ledger } = makeLedger();
  await ledger.reserve(reserveInput("refund-trial", TRIAL_QUOTA_MS));
  await assert.rejects(() => ledger.reserve(reserveInput("after-full", 1)), /quota/);
  const refunded = await ledger.refund("refund-trial");
  assert.equal(refunded.refunded, true);
  const again = await ledger.reserve(reserveInput("after-full", 1));
  assert.equal(again.replay, false);
});

test("translation records cost without consuming source_ms quota", async () => {
  const { store, ledger } = makeLedger();
  const period = addPeriod(store);
  const recorded = await ledger.recordTranslation({
    requestKey: "tr-1",
    accountId: ACCOUNT,
    periodId: period.id,
    provider: "gemini-flash-lite",
    model: "gemini-3.1-flash-lite",
    inputChars: 300,
    outputChars: 320,
    costMicrousd: 55,
    latencyMs: 400,
    result: JSON.stringify({ text: "xin chao" })
  });
  assert.equal(recorded.replay, false);
  assert.equal(period.usedMs, 0);
  assert.equal(store.usages.length, 1);
  assert.equal(store.usages[0].sourceMs, 0);
  assert.equal(store.usages[0].costMicrousd, 55);
  const replay = await ledger.recordTranslation({
    requestKey: "tr-1",
    accountId: ACCOUNT,
    periodId: period.id,
    provider: "gemini-flash-lite",
    model: "gemini-3.1-flash-lite",
    inputChars: 300,
    outputChars: 320,
    costMicrousd: 55,
    latencyMs: 400,
    result: JSON.stringify({ text: "xin chao" })
  });
  assert.equal(replay.replay, true);
  assert.equal(store.usages.length, 1);
});

test("monthly spend aggregates usage events and reserved requests by class", async () => {
  const { store, ledger } = makeLedger();
  addPeriod(store);
  await ledger.reserve(reserveInput("spend-paid", 1_000));
  await ledger.settle("spend-paid", {
    actualMs: 1_000,
    costMicrousd: 200,
    generatedChars: 10,
    latencyMs: 10,
    provider: "google-gemini-tts",
    model: "gemini-2.5-flash-preview-tts",
    result: "{}"
  });
  await ledger.reserve(reserveInput("spend-trial", 1_000, "acct-trial"));
  const spend = await ledger.monthlySpend(new Date(T0.getTime() - 1000));
  assert.equal(spend.totalMicrousd, 300);
  assert.equal(spend.trialMicrousd, 100);
});
