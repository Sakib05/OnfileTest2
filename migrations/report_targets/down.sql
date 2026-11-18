-- Reverts the column. PostgreSQL cannot drop a single enum value; the unused 'inappropriate' value is harmless and is left in place.
-- (Delete or re-point any rows that use it first if you really need to recreate the type.)
DROP INDEX IF EXISTS "reports_playlist_id_idx";
ALTER TABLE "reports" DROP COLUMN IF EXISTS "playlist_id";
