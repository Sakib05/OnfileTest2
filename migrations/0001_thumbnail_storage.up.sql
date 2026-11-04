-- Onfile multi-provider thumbnail storage — UP migration (additive only).
-- Apply to a scratch/staging database first. NEVER run automatically against production.
-- Requires existing tables: users, files.
BEGIN;

CREATE TYPE "public"."storage_migration_job_status" AS ENUM('pending', 'running', 'paused', 'completed', 'failed', 'cancelled');

CREATE TYPE "public"."storage_provider_status" AS ENUM('ACTIVE', 'NEAR_LIMIT', 'EXHAUSTED', 'DRAINING', 'DISABLED', 'ERROR');

CREATE TYPE "public"."storage_terms_status" AS ENUM('UNREVIEWED', 'PERMITTED', 'AMBIGUOUS', 'PROHIBITED');

CREATE TYPE "public"."storage_usage_source" AS ENUM('OFFICIAL_API', 'MANUAL', 'ESTIMATED', 'UNKNOWN');

CREATE TYPE "public"."thumbnail_asset_status" AS ENUM('active', 'pending_delete');

CREATE TABLE "provider_usage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"storage_used" bigint,
	"bandwidth_used" bigint,
	"request_used" bigint,
	"source" "storage_usage_source" DEFAULT 'UNKNOWN' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "storage_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_telegram_id" varchar(64),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "storage_locks" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"holder" varchar(64) NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);

CREATE TABLE "storage_migration_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"source_provider_id" integer NOT NULL,
	"destination_provider_id" integer,
	"status" "storage_migration_job_status" DEFAULT 'pending' NOT NULL,
	"reason" varchar(64),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_details" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "storage_provider_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer,
	"event_type" varchar(64) NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" varchar(128),
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "storage_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_key" varchar(32) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "storage_provider_status" DEFAULT 'ACTIVE' NOT NULL,
	"commercial_terms_status" "storage_terms_status" DEFAULT 'UNREVIEWED' NOT NULL,
	"commercial_terms_note" text,
	"storage_quota" bigint,
	"storage_used" bigint DEFAULT 0 NOT NULL,
	"bandwidth_quota" bigint,
	"bandwidth_used" bigint DEFAULT 0 NOT NULL,
	"request_quota" bigint,
	"request_used" bigint DEFAULT 0 NOT NULL,
	"usage_source" "storage_usage_source" DEFAULT 'UNKNOWN' NOT NULL,
	"usage_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight" numeric(8, 3) DEFAULT '1' NOT NULL,
	"max_assets" integer,
	"billing_cycle_day" integer,
	"billing_period_start" timestamp with time zone,
	"consecutive_upload_failures" integer DEFAULT 0 NOT NULL,
	"consecutive_delivery_failures" integer DEFAULT 0 NOT NULL,
	"quota_error_at" timestamp with time zone,
	"last_health_check" timestamp with time zone,
	"health_ok" boolean,
	"last_usage_sync" timestamp with time zone,
	"error_details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "storage_rate_limits" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "storage_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "thumbnail_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer,
	"owner_id" integer,
	"provider_id" integer NOT NULL,
	"provider_object_key" text NOT NULL,
	"delivery_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allocation_reason" jsonb,
	"mime_type" varchar(64) NOT NULL,
	"file_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"status" "thumbnail_asset_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "provider_usage_history" ADD CONSTRAINT "provider_usage_history_provider_id_storage_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."storage_providers"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "storage_audit_logs" ADD CONSTRAINT "storage_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "storage_migration_jobs" ADD CONSTRAINT "storage_migration_jobs_asset_id_thumbnail_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."thumbnail_assets"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "storage_migration_jobs" ADD CONSTRAINT "storage_migration_jobs_source_provider_id_storage_providers_id_fk" FOREIGN KEY ("source_provider_id") REFERENCES "public"."storage_providers"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "storage_migration_jobs" ADD CONSTRAINT "storage_migration_jobs_destination_provider_id_storage_providers_id_fk" FOREIGN KEY ("destination_provider_id") REFERENCES "public"."storage_providers"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "storage_provider_events" ADD CONSTRAINT "storage_provider_events_provider_id_storage_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."storage_providers"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "thumbnail_assets" ADD CONSTRAINT "thumbnail_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "thumbnail_assets" ADD CONSTRAINT "thumbnail_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "thumbnail_assets" ADD CONSTRAINT "thumbnail_assets_provider_id_storage_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."storage_providers"("id") ON DELETE restrict ON UPDATE no action;

CREATE INDEX "provider_usage_history_provider_time_idx" ON "provider_usage_history" USING btree ("provider_id","measured_at");

CREATE INDEX "storage_audit_logs_time_idx" ON "storage_audit_logs" USING btree ("created_at");

CREATE UNIQUE INDEX "storage_migration_jobs_one_open_per_asset_idx" ON "storage_migration_jobs" USING btree ("asset_id") WHERE "storage_migration_jobs"."status" in ('pending','running','paused');

CREATE INDEX "storage_migration_jobs_status_idx" ON "storage_migration_jobs" USING btree ("status","next_attempt_at");

CREATE INDEX "storage_migration_jobs_source_idx" ON "storage_migration_jobs" USING btree ("source_provider_id");

CREATE INDEX "storage_provider_events_provider_time_idx" ON "storage_provider_events" USING btree ("provider_id","created_at");

CREATE INDEX "storage_provider_events_dedupe_idx" ON "storage_provider_events" USING btree ("dedupe_key","created_at");

CREATE UNIQUE INDEX "storage_providers_provider_key_idx" ON "storage_providers" USING btree ("provider_key");

CREATE UNIQUE INDEX "storage_settings_key_idx" ON "storage_settings" USING btree ("key");

CREATE UNIQUE INDEX "thumbnail_assets_one_active_per_file_idx" ON "thumbnail_assets" USING btree ("file_id") WHERE "thumbnail_assets"."status" = 'active';

CREATE UNIQUE INDEX "thumbnail_assets_provider_object_idx" ON "thumbnail_assets" USING btree ("provider_id","provider_object_key");

CREATE INDEX "thumbnail_assets_provider_status_idx" ON "thumbnail_assets" USING btree ("provider_id","status");

CREATE INDEX "thumbnail_assets_owner_idx" ON "thumbnail_assets" USING btree ("owner_id");

COMMIT;
