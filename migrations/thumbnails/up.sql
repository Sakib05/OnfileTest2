-- Onfile: DBByte thumbnail storage — ADDITIVE migration (creates 4 new tables only).
-- Does not alter or delete any existing table or row. Safe to run more than once.
-- Run against a Supabase PREVIEW/staging database first, never production without approval.
-- (Equivalent to `npx drizzle-kit push` for these tables.)

CREATE TABLE IF NOT EXISTS "file_thumbnails" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "file_id" integer NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "provider" varchar(16) NOT NULL DEFAULT 'dbbyte',
  "object_key" varchar(255) NOT NULL,
  "version" varchar(32) NOT NULL,
  "mime_type" varchar(64) NOT NULL,
  "format" varchar(16) NOT NULL,
  "size_bytes" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'ready',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "file_thumbnails_file_id_idx" ON "file_thumbnails" ("file_id");
CREATE UNIQUE INDEX IF NOT EXISTS "file_thumbnails_object_key_idx" ON "file_thumbnails" ("provider", "object_key");
CREATE INDEX IF NOT EXISTS "file_thumbnails_user_id_idx" ON "file_thumbnails" ("user_id");

CREATE TABLE IF NOT EXISTS "thumbnail_orphans" (
  "id" serial PRIMARY KEY,
  "provider" varchar(16) NOT NULL DEFAULT 'dbbyte',
  "object_key" varchar(255) NOT NULL,
  "reason" varchar(48) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" varchar(300),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_attempt_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "thumbnail_orphans_object_key_idx" ON "thumbnail_orphans" ("provider", "object_key");

CREATE TABLE IF NOT EXISTS "thumbnail_failures" (
  "id" serial PRIMARY KEY,
  "user_id" integer,
  "file_id" integer,
  "code" varchar(48) NOT NULL,
  "http_status" integer,
  "message" varchar(300),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "thumbnail_failures_created_at_idx" ON "thumbnail_failures" ("created_at");

CREATE TABLE IF NOT EXISTS "storage_usage_manual" (
  "id" serial PRIMARY KEY,
  "metric" varchar(32) NOT NULL,
  "used" bigint NOT NULL,
  "limit" bigint NOT NULL,
  "updated_by" integer,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "storage_usage_manual_metric_idx" ON "storage_usage_manual" ("metric");
