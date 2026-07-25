import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptionPeriods, usageEvents } from "@/db/schema";
import { v1Error, v1Json, V1_ERROR_CODES } from "@/lib/api-error";
import {
  SupabaseAuthenticator,
  UserOperationRateLimiter,
  authConfig,
  requireV1Auth
} from "@/lib/auth";
import { buildAccountPayload, managedFlags } from "@/lib/account";

export const runtime = "nodejs";

const config = authConfig();
const authenticator = new SupabaseAuthenticator(config);
const limiter = new UserOperationRateLimiter(config.rateLimitPerMinute);

export async function GET(request: Request) {
  const auth = await requireV1Auth(request, authenticator, limiter, "account.read");
  if (!auth.ok) {
    const headers: Record<string, string> = {};
    if (auth.retryAfterSec) headers["retry-after"] = String(auth.retryAfterSec);
    return v1Error(auth.code, auth.message, auth.status, headers);
  }

  try {
    const periods = await db
      .select({
        id: subscriptionPeriods.id,
        startAt: subscriptionPeriods.startAt,
        endAt: subscriptionPeriods.endAt,
        quotaMs: subscriptionPeriods.quotaMs,
        usedMs: subscriptionPeriods.usedMs,
        status: subscriptionPeriods.status
      })
      .from(subscriptionPeriods)
      .where(
        and(
          eq(subscriptionPeriods.accountId, auth.userId),
          inArray(subscriptionPeriods.status, ["active", "queued"])
        )
      )
      .orderBy(asc(subscriptionPeriods.startAt));

    const trialRows = await db
      .select({ total: sql<string>`coalesce(sum(${usageEvents.sourceMs}), 0)` })
      .from(usageEvents)
      .where(and(eq(usageEvents.accountId, auth.userId), isNull(usageEvents.periodId)));

    const payload = buildAccountPayload({
      userId: auth.userId,
      periods,
      trialUsedMs: Number(trialRows[0]?.total ?? 0),
      flags: managedFlags(),
      now: new Date()
    });

    return v1Json(payload);
  } catch {
    return v1Error(V1_ERROR_CODES.internal, "account lookup failed", 500);
  }
}
