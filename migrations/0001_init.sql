CREATE TABLE IF NOT EXISTS sessions (
  sid          TEXT PRIMARY KEY,
  fbp          TEXT DEFAULT '',
  fbc          TEXT DEFAULT '',
  fbclid       TEXT DEFAULT '',
  gclid        TEXT DEFAULT '',
  utm_source   TEXT DEFAULT '',
  utm_medium   TEXT DEFAULT '',
  utm_campaign TEXT DEFAULT '',
  utm_content  TEXT DEFAULT '',
  utm_term     TEXT DEFAULT '',
  ga_client_id TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name    TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  session_id    TEXT DEFAULT '',
  email_hash    TEXT DEFAULT '',
  phone_hash    TEXT DEFAULT '',
  name_hash     TEXT DEFAULT '',
  faturamento   TEXT DEFAULT '',
  source_url    TEXT DEFAULT '',
  fbp_source    TEXT DEFAULT '',
  fbc_source    TEXT DEFAULT '',
  meta_status   INTEGER DEFAULT 0,
  meta_response TEXT DEFAULT '',
  ga4_status    INTEGER DEFAULT 0,
  ga4_response  TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);
