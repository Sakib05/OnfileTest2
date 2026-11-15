-- Rolls back migrations/bot_guided_connect/up.sql. Drops only the three columns it added.
-- The columns hold short-lived flow state only (requests live 10 minutes), so no user data is lost.
-- Deploy the previous code version first, otherwise it will fail to read the dropped columns.

BEGIN;
ALTER TABLE "pending_channel_requests" DROP COLUMN IF EXISTS "connect_started_at";
ALTER TABLE "pending_channel_requests" DROP COLUMN IF EXISTS "picker_sent_at";
ALTER TABLE "pending_channel_requests" DROP COLUMN IF EXISTS "confirmation_sent_at";
COMMIT;
