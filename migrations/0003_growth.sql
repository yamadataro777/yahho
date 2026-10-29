PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS growth_hypotheses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  audience TEXT NOT NULL,
  pain TEXT NOT NULL,
  query TEXT NOT NULL,
  target_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS growth_evidence (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES growth_hypotheses(id),
  kind TEXT NOT NULL CHECK(kind IN ('customer_quote','search_console','suggestion','competitor','official_page')),
  source_url TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_evidence_hypothesis ON growth_evidence(hypothesis_id,kind,period_start,period_end);
CREATE TRIGGER IF NOT EXISTS growth_evidence_no_overlapping_search_period
BEFORE INSERT ON growth_evidence
WHEN NEW.kind='search_console' AND EXISTS (
  SELECT 1 FROM growth_evidence WHERE hypothesis_id=NEW.hypothesis_id AND kind=NEW.kind AND query=NEW.query
  AND period_start<=NEW.period_end AND period_end>=NEW.period_start
)
BEGIN SELECT RAISE(ABORT,'overlapping_evidence_period'); END;

CREATE TABLE IF NOT EXISTS growth_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('threads','search','social','email','referral','other')),
  hypothesis_id TEXT NOT NULL REFERENCES growth_hypotheses(id),
  target_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS growth_observations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES growth_campaigns(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS growth_observations_no_overlapping_period
BEFORE INSERT ON growth_observations
WHEN EXISTS (SELECT 1 FROM growth_observations WHERE campaign_id=NEW.campaign_id AND period_start<=NEW.period_end AND period_end>=NEW.period_start)
BEGIN SELECT RAISE(ABORT,'overlapping_observation_period'); END;
CREATE TABLE IF NOT EXISTS growth_decisions (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES growth_hypotheses(id),
  campaign_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','applied','dismissed','evaluated')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_decisions_open ON growth_decisions(hypothesis_id,campaign_id,kind,status);
