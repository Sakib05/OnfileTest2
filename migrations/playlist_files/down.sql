-- Rollback for migrations/playlist_files/up.sql. Drops ONLY the membership table.
-- Files, playlists and the legacy files.playlist_id column are untouched, so nothing in the Library is lost.
-- (Memberships created AFTER the migration — extra playlists per file, ordering — are lost.)
DROP TABLE IF EXISTS "playlist_files";
