import type { Incident, IncidentDay, IncidentUpdate } from '../src/types'
import { dayBounds, incidentMonth, monthBounds, INCIDENT_TIME_ZONE } from '../src/lib/incident-calendar'
import { HttpError } from './validation'

const PAGE = 20
// Start with the small unresolved set, not a monitor's lifetime of resolved links.
export const ACTIVE_INCIDENT_SQL = `SELECT i.id FROM incidents i INDEXED BY idx_incidents_active
  CROSS JOIN incident_monitors im ON im.incident_id=i.id
  WHERE i.status!='resolved' AND im.monitor_id=? LIMIT 1`

export const RECENT_INCIDENTS_SQL = `WITH selected AS (
  SELECT id FROM incidents WHERE status!='resolved'
  UNION ALL SELECT id FROM (SELECT id FROM incidents WHERE status='resolved' ORDER BY resolved_at DESC,id DESC LIMIT 5)
) SELECT i.*,im.monitor_id FROM selected s JOIN incidents i ON i.id=s.id
  LEFT JOIN incident_monitors im ON im.incident_id=i.id
  ORDER BY CASE WHEN i.status='resolved' THEN 1 ELSE 0 END,i.created_at DESC,i.id DESC`

// Each arm seeks only activity inside the requested date range. A recovery in a
// later month still leads back to the original incident. Heartbeats are not used.
export const INCIDENT_ACTIVITY_SQL = `WITH activity AS (
  SELECT i.id AS incident_id,i.created_at AS timestamp,'opened' AS kind,
    COALESCE((SELECT severity FROM incident_updates INDEXED BY idx_incident_updates_opened WHERE incident_id=i.id AND kind='opened' ORDER BY timestamp,id LIMIT 1),i.severity) AS severity
    FROM incidents i WHERE created_at>=? AND created_at<?
  UNION ALL
  SELECT id,resolved_at,'resolved',severity FROM incidents
    WHERE status='resolved' AND resolved_at>=? AND resolved_at<?
  UNION ALL
  SELECT incident_id,timestamp,kind,severity FROM incident_updates
    WHERE timestamp>=? AND timestamp<? AND (kind='updated' OR (kind='snapshot' AND status!='resolved'))
)`

function rangeValues(start: number, end: number) { return [start, end, start, end, start, end] }

function cursor(value: string | null, numericId = false): [number, string | number] | null {
  if (!value) return null
  if (value.length > 200) throw new HttpError(400, '历史游标无效')
  try {
    const v: unknown = JSON.parse(value)
    if (!Array.isArray(v) || v.length !== 2 || !Number.isSafeInteger(v[0]) || v[0] < 0 ||
      (numericId ? !Number.isSafeInteger(v[1]) || v[1] < 1 : typeof v[1] !== 'string' || !v[1] || v[1].length > 100)) throw new Error()
    return v as [number, string | number]
  } catch { throw new HttpError(400, '历史游标无效') }
}

export async function incidentHistory(url: URL, db: D1Database) {
  const month = url.searchParams.get('month') ?? incidentMonth()
  const bounds = monthBounds(month)
  if (!bounds || month > incidentMonth()) throw new HttpError(400, '请选择有效的历史月份')
  const day = url.searchParams.get('day')
  const dayRange = day ? dayBounds(day) : null
  if (day && (!dayRange || day.slice(0, 7) !== month)) throw new HttpError(400, '日期必须在选定月份内')
  const before = cursor(url.searchParams.get('cursor'))
  const [start, end] = dayRange ?? bounds
  if (before && (before[0] < start || before[0] >= end)) throw new HttpError(400, '历史游标不属于所选日期')
  const days = await db.prepare(`${INCIDENT_ACTIVITY_SQL}
    SELECT strftime('%Y-%m-%d',timestamp,'unixepoch','+8 hours') AS date,
      COUNT(DISTINCT incident_id) AS total,SUM(kind='opened') AS opened,SUM(kind='resolved') AS resolved,
      MAX(CASE WHEN kind!='resolved' THEN CASE WHEN severity='major' THEN 2 ELSE 1 END ELSE 0 END) AS severity
    FROM activity GROUP BY date ORDER BY date`).bind(...rangeValues(...bounds)).all<IncidentDay>()
  const rows = await db.prepare(`${INCIDENT_ACTIVITY_SQL}, selected AS (
    SELECT incident_id,MAX(timestamp) AS last_activity_at FROM activity GROUP BY incident_id
  ) SELECT i.*,im.monitor_id,s.last_activity_at FROM selected s JOIN incidents i ON i.id=s.incident_id
    LEFT JOIN incident_monitors im ON im.incident_id=i.id
    ${before ? 'WHERE (s.last_activity_at,s.incident_id)<(?,?)' : ''}
    ORDER BY s.last_activity_at DESC,s.incident_id DESC LIMIT ?`)
    .bind(...rangeValues(start, end), ...(before ?? []), PAGE + 1).all<Incident>()
  const first = await db.prepare('SELECT created_at FROM incidents ORDER BY created_at,id LIMIT 1').first<{ created_at: number }>()
  const incidents = rows.results.slice(0, PAGE)
  const last = incidents.at(-1)
  return { success: true, month, day: day ?? null, time_zone: INCIDENT_TIME_ZONE,
    earliest_month: first ? incidentMonth(first.created_at) : null, days: days.results, incidents,
    next_cursor: rows.results.length > PAGE && last ? JSON.stringify([last.last_activity_at, last.id]) : null }
}

export async function incidentDetail(id: string, url: URL, db: D1Database) {
  if (!id || id.length > 100) throw new HttpError(400, '事件 ID 无效')
  const incident = await db.prepare(`SELECT i.*,im.monitor_id FROM incidents i
    LEFT JOIN incident_monitors im ON im.incident_id=i.id WHERE i.id=?`).bind(id).first<Incident>()
  if (!incident) throw new HttpError(404, '事件不存在')
  const after = cursor(url.searchParams.get('cursor'), true)
  const rows = await db.prepare(`SELECT * FROM incident_updates WHERE incident_id=?
    ${after ? 'AND (timestamp,id)>(?,?)' : ''} ORDER BY timestamp,id LIMIT ?`)
    .bind(id, ...(after ?? []), PAGE + 1).all<IncidentUpdate>()
  const updates = rows.results.slice(0, PAGE), last = updates.at(-1)
  return { success: true, incident, updates,
    next_cursor: rows.results.length > PAGE && last ? JSON.stringify([last.timestamp, last.id]) : null }
}
