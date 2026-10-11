import type { Env } from './env'
import type { MonitorConfig } from '../src/types'
import { getAllMonitors, MAX_MONITORS, settingsStatement, updateMonitor } from './db'
import { deviceList, logout } from './auth'
import { HttpError, monitorInput, readJson } from './validation'
import { withSchedulerLock } from './scheduler'

const now = () => Math.floor(Date.now() / 1000)
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
const monitorId = (url: URL) => {
  const id = url.searchParams.get('id')
  if (!id || id.length > 100) throw new HttpError(400, '缺少有效监控 ID')
  return id
}
const fields = [
  'name',
  'group_name',
  'url',
  'method',
  'expected_status',
  'interval_min',
  'timeout_ms',
  'enabled',
  'keyword',
  'json_path',
  'json_expected',
  'failure_threshold',
  'notify_recovery',
  'reminder_min',
  'maintenance_until',
] as const

export async function management(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url),
    db = env.DB
  if (url.pathname === '/api/monitors' && request.method === 'PATCH') {
    const id = monitorId(url),
      body = await readJson(request)
    const monitor = await withSchedulerLock(db, () => updateMonitor(id, body, db))
    if (!monitor) throw new HttpError(409, '已有巡检正在执行，请稍后再试')
    return json({ success: true, monitor })
  }
  if (url.pathname === '/api/progress' && request.method === 'GET') {
    const lease = await db
      .prepare("SELECT expires_at FROM probe_locks WHERE key='scheduler'")
      .first<{ expires_at: number }>()
    const rows = await db
      .prepare(
        "SELECT monitor_id,stage,started_at,updated_at FROM probe_progress WHERE run_id=(SELECT run_id FROM probe_round WHERE key='current') AND updated_at>? ORDER BY started_at,monitor_id"
      )
      .bind(now() - 600)
      .all<{ monitor_id: string; stage: string; started_at: number; updated_at: number }>()
    const items = rows.results.map((r) => ({
      ...r,
      stage:
        ['queued', 'probing', 'retrying'].includes(r.stage) && (!lease || lease.expires_at <= now())
          ? 'failed'
          : r.stage,
    }))
    return json({
      success: true,
      active: items.some((r) => ['queued', 'probing', 'retrying'].includes(r.stage)),
      items,
    })
  }
  if (url.pathname === '/api/history' && request.method === 'GET') {
    const id = monitorId(url)
    if (!(await db.prepare('SELECT id FROM monitors WHERE id=?').bind(id).first()))
      throw new HttpError(404, '监控项不存在')
    const range = url.searchParams.get('range') ?? '24h'
    const seconds =
      range === '24h' ? 86400 : range === '7d' ? 7 * 86400 : range === '30d' ? 30 * 86400 : 0
    if (!seconds) throw new HttpError(400, '历史范围仅支持 24h / 7d / 30d')
    const to = url.searchParams.has('to') ? Number(url.searchParams.get('to')) : now()
    const from = url.searchParams.has('from') ? Number(url.searchParams.get('from')) : to - seconds
    const page = Number(url.searchParams.get('page') ?? 0)
    if (
      !Number.isInteger(to) ||
      !Number.isInteger(from) ||
      from < now() - 30 * 86400 - 5 ||
      to > now() + 5 ||
      from >= to ||
      to - from > 30 * 86400 ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 1000
    )
      throw new HttpError(400, '时间范围或页码无效（最多 30 天）')
    const bucket = Math.max(180, Math.ceil((to - from) / 360))
    const points = await db
      .prepare(
        `SELECT CAST(timestamp/? AS INTEGER)*? timestamp,AVG(latency_ms) latency_ms,
      MIN(latency_ms) min_ms,MAX(latency_ms) max_ms,COUNT(*) count,SUM(CASE WHEN status=0 THEN 1 ELSE 0 END) failures
      FROM heartbeats WHERE monitor_id=? AND timestamp>=? AND timestamp<=? GROUP BY CAST(timestamp/? AS INTEGER) ORDER BY timestamp`
      )
      .bind(bucket, bucket, id, from, to, bucket)
      .all()
    const records = await db
      .prepare(
        `SELECT status,status_code,latency_ms,message,timestamp FROM heartbeats WHERE monitor_id=? AND timestamp>=? AND timestamp<=?
      ${url.searchParams.get('errors') === '1' ? 'AND status IN (0,2)' : ''} ORDER BY timestamp DESC,id DESC LIMIT 101 OFFSET ?`
      )
      .bind(id, from, to, page * 100)
      .all()
    return json({
      success: true,
      from,
      to,
      bucket_seconds: bucket,
      points: points.results,
      records: records.results.slice(0, 100),
      has_more: records.results.length > 100,
    })
  }
  if (url.pathname === '/api/admin/export' && request.method === 'GET') {
    const monitors = (await getAllMonitors(db, true)).map((m) =>
      Object.fromEntries(fields.map((key) => [key, m[key]]))
    )
    return json({ success: true, version: 1, monitors })
  }
  if (url.pathname === '/api/admin/import' && request.method === 'POST') {
    const body = await readJson(request, 65536)
    if (
      body.version !== 1 ||
      !Array.isArray(body.monitors) ||
      !body.monitors.length ||
      body.monitors.length > MAX_MONITORS
    )
      throw new HttpError(400, `需要 version:1 和 1–${MAX_MONITORS} 个项目`)
    const monitors: MonitorConfig[] = body.monitors.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new HttpError(400, '项目配置无效')
      const data = raw as Record<string, unknown>
      if (data.enabled !== undefined && data.enabled !== 0 && data.enabled !== 1)
        throw new HttpError(400, '启用状态无效')
      return {
        id: crypto.randomUUID(),
        ...monitorInput(data),
        enabled: data.enabled === 0 ? 0 : 1,
        order_num: 10,
        created_at: now(),
      }
    })
    const imported = await withSchedulerLock(db, async () => {
      const count = await db
        .prepare('SELECT COUNT(*) count FROM monitors')
        .first<{ count: number }>()
      if ((count?.count ?? 0) + monitors.length > MAX_MONITORS)
        throw new HttpError(409, `最多支持 ${MAX_MONITORS} 个项目，请减少导入数量`)
      await db.batch(
        monitors
          .flatMap((m) => [
            db
              .prepare(
                'INSERT INTO monitors(id,name,group_name,url,method,expected_status,interval_min,timeout_ms,order_num,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
              )
              .bind(
                m.id,
                m.name,
                m.group_name,
                m.url,
                m.method,
                m.expected_status,
                m.interval_min,
                m.timeout_ms,
                m.order_num,
                m.enabled,
                m.created_at!
              ),
            settingsStatement(db, m),
          ])
          .concat(db.prepare("UPDATE status_revision SET revision=revision+1 WHERE key='status'"))
      )
      return monitors.length
    })
    if (imported === null) throw new HttpError(409, '已有巡检正在执行，请稍后再试')
    return json({ success: true, imported_count: imported }, 201)
  }
  if (url.pathname === '/api/admin/devices' && request.method === 'GET')
    return json({ success: true, devices: await deviceList(request, env) })
  if (url.pathname === '/api/admin/devices' && request.method === 'DELETE') {
    const result = await db
      .prepare(
        'DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM session_devices WHERE id=?) RETURNING token_hash'
      )
      .bind(monitorId(url))
      .first()
    if (!result) throw new HttpError(404, '设备授权不存在或已撤销')
    return json({ success: true })
  }
  if (url.pathname === '/api/session' && request.method === 'DELETE') {
    const response = json({ success: true })
    response.headers.set('Set-Cookie', await logout(request, env))
    return response
  }
  if (url.pathname === '/api/admin/alerts' && request.method === 'GET') {
    const deliveries = await db
      .prepare('SELECT * FROM alert_deliveries ORDER BY timestamp DESC,id DESC LIMIT 100')
      .all()
    const pending = await db
      .prepare(
        'SELECT id,attempts,next_attempt_at,created_at FROM alert_outbox ORDER BY created_at DESC LIMIT 100'
      )
      .all()
    return json({
      success: true,
      configured: !!env.WEBHOOK_URL,
      channel: env.WEBHOOK_TYPE ?? 'generic',
      deliveries: deliveries.results,
      pending: pending.results,
    })
  }
  if (url.pathname === '/api/admin/alerts/test' && request.method === 'POST') {
    if (!env.WEBHOOK_URL) throw new HttpError(409, '请先在 Worker 配置告警渠道')
    const id = crypto.randomUUID()
    await db
      .prepare('INSERT INTO alert_outbox(id,payload,next_attempt_at,created_at) VALUES(?,?,?,?)')
      .bind(
        id,
        JSON.stringify({
          monitor: '通知测试',
          url: new URL(request.url).origin,
          status: 'UP',
          message: '这是 vPulse 告警渠道测试消息',
        }),
        now(),
        now()
      )
      .run()
    return json({ success: true, message: '测试通知已进入发送队列', alert_id: id })
  }
  if (url.pathname === '/api/admin/alerts/retry' && request.method === 'POST') {
    const id = monitorId(url)
    const lease = await db
      .prepare("SELECT owner FROM probe_locks WHERE key='alerts' AND expires_at>?")
      .bind(now())
      .first()
    if (lease) throw new HttpError(409, '正在发送通知，请稍后再试')
    const result = await db
      .prepare('UPDATE alert_outbox SET attempts=0,next_attempt_at=? WHERE id=? RETURNING id')
      .bind(now(), id)
      .first()
    if (!result) throw new HttpError(404, '待发送通知不存在')
    return json({ success: true })
  }
  return null
}
