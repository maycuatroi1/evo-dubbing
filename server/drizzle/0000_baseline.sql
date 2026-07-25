CREATE TABLE IF NOT EXISTS "dub_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dub_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"original_text" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"audio_key" text NOT NULL,
	"mime" text DEFAULT 'audio/mpeg' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"video_id" text NOT NULL,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"voice" text NOT NULL,
	"provider" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner_token_hash" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dub_segments" ADD CONSTRAINT "dub_segments_dub_id_dubs_id_fk" FOREIGN KEY ("dub_id") REFERENCES "public"."dubs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dub_segments_dub_idx" ON "dub_segments" USING btree ("dub_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dubs_lookup_idx" ON "dubs" USING btree ("platform","video_id","target_lang","voice","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dubs_public_idx" ON "dubs" USING btree ("visibility","created_at");
