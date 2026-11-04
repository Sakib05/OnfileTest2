-- Onfile multi-provider thumbnail storage — DOWN migration (reversible).
-- WARNING: drops all thumbnail-storage metadata. Remote objects are NOT deleted;
-- run the admin "drain" flow / delete remote objects first if you need them removed.
BEGIN;
DROP TABLE IF EXISTS "storage_locks";
DROP TABLE IF EXISTS "storage_rate_limits";
DROP TABLE IF EXISTS "storage_settings";
DROP TABLE IF EXISTS "storage_audit_logs";
DROP TABLE IF EXISTS "storage_provider_events";
DROP TABLE IF EXISTS "provider_usage_history";
DROP TABLE IF EXISTS "storage_migration_jobs";
DROP TABLE IF EXISTS "thumbnail_assets";
DROP TABLE IF EXISTS "storage_providers";
DROP TYPE IF EXISTS "storage_migration_job_status";
DROP TYPE IF EXISTS "thumbnail_asset_status";
DROP TYPE IF EXISTS "storage_terms_status";
DROP TYPE IF EXISTS "storage_usage_source";
DROP TYPE IF EXISTS "storage_provider_status";
COMMIT;
