import { sql } from "drizzle-orm";
import { db } from "@/db";
import { creatorOutreach, playbackDailyTotals, playbackEventDedupe } from "@/db/schema";
import { createPlaybackEventHandlers, productEventConfig } from "@/lib/product-events";
import type { PlaybackEventStore } from "@/lib/product-events";

export const runtime = "nodejs";

const store: PlaybackEventStore = {
  async tryInsertDedupe(row) {
    const inserted = await db
      .insert(playbackEventDedupe)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: playbackEventDedupe.id });
    return inserted.length > 0;
  },
  async incrementDaily(platform, videoId, day) {
    await db
      .insert(playbackDailyTotals)
      .values({ platform, videoId, day, starts: 1 })
      .onConflictDoUpdate({
        target: [playbackDailyTotals.platform, playbackDailyTotals.videoId, playbackDailyTotals.day],
        set: { starts: sql`${playbackDailyTotals.starts} + 1` }
      });
  },
  async totalStarts(platform, videoId) {
    const rows = await db.execute(
      sql`SELECT coalesce(sum(${playbackDailyTotals.starts}), 0) AS total FROM ${playbackDailyTotals}
          WHERE ${playbackDailyTotals.platform} = ${platform} AND ${playbackDailyTotals.videoId} = ${videoId}`
    );
    const first = (rows as unknown as { total: string | number }[])[0];
    return Number(first?.total ?? 0);
  },
  async findOutreach(platform, videoId) {
    const rows = await db
      .select({ id: creatorOutreach.id })
      .from(creatorOutreach)
      .where(sql`${creatorOutreach.platform} = ${platform} AND ${creatorOutreach.videoId} = ${videoId}`)
      .limit(1);
    return rows[0] ?? null;
  },
  async insertOutreach(row) {
    await db.insert(creatorOutreach).values(row).onConflictDoNothing();
  }
};

const handlers = createPlaybackEventHandlers({ store, config: productEventConfig() });

export const POST = handlers.report;
