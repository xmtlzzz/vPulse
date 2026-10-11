import type { Env } from './env'
import { createMonitor, removeMonitor, requireDb } from './db'
import { readStatus } from './status'
import { HttpError, monitorInput, readJson } from './validation'
import { rateLimit, runProbes, storeProbe, withSchedulerLock } from './scheduler'
import { probeSingleMonitor } from './probe'
import { flushAlerts } from './alerts'
import { authorize, rememberDevice } from './auth'
import { nextScheduledCheck } from '../src/lib/schedule'

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin && (request.method !== 'GET' || url.searchParams.has('probe'))) throw new HttpError(403, '不允许跨站管理请求')
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' && (request.method !== 'GET' || url.searchParams.has('probe'))) throw new HttpError(403, '不允许跨站管理请求')
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, DELETE, OPTIONS' } })
  const isManagement = request.method !== 'GET' || url.searchParams.has('probe')
  if (isManagement) await authorize(request, env, (request.method === 'POST' && ['/api/monitors', '/api/session'].includes(url.pathname)) || request.method === 'GET')
  const db = requireDb(env.DB)

  if (url.pathname === '/api/session' && request.method === 'POST') {
    await rateLimit(db, 'session', 20)
    const response = json({ success: true })
    response.headers.set('Set-Cookie', await rememberDevice(request, env))
    return response
  }

  if (url.pathname === '/api/status' && request.method === 'GET') {
    if (url.searchParams.get('probe') === '1') {
      await rateLimit(db, 'manual', 20)
      await runProbes(env, { force: true })
    }
    return json(await readStatus(db))
  }
  if (url.pathname === '/api/probe' && request.method === 'POST') {
    await rateLimit(db, 'manual', 20)
    return json(await runProbes(env, { id: url.searchParams.get('id') ?? undefined, force: url.searchParams.get('force') === '1' }))
  }
  if (url.pathname === '/api/probe-test' && request.method === 'POST') {
    const body = await readJson(request)
    const input = monitorInput({ ...body, name: '连接测试', group_name: '测试' })
    await rateLimit(db, 'preview', 6)
    const result = await probeSingleMonitor({ id: 'preview', ...input, enabled: 1, order_num: 0 })
    return json({ success: result.status !== 0, statusCode: result.status_code, latencyMs: result.latency_ms, error: result.status === 0 ? result.message : undefined })
  }
  if (url.pathname === '/api/monitors' && request.method === 'POST') {
    const input = monitorInput(await readJson(request))
    await rateLimit(db, 'management', 20)
    const result = await withSchedulerLock(db, async () => {
      const monitor = await createMonitor(input, db)
      await storeProbe(env, monitor, await probeSingleMonitor(monitor))
      await flushAlerts(env)
      return monitor
    })
    if (!result) throw new HttpError(409, '已有巡检正在执行，请稍后再试')
    const response = json({ success: true, monitor: result }, 201)
    response.headers.set('Set-Cookie', await rememberDevice(request, env))
    return response
  }
  if (url.pathname === '/api/monitors' && request.method === 'DELETE') {
    await rateLimit(db, 'management', 20)
    const id = url.searchParams.get('id')
    if (!id || id.length > 100) throw new HttpError(400, '缺少有效监控 ID')
    const result = await withSchedulerLock(db, () => removeMonitor(id, db))
    if (result === null) throw new HttpError(409, '已有巡检正在执行，请稍后再试')
    if (!result) throw new HttpError(404, '监控项不存在')
    return json({ success: true, deleted_id: id })
  }
  if (url.pathname === '/api/monitors' && request.method === 'GET') return json({ success: true, monitors: (await readStatus(db)).monitors })
  if (url.pathname === '/api/health' && request.method === 'GET') {
    await db.prepare('SELECT 1').first()
    const rows = await db.prepare(`SELECT m.id,m.interval_min,m.timeout_ms,MAX(h.timestamp) AS last_checked
      FROM monitors m LEFT JOIN heartbeats h ON h.monitor_id=m.id WHERE m.enabled=1 GROUP BY m.id`)
      .all<{ id: string; interval_min: number; timeout_ms: number; last_checked: number | null }>()
    const now = Math.floor(Date.now() / 1000)
    const stale = rows.results.filter(m => m.last_checked === null || now > nextScheduledCheck(m.last_checked, m.interval_min) + Math.max(60, m.timeout_ms * 2 / 1000))
    return json({ status: stale.length ? 'DEGRADED' : 'UP', service: 'vPulse', components: { d1: { status: 'UP' }, scheduler: { status: stale.length ? 'DEGRADED' : 'UP', stale_count: stale.length } }, timestamp: now }, stale.length ? 503 : 200)
  }
  const known = ['/api/status', '/api/monitors', '/api/probe', '/api/probe-test', '/api/health', '/api/session']
  throw new HttpError(known.includes(url.pathname) ? 405 : 404, known.includes(url.pathname) ? '请求方式不支持' : '接口不存在')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env) }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 503
      if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: 'api_failure', path: new URL(request.url).pathname, error: error instanceof Error ? error.message : 'unknown' }))
      return json({ success: false, status: 'UNKNOWN', error: error instanceof HttpError ? error.message : '监控系统暂时不可用，请稍后重试' }, status)
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runProbes(env, { scheduled: true }).catch(error => {
      console.error(JSON.stringify({ event: 'scheduled_probe_failed', error: error instanceof Error ? error.message : 'unknown' }))
      throw error
    }))
  },
} satisfies ExportedHandler<Env>
