import type { StatusResponse } from '../src/types'
import { projectFreshness } from '../src/lib/status'
import { fetchIncidents, fetchMonitorsWithHistory, overallStatus } from './db'

export async function readStatus(db: D1Database): Promise<StatusResponse> {
  const now = Math.floor(Date.now() / 1000)
  const snapshot = await db.prepare(`SELECT r.revision,c.payload,c.expires_at FROM status_revision r
    LEFT JOIN status_cache c ON c.key=r.key AND c.revision=r.revision WHERE r.key='status'`)
    .first<{ revision: number; payload: string | null; expires_at: number | null }>()
  if (!snapshot) throw new Error('Status cache migration has not been applied')
  if (snapshot.payload && snapshot.expires_at! > now) {
    // Cache lifetime must never extend the health of an expired observation.
    return projectFreshness(JSON.parse(snapshot.payload) as StatusResponse, now)
  }
  const monitors = await fetchMonitorsWithHistory(db)
  const incidents = await fetchIncidents(db)
  const data: StatusResponse = { success: true, overall: overallStatus(monitors), monitors, incidents }
  // A concurrent probe/create/delete increments the revision atomically. A read
  // begun before that change can never overwrite the cache for the newer state.
  await db.prepare(`INSERT INTO status_cache(key,revision,payload,expires_at)
    SELECT 'status',?,?,? FROM status_revision WHERE key='status' AND revision=?
    ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,expires_at=excluded.expires_at`)
    .bind(snapshot.revision, JSON.stringify(data), now + 60, snapshot.revision).run()
  return data
}
