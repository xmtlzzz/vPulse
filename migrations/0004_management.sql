CREATE TABLE monitor_settings (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL DEFAULT '',
  json_path TEXT NOT NULL DEFAULT '',
  json_expected TEXT NOT NULL DEFAULT '',
  failure_threshold INTEGER NOT NULL DEFAULT 1,
  notify_recovery INTEGER NOT NULL DEFAULT 1,
  reminder_min INTEGER NOT NULL DEFAULT 0,
  maintenance_until INTEGER NOT NULL DEFAULT 0,
  probe_after_id INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE alert_state (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  notified_status INTEGER,
  last_notified_at INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE alert_outbox ADD COLUMN monitor_id TEXT REFERENCES monitors(id) ON DELETE CASCADE;
CREATE TABLE alert_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id TEXT NOT NULL,
  monitor TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_alert_deliveries_time ON alert_deliveries(timestamp DESC);
CREATE TABLE probe_progress (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE probe_round (
  key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL
);
CREATE TABLE session_devices (
  token_hash TEXT PRIMARY KEY REFERENCES admin_sessions(token_hash) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO session_devices SELECT token_hash,lower(hex(randomblob(16))),'已记住的设备',unixepoch() FROM admin_sessions;
DELETE FROM status_cache;
