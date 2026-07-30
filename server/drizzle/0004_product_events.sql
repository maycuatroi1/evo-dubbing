CREATE TABLE IF NOT EXISTS "playback_event_dedupe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"video_id" text NOT NULL,
	"day" date NOT NULL,
	"install_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "playback_daily_totals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"video_id" text NOT NULL,
	"day" date NOT NULL,
	"starts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_outreach" ADD COLUMN IF NOT EXISTS "video_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_outreach" ADD COLUMN IF NOT EXISTS "channel_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_outreach" ADD COLUMN IF NOT EXISTS "creator_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD COLUMN IF NOT EXISTS "platform" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD COLUMN IF NOT EXISTS "video_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD COLUMN IF NOT EXISTS "previous_visibility" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playback_event_dedupe_idx" ON "playback_event_dedupe" USING btree ("platform","video_id","day","install_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "playback_daily_totals_rollup_idx" ON "playback_daily_totals" USING btree ("platform","video_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creator_outreach_video_idx" ON "creator_outreach" USING btree ("platform","video_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playback_daily_totals" ADD CONSTRAINT "playback_daily_totals_starts_non_negative" CHECK ("starts" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
