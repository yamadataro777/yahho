-- Short-lived, first-party, anonymous journeys. No IP, user agent, raw referrer,
-- email, search text or arbitrary URL parameters are recorded.
CREATE TABLE growth_visits (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('direct','search','threads','social','referral','email','other')),
  campaign_id TEXT NOT NULL DEFAULT '',
  landing_path TEXT NOT NULL
);
CREATE INDEX growth_visits_time ON growth_visits(started_at);
CREATE TABLE growth_events (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES growth_visits(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('page_view','diagnosis','affiliate_click')),
  page_path TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  offer_id TEXT NOT NULL DEFAULT '',
  tracked_click INTEGER NOT NULL DEFAULT 0 CHECK (tracked_click IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX growth_events_visit ON growth_events(visit_id,created_at);
CREATE INDEX growth_events_time ON growth_events(created_at,kind);
ALTER TABLE conversions ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','reversed'));
ALTER TABLE conversions ADD COLUMN reversed_at TEXT;
ALTER TABLE conversions ADD COLUMN click_id TEXT;
ALTER TABLE conversions ADD COLUMN attributed_source TEXT NOT NULL DEFAULT '';
ALTER TABLE conversions ADD COLUMN attributed_campaign_id TEXT NOT NULL DEFAULT '';
ALTER TABLE conversions ADD COLUMN attributed_landing_path TEXT NOT NULL DEFAULT '';
ALTER TABLE conversions ADD COLUMN attributed_page_path TEXT NOT NULL DEFAULT '';
CREATE INDEX conversions_click ON conversions(click_id,status);
CREATE INDEX conversions_time ON conversions(occurred_at,status);
