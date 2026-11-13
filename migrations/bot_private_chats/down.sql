-- Rolls back migrations/bot_private_chats/up.sql. Drops only the table that migration created.
-- The table only caches chat ids that Telegram webhook updates re-populate automatically, so
-- dropping it loses no user data (the next connect simply uses the signed start link once).

BEGIN;
DROP TABLE IF EXISTS "bot_private_chats";
COMMIT;
