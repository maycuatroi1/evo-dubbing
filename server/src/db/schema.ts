import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const dubs = pgTable(
  "dubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").notNull(),
    videoId: text("video_id").notNull(),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    voice: text("voice").notNull(),
    provider: text("provider").notNull(),
    title: text("title").notNull().default(""),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("pending"),
    ownerTokenHash: text("owner_token_hash").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    segmentCount: integer("segment_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    lookupIdx: uniqueIndex("dubs_lookup_idx").on(
      t.platform,
      t.videoId,
      t.targetLang,
      t.voice,
      t.provider
    ),
    publicIdx: index("dubs_public_idx").on(t.visibility, t.createdAt)
  })
);

export const dubSegments = pgTable(
  "dub_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dubId: uuid("dub_id")
      .notNull()
      .references(() => dubs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    originalText: text("original_text").notNull().default(""),
    text: text("text").notNull().default(""),
    audioKey: text("audio_key").notNull(),
    mime: text("mime").notNull().default("audio/mpeg")
  },
  (t) => ({
    bySegment: uniqueIndex("dub_segments_dub_idx").on(t.dubId, t.idx)
  })
);

export type DubRow = typeof dubs.$inferSelect;
export type DubSegmentRow = typeof dubSegments.$inferSelect;
