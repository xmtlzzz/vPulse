import type { MonitorConfig, ProbeResponse } from '../src/types'
import type { Env } from './env'
import { requireDb, getAllMonitors, MAX_MONITORS } from './db'
import { HttpError } from './validation'
import { probeSingleMonitor, type HeartbeatResult } from './probe'
import { type Alert } from './alerts'
import { nextScheduledCheck } from '../src/lib/schedule'

const nowSeconds = () => Math.floor(Date.now() / 1000)

// One database-owned lease serializes Cron, manual probes and monitor mutations,
// including requests handled in different Worker isolates/locations.
export async function withSchedulerLock<T>(
  db: D1Database,
  action: () => Promise<T>
): Promise<T | null> {
  const owner = crypto.randomUUID()
  const now = nowSeconds()
  const claimed = await db
    .prepare(
      `INSERT INTO probe_locks(key,owner,expires_at) VALUES('scheduler',?,?)
    ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE probe_locks.expires_at<=? RETURNING owner`
    )
    .bind(owner, now + 600, now)
    .first<{ owner: string }>()
  if (!claimed) return null
  try {
    return await action()
  } finally {
    await db.prepare("DELETE FROM probe_locks WHERE key='scheduler' AND owner=?").bind(owner).run()
  }
}

export async function rateLimit(db: D1Database, key: string, limit: number): Promise<void> {
  const window = Math.floor(nowSeconds() / 60) * 60
  const row = await db
    .prepare(
      `INSERT INTO request_limits(key,window_start,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,
      count=CASE WHEN request_limits.window_start=excluded.window_start THEN request_limits.count+1 ELSE 1 END
    WHERE request_limits.window_start!=excluded.window_start OR request_limits.count<? RETURNING count`
    )
    .bind(key, window, limit)
    .first()
  if (!row) throw new HttpError(429, '操作过于频繁，请稍后再试')
}

export async function storeProbe(env: Env, monitor: MonitorConfig, result: HeartbeatResult) {
  const db = env.DB
  const previous = await db
    .prepare(
      'SELECT status FROM heartbeats WHERE monitor_id=? ORDER BY timestamp DESC,id DESC LIMIT 1'
    )
    .bind(monitor.id)
    .first<{ status: number }>()
  const changed = previous?.status !== result.status
  const statements = [
    db
      .prepare(
        `INSERT INTO heartbeats(monitor_id,status,status_code,latency_ms,ssl_days_remaining,message,timestamp) VALUES(?,?,?,?,?,?,?)`
      )
      .bind(
        monitor.id,
        result.status,
        result.status_code,
        result.latency_ms,
        null,
        result.message,
        result.timestamp
      ),
  ]
  const active = await db
    .prepare(
      `SELECT i.id FROM incidents i JOIN incident_monitors im ON im.incident_id=i.id
    WHERE im.monitor_id=? AND i.status!='resolved' LIMIT 1`
    )
    .bind(monitor.id)
    .first<{ id: string }>()
  const needsIncident = result.status !== 1 && !active
  if (changed || needsIncident || (result.status === 1 && active)) {
    if (result.status === 1 && active) {
      statements.push(
        db
          .prepare("UPDATE incidents SET status='resolved',updated_at=?,resolved_at=? WHERE id=?")
          .bind(result.timestamp, result.timestamp, active.id)
      )
    } else if (result.status !== 1) {
      const title = `${result.status === 0 ? '服务中断' : '服务降级'}: ${monitor.name}`
      if (active) {
        statements.push(
          db
            .prepare(
              'UPDATE incidents SET title=?,description=?,severity=?,updated_at=? WHERE id=?'
            )
            .bind(
              title,
              result.message,
              result.status === 0 ? 'major' : 'minor',
              result.timestamp,
              active.id
            )
        )
      } else {
        const id = crypto.randomUUID()
        let started = result.timestamp
        // Older releases stored DOWN heartbeats without creating incidents.
        // Reconcile that state using the start of the observed failure streak.
        if (previous && previous.status !== 1) {
          const streak = await db
            .prepare(
              `WITH recovery AS (
            SELECT timestamp,id FROM heartbeats WHERE monitor_id=? AND status=1 ORDER BY timestamp DESC,id DESC LIMIT 1
          ) SELECT MIN(timestamp) AS started_at FROM heartbeats WHERE monitor_id=? AND status!=1
            AND (NOT EXISTS(SELECT 1 FROM recovery) OR (timestamp,id)>(SELECT timestamp,id FROM recovery))`
            )
            .bind(monitor.id, monitor.id)
            .first<{ started_at: number | null }>()
          started = Math.min(result.timestamp, streak?.started_at ?? result.timestamp)
        }
        statements.push(
          db
            .prepare(
              "INSERT INTO incidents(id,title,description,severity,status,created_at,updated_at) VALUES(?,?,?,?,'investigating',?,?)"
            )
            .bind(
              id,
              title,
              result.message,
              result.status === 0 ? 'major' : 'minor',
              started,
              result.timestamp
            )
        )
        statements.push(
          db
            .prepare('INSERT INTO incident_monitors(incident_id,monitor_id) VALUES(?,?)')
            .bind(id, monitor.id)
        )
      }
    }
  }
  const state = await db
    .prepare('SELECT * FROM alert_state WHERE monitor_id=?')
    .bind(monitor.id)
    .first<{ failure_streak: number; notified_status: number | null; last_notified_at: number }>()
  const streak = result.status === 1 ? 0 : (state?.failure_streak ?? 0) + 1
  const suppressed = !monitor.enabled || (monitor.maintenance_until ?? 0) > result.timestamp
  const recovery =
    result.status === 1 &&
    ((state?.notified_status != null && state.notified_status !== 1) ||
      (!state && previous && previous.status !== 1))
  const shouldNotify =
    !suppressed &&
    env.WEBHOOK_URL &&
    (result.status === 1
      ? recovery && monitor.notify_recovery !== 0
      : streak >= (monitor.failure_threshold ?? 1) &&
        (state?.notified_status !== result.status ||
          ((monitor.reminder_min ?? 0) > 0 &&
            result.timestamp - (state?.last_notified_at ?? 0) >= (monitor.reminder_min ?? 0) * 60)))
  if (shouldNotify) {
    const alert: Alert = {
      monitor: monitor.name,
      url: monitor.url,
      status: result.status === 0 ? 'DOWN' : result.status === 2 ? 'DEGRADED' : 'UP',
      message: result.message,
    }
    statements.push(
      db
        .prepare(
          'INSERT INTO alert_outbox(id,payload,next_attempt_at,created_at,monitor_id) VALUES(?,?,?,?,?)'
        )
        .bind(
          crypto.randomUUID(),
          JSON.stringify(alert),
          result.timestamp,
          result.timestamp,
          monitor.id
        )
    )
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO alert_state(monitor_id,failure_streak,notified_status,last_notified_at) VALUES(?,?,?,?)
    ON CONFLICT(monitor_id) DO UPDATE SET failure_streak=excluded.failure_streak,notified_status=excluded.notified_status,last_notified_at=excluded.last_notified_at`
      )
      .bind(
        monitor.id,
        streak,
        result.status === 1 ? 1 : shouldNotify ? result.status : (state?.notified_status ?? null),
        shouldNotify ? result.timestamp : (state?.last_notified_at ?? 0)
      )
  )
  statements.push(db.prepare("UPDATE status_revision SET revision=revision+1 WHERE key='status'"))
  await db.batch(statements)
}

export async function runProbes(
  env: Env,
  options: { id?: string; force?: boolean; scheduled?: boolean } = {}
): Promise<ProbeResponse> {
  const db = requireDb(env.DB)
  const result = await withSchedulerLock(db, async () => {
    const configs = await getAllMonitors(db)
    if (configs.length > MAX_MONITORS)
      throw new HttpError(503, `监控数量超过 ${MAX_MONITORS}，请先减少监控项`)
    const now = nowSeconds()
    const last = await db
      .prepare(
        'SELECT h.monitor_id,MAX(h.timestamp) AS timestamp FROM heartbeats h LEFT JOIN monitor_settings s ON s.monitor_id=h.monitor_id WHERE h.id>COALESCE(s.probe_after_id,0) GROUP BY h.monitor_id'
      )
      .all<{ monitor_id: string; timestamp: number }>()
    const lastById = new Map(last.results.map((row) => [row.monitor_id, row.timestamp]))
    let monitors = configs
    if (options.id) {
      monitors = configs.filter((m) => m.id === options.id)
      if (!monitors.length) {
        if ((await getAllMonitors(db, true)).some((m) => m.id === options.id))
          throw new HttpError(409, '项目已暂停或正在维护，请先恢复监控')
        throw new HttpError(404, '监控项不存在')
      }
      const checked = lastById.get(options.id)
      if (!options.force && checked !== undefined && now - checked < 30) {
        return {
          success: true,
          debounced: true,
          probed_count: 0,
          cooldown_remaining_sec: 30 - (now - checked),
        }
      }
    } else if (options.scheduled) {
      monitors = configs.filter(
        (m) => !lastById.has(m.id) || now >= nextScheduledCheck(lastById.get(m.id)!, m.interval_min)
      )
    } else if (!options.force) {
      const fleet = await db
        .prepare("SELECT finished_at FROM probe_runs WHERE key='fleet'")
        .first<{ finished_at: number }>()
      if (fleet && now - fleet.finished_at < 90)
        return {
          success: true,
          debounced: true,
          probed_count: 0,
          cooldown_remaining_sec: 90 - (now - fleet.finished_at),
        }
    }
    // At most three probes in flight; persist each result without waiting for slow peers.
    const runId = crypto.randomUUID()
    if (monitors.length)
      await db.batch([
        db
          .prepare(
            "INSERT INTO probe_round(key,run_id) VALUES('current',?) ON CONFLICT(key) DO UPDATE SET run_id=excluded.run_id"
          )
          .bind(runId),
        ...monitors.map((m) =>
          db
            .prepare(
              `INSERT INTO probe_progress(monitor_id,run_id,stage,started_at,updated_at) VALUES(?,?,'queued',?,?)
      ON CONFLICT(monitor_id) DO UPDATE SET run_id=excluded.run_id,stage='queued',started_at=excluded.started_at,updated_at=excluded.updated_at`
            )
            .bind(m.id, runId, now, now)
        ),
      ])
    let cursor = 0
    const runOne = async () => {
      while (cursor < monitors.length) {
        const monitor = monitors[cursor++]
        const setStage = async (stage: string) => {
          await db
            .prepare(
              'UPDATE probe_progress SET stage=?,updated_at=? WHERE monitor_id=? AND run_id=?'
            )
            .bind(stage, nowSeconds(), monitor.id, runId)
            .run()
        }
        try {
          const heartbeat = await probeSingleMonitor(monitor, setStage)
          await storeProbe(env, monitor, heartbeat)
          await setStage('complete')
        } catch (error) {
          await setStage('failed')
          throw error
        }
      }
    }
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(3, monitors.length) }, runOne)
    )
    const failure = settled.find((r) => r.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (!options.id && monitors.length) {
      await db
        .prepare(
          "INSERT INTO probe_runs(key,finished_at) VALUES('fleet',?) ON CONFLICT(key) DO UPDATE SET finished_at=excluded.finished_at"
        )
        .bind(nowSeconds())
        .run()
    }
    // Keep an anchor just outside the window so time-weighted statistics include
    // the start boundary. Older records are deleted once per completed round.
    await db
      .prepare('DELETE FROM heartbeats WHERE timestamp<?')
      .bind(nowSeconds() - 30 * 86400 - 7200)
      .run()
    console.log(
      JSON.stringify({
        event: 'probe_round_completed',
        source: options.scheduled ? 'cron' : 'manual',
        count: monitors.length,
      })
    )
    return { success: true, debounced: false, probed_count: monitors.length }
  })
  return (
    result ?? {
      success: true,
      debounced: true,
      probed_count: 0,
      cooldown_remaining_sec: 5,
      message: '已有巡检或管理操作正在执行',
    }
  )
}
