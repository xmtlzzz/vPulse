import type { MonitorConfig, Monitor, Heartbeat, Incident } from '../src/types'
import { HttpError, monitorInput } from './validation'
import { nextScheduledCheck } from '../src/lib/schedule'

export const MAX_MONITORS = 20
export function requireDb(db?: D1Database): D1Database {
  if (!db) throw new HttpError(503, '监控数据库未配置')
  return db
}

export async function getAllMonitors(
  db?: D1Database,
  includeInactive = false
): Promise<MonitorConfig[]> {
  const rows = await requireDb(db)
    .prepare(
      `SELECT m.*,COALESCE(s.keyword,'') keyword,COALESCE(s.json_path,'') json_path,
    COALESCE(s.json_expected,'') json_expected,COALESCE(s.failure_threshold,1) failure_threshold,
    COALESCE(s.notify_recovery,1) notify_recovery,COALESCE(s.reminder_min,0) reminder_min,COALESCE(s.maintenance_until,0) maintenance_until,COALESCE(s.probe_after_id,0) probe_after_id
    FROM monitors m LEFT JOIN monitor_settings s ON s.monitor_id=m.id
    ${includeInactive ? '' : 'WHERE m.enabled=1 AND COALESCE(s.maintenance_until,0)<=?'} ORDER BY order_num,created_at,id`
    )
    .bind(...(includeInactive ? [] : [Math.floor(Date.now() / 1000)]))
    .all<MonitorConfig>()
  return rows.results
}

export function settingsStatement(database: D1Database, m: MonitorConfig) {
  return database
    .prepare(
      `INSERT INTO monitor_settings(monitor_id,keyword,json_path,json_expected,failure_threshold,notify_recovery,reminder_min,maintenance_until)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM monitors WHERE id=?)
    ON CONFLICT(monitor_id) DO UPDATE SET keyword=excluded.keyword,json_path=excluded.json_path,json_expected=excluded.json_expected,
      failure_threshold=excluded.failure_threshold,notify_recovery=excluded.notify_recovery,reminder_min=excluded.reminder_min,maintenance_until=excluded.maintenance_until`
    )
    .bind(
      m.id,
      m.keyword ?? '',
      m.json_path ?? '',
      m.json_expected ?? '',
      m.failure_threshold ?? 1,
      m.notify_recovery ?? 1,
      m.reminder_min ?? 0,
      m.maintenance_until ?? 0,
      m.id
    )
}

export async function updateMonitor(
  id: string,
  data: Record<string, unknown>,
  database: D1Database
) {
  const existing = (await getAllMonitors(database, true)).find((m) => m.id === id)
  if (!existing) throw new HttpError(404, '监控项不存在')
  if (data.enabled !== undefined && data.enabled !== 0 && data.enabled !== 1)
    throw new HttpError(400, '启用状态无效')
  const m: MonitorConfig = {
    ...existing,
    ...monitorInput({ ...existing, ...data }),
    enabled: (data.enabled as number) ?? existing.enabled,
  }
  const invalidate =
    m.url !== existing.url ||
    m.method !== existing.method ||
    m.expected_status !== existing.expected_status ||
    m.keyword !== existing.keyword ||
    m.json_path !== existing.json_path ||
    m.json_expected !== existing.json_expected ||
    m.timeout_ms !== existing.timeout_ms
  const reset =
    invalidate ||
    m.enabled !== existing.enabled ||
    m.maintenance_until !== existing.maintenance_until
  await database.batch([
    database
      .prepare(
        'UPDATE monitors SET name=?,group_name=?,url=?,method=?,expected_status=?,interval_min=?,timeout_ms=?,enabled=? WHERE id=?'
      )
      .bind(
        m.name,
        m.group_name,
        m.url,
        m.method,
        m.expected_status,
        m.interval_min,
        m.timeout_ms,
        m.enabled,
        id
      ),
    settingsStatement(database, m),
    ...(invalidate
      ? [
          database
            .prepare(
              'UPDATE monitor_settings SET probe_after_id=COALESCE((SELECT MAX(id) FROM heartbeats WHERE monitor_id=?),0) WHERE monitor_id=?'
            )
            .bind(id, id),
        ]
      : []),
    ...(reset
      ? [
          database
            .prepare(
              `INSERT INTO alert_state(monitor_id,failure_streak,notified_status,last_notified_at) VALUES(?,0,1,0)
      ON CONFLICT(monitor_id) DO UPDATE SET failure_streak=0,notified_status=1,last_notified_at=0`
            )
            .bind(id),
          database.prepare('DELETE FROM alert_outbox WHERE monitor_id=?').bind(id),
        ]
      : []),
    database.prepare("UPDATE status_revision SET revision=revision+1 WHERE key='status'"),
  ])
  return m
}

export async function createMonitor(
  data: Record<string, unknown>,
  db?: D1Database
): Promise<MonitorConfig> {
  const input = monitorInput(data)
  const monitor: MonitorConfig = {
    id: crypto.randomUUID(),
    ...input,
    order_num: 10,
    enabled: 1,
    created_at: Math.floor(Date.now() / 1000),
  }
  const database = requireDb(db)
  const result = await database.batch<{ id: string }>([
    database
      .prepare(
        `INSERT INTO monitors(id,name,group_name,url,method,expected_status,interval_min,timeout_ms,order_num,enabled,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM monitors) < ? RETURNING id`
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
        monitor.created_at!,
        MAX_MONITORS
      ),
    settingsStatement(database, monitor),
    database
      .prepare(
        "UPDATE status_revision SET revision=revision+1 WHERE key='status' AND EXISTS(SELECT 1 FROM monitors WHERE id=?)"
      )
      .bind(monitor.id),
  ])
  if (!result[0].results.length) throw new HttpError(409, `最多支持 ${MAX_MONITORS} 个监控项`)
  return monitor
}

export async function removeMonitor(id: string, db?: D1Database): Promise<boolean> {
  const database = requireDb(db)
  const now = Math.floor(Date.now() / 1000)
  const results = await database.batch<{ id: string }>([
    database
      .prepare(
        `UPDATE incidents SET status='resolved',resolved_at=?,updated_at=?,description=description || '（监控项已删除，停止追踪）'
      WHERE status!='resolved' AND id IN (SELECT incident_id FROM incident_monitors WHERE monitor_id=?)`
      )
      .bind(now, now, id),
    database.prepare('DELETE FROM monitors WHERE id=? RETURNING id').bind(id),
    database.prepare("UPDATE status_revision SET revision=revision+1 WHERE key='status'"),
  ])
  return results[1].results.length > 0
}

export async function fetchMonitorsWithHistory(db?: D1Database): Promise<Monitor[]> {
  const database = requireDb(db)
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - 30 * 86400
  const monitors = await getAllMonitors(database, true)
  if (!monitors.length) return []
  const histories = await database.batch<Heartbeat>(
    monitors.map((m) =>
      database
        .prepare(
          'SELECT id,status,status_code,latency_ms,message,timestamp FROM heartbeats WHERE monitor_id=? ORDER BY timestamp DESC,id DESC LIMIT 60'
        )
        .bind(m.id)
    )
  )
  // Time-weighted observed availability; long gaps are unknown. Report coverage too.
  const stats = await database
    .prepare(
      `WITH intervals AS (
    SELECT h.monitor_id,h.status,h.timestamp,m.interval_min,m.timeout_ms,
      LEAD(h.timestamp,1,?) OVER (PARTITION BY h.monitor_id ORDER BY h.timestamp,h.id) AS next_ts
    FROM heartbeats h JOIN monitors m ON m.id=h.monitor_id WHERE h.timestamp>=?
  ), durations AS (
    SELECT monitor_id,status,MAX(0,MIN(next_ts,(CAST(timestamp/180 AS INTEGER)+CAST((interval_min+2)/3 AS INTEGER))*180+MAX(60,timeout_ms*2/1000),?)-MAX(timestamp,?)) AS seconds FROM intervals
  ) SELECT monitor_id,SUM(seconds) AS covered,SUM(CASE WHEN status IN (1,2) THEN seconds ELSE 0 END) AS available
    FROM durations GROUP BY monitor_id`
    )
    .bind(now, cutoff - 7200, now, cutoff)
    .all<{ monitor_id: string; covered: number; available: number }>()
  const byId = new Map(stats.results.map((s) => [s.monitor_id, s]))
  return monitors.map((m, index) => {
    const heartbeats = histories[index].results.reverse()
    const latest = heartbeats.filter((h) => (h.id ?? 0) > (m.probe_after_id ?? 0)).at(-1)
    const suppressed = !m.enabled || (m.maintenance_until ?? 0) > now
    const next = suppressed
      ? null
      : latest
        ? nextScheduledCheck(latest.timestamp, m.interval_min)
        : null
    const stale =
      suppressed || !latest || now > next! + Math.max(60, Math.ceil((m.timeout_ms * 2) / 1000))
    const observed = heartbeats.filter((h) => h.latency_ms !== null && h.status !== 0)
    const stat = byId.get(m.id)
    const window = Math.max(1, now - Math.max(cutoff, m.created_at ?? cutoff))
    return {
      ...m,
      heartbeats,
      stale,
      current_status: stale ? -1 : latest!.status,
      current_latency_ms: stale ? null : latest!.latency_ms,
      avg_latency_ms: observed.length
        ? Math.round(observed.reduce((s, h) => s + h.latency_ms!, 0) / observed.length)
        : null,
      uptime_30d: stat?.covered ? Math.round((stat.available / stat.covered) * 10000) / 100 : null,
      coverage_30d: stat?.covered
        ? Math.min(100, Math.round((stat.covered / window) * 10000) / 100)
        : 0,
      last_checked_at: latest?.timestamp ?? null,
      next_check_at: next,
    }
  })
}

export { overallStatus } from '../src/lib/status'

export async function fetchIncidents(db?: D1Database): Promise<Incident[]> {
  const rows = await requireDb(db)
    .prepare(
      `SELECT i.*,im.monitor_id FROM incidents i LEFT JOIN incident_monitors im ON im.incident_id=i.id
    WHERE i.status!='resolved' OR i.id IN (SELECT id FROM incidents WHERE status='resolved' ORDER BY resolved_at DESC LIMIT 5)
    ORDER BY CASE WHEN i.status='resolved' THEN 1 ELSE 0 END, i.created_at DESC`
    )
    .all<Incident>()
  return rows.results
}
