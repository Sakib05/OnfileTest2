-- Onfile: Bot-guided channel connection — ADDITIVE migration.
-- Adds THREE nullable timestamp columns to "pending_channel_requests". It does not alter,
-- drop, rewrite or backfill any existing column or row. Idempotent (IF NOT EXISTS).
-- Equivalent to `npx drizzle-kit push` for these columns.
-- Run against a Supabase PREVIEW/staging database first. NEVER run against production
-- without explicit approval, and apply it BEFORE deploying the code that reads the columns
-- (the ORM selects them explicitly, so the code needs them to exist).

BEGIN;

ALTER TABLE "pending_channel_requests" ADD COLUMN IF NOT EXISTS "connect_started_at" timestamp;
ALTER TABLE "pending_channel_requests" ADD COLUMN IF NOT EXISTS "picker_sent_at" timestamp;
ALTER TABLE "pending_channel_requests" ADD COLUMN IF NOT EXISTS "confirmation_sent_at" timestamp;

COMMIT;
