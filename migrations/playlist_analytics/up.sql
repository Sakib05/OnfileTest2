-- Additive, backward-compatible migration for the Creator Playlist Analytics page.
-- WHY: views and confirmed downloads must be recorded per playlist, idempotently. The existing `analytics` table
-- already has file_id / playlist_id / event_type / created_at; it only lacks (a) an idempotency key so retries and
-- duplicate requests cannot inflate counts, and (b) an anonymous visitor hash for "unique viewers".
-- Existing rows are NOT modified (both columns start NULL). The unique index ignores NULLs, so legacy rows are fine.
-- Safe to run more than once. Apply to a DEV/Preview database first; run against Production only after approval.
ALTER TABLE "analytics" ADD COLUMN IF NOT EXISTS "event_key" varchar(96);
ALTER TABLE "analytics" ADD COLUMN IF NOT EXISTS "visitor_hash" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_event_key_idx" ON "analytics" ("event_key");
CREATE INDEX IF NOT EXISTS "analytics_playlist_event_idx" ON "analytics" ("playlist_id", "event_type", "created_at");
