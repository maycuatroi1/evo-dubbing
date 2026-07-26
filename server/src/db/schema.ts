import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  date,
  timestamp,
  index,
  uniqueIndex,
  check
} from "drizzle-orm/pg-core";

export const PERIOD_QUOTA_MS = 18_000_000;
export const PERIOD_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

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
    generationProfile: text("generation_profile"),
    voiceProfile: text("voice_profile"),
    rightsAssertedAt: timestamp("rights_asserted_at", { withTimezone: true }),
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

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    provider: text("provider").notNull().default("payos"),
    orderCode: bigint("order_code", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("VND"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    orderCodeUnique: uniqueIndex("payments_order_code_idx").on(t.provider, t.orderCode),
    idempotencyUnique: uniqueIndex("payments_idempotency_key_idx").on(t.idempotencyKey),
    accountIdx: index("payments_account_idx").on(t.accountId, t.createdAt),
    amountPositive: check("payments_amount_minor_positive", sql`${t.amountMinor} >= 0`)
  })
);

export const subscriptionPeriods = pgTable(
  "subscription_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    quotaMs: bigint("quota_ms", { mode: "number" }).notNull().default(PERIOD_QUOTA_MS),
    usedMs: bigint("used_ms", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    accountIdx: index("subscription_periods_account_idx").on(t.accountId, t.startAt),
    oneActivePerAccount: uniqueIndex("subscription_periods_one_active_idx")
      .on(t.accountId)
      .where(sql`${t.status} = 'active'`),
    windowOrdered: check("subscription_periods_window_ordered", sql`${t.endAt} > ${t.startAt}`),
    quotaPositive: check("subscription_periods_quota_positive", sql`${t.quotaMs} > 0`),
    usedWithinQuota: check(
      "subscription_periods_used_within_quota",
      sql`${t.usedMs} >= 0 AND ${t.usedMs} <= ${t.quotaMs}`
    ),
    statusKnown: check(
      "subscription_periods_status_known",
      sql`${t.status} IN ('active', 'queued', 'expired', 'cancelled')`
    )
  })
);

export const inferenceRequests = pgTable(
  "inference_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestKey: text("request_key").notNull(),
    accountId: text("account_id").notNull(),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("pending"),
    periodId: uuid("period_id").references(() => subscriptionPeriods.id, { onDelete: "set null" }),
    reservedMs: bigint("reserved_ms", { mode: "number" }).notNull().default(0),
    result: text("result").notNull().default(""),
    inputChars: integer("input_chars").notNull().default(0),
    outputChars: integer("output_chars").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    costMicrousd: bigint("cost_microusd", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    requestKeyUnique: uniqueIndex("inference_requests_request_key_idx").on(t.requestKey),
    accountIdx: index("inference_requests_account_idx").on(t.accountId, t.createdAt),
    periodIdx: index("inference_requests_period_idx").on(t.periodId),
    latencyNonNegative: check("inference_requests_latency_non_negative", sql`${t.latencyMs} >= 0`),
    costNonNegative: check("inference_requests_cost_non_negative", sql`${t.costMicrousd} >= 0`),
    reservedNonNegative: check("inference_requests_reserved_non_negative", sql`${t.reservedMs} >= 0`)
  })
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    inferenceRequestId: uuid("inference_request_id").references(() => inferenceRequests.id, {
      onDelete: "set null"
    }),
    periodId: uuid("period_id").references(() => subscriptionPeriods.id, { onDelete: "set null" }),
    sourceMs: bigint("source_ms", { mode: "number" }).notNull().default(0),
    generatedChars: integer("generated_chars").notNull().default(0),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    currency: text("currency").notNull().default("USD"),
    costMicrousd: bigint("cost_microusd", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status").notNull().default("ok"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    accountIdx: index("usage_events_account_idx").on(t.accountId, t.createdAt),
    periodIdx: index("usage_events_period_idx").on(t.periodId),
    sourceNonNegative: check("usage_events_source_non_negative", sql`${t.sourceMs} >= 0`),
    charsNonNegative: check("usage_events_chars_non_negative", sql`${t.generatedChars} >= 0`),
    costNonNegative: check("usage_events_cost_non_negative", sql`${t.costMicrousd} >= 0`),
    latencyNonNegative: check("usage_events_latency_non_negative", sql`${t.latencyMs} >= 0`)
  })
);

export const dailyProductEvents = pgTable(
  "daily_product_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    day: date("day").notNull(),
    kind: text("kind").notNull(),
    requests: integer("requests").notNull().default(0),
    sourceMs: bigint("source_ms", { mode: "number" }).notNull().default(0),
    generatedChars: integer("generated_chars").notNull().default(0),
    costMicrousd: bigint("cost_microusd", { mode: "number" }).notNull().default(0)
  },
  (t) => ({
    rollupUnique: uniqueIndex("daily_product_events_rollup_idx").on(t.accountId, t.day, t.kind),
    countersNonNegative: check(
      "daily_product_events_counters_non_negative",
      sql`${t.requests} >= 0 AND ${t.sourceMs} >= 0 AND ${t.generatedChars} >= 0 AND ${t.costMicrousd} >= 0`
    )
  })
);

export const creatorOutreach = pgTable(
  "creator_outreach",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    platform: text("platform").notNull(),
    handle: text("handle").notNull(),
    channelUrl: text("channel_url").notNull().default(""),
    status: text("status").notNull().default("new"),
    notes: text("notes").notNull().default(""),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    creatorUnique: uniqueIndex("creator_outreach_creator_idx").on(t.platform, t.handle)
  })
);

export const takedownRequests = pgTable(
  "takedown_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dubId: uuid("dub_id").references(() => dubs.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    reporterEmail: text("reporter_email").notNull(),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idempotencyUnique: uniqueIndex("takedown_requests_idempotency_key_idx").on(t.idempotencyKey),
    statusIdx: index("takedown_requests_status_idx").on(t.status, t.createdAt)
  })
);

export type PaymentRow = typeof payments.$inferSelect;
export type SubscriptionPeriodRow = typeof subscriptionPeriods.$inferSelect;
export type InferenceRequestRow = typeof inferenceRequests.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
export type DailyProductEventRow = typeof dailyProductEvents.$inferSelect;
export type CreatorOutreachRow = typeof creatorOutreach.$inferSelect;
export type TakedownRequestRow = typeof takedownRequests.$inferSelect;
