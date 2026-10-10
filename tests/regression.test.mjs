import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load, database, seed, beat, context, request, mockNetwork } from './helpers.mjs'

const worker = (await load('worker/index.ts')).default
const dbmod = await load('worker/db.ts')
const { probeSingleMonitor } = await load('worker/probe.ts')
const api = await load('src/lib/api.ts')
const statusTools = await load('src/lib/status.ts')
const scheduler = await load('worker/scheduler.ts')
const alerts = await load('worker/alerts.ts')
const validation = await load('worker/validation.ts')
const { readStatus } = await load('worker/status.ts')
const now = () => Math.floor(Date.now() / 1000)
const config = { id: 'audit', name: 'Audit', group_name: 'Audit', url: 'https://example.com', method: 'GET', expected_status: 200, interval_min: 3, timeout_ms: 100, order_num: 1, enabled: 1 }

test('R01: network errors never produce healthy fallback data', async (t) => {
  mockNetwork(t, async () => { throw new Error('offline') })
  await assert.rejects(api.fetchStatus())
})

test('R01/R18: DB outage is reported by both status and readiness', async () => {
  const env = { DB: { prepare() { throw new Error('offline') } } }
  for (const path of ['/api/status', '/api/health']) {
    const res = await worker.fetch(request(path), env, context())
    assert.equal(res.status, 503, path)
  }
})

test('R02/R03: every mutation and forced read requires configured authentication', async (t) => {
  const d = database(); t.after(d.close)
  mockNetwork(t, async () => new Response('OK'))
  for (const [path, method, body] of [['/api/monitors', 'POST', { name: 'New', url: config.url }], ['/api/monitors?id=audit', 'DELETE'], ['/api/probe?force=1', 'POST'], ['/api/probe-test', 'POST', { url: config.url }], ['/api/status?probe=1', 'GET']]) {
    for (const token of [undefined, 'audit-secret']) {
      const res = await worker.fetch(request(path, method, body, ''), { DB: d.db, ADMIN_TOKEN: token }, context())
      assert.ok([401, 503].includes(res.status), `${path}: ${res.status}`)
    }
  }
})

test('R03: rejects private URLs and unsafe HTTP methods before outbound fetch', async (t) => {
  const d = database(); t.after(d.close)
  let calls = 0; mockNetwork(t, async () => { calls++; return new Response('OK') })
  for (const body of [{ url: 'http://127.0.0.1' }, { url: 'http://2130706433' }, { url: 'http://[::1]' }, { url: 'http://169.254.169.254' }, { url: 'https://user:password@example.com' }, { url: 'https://example.com', method: 'DELETE' }]) {
    const res = await worker.fetch(request('/api/probe-test', 'POST', body), { DB: d.db, ADMIN_TOKEN: 'audit-secret' }, context())
    assert.equal(res.status, 400)
  }
  assert.equal(calls, 0)
})

test('R04: concurrent fleet probes execute only one round', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql)
  let calls = 0
  mockNetwork(t, async () => { calls++; await new Promise(r => setTimeout(r, 30)); return new Response('OK') })
  await Promise.all([1, 2].map(() => worker.fetch(request('/api/probe', 'POST'), { DB: d.db, ADMIN_TOKEN: 'audit-secret' }, context())))
  assert.equal(calls, 1)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM heartbeats').get().n, 1)
})

test('R05: parallel same-name creates preserve every monitor and existing history', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql); beat(d.sql, 'audit', 1, now() - 30)
  const result = await Promise.all(Array.from({ length: 8 }, () => dbmod.createMonitor({ name: 'Same', group_name: 'Audit', url: config.url }, d.db)))
  assert.equal(new Set(result.map(m => m.id)).size, 8)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM monitors').get().n, 9)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM heartbeats').get().n, 1)
})

test('R06: body reads remain inside the timeout and cancel the stream', async (t) => {
  let canceled = false
  mockNetwork(t, async () => new Response(new ReadableStream({ cancel() { canceled = true } }), { headers: { 'Content-Type': 'application/json' } }))
  const result = await Promise.race([probeSingleMonitor({ ...config, timeout_ms: 20 }), new Promise(resolve => setTimeout(() => resolve(null), 1000))])
  assert.ok(result, 'hung beyond the total timeout')
  assert.equal(result.status, 0)
  assert.equal(canceled, true)
})

test('R07: 30-day availability includes older failures and exposes coverage', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql)
  for (let i = 120; i >= 1; i--) beat(d.sql, 'audit', i > 60 ? 0 : 1, now() - i * 180)
  const [m] = await dbmod.fetchMonitorsWithHistory(d.db)
  assert.equal(m.heartbeats.length, 60)
  assert.ok(Math.abs(m.uptime_30d - 50) < 0.1, `${m.uptime_30d}`)
  assert.ok(m.coverage_30d > 0 && m.coverage_30d < 2)
})

test('R08: an empty database stays empty and public status performs no probes', async (t) => {
  const d = database(); t.after(d.close)
  assert.deepEqual(await dbmod.getAllMonitors(d.db), [])
  const ctx = context()
  const res = await worker.fetch(request('/api/status', 'GET', undefined, ''), { DB: d.db }, ctx)
  const data = await res.json()
  assert.deepEqual(data.monitors, [])
  assert.equal(data.overall.status, 'unknown')
  assert.equal(ctx.tasks.length, 0)
})

test('R09: checks exact expected code and aggregates component failures', async (t) => {
  mockNetwork(t, async () => new Response(null, { status: 204 }))
  const mismatch = await probeSingleMonitor(config)
  assert.equal(mismatch.status, 0)
  assert.equal(mismatch.status_code, 204)
  mockNetwork(t, async () => Response.json({ status: 'UP', components: { d1: { status: 'DOWN' } } }))
  assert.equal((await probeSingleMonitor(config)).status, 0)
})

test('R10/R15: incidents persist across repeated failures, resolve on recovery, notify transitions', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql)
  let state = 'DOWN'; const notifications = []
  mockNetwork(t, async (url, init) => {
    if (url === 'https://hooks.example/alert') { notifications.push(JSON.parse(init.body)); return new Response('OK') }
    return Response.json({ status: state })
  })
  const env = { DB: d.db, ADMIN_TOKEN: 'audit-secret', WEBHOOK_URL: 'https://hooks.example/alert' }
  for (state of ['DOWN', 'DOWN', 'UP']) {
    const res = await worker.fetch(request('/api/probe?force=1', 'POST'), env, context())
    assert.equal(res.status, 200)
  }
  const incidents = await dbmod.fetchIncidents(d.db)
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].status, 'resolved')
  assert.ok(incidents[0].resolved_at)
  assert.equal(notifications.length, 2)
  assert.deepEqual(notifications.map(n => n.status), ['DOWN', 'UP'])
})

test('R12: failed management operations cannot be successful or create local data', async (t) => {
  mockNetwork(t, async () => new Response('{}', { status: 500 }))
  assert.equal((await api.createNewMonitor({ name: 'Offline', url: config.url, group_name: 'Audit' })).success, false)
  assert.equal((await api.deleteMonitorById('audit')).success, false)
  const result = await api.testConnectionProbe(config.url)
  assert.equal(result.success, false)
})

test('R18/R20: freshness is per monitor and HTTP codes survive the history API', async (t) => {
  const d = database(); t.after(d.close)
  seed(d.sql, { id: 'fresh' }); seed(d.sql, { id: 'stale' })
  beat(d.sql, 'fresh', 1, now(), 204); beat(d.sql, 'stale', 1, now() - 1000, 200)
  const monitors = await dbmod.fetchMonitorsWithHistory(d.db)
  assert.equal(monitors.find(m => m.id === 'stale').current_status, -1)
  assert.equal(monitors.find(m => m.id === 'fresh').heartbeats.at(-1).status_code, 204)
})

test('deleting a failing monitor closes its incident and retains event history', async (t) => {
  const d = database(); t.after(d.close); const monitor = seed(d.sql)
  await scheduler.storeProbe({ DB: d.db }, monitor, { monitor_id: monitor.id, status: 0, status_code: 503, latency_ms: 20, timestamp: now(), message: 'down' })
  assert.equal(await dbmod.removeMonitor(monitor.id, d.db), true)
  const [incident] = await dbmod.fetchIncidents(d.db)
  assert.equal(incident.status, 'resolved')
  assert.match(incident.description, /删除/)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM heartbeats').get().n, 0)
})

test('R10: HTTP 200 provider errors remain queued for retry', async (t) => {
  const d = database(); t.after(d.close)
  d.sql.prepare('INSERT INTO alert_outbox(id,payload,next_attempt_at,created_at) VALUES(?,?,?,?)').run('alert', JSON.stringify({ monitor: 'a', url: config.url, status: 'DOWN', message: 'down' }), now(), now())
  mockNetwork(t, async () => Response.json({ ok: false, description: 'chat not found' }))
  await alerts.flushAlerts({ DB: d.db, WEBHOOK_URL: 'https://hooks.example', WEBHOOK_TYPE: 'telegram', TELEGRAM_CHAT_ID: '123' })
  assert.equal(d.sql.prepare('SELECT attempts FROM alert_outbox WHERE id=?').get('alert').attempts, 1)
})

test('R18: paused pages age each monitor into unknown without rewriting history', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql); beat(d.sql, 'audit', 1, now())
  const monitors = await dbmod.fetchMonitorsWithHistory(d.db)
  const original = { success: true, overall: dbmod.overallStatus(monitors), monitors, incidents: [] }
  const stale = statusTools.projectFreshness(original, now() + 241)
  assert.equal(stale.overall.status, 'unknown')
  assert.equal(stale.monitors[0].current_status, -1)
  assert.equal(stale.monitors[0].heartbeats.at(-1).status, 1)
  assert.equal(original.monitors[0].current_status, 1)
})

test('R03/R06: redirects cannot reach private URLs; oversized JSON is bounded', async (t) => {
  const urls = []
  mockNetwork(t, async url => { urls.push(url); return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }) })
  const rejected = await probeSingleMonitor(config)
  assert.equal(rejected.status, 0)
  assert.ok(urls.every(url => url === 'https://example.com/'))
  mockNetwork(t, async () => Response.json({ message: 'x'.repeat(65536) }))
  const large = await probeSingleMonitor(config)
  assert.equal(large.status, 0)
  assert.match(large.message, /64 KiB/)
})

test('R04: single probes do not reset fleet cooldown; Cron respects per-monitor interval', async (t) => {
  const d = database(); t.after(d.close)
  seed(d.sql, { id: 'one', interval_min: 1 }); seed(d.sql, { id: 'ten', interval_min: 10 })
  beat(d.sql, 'one', 1, now() - 120); beat(d.sql, 'ten', 1, now() - 120)
  let calls = 0; mockNetwork(t, async () => { calls++; return new Response('OK') })
  const env = { DB: d.db }
  assert.equal((await scheduler.runProbes(env, { scheduled: true })).probed_count, 1)
  d.sql.exec("DELETE FROM probe_runs; DELETE FROM heartbeats WHERE monitor_id='one'")
  assert.equal((await scheduler.runProbes(env, { id: 'one' })).probed_count, 1)
  assert.equal((await scheduler.runProbes(env)).probed_count, 2)
  assert.equal((await scheduler.runProbes(env)).debounced, true)
  assert.equal(calls, 4)
})

test('R04: the database lease excludes Cron/manual overlap and expired leases recover', async (t) => {
  const d = database(); t.after(d.close)
  let release; const held = scheduler.withSchedulerLock(d.db, () => new Promise(resolve => { release = resolve }))
  // Let the lease claim complete before entering the second path.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await scheduler.withSchedulerLock(d.db, async () => 'unexpected'), null)
  release('done'); assert.equal(await held, 'done')
  d.sql.prepare('INSERT INTO probe_locks VALUES(?,?,?)').run('scheduler', 'crashed', now() - 1)
  assert.equal(await scheduler.withSchedulerLock(d.db, async () => 'recovered'), 'recovered')
})

test('R03: atomic limit enforces its cap under concurrent calls', async (t) => {
  const d = database(); t.after(d.close)
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => scheduler.rateLimit(d.db, 'test', 6)))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 6)
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429))
})

test('R05: monitor cap is atomic and invalid fields are rejected', async (t) => {
  const d = database(); t.after(d.close)
  const results = await Promise.allSettled(Array.from({ length: 25 }, () => dbmod.createMonitor({ name: 'a', url: config.url }, d.db)))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 20)
  for (const patch of [{ name: {} }, { group_name: [] }, { interval_min: 0 }, { timeout_ms: 60000 }, { expected_status: '200' }]) {
    assert.throws(() => validation.monitorInput({ name: 'a', url: config.url, ...patch }), error => error.status === 400)
  }
})

test('request bodies reject malformed, wrong-type and oversized data', async () => {
  for (const [body, type, code] of [['[]', 'application/json', 400], ['{', 'application/json', 400], ['{}', 'text/plain', 415], ['x'.repeat(8193), 'application/json', 413]]) {
    await assert.rejects(validation.readJson(new Request('https://pulse.example', { method: 'POST', headers: { 'Content-Type': type }, body })), error => error.status === code)
  }
})

test('R07: long observation gaps do not produce invented 100% coverage', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql)
  beat(d.sql, 'audit', 1, now() - 86400 * 15); beat(d.sql, 'audit', 0, now() - 180)
  const [monitor] = await dbmod.fetchMonitorsWithHistory(d.db)
  assert.ok(monitor.coverage_30d < 0.1)
  assert.ok(monitor.uptime_30d > 50 && monitor.uptime_30d < 60)
  assert.equal(monitor.current_status, 0)
})

test('R08: heartbeat persistence errors propagate instead of reporting success', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql)
  mockNetwork(t, async () => new Response('OK'))
  const failing = { ...d.db, batch() { throw new Error('write failed') } }
  const res = await worker.fetch(request('/api/probe', 'POST'), { DB: failing, ADMIN_TOKEN: 'audit-secret' }, context())
  assert.equal(res.status, 503)
  assert.equal((await res.json()).success, false)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM probe_locks').get().n, 0)
})

test('R09: expected HEAD 204 succeeds; component degradation preserves diagnostics', async (t) => {
  mockNetwork(t, async () => new Response(null, { status: 204 }))
  assert.equal((await probeSingleMonitor({ ...config, method: 'HEAD', expected_status: 204 })).status, 1)
  mockNetwork(t, async () => Response.json({ status: 'UP', components: { kv: { status: 'DEGRADED', latency_ms: 80 } } }))
  const result = await probeSingleMonitor(config)
  assert.equal(result.status, 2); assert.match(result.message, /kv:80ms/)
  assert.equal(result.ssl_days_remaining, null)
})

test('R10: provider payloads and failed HTTP delivery are handled explicitly', async (t) => {
  const alert = { monitor: 'a', url: config.url, status: 'UP', message: 'recovered' }
  assert.ok(alerts.webhookPayload(alert, 'discord').content)
  assert.equal(alerts.webhookPayload(alert, 'telegram', '123').chat_id, '123')
  assert.equal(alerts.webhookPayload(alert, 'feishu').msg_type, 'text')
  assert.equal(alerts.webhookPayload(alert, 'dingtalk').msgtype, 'text')
  assert.throws(() => alerts.webhookPayload(alert, 'telegram'), /TELEGRAM_CHAT_ID/)
  const d = database(); t.after(d.close)
  d.sql.prepare('INSERT INTO alert_outbox(id,payload,next_attempt_at,created_at) VALUES(?,?,?,?)').run('alert', JSON.stringify(alert), now(), now())
  mockNetwork(t, async () => new Response('unavailable', { status: 500 }))
  await alerts.flushAlerts({ DB: d.db, WEBHOOK_URL: 'https://hooks.example' })
  assert.equal(d.sql.prepare('SELECT attempts FROM alert_outbox').get().attempts, 1)
  d.sql.exec('UPDATE alert_outbox SET next_attempt_at=0')
  mockNetwork(t, async () => new Response(null, { status: 204 }))
  await alerts.flushAlerts({ DB: d.db, WEBHOOK_URL: 'https://hooks.example' })
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM alert_outbox').get().n, 0)
})

test('R12: saved session token authenticates all management operations', async (t) => {
  const values = new Map([['vpulse-admin-token', 'stored-token']])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete globalThis.sessionStorage })
  const tokens = []; mockNetwork(t, async (_url, init) => { tokens.push(init.headers.get('Authorization')); return Response.json({ success: true, debounced: false, probed_count: 0 }) })
  assert.equal((await api.deleteMonitorById('a')).success, true)
  assert.equal((await api.createNewMonitor({ name: 'a', url: config.url, group_name: 'a' })).success, true)
  await api.triggerProbe(); await api.testConnectionProbe(config.url)
  assert.deepEqual(tokens, Array(4).fill('Bearer stored-token'))
})

test('R13/R14: prototype-like group names are safe and countdown keeps server anchors', () => {
  const groups = statusTools.groupMonitors(['__proto__', 'constructor', 'toString'].map(group_name => ({ group_name })))
  assert.equal(groups.size, 3)
  assert.equal(groups.get('__proto__').length, 1)
  assert.equal(statusTools.remainingSeconds(null, now()), null)
  assert.equal(statusTools.remainingSeconds(100, 91), 9)
  assert.equal(statusTools.remainingSeconds(100, 101), 0)
})

test('R15: old active incidents remain visible alongside recent recovered ones', async (t) => {
  const d = database(); t.after(d.close)
  for (let i = 0; i < 8; i++) d.sql.prepare('INSERT INTO incidents(id,title,description,status,created_at,updated_at,resolved_at) VALUES(?,?,?,?,?,?,?)')
    .run(String(i), 'incident', '', i === 0 ? 'investigating' : 'resolved', now() + i, now() + i, i === 0 ? null : now() + i)
  const incidents = await dbmod.fetchIncidents(d.db)
  assert.equal(incidents.length, 6); assert.equal(incidents[0].id, '0')
})

test('R18: readiness catches an individually stale monitor and rejects cross-origin management', async (t) => {
  const d = database(); t.after(d.close)
  seed(d.sql, { id: 'fresh' }); seed(d.sql, { id: 'stale' })
  beat(d.sql, 'fresh', 1, now()); beat(d.sql, 'stale', 1, now() - 1000)
  const res = await worker.fetch(request('/api/health', 'GET', undefined, ''), { DB: d.db }, context())
  assert.equal(res.status, 503); assert.equal((await res.json()).components.scheduler.stale_count, 1)
  const cross = request('/api/probe', 'POST'); cross.headers.set('Origin', 'https://untrusted.example')
  assert.equal((await worker.fetch(cross, { DB: d.db, ADMIN_TOKEN: 'audit-secret' }, context())).status, 403)
})

test('additive migration can run again without altering existing records', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql); beat(d.sql, 'audit', 1, now())
  d.sql.exec(readFileSync('migrations/0001_reliability.sql', 'utf8'))
  d.sql.exec(readFileSync('migrations/0002_status_cache.sql', 'utf8'))
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM monitors').get().n, 1)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM heartbeats').get().n, 1)
})

test('R03: legacy stored unsafe methods cannot bypass the outbound method restriction', async (t) => {
  let calls = 0; mockNetwork(t, async () => { calls++; return new Response('OK') })
  const result = await probeSingleMonitor({ ...config, method: 'POST' })
  assert.equal(result.status, 0)
  assert.equal(calls, 0)
})

test('shared status cache avoids repeated history scans and invalidates on every mutation', async (t) => {
  const d = database(); t.after(d.close); const monitor = seed(d.sql); beat(d.sql, monitor.id, 1, now())
  let scans = 0
  const counted = { ...d.db, prepare(query) { if (query.includes('LEAD(')) scans++; return d.db.prepare(query) } }
  await readStatus(counted); await readStatus(counted)
  assert.equal(scans, 1)
  await scheduler.storeProbe({ DB: d.db }, monitor, { status: 0, status_code: 503, latency_ms: null, timestamp: now(), message: 'down' })
  assert.equal((await readStatus(counted)).monitors[0].current_status, 0)
  assert.equal(scans, 2)
  const created = await dbmod.createMonitor({ name: 'New', url: config.url }, d.db)
  assert.equal((await readStatus(counted)).monitors.length, 2)
  assert.equal(scans, 3)
  await dbmod.removeMonitor(created.id, d.db)
  assert.equal((await readStatus(counted)).monitors.length, 1)
  assert.equal(scans, 4)
})

test('a read racing with a probe cannot publish a cache for the older revision', async (t) => {
  const d = database(); t.after(d.close); const monitor = seed(d.sql); beat(d.sql, monitor.id, 1, now())
  let injected = false
  const racing = { ...d.db, prepare(query) {
    const statement = d.db.prepare(query)
    if (query.includes('INSERT INTO status_cache')) {
      const bind = statement.bind
      statement.bind = function (...values) {
        const bound = bind.call(this, ...values)
        return { ...bound, async run() {
          if (!injected) { injected = true; await scheduler.storeProbe({ DB: d.db }, monitor, { status: 0, status_code: 503, latency_ms: null, timestamp: now(), message: 'down' }) }
          return bound.run()
        } }
      }
    }
    return statement
  } }
  await readStatus(racing)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM status_cache').get().n, 0)
  assert.equal((await readStatus(d.db)).overall.status, 'outage')
})

test('cached status still expires individual observations and refreshes after TTL', async (t) => {
  const d = database(); t.after(d.close); seed(d.sql); const start = now(); beat(d.sql, 'audit', 1, start - 230)
  assert.equal((await readStatus(d.db)).overall.status, 'operational')
  t.mock.method(Date, 'now', () => (start + 11) * 1000)
  assert.equal((await readStatus(d.db)).overall.status, 'unknown')
  assert.equal((await readStatus(d.db)).monitors[0].current_latency_ms, null)
  Date.now = () => (start + 61) * 1000
  await readStatus(d.db)
  assert.equal(d.sql.prepare('SELECT expires_at FROM status_cache').get().expires_at, start + 121)
})

test('R15: legacy ongoing failures gain one persistent incident even without a new status transition', async (t) => {
  const d = database(); t.after(d.close); const monitor = seed(d.sql); const started = now() - 300
  beat(d.sql, monitor.id, 1, started - 100)
  beat(d.sql, monitor.id, 0, started); beat(d.sql, monitor.id, 0, started + 60)
  for (let i = 0; i < 2; i++) await scheduler.storeProbe({ DB: d.db }, monitor, { status: 0, status_code: 503, latency_ms: null, timestamp: now(), message: 'still down' })
  const incidents = await dbmod.fetchIncidents(d.db)
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].status, 'investigating')
  assert.equal(incidents[0].created_at, started)
})
