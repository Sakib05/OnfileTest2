-- Reverts migrations/profile_management/up.sql (drops only the two columns it added).
ALTER TABLE users DROP COLUMN IF EXISTS profile_image_key;
ALTER TABLE users DROP COLUMN IF EXISTS display_name_custom;
