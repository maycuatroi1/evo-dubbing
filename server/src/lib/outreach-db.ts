import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { creatorOutreach, dubs, takedownRequests } from "@/db/schema";
import type { OutreachRecord, OutreachStore, TakedownStore } from "./outreach.ts";

function toRecord(row: typeof creatorOutreach.$inferSelect): OutreachRecord {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    channelUrl: row.channelUrl,
    channelId: row.channelId,
    videoId: row.videoId,
    creatorEmail: row.creatorEmail,
    status: row.status
  };
}

export function createDrizzleOutreachStore(): OutreachStore {
  return {
    async listPending() {
      const rows = await db
        .select()
        .from(creatorOutreach)
        .where(eq(creatorOutreach.status, "pending"))
        .orderBy(asc(creatorOutreach.createdAt));
      return rows.map(toRecord);
    },
    async findById(id) {
      const rows = await db.select().from(creatorOutreach).where(eq(creatorOutreach.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async setCreatorEmail(id, email) {
      await db
        .update(creatorOutreach)
        .set({ creatorEmail: email, updatedAt: new Date() })
        .where(eq(creatorOutreach.id, id));
    },
    async markSent(id, at) {
      await db
        .update(creatorOutreach)
        .set({ status: "sent", lastContactedAt: at, updatedAt: at })
        .where(eq(creatorOutreach.id, id));
    }
  };
}

export function createDrizzleTakedownStore(): TakedownStore {
  return {
    async unpublishDubs(platform, videoId) {
      const targets = await db
        .select({ id: dubs.id, visibility: dubs.visibility })
        .from(dubs)
        .where(and(eq(dubs.platform, platform), eq(dubs.videoId, videoId), eq(dubs.visibility, "public")));
      for (const target of targets) {
        await db
          .update(dubs)
          .set({ visibility: "unpublished", updatedAt: new Date() })
          .where(and(eq(dubs.id, target.id), eq(dubs.visibility, "public")));
      }
      return targets.map((t) => ({ id: t.id, previousVisibility: t.visibility }));
    },
    async insertAudit(rows) {
      if (rows.length === 0) return;
      await db
        .insert(takedownRequests)
        .values(
          rows.map((row) => ({
            dubId: row.dubId,
            idempotencyKey: row.idempotencyKey,
            reporterEmail: row.reporterEmail,
            platform: row.platform,
            videoId: row.videoId,
            previousVisibility: row.previousVisibility,
            reason: row.reason,
            status: row.status
          }))
        )
        .onConflictDoNothing();
    },
    async appliedAudits(platform, videoId) {
      const rows = await db
        .select({
          id: takedownRequests.id,
          dubId: takedownRequests.dubId,
          previousVisibility: takedownRequests.previousVisibility
        })
        .from(takedownRequests)
        .where(
          and(
            eq(takedownRequests.platform, platform),
            eq(takedownRequests.videoId, videoId),
            eq(takedownRequests.status, "applied")
          )
        );
      return rows
        .filter((row) => row.dubId)
        .map((row) => ({ id: row.id, dubId: row.dubId as string, previousVisibility: row.previousVisibility }));
    },
    async restoreDub(dubId, visibility) {
      await db.update(dubs).set({ visibility, updatedAt: new Date() }).where(eq(dubs.id, dubId));
    },
    async markAuditRestored(id) {
      await db
        .update(takedownRequests)
        .set({ status: "restored", updatedAt: new Date() })
        .where(eq(takedownRequests.id, id));
    }
  };
}
