-- Rollback for migrations/playlist_analytics/up.sql.
-- Drops ONLY the two additive columns and their indexes. Legacy analytics rows are untouched.
-- NOTE: rows written after the migration (event_type playlist_view / playlist_unlock / playlist_download) remain in the
-- table but lose their idempotency key + visitor hash. To remove them as well, run FIRST:
--   DELETE FROM "analytics" WHERE "event_type" IN ('playlist_view', 'playlist_unlock', 'playlist_download');
DROP INDEX IF EXISTS "analytics_playlist_event_idx";
DROP INDEX IF EXISTS "analytics_event_key_idx";
ALTER TABLE "analytics" DROP COLUMN IF EXISTS "visitor_hash";
ALTER TABLE "analytics" DROP COLUMN IF EXISTS "event_key";
