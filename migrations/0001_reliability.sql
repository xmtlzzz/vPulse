-- Additive migration: preserves existing monitors, heartbeats and incidents.
CREATE TABLE IF NOT EXISTS probe_locks (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS probe_runs (key TEXT PRIMARY KEY, finished_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS incident_monitors (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_incident_monitors_monitor ON incident_monitors(monitor_id);
CREATE TABLE IF NOT EXISTS alert_outbox (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
