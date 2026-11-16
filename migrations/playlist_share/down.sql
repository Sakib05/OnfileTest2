-- Rollback for migrations/playlist_share/up.sql. Drops ONLY the share token column (and its unique index).
-- Playlists, files and memberships are untouched; previously issued /p/<token> links stop working.
DROP INDEX IF EXISTS "playlists_share_slug_unique";
ALTER TABLE "playlists" DROP COLUMN IF EXISTS "share_slug";
