-- Onfile: Mini App-triggered channel verification — ADDITIVE migration.
-- Adds TWO nullable columns to "pending_channel_requests": the channel Telegram reported in `chat_shared`
-- (stored by the webhook, verified only when the user taps Verify in the Mini App) and when it was stored.
-- It does not alter, drop, rewrite or backfill any existing column or row. Idempotent (IF NOT EXISTS).
-- Equivalent to `npx drizzle-kit push` for these columns.
-- Apply BEFORE deploying the code that reads the columns (the ORM selects them explicitly).

BEGIN;

ALTER TABLE "pending_channel_requests" ADD COLUMN IF NOT EXISTS "selected_chat_id" varchar(64);
ALTER TABLE "pending_channel_requests" ADD COLUMN IF NOT EXISTS "selected_at" timestamp;

COMMIT;
