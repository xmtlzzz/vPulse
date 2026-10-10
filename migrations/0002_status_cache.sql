-- Cache revision is updated in the same transaction as every state mutation.
CREATE TABLE IF NOT EXISTS status_revision (key TEXT PRIMARY KEY, revision INTEGER NOT NULL);
INSERT OR IGNORE INTO status_revision(key,revision) VALUES('status',0);
CREATE TABLE IF NOT EXISTS status_cache (
  key TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);
