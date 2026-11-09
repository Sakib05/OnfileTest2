-- ROLLBACK for migrations/thumbnails/up.sql. Drops ONLY the 4 thumbnail tables.
-- Existing files/users data is untouched. Thumbnails already uploaded to DBByte
-- stay in the bucket (delete them from the DBByte dashboard if desired).
DROP TABLE IF EXISTS "file_thumbnails";
DROP TABLE IF EXISTS "thumbnail_orphans";
DROP TABLE IF EXISTS "thumbnail_failures";
DROP TABLE IF EXISTS "storage_usage_manual";

-- Staged thumbnails table (added with the Publish-wizard upload feature).
DROP TABLE IF EXISTS "thumbnail_uploads";
