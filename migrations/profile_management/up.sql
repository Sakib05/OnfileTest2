-- Profile management (creator profile picture + persistent Display Name).
-- ADDITIVE and idempotent. Safe to run on a live database: no data is rewritten, no balances are touched.
--   profile_image_key    : storage object key of the creator-uploaded profile picture (NULL = keep the default avatar)
--   display_name_custom  : TRUE once the creator edited their Display Name; stops the Telegram login sync from
--                          overwriting first_name / last_name
-- Equivalent to `npx drizzle-kit push` against src/db/schema.ts. NOT executed against production by this change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_key varchar(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_custom boolean NOT NULL DEFAULT false;
