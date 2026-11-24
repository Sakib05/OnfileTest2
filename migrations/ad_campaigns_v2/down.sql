-- ROLLBACK for ad_campaigns_v2. WARNING: destroys all Creator Advertising System data (creator campaigns' extra
-- columns, ad_events, ad_conversions). Legacy campaign rows and their legacy columns are untouched.
-- Take a backup first. Run MANUALLY.
--
-- The 'draft' value of campaign_status is intentionally NOT removed (PostgreSQL cannot drop enum values safely);
-- it is harmless when unused. Creator-owned rows are deleted so the legacy NOT NULL constraints can be restored.

DROP TABLE IF EXISTS ad_conversions;
DROP TABLE IF EXISTS ad_events;

DELETE FROM ad_campaigns WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS ad_campaigns_public_id_idx;
DROP INDEX IF EXISTS ad_campaigns_user_client_ref_idx;
DROP INDEX IF EXISTS ad_campaigns_user_id_idx;
DROP INDEX IF EXISTS ad_campaigns_status_idx;

ALTER TABLE ad_campaigns
  DROP COLUMN IF EXISTS public_id, DROP COLUMN IF EXISTS user_id, DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS client_ref, DROP COLUMN IF EXISTS ad_type, DROP COLUMN IF EXISTS content_kind,
  DROP COLUMN IF EXISTS objective, DROP COLUMN IF EXISTS headline, DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS cta_text, DROP COLUMN IF EXISTS file_id, DROP COLUMN IF EXISTS playlist_id,
  DROP COLUMN IF EXISTS channel_id, DROP COLUMN IF EXISTS destination_ref, DROP COLUMN IF EXISTS invite_link,
  DROP COLUMN IF EXISTS tg_chat_id, DROP COLUMN IF EXISTS tg_chat_username, DROP COLUMN IF EXISTS tg_chat_title,
  DROP COLUMN IF EXISTS join_verifiable, DROP COLUMN IF EXISTS placements, DROP COLUMN IF EXISTS targeting,
  DROP COLUMN IF EXISTS currency, DROP COLUMN IF EXISTS spent, DROP COLUMN IF EXISTS target_amount,
  DROP COLUMN IF EXISTS start_date, DROP COLUMN IF EXISTS end_date, DROP COLUMN IF EXISTS pricing_model,
  DROP COLUMN IF EXISTS unit_price, DROP COLUMN IF EXISTS payment_status, DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS reviewed_at, DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS paused_by, DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS completion_reason,
  DROP COLUMN IF EXISTS verified_joins, DROP COLUMN IF EXISTS updated_at;

UPDATE ad_campaigns SET advertiser_name = COALESCE(advertiser_name, 'unknown'), advertiser_email = COALESCE(advertiser_email, 'unknown');
ALTER TABLE ad_campaigns ALTER COLUMN advertiser_name SET NOT NULL;
ALTER TABLE ad_campaigns ALTER COLUMN advertiser_email SET NOT NULL;
