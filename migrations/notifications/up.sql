-- Onfile: in-app notifications — ADDITIVE migration (ONE new table + 4 indexes).
-- Does not alter, drop or rewrite any existing table/column. Idempotent (IF NOT EXISTS).
-- Equivalent to `npx drizzle-kit push` for src/db/schema.ts -> notifications.
-- Run against a Supabase PREVIEW/staging database first; never against production without approval.
-- The app degrades gracefully if the table is missing: the bell shows an empty list and no
-- notification is written (event handlers swallow the error), so deploying code before the
-- migration cannot break channel connection, publishing or withdrawals.

BEGIN;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" serial PRIMARY KEY,
  "public_id" varchar(24) NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(48) NOT NULL,
  "title" varchar(160) NOT NULL,
  "body" varchar(400) NOT NULL,
  "destination_type" varchar(24),
  "destination_ref" varchar(32),
  "dedupe_key" varchar(96),
  "read_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_public_id_idx" ON "notifications" ("public_id");
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" ("user_id") WHERE "read_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_idx" ON "notifications" ("user_id", "dedupe_key");

COMMIT;
