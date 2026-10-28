PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS articles (
  slug TEXT PRIMARY KEY,
  article_json TEXT NOT NULL CHECK (json_valid(article_json)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'rejected')),
  origin TEXT NOT NULL DEFAULT 'automation' CHECK (origin IN ('seed', 'automation', 'manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_publication ON articles(status, updated_at);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  offer_json TEXT NOT NULL CHECK (json_valid(offer_json)),
  updated_at TEXT NOT NULL
);

-- Aggregate counts only: no IP addresses, browser identifiers, or visitor profiles.
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('diagnosis', 'affiliate_click')),
  article_slug TEXT NOT NULL DEFAULT '',
  offer_id TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  PRIMARY KEY (day, kind, article_slug, offer_id, variant)
);

CREATE TABLE IF NOT EXISTS conversions (
  external_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  commission_jpy INTEGER NOT NULL CHECK (commission_jpy >= 0),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_checks (
  source_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status_code INTEGER,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  content_hash TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary_json))
);
CREATE INDEX IF NOT EXISTS automation_runs_time ON automation_runs(started_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
