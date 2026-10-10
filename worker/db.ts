import { DEFAULT_MONITORS, MonitorConfig } from './default-monitors'
import { HeartbeatResult } from './probe'

export interface MonitorWithHistory extends MonitorConfig {
  current_status: 1 | 0 | 2
  current_latency_ms: number
  ssl_days_remaining: number
  uptime_30d: number
  avg_latency_ms: number
  heartbeats: HeartbeatSummary[]
}

export interface HeartbeatSummary {
  status: 1 | 0 | 2
  latency_ms: number
  timestamp: number
  message?: string
}

export interface IncidentRecord {
  id: string
  title: string
  description: string
  severity: 'minor' | 'major' | 'maintenance'
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  created_at: number
  updated_at: number
  resolved_at?: number
}

// Generate fallback 60-slot heartbeat history for zero-cold-start presentation
function generateMockHeartbeats(
  monitorId: string,
  baseLatency: number
): HeartbeatSummary[] {
  const heartbeats: HeartbeatSummary[] = []
  const now = Math.floor(Date.now() / 1000)
  const slotIntervalSec = 180 // 3 minutes per slot

  for (let i = 59; i >= 0; i--) {
    const timestamp = now - i * slotIntervalSec
    // Add subtle jitter: baseLatency ± 15ms
    const jitter = Math.floor(Math.sin(i * 0.4) * 12 + (i % 7))
    const latency_ms = Math.max(12, baseLatency + jitter)

    heartbeats.push({
      status: 1, // Healthy UP
      latency_ms,
      timestamp,
      message: 'OK',
    })
  }

  return heartbeats
}

export async function fetchMonitorsWithHistory(
  db?: D1Database
): Promise<MonitorWithHistory[]> {
  let monitors: MonitorConfig[] = DEFAULT_MONITORS

  if (db) {
    try {
      const rows = await db
        .prepare('SELECT * FROM monitors WHERE enabled = 1 ORDER BY order_num ASC')
        .all<MonitorConfig>()
      if (rows.results && rows.results.length > 0) {
        monitors = rows.results
      }
    } catch {
      // Use DEFAULT_MONITORS if table not yet initialized
    }
  }

  const results: MonitorWithHistory[] = []

  for (const monitor of monitors) {
    let heartbeats: HeartbeatSummary[] = []
    let uptime_30d = 99.98
    let avg_latency_ms = 45
    let current_status: 1 | 0 | 2 = 1
    let current_latency_ms = 45
    let ssl_days_remaining = 84

    if (db) {
      try {
        const hbRows = await db
          .prepare(
            `SELECT status, latency_ms, timestamp, message, ssl_days_remaining
             FROM heartbeats
             WHERE monitor_id = ?
             ORDER BY timestamp DESC
             LIMIT 60`
          )
          .bind(monitor.id)
          .all<{
            status: 1 | 0 | 2
            latency_ms: number
            timestamp: number
            message?: string
            ssl_days_remaining?: number
          }>()

        if (hbRows.results && hbRows.results.length > 0) {
          // Reverse so oldest is left (index 0) and latest is right (index 59)
          heartbeats = hbRows.results
            .reverse()
            .map((r) => ({
              status: r.status,
              latency_ms: r.latency_ms,
              timestamp: r.timestamp,
              message: r.message,
            }))

          const latest = hbRows.results[hbRows.results.length - 1]
          current_status = latest.status
          current_latency_ms = latest.latency_ms
          if (latest.ssl_days_remaining) {
            ssl_days_remaining = latest.ssl_days_remaining
          }

          const upCount = heartbeats.filter((h) => h.status === 1).length
          uptime_30d = Math.round((upCount / heartbeats.length) * 10000) / 100

          const sumLatency = heartbeats.reduce((acc, h) => acc + h.latency_ms, 0)
          avg_latency_ms = Math.round(sumLatency / heartbeats.length)
        }
      } catch (err) {
        console.warn(`[vPulse] DB query failed for monitor ${monitor.id}:`, err)
      }
    }

    // If heartbeats are fewer than 60:
    if (heartbeats.length < 60) {
      const isDefault = ['vmaker', 'vblog', 'vblog-api'].includes(monitor.id)
      const now = Math.floor(Date.now() / 1000)
      const missingCount = 60 - heartbeats.length

      if (isDefault && heartbeats.length === 0) {
        // Cold start demo baseline for default system monitors only
        const baseLatencies: Record<string, number> = {
          vmaker: 42,
          vblog: 58,
          'vblog-api': 24,
        }
        heartbeats = generateMockHeartbeats(monitor.id, baseLatencies[monitor.id] || 50)
      } else {
        // Newly added monitors: prefix with blank unprobed slots so real probes push forward from tail!
        const blankSlots: HeartbeatSummary[] = []
        for (let i = missingCount; i >= 1; i--) {
          blankSlots.push({
            status: -1,
            latency_ms: 0,
            timestamp: now - (heartbeats.length + i) * 180,
            message: '等待探活',
          })
        }
        heartbeats = blankSlots.concat(heartbeats)
      }

      const realSlots = heartbeats.filter((h) => h.status !== -1)
      if (realSlots.length > 0) {
        current_latency_ms = realSlots[realSlots.length - 1].latency_ms
        current_status = realSlots[realSlots.length - 1].status
        avg_latency_ms = Math.round(
          realSlots.reduce((acc, h) => acc + h.latency_ms, 0) / realSlots.length
        )
        const upCount = realSlots.filter((h) => h.status === 1).length
        uptime_30d = Math.round((upCount / realSlots.length) * 10000) / 100
      }
    }

    results.push({
      ...monitor,
      current_status,
      current_latency_ms,
      ssl_days_remaining,
      uptime_30d,
      avg_latency_ms,
      heartbeats,
    })
  }

  return results
}

export async function fetchIncidents(db?: D1Database): Promise<IncidentRecord[]> {
  if (!db) return []
  try {
    const rows = await db
      .prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 5')
      .all<IncidentRecord>()
    return rows.results || []
  } catch {
    return []
  }
}

export async function getAllMonitors(db?: D1Database): Promise<MonitorConfig[]> {
  if (!db) return DEFAULT_MONITORS
  try {
    const rows = await db
      .prepare('SELECT * FROM monitors WHERE enabled = 1 ORDER BY order_num ASC, created_at ASC')
      .all<MonitorConfig>()
    if (rows.results && rows.results.length > 0) {
      return rows.results
    }
  } catch (err) {
    console.warn('[vPulse] DB query monitors failed, fallback to defaults:', err)
  }
  return DEFAULT_MONITORS
}

export async function createMonitor(
  data: {
    id?: string
    name: string
    group_name: string
    url: string
    method?: 'GET' | 'HEAD' | 'POST'
    expected_status?: number
    interval_min?: number
    timeout_ms?: number
  },
  db?: D1Database
): Promise<MonitorConfig> {
  const id =
    data.id ||
    data.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') ||
    `mon-${Date.now()}`

  const monitor: MonitorConfig = {
    id,
    name: data.name,
    group_name: data.group_name || '自定义服务',
    url: data.url,
    method: data.method || 'GET',
    expected_status: data.expected_status || 200,
    interval_min: data.interval_min || 3,
    timeout_ms: data.timeout_ms || 6000,
    order_num: 10,
    enabled: 1,
  }

  if (db) {
    await db
      .prepare(
        `INSERT INTO monitors (id, name, group_name, url, method, expected_status, interval_min, timeout_ms, order_num, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        monitor.id,
        monitor.name,
        monitor.group_name,
        monitor.url,
        monitor.method,
        monitor.expected_status,
        monitor.interval_min,
        monitor.timeout_ms,
        monitor.order_num,
        monitor.enabled,
        Math.floor(Date.now() / 1000)
      )
      .run()
  }

  return monitor
}

export async function removeMonitor(id: string, db?: D1Database): Promise<boolean> {
  if (db) {
    await db.prepare('DELETE FROM monitors WHERE id = ?').bind(id).run()
    await db.prepare('DELETE FROM heartbeats WHERE monitor_id = ?').bind(id).run()
    return true
  }
  return false
}

