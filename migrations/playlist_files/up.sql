-- Onfile: playlist memberships — ADDITIVE migration (creates ONE new table + indexes, copies data).
-- Does not alter, drop or rewrite any existing table/column. `files.playlist_id` is left untouched.
-- Idempotent: safe to run more than once (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- Run against a Supabase PREVIEW/staging database first; never against production without approval.
-- (The table part is equivalent to `npx drizzle-kit push`; the backfill below is NOT done by push, but the app
--  also self-heals by copying any not-yet-migrated `files.playlist_id` values on first playlist access.)

BEGIN;

CREATE TABLE IF NOT EXISTS "playlist_files" (
  "id" serial PRIMARY KEY,
  "playlist_id" integer NOT NULL REFERENCES "playlists"("id") ON DELETE CASCADE,
  "file_id" integer NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "playlist_files_playlist_file_idx" ON "playlist_files" ("playlist_id", "file_id");
CREATE INDEX IF NOT EXISTS "playlist_files_playlist_position_idx" ON "playlist_files" ("playlist_id", "position");
CREATE INDEX IF NOT EXISTS "playlist_files_file_id_idx" ON "playlist_files" ("file_id");

-- Backfill: every file that currently points at one of its owner's playlists becomes a membership.
-- Oldest first (position 0 = first published) after any rows that already exist in the playlist.
INSERT INTO "playlist_files" ("playlist_id", "file_id", "user_id", "position", "created_at")
SELECT f."playlist_id",
       f."id",
       f."user_id",
       COALESCE((SELECT MAX(pf."position") + 1 FROM "playlist_files" pf WHERE pf."playlist_id" = f."playlist_id"), 0)
         + (ROW_NUMBER() OVER (PARTITION BY f."playlist_id" ORDER BY f."created_at", f."id") - 1)::int,
       COALESCE(f."created_at", now())
FROM "files" f
JOIN "playlists" p ON p."id" = f."playlist_id" AND p."user_id" = f."user_id"
WHERE f."playlist_id" IS NOT NULL
ON CONFLICT ("playlist_id", "file_id") DO NOTHING;

COMMIT;
