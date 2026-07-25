CREATE TABLE IF NOT EXISTS "creator_outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"channel_url" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"source_ms" bigint DEFAULT 0 NOT NULL,
	"generated_chars" integer DEFAULT 0 NOT NULL,
	"cost_microusd" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inference_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" text NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_chars" integer DEFAULT 0 NOT NULL,
	"output_chars" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"cost_microusd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider" text DEFAULT 'payos' NOT NULL,
	"order_code" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"payment_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"quota_ms" bigint DEFAULT 18000000 NOT NULL,
	"used_ms" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takedown_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dub_id" uuid,
	"idempotency_key" text NOT NULL,
	"reporter_email" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"inference_request_id" uuid,
	"period_id" uuid,
	"source_ms" bigint DEFAULT 0 NOT NULL,
	"generated_chars" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cost_microusd" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_dub_id_dubs_id_fk" FOREIGN KEY ("dub_id") REFERENCES "public"."dubs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_inference_request_id_inference_requests_id_fk" FOREIGN KEY ("inference_request_id") REFERENCES "public"."inference_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_period_id_subscription_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creator_outreach_creator_idx" ON "creator_outreach" USING btree ("platform","handle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_product_events_rollup_idx" ON "daily_product_events" USING btree ("account_id","day","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inference_requests_request_key_idx" ON "inference_requests" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inference_requests_account_idx" ON "inference_requests" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_order_code_idx" ON "payments" USING btree ("provider","order_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_idx" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_account_idx" ON "payments" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_periods_account_idx" ON "subscription_periods" USING btree ("account_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_periods_one_active_idx" ON "subscription_periods" USING btree ("account_id") WHERE "subscription_periods"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "takedown_requests_idempotency_key_idx" ON "takedown_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takedown_requests_status_idx" ON "takedown_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_account_idx" ON "usage_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_period_idx" ON "usage_events" USING btree ("period_id");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_minor_positive" CHECK ("amount_minor" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_window_ordered" CHECK ("end_at" > "start_at");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_quota_positive" CHECK ("quota_ms" > 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_used_within_quota" CHECK ("used_ms" >= 0 AND "used_ms" <= "quota_ms");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_status_known" CHECK ("status" IN ('active', 'queued', 'expired', 'cancelled'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_no_overlap" EXCLUDE USING gist ("account_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("status" IN ('active', 'queued'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inference_requests" ADD CONSTRAINT "inference_requests_latency_non_negative" CHECK ("latency_ms" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inference_requests" ADD CONSTRAINT "inference_requests_cost_non_negative" CHECK ("cost_microusd" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_source_non_negative" CHECK ("source_ms" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_chars_non_negative" CHECK ("generated_chars" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_cost_non_negative" CHECK ("cost_microusd" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_latency_non_negative" CHECK ("latency_ms" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_product_events" ADD CONSTRAINT "daily_product_events_counters_non_negative" CHECK ("requests" >= 0 AND "source_ms" >= 0 AND "generated_chars" >= 0 AND "cost_microusd" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
