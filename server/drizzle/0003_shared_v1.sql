ALTER TABLE "dubs" ADD COLUMN IF NOT EXISTS "generation_profile" text;--> statement-breakpoint
ALTER TABLE "dubs" ADD COLUMN IF NOT EXISTS "voice_profile" text;--> statement-breakpoint
ALTER TABLE "dubs" ADD COLUMN IF NOT EXISTS "rights_asserted_at" timestamp with time zone;
