-- Profile customisation (Edit Profile): custom display name + custom profile picture.
-- ADDITIVE and idempotent. No existing column is renamed, dropped or rewritten, and no row is modified.
-- Equivalent to what `npx drizzle-kit push` applies from src/db/schema.ts.
-- NOT executed automatically — run it yourself against Production only after review/approval.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_custom varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_key varchar(255);
