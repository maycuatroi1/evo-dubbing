ALTER TABLE "inference_requests" ADD COLUMN IF NOT EXISTS "period_id" uuid;--> statement-breakpoint
ALTER TABLE "inference_requests" ADD COLUMN IF NOT EXISTS "reserved_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inference_requests" ADD COLUMN IF NOT EXISTS "result" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inference_requests" ADD CONSTRAINT "inference_requests_period_id_subscription_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inference_requests_period_idx" ON "inference_requests" USING btree ("period_id");--> statement-breakpoint
ALTER TABLE "inference_requests" DROP CONSTRAINT IF EXISTS "inference_requests_reserved_non_negative";--> statement-breakpoint
ALTER TABLE "inference_requests" ADD CONSTRAINT "inference_requests_reserved_non_negative" CHECK("reserved_ms" >= 0);
