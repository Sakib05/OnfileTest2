-- Onfile: verified private bot chats — ADDITIVE migration (creates ONE new table + one unique index).
-- Does not alter, drop or rewrite any existing table/column. Idempotent (IF NOT EXISTS).
-- Equivalent to `npx drizzle-kit push` for this table.
-- Run against a Supabase PREVIEW/staging database first; never against production without approval.
-- The app degrades gracefully if the table is missing: connecting a channel falls back to the
-- signed `?start=` deep link (the pre-existing flow) until the migration has been applied.

BEGIN;

CREATE TABLE IF NOT EXISTS "bot_private_chats" (
  "id" serial PRIMARY KEY,
  "telegram_user_id" varchar(64) NOT NULL,
  "chat_id" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "source" varchar(16) NOT NULL DEFAULT 'webhook',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bot_private_chats_user_idx" ON "bot_private_chats" ("telegram_user_id");

COMMIT;
