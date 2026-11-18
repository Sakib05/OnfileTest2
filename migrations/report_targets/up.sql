-- Additive migration: lets a public report target a whole playlist and adds an "inappropriate" reason.
-- Existing rows are NOT modified. Safe to run more than once.
-- Apply to a DEV/Preview database first; run against Production only after explicit approval.
ALTER TYPE "report_reason" ADD VALUE IF NOT EXISTS 'inappropriate';
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "playlist_id" integer;
CREATE INDEX IF NOT EXISTS "reports_playlist_id_idx" ON "reports" ("playlist_id");
