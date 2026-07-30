import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { v1Error, v1Json, V1_ERROR_CODES } from "@/lib/api-error";
import { managedFlags } from "@/lib/account";
import {
  SupabaseAuthenticator,
  UserOperationRateLimiter,
  authConfig,
  requireV1Auth
} from "@/lib/auth";
import { buildCheckout, createPaymentLink, parsePayOsConfig } from "@/lib/payos";

export const runtime = "nodejs";

const config = authConfig();
const authenticator = new SupabaseAuthenticator(config);
const limiter = new UserOperationRateLimiter(config.rateLimitPerMinute);

export async function POST(request: Request) {
  const auth = await requireV1Auth(request, authenticator, limiter, "billing.checkout");
  if (!auth.ok) {
    const headers: Record<string, string> = {};
    if (auth.retryAfterSec) headers["retry-after"] = String(auth.retryAfterSec);
    return v1Error(auth.code, auth.message, auth.status, headers);
  }

  if (!managedFlags().checkout) {
    return v1Error(V1_ERROR_CODES.checkoutDisabled, "managed checkout is not enabled", 403);
  }

  const payos = parsePayOsConfig(process.env);
  if (!payos) {
    return v1Error(V1_ERROR_CODES.checkoutUnavailable, "PayOS credentials are not configured", 503);
  }

  const body = (await request.json().catch(() => null)) as {
    planId?: unknown;
    returnUrl?: unknown;
    cancelUrl?: unknown;
  } | null;
  const checkout = buildCheckout(payos, {
    planId: body?.planId,
    returnUrl: body?.returnUrl,
    cancelUrl: body?.cancelUrl
  });
  if (!checkout.ok) {
    return v1Error(checkout.code, checkout.message, 400);
  }

  let paymentId: string | null = null;
  for (let attempt = 0; attempt < 2 && paymentId === null; attempt += 1) {
    const orderCode = attempt === 0 ? checkout.orderCode : checkout.orderCode + 1;
    try {
      const rows = await db
        .insert(payments)
        .values({
          accountId: auth.userId,
          provider: "payos",
          orderCode,
          idempotencyKey: randomUUID(),
          amountMinor: checkout.amountMinor,
          currency: checkout.currency,
          status: "pending"
        })
        .returning({ id: payments.id });
      paymentId = rows[0]?.id ?? null;
      checkout.orderCode = orderCode;
    } catch (err) {
      const message = String((err as { message?: unknown })?.message ?? err);
      if (!/payments_order_code_idx|duplicate key/i.test(message) || attempt === 1) {
        return v1Error(V1_ERROR_CODES.internal, "could not create pending payment", 500);
      }
    }
  }

  try {
    const link = await createPaymentLink(payos, {
      orderCode: checkout.orderCode,
      amount: checkout.amountMinor,
      description: checkout.description,
      cancelUrl: checkout.cancelUrl,
      returnUrl: checkout.returnUrl,
      expiredAt: checkout.expiredAtSec
    });
    return v1Json({
      checkoutUrl: link.checkoutUrl,
      orderCode: checkout.orderCode,
      amountMinor: checkout.amountMinor,
      currency: checkout.currency,
      expiresAt: new Date(checkout.expiredAtSec * 1000).toISOString()
    });
  } catch {
    return v1Error(V1_ERROR_CODES.checkoutFailed, "PayOS payment link creation failed", 502);
  }
}
