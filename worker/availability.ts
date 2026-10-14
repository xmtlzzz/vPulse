import type { MonitorConfig } from '../src/types'
import { nextScheduledCheck } from '../src/lib/schedule'

const WINDOW = 30 * 86400
const RETENTION_GRACE = 7200
type Totals = { covered: number; available: number }
type Sample = { id: number; status: number; timestamp: number }
type Checkpoint = Totals & {
  id: string
  monitor_id: string | null
  interval_min: number
  timeout_ms: number
  computed_at: number
  last_id: number
  latest_id: number
  new_start: number | null
}

// Cold start/configuration changes rebuild only this monitor's window once.
// Subsequent reads reuse its totals, adding the new right edge and removing
// the expired left edge instead of repeating a 30-day GROUP BY scan.
export const BOOTSTRAP_AVAILABILITY_SQL = `WITH intervals AS (
  SELECT status,timestamp,LEAD(timestamp,1,?) OVER (ORDER BY timestamp,id) AS next_ts
  FROM heartbeats WHERE monitor_id=? AND timestamp>=?
), durations AS (
  SELECT status,MAX(0,MIN(next_ts,
    (CAST(timestamp/180 AS INTEGER)+?)*180+?,?)-MAX(timestamp,?)) AS seconds
  FROM intervals
) SELECT COALESCE(SUM(seconds),0) AS covered,
  COALESCE(SUM(CASE WHEN status IN (1,2) THEN seconds ELSE 0 END),0) AS available
FROM durations`

function windowSlice(
  samples: Sample[], monitor: MonitorConfig, start: number, end: number
): Totals {
  if (end <= start) return { covered: 0, available: 0 }
  let covered = 0, available = 0
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const expires = nextScheduledCheck(sample.timestamp, monitor.interval_min) +
      Math.max(60, monitor.timeout_ms * 2 / 1000)
    const seconds = Math.max(0,
      Math.min(samples[i + 1]?.timestamp ?? end, expires, end) - Math.max(sample.timestamp, start))
    covered += seconds
    if (sample.status === 1 || sample.status === 2) available += seconds
  }
  return { covered, available }
}

export async function availabilityStats(
  db: D1Database, monitors: MonitorConfig[], now: number
): Promise<Map<string, Totals>> {
  if (!monitors.length) return new Map()
  const revision = await db.prepare("SELECT revision FROM status_revision WHERE key='status'")
    .first<{ revision: number }>()
  const checkpoints = await db.prepare(`
    SELECT c.*,m.id,COALESCE((SELECT id FROM heartbeats WHERE monitor_id=m.id ORDER BY id DESC LIMIT 1),0) AS latest_id,
      CASE WHEN c.monitor_id IS NOT NULL THEN
        (SELECT MIN(timestamp) FROM heartbeats INDEXED BY idx_heartbeats_monitor_id
          WHERE monitor_id=m.id AND id>c.last_id)
      END AS new_start
    FROM monitors m LEFT JOIN availability_cache c ON c.monitor_id=m.id
    WHERE m.id IN (SELECT value FROM json_each(?))`
  ).bind(JSON.stringify(monitors.map(m => m.id))).all<Checkpoint>()
  const byId = new Map(checkpoints.results.map(c => [c.id, c]))
  const ranges: { key: string; monitor_id: string; start: number; end: number }[] = []
  const reusable = new Set<string>()
  for (let i = 0; i < monitors.length; i++) {
    const m = monitors[i]
    const checkpoint = byId.get(m.id)
    if (!checkpoint) continue // Concurrent deletion; no orphaned checkpoint.
    // Cleanup keeps only two hours of grace outside the rolling window. Rebuild
    // after a long idle period, before boundary data needed for subtraction can
    // have been pruned. Backfilled samples also require a fresh baseline.
    const maxAdvance = RETENTION_GRACE - Math.ceil(m.interval_min / 3) * 180 -
      Math.max(60, m.timeout_ms * 2 / 1000)
    const canReuse = checkpoint.monitor_id != null &&
      checkpoint.interval_min === m.interval_min && checkpoint.timeout_ms === m.timeout_ms &&
      checkpoint.computed_at <= now && now - checkpoint.computed_at <= maxAdvance &&
      checkpoint.last_id <= checkpoint.latest_id &&
      (checkpoint.new_start == null || checkpoint.new_start >= checkpoint.computed_at)
    if (canReuse) {
      reusable.add(m.id)
      if (now > checkpoint.computed_at) ranges.push(
        { key: `${i}:added`, monitor_id: m.id, start: checkpoint.computed_at, end: now },
        { key: `${i}:expired`, monitor_id: m.id, start: checkpoint.computed_at - WINDOW, end: now - WINDOW },
      )
    }
  }
  // One bounded range query serves all monitors instead of issuing four queries
  // per monitor (important for the Free plan's per-invocation query budget).
  const slices = new Map<string, Sample[]>()
  if (ranges.length) {
    const rows = await db.prepare(`WITH ranges AS (
      SELECT json_extract(value,'$.key') AS range_key,json_extract(value,'$.monitor_id') AS monitor_id,
        json_extract(value,'$.start') AS start,json_extract(value,'$.end') AS end FROM json_each(?)
    ), samples AS (
      SELECT r.range_key,h.id,h.status,h.timestamp FROM ranges r JOIN heartbeats h
        ON h.monitor_id=r.monitor_id AND h.timestamp>=r.start AND h.timestamp<=r.end
      UNION ALL
      SELECT r.range_key,h.id,h.status,h.timestamp FROM ranges r JOIN heartbeats h ON h.id=(
        SELECT id FROM heartbeats WHERE monitor_id=r.monitor_id AND timestamp<r.start
        ORDER BY timestamp DESC,id DESC LIMIT 1
      )
    ) SELECT range_key,id,status,timestamp FROM samples ORDER BY range_key,timestamp,id`
    ).bind(JSON.stringify(ranges)).all<Sample & { range_key: string }>()
    for (const row of rows.results) {
      const group = slices.get(row.range_key) ?? []
      group.push(row)
      slices.set(row.range_key, group)
    }
  }
  const totals = new Map<string, Totals>()
  const writes: (Totals & { monitor_id: string; interval_min: number; timeout_ms: number; computed_at: number; last_id: number })[] = []
  for (let i = 0; i < monitors.length; i++) {
    const m = monitors[i]
    const checkpoint = byId.get(m.id)
    if (!checkpoint) continue
    let stat: Totals
    if (reusable.has(m.id)) {
      const added = windowSlice(slices.get(`${i}:added`) ?? [], m, checkpoint.computed_at, now)
      const expired = windowSlice(slices.get(`${i}:expired`) ?? [], m, checkpoint.computed_at - WINDOW, now - WINDOW)
      stat = {
        covered: Math.max(0, checkpoint.covered + added.covered - expired.covered),
        available: Math.max(0, checkpoint.available + added.available - expired.available),
      }
    } else {
      stat = (await db.prepare(BOOTSTRAP_AVAILABILITY_SQL).bind(
        now, m.id, now - WINDOW - RETENTION_GRACE, Math.ceil(m.interval_min / 3),
        Math.max(60, m.timeout_ms * 2 / 1000), now, now - WINDOW
      ).first<Totals>())!
    }
    totals.set(m.id, stat)
    writes.push({ ...stat, monitor_id: m.id, interval_min: m.interval_min, timeout_ms: m.timeout_ms,
      computed_at: now, last_id: checkpoint.latest_id })
  }
  if (revision && writes.length) await db.batch([db.prepare(`INSERT INTO availability_cache
      (monitor_id,interval_min,timeout_ms,computed_at,last_id,covered,available,source_revision)
      SELECT m.id,m.interval_min,m.timeout_ms,json_extract(p.value,'$.computed_at'),
        json_extract(p.value,'$.last_id'),json_extract(p.value,'$.covered'),json_extract(p.value,'$.available'),r.revision
      FROM json_each(?) p JOIN monitors m ON m.id=json_extract(p.value,'$.monitor_id')
      JOIN status_revision r ON r.key='status' AND r.revision=?
      WHERE m.interval_min=json_extract(p.value,'$.interval_min') AND m.timeout_ms=json_extract(p.value,'$.timeout_ms')
      ON CONFLICT(monitor_id) DO UPDATE SET interval_min=excluded.interval_min,timeout_ms=excluded.timeout_ms,
        computed_at=excluded.computed_at,last_id=excluded.last_id,covered=excluded.covered,
        available=excluded.available,source_revision=excluded.source_revision
      WHERE availability_cache.source_revision<=excluded.source_revision
        AND availability_cache.computed_at<=excluded.computed_at`
    ).bind(JSON.stringify(writes), revision.revision)])
  return totals
}
