-- Cover latest-sample ties and seek new IDs without scanning invalidated history.
DROP INDEX IF EXISTS idx_heartbeats_monitor_time;
CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id,timestamp DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_id ON heartbeats(monitor_id,id);

-- Lazily initialize each monitor once; later reads advance its rolling totals.
CREATE TABLE IF NOT EXISTS availability_cache (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  interval_min INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  computed_at INTEGER NOT NULL,
  last_id INTEGER NOT NULL,
  covered REAL NOT NULL,
  available REAL NOT NULL,
  source_revision INTEGER NOT NULL
);
DELETE FROM status_cache;
