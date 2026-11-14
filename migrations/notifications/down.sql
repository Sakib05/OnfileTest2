-- Rolls back migrations/notifications/up.sql. Drops only the table (and its indexes) that migration created.
-- Notifications are a derived, informational history of events that are also recorded in their own
-- tables (channels, files, withdrawals), so dropping it loses no business data.

BEGIN;
DROP TABLE IF EXISTS "notifications";
COMMIT;
