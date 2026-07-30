import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { usageEvents } from "../../db/schema.ts";
import { managedFlags } from "../account.ts";
import { SupabaseAuthenticator, UserOperationRateLimiter, authConfig } from "../auth.ts";
import { budgetConfig } from "./budget.ts";
import { createR2CacheStore } from "./cache.ts";
import { createInferenceHandlers, parseInferenceConstraints } from "./inference-api.ts";
import type { InferenceHandlers } from "./inference-api.ts";
import { ManagedLedger, PgLedgerStore } from "./ledger.ts";
import { ManagedRouter } from "./provider-router.ts";

async function trialUsedMs(accountId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.sourceMs}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.accountId, accountId), isNull(usageEvents.periodId)));
  return Number(rows[0]?.total ?? 0);
}

export function createManagedInferenceRoutes(): InferenceHandlers {
  const config = authConfig();
  const ledger = new ManagedLedger(new PgLedgerStore(db));
  return createInferenceHandlers({
    authenticator: new SupabaseAuthenticator(config),
    limiter: new UserOperationRateLimiter(config.rateLimitPerMinute),
    router: new ManagedRouter({
      ledger,
      budget: budgetConfig(),
      cache: createR2CacheStore()
    }),
    ledger,
    flags: managedFlags,
    trialUsedMs,
    constraints: parseInferenceConstraints(process.env)
  });
}
