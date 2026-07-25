import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MONTHLY_BUDGET_USD,
  DEFAULT_TRIAL_BUDGET_USD,
  MICROUSD_PER_USD,
  evaluateBudget,
  parseBudgetConfig
} from "../src/lib/managed/budget.ts";
import { InMemoryLedgerStore, ManagedLedger } from "../src/lib/managed/ledger.ts";
import { ManagedRouter, ProviderClient } from "../src/lib/managed/provider-router.ts";
import type { FetchImpl } from "../src/lib/managed/provider-router.ts";

const ACCOUNT = "acct-budget";
const T0 = new Date(Date.UTC(2026, 6, 10, 12));
const M = MICROUSD_PER_USD;

test("budget config parses env with 100 USD monthly default and kill switch", () => {
  const off = parseBudgetConfig({});
  assert.equal(off.enabled, false);
  assert.equal(off.monthlyBudgetMicrousd, DEFAULT_MONTHLY_BUDGET_USD * M);
  assert.equal(off.trialBudgetMicrousd, DEFAULT_TRIAL_BUDGET_USD * M);
  const on = parseBudgetConfig({
    MANAGED_INFERENCE_ENABLED: "1",
    MANAGED_MONTHLY_BUDGET_USD: "50",
    MANAGED_TRIAL_BUDGET_USD: "5"
  });
  assert.equal(on.enabled, true);
  assert.equal(on.monthlyBudgetMicrousd, 50 * M);
  assert.equal(on.trialBudgetMicrousd, 5 * M);
});

test("kill switch denies every traffic class", () => {
  const config = parseBudgetConfig({ MANAGED_INFERENCE_ENABLED: "0" });
  const spend = { totalMicrousd: 0, trialMicrousd: 0 };
  for (const cls of ["trial", "paid"] as const) {
    const decision = evaluateBudget(config, spend, cls, 1);
    assert.equal(decision.allowed, false);
    assert.equal(decision.denial, "kill_switch");
  }
});

test("trial budget stops trial traffic while paid traffic continues", () => {
  const config = parseBudgetConfig({
    MANAGED_INFERENCE_ENABLED: "1",
    MANAGED_MONTHLY_BUDGET_USD: "100",
    MANAGED_TRIAL_BUDGET_USD: "10"
  });
  const spend = { totalMicrousd: 15 * M, trialMicrousd: Math.round(9.6 * M) };
  const trial = evaluateBudget(config, spend, "trial", 1 * M);
  assert.equal(trial.allowed, false);
  assert.equal(trial.denial, "trial_budget");
  const paid = evaluateBudget(config, spend, "paid", 1 * M);
  assert.equal(paid.allowed, true);
});

test("total monthly cap stops both traffic classes", () => {
  const config = parseBudgetConfig({
    MANAGED_INFERENCE_ENABLED: "1",
    MANAGED_MONTHLY_BUDGET_USD: "100",
    MANAGED_TRIAL_BUDGET_USD: "10"
  });
  const spend = { totalMicrousd: Math.round(99.6 * M), trialMicrousd: 1 * M };
  for (const cls of ["trial", "paid"] as const) {
    const decision = evaluateBudget(config, spend, cls, 1 * M);
    assert.equal(decision.allowed, false);
    assert.equal(decision.denial, "monthly_budget");
  }
});

test("alert thresholds fire at eighty percent without blocking", () => {
  const config = parseBudgetConfig({
    MANAGED_INFERENCE_ENABLED: "1",
    MANAGED_MONTHLY_BUDGET_USD: "100",
    MANAGED_TRIAL_BUDGET_USD: "10"
  });
  const spend = { totalMicrousd: 85 * M, trialMicrousd: Math.round(8.5 * M) };
  const decision = evaluateBudget(config, spend, "paid", 1 * M);
  assert.equal(decision.allowed, true);
  assert.equal(decision.alerts.length, 2);
  const quiet = evaluateBudget(config, { totalMicrousd: 1 * M, trialMicrousd: 1 * M }, "paid", 1);
  assert.equal(quiet.alerts.length, 0);
});

test("router blocks provider calls when the kill switch is off", async () => {
  let fetchCalls = 0;
  const fetchImpl: FetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const store = new InMemoryLedgerStore();
  const ledger = new ManagedLedger(store, () => T0);
  const router = new ManagedRouter({
    ledger,
    budget: parseBudgetConfig({ MANAGED_INFERENCE_ENABLED: "0" }),
    env: { GOOGLE_API_KEY: "g" },
    now: () => T0,
    client: new ProviderClient({ fetchImpl, sleep: async () => {} })
  });
  await assert.rejects(
    () =>
      router.synthesizeSpeech({
        accountId: ACCOUNT,
        requestKey: "kill-1",
        text: "xin chao",
        targetLang: "vi-VN",
        cueDurationMs: 5_000
      }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "inference_disabled");
      return true;
    }
  );
  assert.equal(fetchCalls, 0);
  assert.equal(store.requests.size, 0);
});

test("router stops trial traffic at the trial budget while paid traffic passes", async () => {
  const fetchImpl: FetchImpl = async (url) => {
    void url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: "QUJD" } }] } }]
      })
    };
  };
  const store = new InMemoryLedgerStore();
  const ledger = new ManagedLedger(store, () => T0);
  const router = new ManagedRouter({
    ledger,
    budget: parseBudgetConfig({
      MANAGED_INFERENCE_ENABLED: "1",
      MANAGED_MONTHLY_BUDGET_USD: "100",
      MANAGED_TRIAL_BUDGET_USD: "0.000002"
    }),
    env: { GOOGLE_API_KEY: "g" },
    now: () => T0,
    client: new ProviderClient({ fetchImpl, sleep: async () => {} })
  });
  await assert.rejects(
    () =>
      router.synthesizeSpeech({
        accountId: ACCOUNT,
        requestKey: "trial-blocked",
        text: "xin chao",
        targetLang: "vi-VN",
        cueDurationMs: 5_000
      }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "budget_exceeded");
      return true
    }
  );
  store.periods.set("period-paid", {
    id: "period-paid",
    accountId: ACCOUNT,
    quotaMs: 18_000_000,
    usedMs: 0,
    status: "active",
    startAt: new Date(T0.getTime() - 1000).toISOString(),
    endAt: new Date(T0.getTime() + 86_400_000).toISOString()
  });
  const paid = await router.synthesizeSpeech({
    accountId: ACCOUNT,
    requestKey: "paid-allowed",
    text: "xin chao",
    targetLang: "vi-VN",
    cueDurationMs: 5_000
  });
  assert.equal(paid.provider, "google-gemini-tts");
});
