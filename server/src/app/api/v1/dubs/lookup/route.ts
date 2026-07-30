import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dubs, dubSegments } from "@/db/schema";
import { authConfig, SupabaseAuthenticator, UserOperationRateLimiter } from "@/lib/auth";
import { createSharedLookupHandlers } from "@/lib/managed/shared-lookup";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

const config = authConfig();

const handlers = createSharedLookupHandlers({
  authenticator: new SupabaseAuthenticator(config),
  limiter: new UserOperationRateLimiter(config.rateLimitPerMinute),
  findCandidates: async (query) =>
    db.query.dubs.findMany({
      where: and(
        eq(dubs.platform, query.platform),
        eq(dubs.videoId, query.videoId),
        eq(dubs.targetLang, query.targetLang),
        eq(dubs.status, "ready"),
        eq(dubs.visibility, "public")
      )
    }),
  findSegments: async (dubId) =>
    db.query.dubSegments.findMany({
      where: eq(dubSegments.dubId, dubId),
      orderBy: [asc(dubSegments.idx)]
    }),
  presign: presignGet
});

export const GET = handlers.lookup;
