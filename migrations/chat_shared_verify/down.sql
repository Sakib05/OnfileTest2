-- Rolls back migrations/chat_shared_verify/up.sql. Drops only the two columns it added.
-- They hold short-lived flow state only (requests live 10 minutes), so no user data is lost.
-- Deploy the previous code version first, otherwise it will fail to read the dropped columns.

BEGIN;
ALTER TABLE "pending_channel_requests" DROP COLUMN IF EXISTS "selected_chat_id";
ALTER TABLE "pending_channel_requests" DROP COLUMN IF EXISTS "selected_at";
COMMIT;
