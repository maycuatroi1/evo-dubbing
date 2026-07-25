import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { payments, subscriptionPeriods } from "@/db/schema";
import { v1Error, v1Json, V1_ERROR_CODES } from "@/lib/api-error";
import {
  parsePayOsConfig,
  processPayOsWebhook
} from "@/lib/payos";
import type { BillingWebhookStore, WebhookPayment } from "@/lib/payos";
import type { PeriodWindow, PlannedPeriod } from "@/lib/subscription";

export const runtime = "nodejs";

const store: BillingWebhookStore = {
  async getPaymentByOrderCode(orderCode: number): Promise<WebhookPayment | null> {
    const rows = await db
      .select({
        id: payments.id,
        accountId: payments.accountId,
        orderCode: payments.orderCode,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        status: payments.status
      })
      .from(payments)
      .where(and(eq(payments.provider, "payos"), eq(payments.orderCode, orderCode)))
      .limit(1);
    return rows[0] ?? null;
  },

  async listOpenPeriods(accountId: string): Promise<PeriodWindow[]> {
    const rows = await db
      .select({
        startAt: subscriptionPeriods.startAt,
        endAt: subscriptionPeriods.endAt,
        status: subscriptionPeriods.status
      })
      .from(subscriptionPeriods)
      .where(
        and(
          eq(subscriptionPeriods.accountId, accountId),
          inArray(subscriptionPeriods.status, ["active", "queued"])
        )
      );
    return rows.map((row) => ({
      startMs: new Date(row.startAt).getTime(),
      endMs: new Date(row.endAt).getTime(),
      status: row.status as PeriodWindow["status"]
    }));
  },

  async finalizePayment(payment: WebhookPayment, planned: PlannedPeriod): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(payments)
        .set({ status: "paid", updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")))
        .returning({ id: payments.id });
      if (updated.length === 0) return false;
      await tx.insert(subscriptionPeriods).values({
        accountId: payment.accountId,
        paymentId: payment.id,
        startAt: planned.startAt,
        endAt: planned.endAt,
        quotaMs: planned.quotaMs,
        usedMs: planned.usedMs,
        status: planned.status
      });
      return true;
    });
  }
};

export async function POST(request: Request) {
  const payos = parsePayOsConfig(process.env);
  if (!payos) {
    return v1Error(V1_ERROR_CODES.checkoutUnavailable, "PayOS credentials are not configured", 503);
  }
  const body = await request.json().catch(() => null);
  const outcome = await processPayOsWebhook(store, body, payos.checksumKey);
  if (!outcome.ok) {
    return v1Error(outcome.code, outcome.message, outcome.status);
  }
  return v1Json({
    received: true,
    activated: outcome.activated,
    duplicate: outcome.duplicate,
    orderCode: outcome.orderCode
  });
}
