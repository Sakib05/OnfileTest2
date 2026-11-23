-- Reverts migrations/profile_customization/up.sql. This DISCARDS users' custom names / picture references
-- (the picture objects themselves must be removed from the storage bucket separately).
ALTER TABLE users DROP COLUMN IF EXISTS profile_image_key;
ALTER TABLE users DROP COLUMN IF EXISTS display_name_custom;
