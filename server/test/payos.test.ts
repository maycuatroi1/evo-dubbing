import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PERIOD_LENGTH_MS, PERIOD_QUOTA_MS } from "../src/db/schema.ts";
import {
  PLANS,
  buildCheckout,
  canonicalizeWebhookData,
  createPaymentLink,
  generateOrderCode,
  isAllowedRedirectUrl,
  parsePayOsConfig,
  paymentLinkSignature,
  processPayOsWebhook,
  verifyWebhookSignature
} from "../src/lib/payos.ts";
import type { BillingWebhookStore, WebhookPayment } from "../src/lib/payos.ts";
import type { PeriodWindow, PlannedPeriod } from "../src/lib/subscription.ts";

const CHECKSUM_KEY = "test-checksum-key";
const CLIENT_ID = "test-client-id";
const API_KEY = "test-api-key";
const ACCOUNT_ID = "0b7f3a2e-6c4d-4f1e-9a2b-1c2d3e4f5a6b";
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0);

function testConfig(overrides: Record<string, string | undefined> = {}) {
  const config = parsePayOsConfig({
    PAYOS_CLIENT_ID: CLIENT_ID,
    PAYOS_API_KEY: API_KEY,
    PAYOS_CHECKSUM_KEY: CHECKSUM_KEY,
    PAYOS_RETURN_URL_ALLOWLIST: "https://app.example.com/billing,chrome-extension://ligchebgiheiildjcnndjoalkpiamgko",
    ...overrides
  });
  assert.ok(config);
  return config;
}

function hmac(data: string): string {
  return createHmac("sha256", CHECKSUM_KEY).update(data, "utf8").digest("hex");
}

class MemoryStore implements BillingWebhookStore {
  payments: WebhookPayment[] = [];
  periods: (PlannedPeriod & { accountId: string; paymentId: string })[] = [];

  addPayment(overrides: Partial<WebhookPayment> = {}): WebhookPayment {
    const payment: WebhookPayment = {
      id: `payment-${this.payments.length + 1}`,
      accountId: ACCOUNT_ID,
      orderCode: 123456,
      amountMinor: 199_000,
      currency: "VND",
      status: "pending",
      ...overrides
    };
    this.payments.push(payment);
    return payment;
  }

  async getPaymentByOrderCode(orderCode: number): Promise<WebhookPayment | null> {
    return this.payments.find((p) => p.orderCode === orderCode) ?? null;
  }

  async listOpenPeriods(accountId: string): Promise<PeriodWindow[]> {
    return this.periods
      .filter((p) => p.accountId === accountId && (p.status === "active" || p.status === "queued"))
      .map((p) => ({
        startMs: p.startAt.getTime(),
        endMs: p.endAt.getTime(),
        status: p.status
      }));
  }

  async finalizePayment(payment: WebhookPayment, planned: PlannedPeriod): Promise<boolean> {
    const row = this.payments.find((p) => p.id === payment.id);
    if (!row || row.status !== "pending") return false;
    row.status = "paid";
    this.periods.push({ ...planned, accountId: row.accountId, paymentId: row.id });
    return true;
  }
}

function webhookBody(data: Record<string, unknown>, key: string = CHECKSUM_KEY) {
  const signature = createHmac("sha256", key).update(canonicalizeWebhookData(data), "utf8").digest("hex");
  return { code: "00", desc: "success", success: true, data, signature };
}

function successData(orderCode: number, overrides: Record<string, unknown> = {}) {
  return {
    orderCode,
    amount: 199_000,
    description: "Evo Dubbing 300 phut",
    accountNumber: "12345678",
    reference: "TF240123456789",
    transactionDateTime: "2026-07-20 12:01:00",
    currency: "VND",
    paymentLinkId: "plink-1",
    code: "00",
    desc: "Thành công",
    counterAccountBankId: "",
    counterAccountBankName: "",
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: "",
    virtualAccountNumber: "",
    ...overrides
  };
}

test("plan catalog pins vi_monthly_300 to 199000 VND, 300 minutes and a 30 day period", () => {
  const plan = PLANS.vi_monthly_300;
  assert.equal(plan.amountMinor, 199_000);
  assert.equal(plan.currency, "VND");
  assert.equal(plan.minutes, 300);
  assert.equal(plan.quotaMs, 18_000_000);
  assert.equal(plan.quotaMs, PERIOD_QUOTA_MS);
  assert.equal(plan.periodDays, 30);
  assert.equal(Object.keys(PLANS).length, 1);
});

test("config requires credentials and parses allowlist plus default 15 minute expiry", () => {
  assert.equal(parsePayOsConfig({}), null);
  assert.equal(parsePayOsConfig({ PAYOS_CLIENT_ID: "x" }), null);
  const config = testConfig();
  assert.equal(config.checkoutExpirySec, 900);
  assert.deepEqual(config.returnUrlAllowlist, [
    "https://app.example.com/billing",
    "chrome-extension://ligchebgiheiildjcnndjoalkpiamgko"
  ]);
});

test("payment link signature is HMAC_SHA256 over the canonical amount/cancel/description/order/return string", () => {
  const request = {
    orderCode: 1780000000123,
    amount: 199_000,
    description: "Evo Dubbing 300 phut",
    cancelUrl: "https://app.example.com/billing/cancel",
    returnUrl: "https://app.example.com/billing/return"
  };
  const raw =
    "amount=199000" +
    "&cancelUrl=https://app.example.com/billing/cancel" +
    "&description=Evo Dubbing 300 phut" +
    "&orderCode=1780000000123" +
    "&returnUrl=https://app.example.com/billing/return";
  assert.equal(paymentLinkSignature(request, CHECKSUM_KEY), hmac(raw));
});

test("checkout builder rejects unknown plan ids", () => {
  const built = buildCheckout(testConfig(), {
    planId: "vi_yearly_unlimited",
    returnUrl: "https://app.example.com/billing/return",
    cancelUrl: "https://app.example.com/billing/cancel"
  });
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.code, "unknown_plan");
});

test("checkout builder rejects return and cancel URLs outside the allowlist", () => {
  const config = testConfig();
  assert.equal(isAllowedRedirectUrl("https://app.example.com/billing/return", config.returnUrlAllowlist), true);
  assert.equal(isAllowedRedirectUrl("https://app.example.com.evil.com/billing", config.returnUrlAllowlist), false);
  assert.equal(isAllowedRedirectUrl("https://app.example.com/phishing", config.returnUrlAllowlist), false);
  assert.equal(isAllowedRedirectUrl("http://app.example.com/billing", config.returnUrlAllowlist), false);
  assert.equal(isAllowedRedirectUrl("javascript:alert(1)", config.returnUrlAllowlist), false);
  assert.equal(isAllowedRedirectUrl("not a url", config.returnUrlAllowlist), false);
  const built = buildCheckout(config, {
    planId: "vi_monthly_300",
    returnUrl: "https://evil.example.com/steal",
    cancelUrl: "https://app.example.com/billing/cancel"
  });
  assert.equal(built.ok, false);
  if (!built.ok) assert.equal(built.code, "redirect_not_allowed");
});

test("checkout builder pins amount server-side, sets expiry and generates unique order codes", () => {
  const randomValues = [0.1, 0.2, 0.3];
  let i = 0;
  const random = () => randomValues[i++ % randomValues.length];
  const first = buildCheckout(testConfig(), {
    planId: "vi_monthly_300",
    returnUrl: "https://app.example.com/billing/return",
    cancelUrl: "https://app.example.com/billing/cancel",
    nowMs: T0,
    random
  });
  const second = buildCheckout(testConfig(), {
    planId: "vi_monthly_300",
    returnUrl: "https://app.example.com/billing/return",
    cancelUrl: "https://app.example.com/billing/cancel",
    nowMs: T0 + 1000,
    random
  });
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.equal(first.amountMinor, 199_000);
    assert.equal(first.currency, "VND");
    assert.equal(first.expiredAtSec - Math.floor(T0 / 1000), 900);
    assert.notEqual(first.orderCode, second.orderCode);
    assert.ok(Number.isSafeInteger(first.orderCode) && first.orderCode > 0);
  }
  assert.notEqual(generateOrderCode(T0, () => 0.5), generateOrderCode(T0, () => 0.6));
});

test("createPaymentLink posts signed payload with client credentials and parses the checkout url", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        code: "00",
        desc: "success",
        data: { checkoutUrl: "https://pay.payos.vn/web/abc", paymentLinkId: "plink-1", orderCode: 42 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const result = await createPaymentLink(
    testConfig(),
    {
      orderCode: 42,
      amount: 199_000,
      description: "Evo Dubbing 300 phut",
      cancelUrl: "https://app.example.com/billing/cancel",
      returnUrl: "https://app.example.com/billing/return",
      expiredAt: 1_900_000_000
    },
    fetchImpl
  );
  assert.equal(result.checkoutUrl, "https://pay.payos.vn/web/abc");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api-merchant.payos.vn/v2/payment-requests");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-client-id"], CLIENT_ID);
  assert.equal(headers["x-api-key"], API_KEY);
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.orderCode, 42);
  assert.equal(sent.expiredAt, 1_900_000_000);
  assert.equal(
    sent.signature,
    paymentLinkSignature(
      {
        orderCode: 42,
        amount: 199_000,
        description: "Evo Dubbing 300 phut",
        cancelUrl: "https://app.example.com/billing/cancel",
        returnUrl: "https://app.example.com/billing/return"
      },
      CHECKSUM_KEY
    )
  );
});

test("createPaymentLink throws when PayOS does not return code 00", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ code: "201", desc: "invalid signature", data: null }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  await assert.rejects(
    createPaymentLink(
      testConfig(),
      {
        orderCode: 42,
        amount: 199_000,
        description: "Evo Dubbing 300 phut",
        cancelUrl: "https://app.example.com/billing/cancel",
        returnUrl: "https://app.example.com/billing/return"
      },
      fetchImpl
    ),
    /payment link failed/
  );
});

test("webhook data canonicalization sorts keys and serializes nested values", () => {
  const canonical = canonicalizeWebhookData({ b: 2, a: "x", c: null, d: { nested: true } });
  assert.equal(canonical, 'a=x&b=2&c=&d={"nested":true}');
  const data = successData(999);
  assert.equal(
    verifyWebhookSignature(data, hmac(canonicalizeWebhookData(data)), CHECKSUM_KEY),
    true
  );
  assert.equal(verifyWebhookSignature(data, hmac("tampered"), CHECKSUM_KEY), false);
});

test("webhook with a wrong signature is rejected and activates nothing", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 111 });
  const body = webhookBody(successData(111), "attacker-key");
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 401);
    assert.equal(outcome.code, "invalid_signature");
  }
  assert.equal(store.payments[0].status, "pending");
  assert.equal(store.periods.length, 0);
});

test("webhook with a tampered amount does not activate", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 112, amountMinor: 199_000 });
  const body = webhookBody(successData(112, { amount: 1_000 }));
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.ok(outcome.ok);
  if (outcome.ok) {
    assert.equal(outcome.activated, false);
    assert.equal(outcome.reason, "amount_mismatch");
  }
  assert.equal(store.payments[0].status, "pending");
  assert.equal(store.periods.length, 0);
});

test("webhook with a mismatched currency does not activate", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 113 });
  const body = webhookBody(successData(113, { currency: "USD" }));
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.ok(outcome.ok);
  if (outcome.ok) assert.equal(outcome.reason, "currency_mismatch");
  assert.equal(store.periods.length, 0);
});

test("webhook for an unknown orderCode activates nothing", async () => {
  const store = new MemoryStore();
  const body = webhookBody(successData(424242));
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.ok(outcome.ok);
  if (outcome.ok) {
    assert.equal(outcome.activated, false);
    assert.equal(outcome.reason, "unknown_order");
  }
  assert.equal(store.periods.length, 0);
});

test("webhook with a non-success code does not activate", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 114 });
  const body = webhookBody(successData(114, { code: "01", desc: "Cancelled" }));
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.ok(outcome.ok);
  if (outcome.ok) assert.equal(outcome.reason, "payment_not_successful");
  assert.equal(store.payments[0].status, "pending");
  assert.equal(store.periods.length, 0);
});

test("correct webhook marks the payment paid and creates exactly one 30 day active period", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 115 });
  const body = webhookBody(successData(115));
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.ok(outcome.ok);
  if (outcome.ok) {
    assert.equal(outcome.activated, true);
    assert.equal(outcome.duplicate, false);
  }
  assert.equal(store.payments[0].status, "paid");
  assert.equal(store.periods.length, 1);
  const period = store.periods[0];
  assert.equal(period.status, "active");
  assert.equal(period.accountId, ACCOUNT_ID);
  assert.equal(period.paymentId, store.payments[0].id);
  assert.equal(period.startAt.getTime(), T0);
  assert.equal(period.endAt.getTime(), T0 + PERIOD_LENGTH_MS);
  assert.equal(period.quotaMs, PERIOD_QUOTA_MS);
  assert.equal(period.usedMs, 0);
});

test("replayed webhook delivery does not create a second period", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 116 });
  const body = webhookBody(successData(116));
  const first = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  const second = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0 + 5_000);
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.equal(first.activated, true);
    assert.equal(second.activated, false);
    assert.equal(second.duplicate, true);
  }
  assert.equal(store.periods.length, 1);
});

test("renewal during an active period queues the next period without overlap", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 117 });
  const first = await processPayOsWebhook(store, webhookBody(successData(117)), CHECKSUM_KEY, T0);
  assert.ok(first.ok);
  store.addPayment({ orderCode: 118, id: "payment-2" });
  const second = await processPayOsWebhook(
    store,
    webhookBody(successData(118)),
    CHECKSUM_KEY,
    T0 + 10 * 24 * 60 * 60 * 1000
  );
  assert.ok(second.ok);
  if (second.ok) assert.equal(second.activated, true);
  assert.equal(store.periods.length, 2);
  const queued = store.periods[1];
  assert.equal(queued.status, "queued");
  assert.equal(queued.startAt.getTime(), store.periods[0].endAt.getTime());
  assert.equal(queued.endAt.getTime(), store.periods[0].endAt.getTime() + PERIOD_LENGTH_MS);
});

test("webhook payload never trusts returnUrl fields for activation", async () => {
  const store = new MemoryStore();
  store.addPayment({ orderCode: 119 });
  const body = webhookBody(
    successData(119, { returnUrl: "https://evil.example.com/claim", cancelUrl: "https://evil.example.com" })
  );
  const outcome = await processPayOsWebhook(store, body, CHECKSUM_KEY, T0);
  assert.ok(outcome.ok);
  if (outcome.ok) assert.equal(outcome.activated, true);
  assert.equal(store.periods.length, 1);
  assert.equal("returnUrl" in store.periods[0], false);
});
