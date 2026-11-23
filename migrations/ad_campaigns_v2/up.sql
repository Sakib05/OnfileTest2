-- Creator Advertising System (ME -> Advertise). ADDITIVE and backward compatible: no column/table is dropped
-- or renamed, no data is modified. Safe to run more than once. Run MANUALLY (never auto-run against production):
--   psql "$DATABASE_URL" -f migrations/ad_campaigns_v2/up.sql
--
-- NOTE: ALTER TYPE ... ADD VALUE must not run inside a transaction block on PostgreSQL < 12; this file
-- deliberately contains no BEGIN/COMMIT and does not USE the new 'draft' value.

ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'draft';

-- Creator campaigns have no "contact form": relax the two legacy NOT NULLs (existing rows keep their values).
ALTER TABLE ad_campaigns ALTER COLUMN advertiser_name DROP NOT NULL;
ALTER TABLE ad_campaigns ALTER COLUMN advertiser_email DROP NOT NULL;

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS public_id varchar(24),
  ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source varchar(32) DEFAULT 'creator',
  ADD COLUMN IF NOT EXISTS client_ref varchar(64),
  ADD COLUMN IF NOT EXISTS ad_type varchar(32),
  ADD COLUMN IF NOT EXISTS content_kind varchar(16),
  ADD COLUMN IF NOT EXISTS objective varchar(32),
  ADD COLUMN IF NOT EXISTS headline varchar(120),
  ADD COLUMN IF NOT EXISTS description varchar(300),
  ADD COLUMN IF NOT EXISTS cta_text varchar(40),
  ADD COLUMN IF NOT EXISTS file_id integer,
  ADD COLUMN IF NOT EXISTS playlist_id integer,
  ADD COLUMN IF NOT EXISTS channel_id integer,
  ADD COLUMN IF NOT EXISTS destination_ref text,
  ADD COLUMN IF NOT EXISTS invite_link text,
  ADD COLUMN IF NOT EXISTS tg_chat_id varchar(64),
  ADD COLUMN IF NOT EXISTS tg_chat_username varchar(128),
  ADD COLUMN IF NOT EXISTS tg_chat_title varchar(256),
  ADD COLUMN IF NOT EXISTS join_verifiable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS placements jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS targeting jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS currency varchar(8) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS spent numeric(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_amount integer,
  ADD COLUMN IF NOT EXISTS start_date timestamp,
  ADD COLUMN IF NOT EXISTS end_date timestamp,
  ADD COLUMN IF NOT EXISTS pricing_model varchar(8),
  ADD COLUMN IF NOT EXISTS unit_price numeric(18,6),
  ADD COLUMN IF NOT EXISTS payment_status varchar(24) DEFAULT 'pending_confirmation',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by integer,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS submitted_at timestamp,
  ADD COLUMN IF NOT EXISTS paused_by varchar(16),
  ADD COLUMN IF NOT EXISTS completed_at timestamp,
  ADD COLUMN IF NOT EXISTS completion_reason varchar(32),
  ADD COLUMN IF NOT EXISTS verified_joins integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_public_id_idx ON ad_campaigns (public_id);
CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_user_client_ref_idx ON ad_campaigns (user_id, client_ref);
CREATE INDEX IF NOT EXISTS ad_campaigns_user_id_idx ON ad_campaigns (user_id);
CREATE INDEX IF NOT EXISTS ad_campaigns_status_idx ON ad_campaigns (status);

CREATE TABLE IF NOT EXISTS ad_events (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  event_type varchar(16) NOT NULL,
  placement varchar(32),
  viewer_key varchar(64) NOT NULL,
  user_id integer,
  country varchar(8),
  cost numeric(18,6) DEFAULT 0,
  dedupe_key varchar(160) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_events_dedupe_key_idx ON ad_events (dedupe_key);
CREATE INDEX IF NOT EXISTS ad_events_campaign_idx ON ad_events (campaign_id, created_at);

CREATE TABLE IF NOT EXISTS ad_conversions (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  user_id integer NOT NULL,
  status varchar(16) NOT NULL,
  cost numeric(18,6) DEFAULT 0,
  baseline_at timestamp NOT NULL DEFAULT now(),
  verified_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_conversions_campaign_user_idx ON ad_conversions (campaign_id, user_id);
