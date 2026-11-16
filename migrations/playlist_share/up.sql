-- Additive migration: unguessable public share token for playlists.
-- Existing rows are NOT modified (every playlist starts with share_slug = NULL, i.e. "not shared yet").
-- Safe to run more than once. Apply to a DEV/Preview database first; run against Production only after approval.
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "share_slug" varchar(32);
CREATE UNIQUE INDEX IF NOT EXISTS "playlists_share_slug_unique" ON "playlists" ("share_slug");
