import { test } from 'node:test'
import assert from 'node:assert/strict'
import { database, seed, beat, load, request, context, mockNetwork } from './helpers.mjs'

const { default: worker } = await load('worker/index.ts')
const scheduler = await load('worker/scheduler.ts')
const probes = await load('worker/probe.ts')
const alertsModule = await load('worker/alerts.ts')
const envFor = (db) => ({
  DB: db,
  ADMIN_TOKEN: 'audit-secret',
  ASSETS: { fetch: () => new Response('asset') },
})

test('editing, pause and maintenance preserve history and exclude suppressed monitors from probes', async (t) => {
  const d = database()
  t.after(d.close)
  seed(d.sql)
  beat(d.sql, 'audit', 1, Math.floor(Date.now() / 1000))
  const env = envFor(d.db)
  let r = await worker.fetch(
    request('/api/monitors?id=audit', 'PATCH', { name: 'Renamed', enabled: 0 }),
    env,
    context()
  )
  assert.equal(r.status, 200)
  let data = await (await worker.fetch(request('/api/status'), env, context())).json()
  assert.equal(data.monitors[0].name, 'Renamed')
  assert.equal(data.monitors[0].enabled, 0)
  assert.equal(data.monitors[0].heartbeats.length, 1)
  assert.equal(data.overall.monitors_count, 0)
  const network = mockNetwork(t, () => {
    throw new Error('suppressed monitor was probed')
  })
  r = await worker.fetch(request('/api/probe?force=1', 'POST'), env, context())
  assert.equal((await r.json()).probed_count, 0)
  r = await worker.fetch(
    request('/api/monitors?id=audit', 'PATCH', {
      enabled: 1,
      maintenance_until: Math.floor(Date.now() / 1000) + 3600,
    }),
    env,
    context()
  )
  assert.equal(r.status, 200)
  r = await worker.fetch(request('/api/probe?force=1', 'POST'), env, context())
  assert.equal((await r.json()).probed_count, 0)
  assert.equal(network.mock.callCount(), 0)
})

test('content assertions reject a false healthy 200 response and count retries as one round', async (t) => {
  const d = database()
  t.after(d.close)
  const monitor = seed(d.sql)
  mockNetwork(t, () => Response.json({ ready: false, status: 'UP' }))
  const result = await probes.probeSingleMonitor({
    ...monitor,
    json_path: 'ready',
    json_expected: 'true',
  })
  assert.equal(result.status, 0)
  assert.match(result.message, /断言/)
  const keyword = await probes.probeSingleMonitor({ ...monitor, keyword: 'welcome' })
  assert.equal(keyword.status, 0)
  const env = { ...envFor(d.db), WEBHOOK_URL: 'https://hooks.example' }
  const configured = { ...monitor, failure_threshold: 2, notify_recovery: 1, reminder_min: 0 }
  await scheduler.storeProbe(env, configured, result)
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM alert_outbox').get().n, 0)
  await scheduler.storeProbe(env, configured, result)
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM alert_outbox').get().n, 1)
  await scheduler.storeProbe(env, configured, { ...result, status: 1 })
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM alert_outbox').get().n, 2)
})

test('batch import is atomic, fresh-token protected, and exports no credentials', async (t) => {
  const d = database()
  t.after(d.close)
  const env = envFor(d.db)
  const session = await worker.fetch(request('/api/session', 'POST'), env, context())
  const cookie = session.headers.get('set-cookie').split(';')[0]
  const config = {
    version: 1,
    monitors: [{ name: 'one', url: 'https://example.com', keyword: 'hello', enabled: 0 }],
  }
  const cookieRequest = new Request('https://pulse.example/api/admin/import', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  assert.equal((await worker.fetch(cookieRequest, env, context())).status, 401)
  let r = await worker.fetch(
    request('/api/admin/import', 'POST', {
      version: 1,
      monitors: [...config.monitors, { name: 'bad', url: 'http://localhost' }],
    }),
    env,
    context()
  )
  assert.equal(r.status, 400)
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM monitors').get().n, 0)
  r = await worker.fetch(request('/api/admin/import', 'POST', config), env, context())
  assert.equal(r.status, 201)
  const exported = await (await worker.fetch(request('/api/admin/export'), env, context())).json()
  assert.equal(exported.monitors[0].keyword, 'hello')
  assert.equal(exported.monitors[0].enabled, 0)
  assert.doesNotMatch(JSON.stringify(exported), /audit-secret|token_hash|credential_tag/)
  assert.equal(
    (await worker.fetch(request('/api/admin/export', 'GET', undefined, ''), env, context())).status,
    401
  )
})

test('devices can be listed and revoked without exposing session secrets', async (t) => {
  const d = database()
  t.after(d.close)
  const env = envFor(d.db)
  const issued = await worker.fetch(request('/api/session', 'POST'), env, context())
  const cookie = issued.headers.get('set-cookie').split(';')[0]
  const devices = await (await worker.fetch(request('/api/admin/devices'), env, context())).json()
  assert.equal(devices.devices.length, 1)
  assert.doesNotMatch(JSON.stringify(devices), /token_hash|credential_tag/)
  const r = await worker.fetch(
    request(`/api/admin/devices?id=${devices.devices[0].id}`, 'DELETE'),
    env,
    context()
  )
  assert.equal(r.status, 200)
  assert.equal(
    (
      await worker.fetch(
        new Request('https://pulse.example/api/probe', {
          method: 'POST',
          headers: { Cookie: cookie },
        }),
        env,
        context()
      )
    ).status,
    401
  )
})

test('history supports bounded ranges, aggregated latency and errors-only filtering', async (t) => {
  const d = database()
  t.after(d.close)
  seed(d.sql)
  const now = Math.floor(Date.now() / 1000)
  beat(d.sql, 'audit', 1, now - 100)
  beat(d.sql, 'audit', 0, now - 50, 503)
  const r = await worker.fetch(
    request('/api/history?id=audit&range=24h&errors=1'),
    envFor(d.db),
    context()
  )
  assert.equal(r.status, 200)
  const data = await r.json()
  assert.equal(data.records.length, 1)
  assert.equal(data.records[0].status, 0)
  assert.ok(data.points.length > 0)
  assert.ok(data.points.length <= 720)
  assert.equal(
    (await worker.fetch(request('/api/history?id=audit&range=999d'), envFor(d.db), context()))
      .status,
    400
  )
})

test('probe response does not wait for webhook and live progress reflects actual in-flight work', async (t) => {
  const d = database()
  t.after(d.close)
  seed(d.sql)
  let releaseProbe
  const probeGate = new Promise((r) => {
    releaseProbe = r
  })
  let releaseHook
  const hookGate = new Promise((r) => {
    releaseHook = r
  })
  mockNetwork(t, async (url) => {
    if (new URL(url).hostname === 'hooks.example') {
      await hookGate
      return new Response('ok')
    }
    await probeGate
    return new Response('down', { status: 503 })
  })
  const env = { ...envFor(d.db), WEBHOOK_URL: 'https://hooks.example' }
  const ctx = context()
  const pending = worker.fetch(request('/api/probe?force=1', 'POST'), env, ctx)
  await new Promise((r) => setTimeout(r, 20))
  const progress = await (await worker.fetch(request('/api/progress'), env, context())).json()
  assert.equal(progress.active, true)
  assert.equal(progress.items[0].stage, 'probing')
  releaseProbe()
  const r = await Promise.race([
    pending,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('probe waited for webhook')), 500)
    ),
  ])
  assert.equal(r.status, 200)
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM heartbeats').get().n, 1)
  releaseHook()
  await Promise.all(ctx.tasks)
  const alerts = await (await worker.fetch(request('/api/admin/alerts'), env, context())).json()
  assert.equal(alerts.configured, true)
  assert.equal(alerts.deliveries[0].status, 'sent')
})

test('maintenance expiry restores scheduling, and paused projects do not fail readiness', async (t) => {
  const d = database()
  t.after(d.close)
  seed(d.sql)
  const env = envFor(d.db),
    until = Math.floor(Date.now() / 1000) + 300
  assert.equal(
    (
      await worker.fetch(
        request('/api/monitors?id=audit', 'PATCH', { maintenance_until: until }),
        env,
        context()
      )
    ).status,
    200
  )
  assert.equal((await worker.fetch(request('/api/health'), env, context())).status, 200)
  mockNetwork(t, () => new Response('ok'))
  t.mock.method(Date, 'now', () => (until + 1) * 1000)
  const ctx = context()
  await worker.scheduled({}, env, ctx)
  await Promise.all(ctx.tasks)
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM heartbeats').get().n, 1)
  const status = await (await worker.fetch(request('/api/status'), env, context())).json()
  assert.equal(status.overall.healthy_count, 1)
})

test('alert reminders, recovery preference and independent delivery lease prevent duplicate sends', async (t) => {
  const d = database()
  t.after(d.close)
  const m = seed(d.sql),
    now = Math.floor(Date.now() / 1000)
  const env = { ...envFor(d.db), WEBHOOK_URL: 'https://hooks.example' }
  const monitor = { ...m, reminder_min: 10, notify_recovery: 0 }
  const down = {
    monitor_id: m.id,
    status: 0,
    status_code: 503,
    latency_ms: null,
    message: 'down',
    timestamp: now,
  }
  await scheduler.storeProbe(env, monitor, down)
  await scheduler.storeProbe(env, monitor, { ...down, timestamp: now + 599 })
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM alert_outbox').get().n, 1)
  await scheduler.storeProbe(env, monitor, { ...down, timestamp: now + 600 })
  await scheduler.storeProbe(env, monitor, { ...down, status: 1, timestamp: now + 601 })
  assert.equal(
    d.sql.prepare('SELECT COUNT(*) n FROM alert_outbox').get().n,
    2,
    'reminder but no recovery notification'
  )
  let release
  const gate = new Promise((r) => {
    release = r
  })
  const calls = []
  mockNetwork(t, async (_url, init) => {
    calls.push(JSON.parse(init.body))
    await gate
    return new Response('ok')
  })
  const sending = alertsModule.flushAlerts(env)
  await new Promise((r) => setTimeout(r, 10))
  await alertsModule.flushAlerts(env)
  release()
  await sending
  assert.equal(
    calls.length,
    1,
    'future reminder is not due and concurrent delivery cannot duplicate the due alert'
  )
  assert.equal(
    d.sql.prepare("SELECT COUNT(*) n FROM alert_deliveries WHERE status='sent'").get().n,
    1
  )
})

test('notification test and explicit retry record errors and never expose webhook secrets', async (t) => {
  const d = database()
  t.after(d.close)
  const env = { ...envFor(d.db), WEBHOOK_URL: 'https://hooks.example/private-secret' }
  mockNetwork(t, () => new Response('failed', { status: 503 }))
  let ctx = context()
  let r = await worker.fetch(request('/api/admin/alerts/test', 'POST'), env, ctx)
  assert.equal(r.status, 200)
  const { alert_id: id } = await r.json()
  await Promise.all(ctx.tasks)
  let data = await (await worker.fetch(request('/api/admin/alerts'), env, context())).json()
  assert.equal(data.pending[0].attempts, 1)
  assert.equal(data.deliveries[0].status, 'failed')
  assert.doesNotMatch(JSON.stringify(data), /private-secret/)
  ctx = context()
  r = await worker.fetch(request(`/api/admin/alerts/retry?id=${id}`, 'POST'), env, ctx)
  assert.equal(r.status, 200)
  await Promise.all(ctx.tasks)
  data = await (await worker.fetch(request('/api/admin/alerts'), env, context())).json()
  assert.equal(data.deliveries.length, 2)
})

test('progress tracks retry and only reports the current round, with interrupted work marked failed', async (t) => {
  const d = database()
  t.after(d.close)
  seed(d.sql)
  seed(d.sql, { id: 'second' })
  let attempts = 0,
    release
  const gate = new Promise((r) => {
    release = r
  })
  mockNetwork(t, async () => {
    attempts++
    if (attempts === 1) return new Response('bad', { status: 503 })
    await gate
    return new Response('ok')
  })
  const env = envFor(d.db),
    ctx = context()
  const pending = worker.fetch(request('/api/probe?id=audit&force=1', 'POST'), env, ctx)
  await new Promise((r) => setTimeout(r, 20))
  let progress = await (await worker.fetch(request('/api/progress'), env, context())).json()
  assert.equal(progress.items[0].stage, 'retrying')
  release()
  await pending
  await Promise.all(ctx.tasks)
  await worker.fetch(request('/api/probe?id=second&force=1', 'POST'), env, context())
  progress = await (await worker.fetch(request('/api/progress'), env, context())).json()
  assert.equal(progress.items.length, 1)
  assert.equal(progress.items[0].monitor_id, 'second')
  d.sql.exec("UPDATE probe_progress SET stage='probing' WHERE monitor_id='second'")
  progress = await (await worker.fetch(request('/api/progress'), env, context())).json()
  assert.equal(progress.active, false)
  assert.equal(progress.items[0].stage, 'failed')
})

test('content success, validation and logout retain the intended authentication boundary', async (t) => {
  const d = database()
  t.after(d.close)
  const m = seed(d.sql),
    env = envFor(d.db)
  mockNetwork(t, () => Response.json({ ready: true, status: 'UP', details: { one: 1, two: 2 } }))
  assert.equal(
    (
      await probes.probeSingleMonitor({
        ...m,
        json_path: 'details',
        json_expected: '{"two":2,"one":1}',
      })
    ).status,
    1,
    'JSON object key order must not change assertion semantics'
  )
  assert.equal(
    (
      await probes.probeSingleMonitor({
        ...m,
        keyword: 'ready',
        json_path: 'ready',
        json_expected: 'true',
      })
    ).status,
    1
  )
  for (const body of [
    { method: 'HEAD', keyword: 'ready' },
    { json_path: 'ready', json_expected: 'bad json' },
    { failure_threshold: 0 },
    { keyword: {} },
    { enabled: 2 },
  ]) {
    assert.equal(
      (await worker.fetch(request('/api/monitors?id=audit', 'PATCH', body), env, context())).status,
      400
    )
  }
  const session = await worker.fetch(request('/api/session', 'POST'), env, context()),
    cookie = session.headers.get('set-cookie').split(';')[0]
  const logout = await worker.fetch(
    new Request('https://pulse.example/api/session', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    }),
    env,
    context()
  )
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal(
    (
      await worker.fetch(
        new Request('https://pulse.example/api/admin/devices', { headers: { Cookie: cookie } }),
        env,
        context()
      )
    ).status,
    401
  )
})

test('changing a target invalidates its current health while retaining old history, even within the same second', async (t) => {
  const d = database()
  t.after(d.close)
  seed(d.sql)
  const env = envFor(d.db),
    now = Math.floor(Date.now() / 1000)
  t.mock.method(Date, 'now', () => now * 1000)
  beat(d.sql, 'audit', 1, now)
  assert.equal(
    (
      await worker.fetch(
        request('/api/monitors?id=audit', 'PATCH', { url: 'https://changed.example' }),
        env,
        context()
      )
    ).status,
    200
  )
  let data = await (await worker.fetch(request('/api/status'), env, context())).json()
  assert.equal(data.monitors[0].current_status, -1)
  assert.equal(data.monitors[0].heartbeats.length, 1)
  mockNetwork(t, () => new Response('ok'))
  const ctx = context()
  const response = await worker.fetch(request('/api/probe?id=audit', 'POST'), env, ctx)
  assert.equal(
    (await response.json()).probed_count,
    1,
    'old endpoint cooldown must not suppress new endpoint check'
  )
  data = await (await worker.fetch(request('/api/status'), env, context())).json()
  assert.equal(data.monitors[0].current_status, 1)
  assert.equal(data.monitors[0].heartbeats.length, 2)
})
