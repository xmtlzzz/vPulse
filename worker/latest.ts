import type { MonitorConfig } from '../src/types'

// The existence check uses (monitor_id,id) so resetting a monitor with no new
// sample does not walk all its invalidated history. The timestamp index then
// returns the newest valid sample, including deterministic timestamp ties.
export const LATEST_HEARTBEAT_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM heartbeats WHERE monitor_id=? AND id>? LIMIT 1
) THEN (
  SELECT timestamp FROM heartbeats WHERE monitor_id=? AND id>?
  ORDER BY timestamp DESC,id DESC LIMIT 1
) END AS timestamp`

export async function latestHeartbeats(
  db: D1Database,
  monitors: Pick<MonitorConfig, 'id' | 'probe_after_id'>[]
): Promise<Map<string, number>> {
  if (!monitors.length) return new Map()
  const rows = await db.batch<{ timestamp: number | null }>(monitors.map((m) =>
    db.prepare(LATEST_HEARTBEAT_SQL)
      .bind(m.id, m.probe_after_id ?? 0, m.id, m.probe_after_id ?? 0)
  ))
  return new Map(rows.flatMap((r, i) => {
    const timestamp = r.results[0]?.timestamp
    return timestamp == null ? [] : [[monitors[i].id, timestamp] as const]
  }))
}
