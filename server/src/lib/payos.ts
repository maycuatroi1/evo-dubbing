import { createHmac, timingSafeEqual } from "node:crypto";
import { PERIOD_LENGTH_MS, PERIOD_QUOTA_MS } from "../db/schema.ts";
import { planSubscriptionPeriod } from "./subscription.ts";
import type { PeriodWindow, PlannedPeriod } from "./subscription.ts";

export const PAYOS_API_BASE = "https://api-merchant.payos.vn";
export const PAYOS_SUCCESS_CODE = "00";
export const DEFAULT_CHECKOUT_EXPIRY_SEC = 900;

export interface PlanDefinition {
  id: string;
  amountMinor: number;
  currency: string;
  minutes: number;
  quotaMs: number;
  periodDays: number;
  description: string;
}

export const PLANS: Record<string, PlanDefinition> = {
  vi_monthly_300: {
    id: "vi_monthly_300",
    amountMinor: 199_000,
    currency: "VND",
    minutes: 300,
    quotaMs: PERIOD_QUOTA_MS,
    periodDays: 30,
    description: "Evo Dubbing 300 phut"
  }
};

export interface PayOsConfig {
  clientId: string;
  apiKey: string;
  checksumKey: string;
  apiBase: string;
  returnUrlAllowlist: string[];
  checkoutExpirySec: number;
}

export function parsePayOsConfig(env: Record<string, string | undefined>): PayOsConfig | null {
  const clientId = env.PAYOS_CLIENT_ID?.trim();
  const apiKey = env.PAYOS_API_KEY?.trim();
  const checksumKey = env.PAYOS_CHECKSUM_KEY?.trim();
  if (!clientId || !apiKey || !checksumKey) return null;
  const allowlist = (env.PAYOS_RETURN_URL_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const expiry = Number(env.PAYOS_CHECKOUT_EXPIRY_SEC ?? DEFAULT_CHECKOUT_EXPIRY_SEC);
  return {
    clientId,
    apiKey,
    checksumKey,
    apiBase: env.PAYOS_API_BASE?.trim() || PAYOS_API_BASE,
    returnUrlAllowlist: allowlist,
    checkoutExpirySec: Number.isFinite(expiry) && expiry > 0 ? Math.floor(expiry) : DEFAULT_CHECKOUT_EXPIRY_SEC
  };
}

export function hmacSha256Hex(key: string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

export function signaturesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface PaymentLinkRequest {
  orderCode: number;
  amount: number;
  description: string;
  cancelUrl: string;
  returnUrl: string;
  expiredAt?: number;
}

export function paymentLinkSignature(request: PaymentLinkRequest, checksumKey: string): string {
  const raw =
    `amount=${request.amount}` +
    `&cancelUrl=${request.cancelUrl}` +
    `&description=${request.description}` +
    `&orderCode=${request.orderCode}` +
    `&returnUrl=${request.returnUrl}`;
  return hmacSha256Hex(checksumKey, raw);
}

export function canonicalizeWebhookData(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .map((key) => {
      const value = data[key];
      if (value === null || value === undefined) return `${key}=`;
      if (typeof value === "object") return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    })
    .join("&");
}

export function verifyWebhookSignature(
  data: Record<string, unknown>,
  signature: string,
  checksumKey: string
): boolean {
  const expected = hmacSha256Hex(checksumKey, canonicalizeWebhookData(data));
  return signaturesEqual(expected, signature);
}

export function generateOrderCode(nowMs: number, random: () => number = Math.random): number {
  const seconds = Math.floor(nowMs / 1000);
  const suffix = Math.floor(random() * 1000);
  return seconds * 1000 + suffix;
}

export function isAllowedRedirectUrl(rawUrl: string, allowlist: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "chrome-extension:") return false;
  for (const entry of allowlist) {
    let allowed: URL;
    try {
      allowed = new URL(entry);
    } catch {
      continue;
    }
    if (parsed.origin !== allowed.origin) continue;
    const prefix = allowed.pathname.endsWith("/")
      ? allowed.pathname
      : `${allowed.pathname}/`;
    if (
      allowed.pathname === "/" ||
      parsed.pathname === allowed.pathname ||
      parsed.pathname.startsWith(prefix)
    ) {
      return true;
    }
  }
  return false;
}

export type CheckoutBuild =
  | {
      ok: true;
      plan: PlanDefinition;
      orderCode: number;
      amountMinor: number;
      currency: string;
      description: string;
      returnUrl: string;
      cancelUrl: string;
      expiredAtSec: number;
    }
  | { ok: false; code: string; message: string };

export function buildCheckout(
  config: PayOsConfig,
  input: { planId: unknown; returnUrl: unknown; cancelUrl: unknown; nowMs?: number; random?: () => number }
): CheckoutBuild {
  const planId = typeof input.planId === "string" ? input.planId : "";
  const plan = PLANS[planId];
  if (!plan) {
    return { ok: false, code: "unknown_plan", message: "planId must be vi_monthly_300" };
  }
  if (typeof input.returnUrl !== "string" || typeof input.cancelUrl !== "string") {
    return { ok: false, code: "invalid_payload", message: "returnUrl and cancelUrl are required" };
  }
  if (!isAllowedRedirectUrl(input.returnUrl, config.returnUrlAllowlist)) {
    return { ok: false, code: "redirect_not_allowed", message: "returnUrl is not allowlisted" };
  }
  if (!isAllowedRedirectUrl(input.cancelUrl, config.returnUrlAllowlist)) {
    return { ok: false, code: "redirect_not_allowed", message: "cancelUrl is not allowlisted" };
  }
  const nowMs = input.nowMs ?? Date.now();
  return {
    ok: true,
    plan,
    orderCode: generateOrderCode(nowMs, input.random),
    amountMinor: plan.amountMinor,
    currency: plan.currency,
    description: plan.description,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
    expiredAtSec: Math.floor(nowMs / 1000) + config.checkoutExpirySec
  };
}

export class PayOsApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export interface PaymentLinkResult {
  checkoutUrl: string;
  paymentLinkId: string;
  orderCode: number;
}

export async function createPaymentLink(
  config: PayOsConfig,
  request: PaymentLinkRequest,
  fetchImpl: typeof fetch = fetch
): Promise<PaymentLinkResult> {
  const signature = paymentLinkSignature(request, config.checksumKey);
  const response = await fetchImpl(`${config.apiBase}/v2/payment-requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-id": config.clientId,
      "x-api-key": config.apiKey
    },
    body: JSON.stringify({ ...request, signature })
  });
  const payload = (await response.json().catch(() => null)) as {
    code?: string;
    desc?: string;
    data?: { checkoutUrl?: string; paymentLinkId?: string; orderCode?: number };
  } | null;
  if (!response.ok || !payload || payload.code !== PAYOS_SUCCESS_CODE || !payload.data?.checkoutUrl) {
    throw new PayOsApiError(
      `payos create payment link failed: ${payload?.desc ?? response.status}`,
      response.status,
      payload
    );
  }
  return {
    checkoutUrl: payload.data.checkoutUrl,
    paymentLinkId: payload.data.paymentLinkId ?? "",
    orderCode: Number(payload.data.orderCode ?? request.orderCode)
  };
}

export interface WebhookPayment {
  id: string;
  accountId: string;
  orderCode: number;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface BillingWebhookStore {
  getPaymentByOrderCode(orderCode: number): Promise<WebhookPayment | null>;
  listOpenPeriods(accountId: string): Promise<PeriodWindow[]>;
  finalizePayment(payment: WebhookPayment, planned: PlannedPeriod): Promise<boolean>;
}

export type WebhookOutcome =
  | {
      ok: true;
      activated: boolean;
      duplicate: boolean;
      orderCode: number;
      reason?: string;
    }
  | { ok: false; status: number; code: string; message: string };

export async function processPayOsWebhook(
  store: BillingWebhookStore,
  body: unknown,
  checksumKey: string,
  nowMs: number = Date.now()
): Promise<WebhookOutcome> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, code: "invalid_payload", message: "webhook body must be an object" };
  }
  const envelope = body as { code?: unknown; data?: unknown; signature?: unknown };
  if (typeof envelope.signature !== "string" || typeof envelope.data !== "object" || envelope.data === null) {
    return { ok: false, status: 400, code: "invalid_payload", message: "missing data or signature" };
  }
  const data = envelope.data as Record<string, unknown>;
  if (!verifyWebhookSignature(data, envelope.signature, checksumKey)) {
    return { ok: false, status: 401, code: "invalid_signature", message: "webhook signature mismatch" };
  }
  const orderCode = Number(data.orderCode);
  if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
    return { ok: false, status: 400, code: "invalid_payload", message: "orderCode must be a positive integer" };
  }
  const payment = await store.getPaymentByOrderCode(orderCode);
  if (!payment) {
    return { ok: true, activated: false, duplicate: false, orderCode, reason: "unknown_order" };
  }
  if (payment.status !== "pending") {
    return { ok: true, activated: false, duplicate: true, orderCode, reason: "already_finalized" };
  }
  const succeeded =
    envelope.code === PAYOS_SUCCESS_CODE && (data.code === undefined || data.code === PAYOS_SUCCESS_CODE);
  if (!succeeded) {
    return { ok: true, activated: false, duplicate: false, orderCode, reason: "payment_not_successful" };
  }
  if (Number(data.amount) !== payment.amountMinor) {
    return { ok: true, activated: false, duplicate: false, orderCode, reason: "amount_mismatch" };
  }
  const currency = typeof data.currency === "string" ? data.currency : "VND";
  if (currency !== payment.currency) {
    return { ok: true, activated: false, duplicate: false, orderCode, reason: "currency_mismatch" };
  }
  const planned = planSubscriptionPeriod(await store.listOpenPeriods(payment.accountId), nowMs);
  const created = await store.finalizePayment(payment, planned);
  return { ok: true, activated: created, duplicate: !created, orderCode };
}

export { PERIOD_LENGTH_MS, PERIOD_QUOTA_MS };
