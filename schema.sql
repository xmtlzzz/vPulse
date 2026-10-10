-- ==============================================================================
-- vPulse - Edge Status Database Schema (Cloudflare D1 / SQLite)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  expected_status INTEGER NOT NULL DEFAULT 200,
  interval_min INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 8000,
  order_num INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  status INTEGER NOT NULL, -- 1: UP (正常), 0: DOWN (宕机), 2: DEGRADED (高延迟或非预期状态)
  status_code INTEGER,
  latency_ms INTEGER,
  ssl_days_remaining INTEGER,
  message TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON heartbeats(timestamp DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor', -- minor | major | maintenance
  status TEXT NOT NULL DEFAULT 'resolved', -- investigating | identified | monitoring | resolved
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- Seed Initial Monitors for v-Ecosystem
INSERT OR IGNORE INTO monitors (id, name, group_name, url, method, expected_status, interval_min, timeout_ms, order_num, enabled, created_at)
VALUES 
  ('vmaker', 'vMaker 创意作品集', '核心站点', 'https://vmaker.xmtlz.dev', 'GET', 200, 3, 6000, 1, 1, strftime('%s', 'now')),
  ('vblog', 'vBlog 个人独立博客', '核心站点', 'https://vblog.xmtlz.dev', 'GET', 200, 3, 6000, 2, 1, strftime('%s', 'now')),
  ('vblog-api', 'vBlog D1 边缘接口', '边缘服务与存储', 'https://vblog.xmtlz.dev/api/health', 'GET', 200, 3, 5000, 3, 1, strftime('%s', 'now')),
  ('github-api', 'GitHub API (xmtlz 档案)', '外部依赖', 'https://api.github.com/users/xmtlz', 'GET', 200, 5, 8000, 4, 1, strftime('%s', 'now'));
