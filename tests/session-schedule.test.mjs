import test from 'node:test'
import assert from 'node:assert/strict'
import { load, database, seed, beat, context, request, mockNetwork } from './helpers.mjs'

const worker = (await load('worker/index.ts')).default
const { runProbes } = await load('worker/scheduler.ts')
const { readStatus } = await load('worker/status.ts')

async function login(env) {
  const response = await worker.fetch(request('/api/session', 'POST'), env, context())
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/)
  assert.match(response.headers.get('Set-Cookie'), /SameSite=Strict/)
  assert.match(response.headers.get('Set-Cookie'), /Secure/)
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=2592000/)
  return response.headers.get('Set-Cookie').split(';')[0]
}

function remembered(path, cookie, body, method = 'POST') {
  const req = request(path, method, body, '')
  req.headers.set('Cookie', cookie)
  return req
}

test('AUTH-01: D1 session survives new requests and only adding requires fresh token', async t => {
  const d = database(); t.after(d.close)
  seed(d.sql)
  mockNetwork(t, async () => new Response('OK'))
  const env = { DB: d.db, ADMIN_TOKEN: 'audit-secret' }
  const cookie = await login(env)
  const stored = d.sql.prepare('SELECT * FROM admin_sessions').get()
  assert.ok(!JSON.stringify(stored).includes('audit-secret'))
  assert.ok(!JSON.stringify(stored).includes(cookie.split('=')[1]))
  for (const path of ['/api/probe', '/api/probe?id=audit']) {
    assert.equal((await worker.fetch(remembered(path, cookie), { ...env }, context())).status, 200)
  }
  assert.equal((await worker.fetch(remembered('/api/probe-test', cookie, { url: 'https://example.com' }), env, context())).status, 200)
  assert.equal((await worker.fetch(remembered('/api/monitors', cookie, { name: 'New', url: 'https://example.com' }), env, context())).status, 401)
  assert.equal((await worker.fetch(remembered('/api/monitors?id=audit', cookie, undefined, 'DELETE'), env, context())).status, 200)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM monitors').get().n, 0)
})

test('AUTH-02: incorrect, expired, forged, rotated and cross-site credentials are rejected', async t => {
  const d = database(); t.after(d.close)
  const env = { DB: d.db, ADMIN_TOKEN: 'audit-secret' }
  assert.equal((await worker.fetch(request('/api/session', 'POST', undefined, 'wrong'), env, context())).status, 401)
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get().n, 0)
  const cookie = await login(env)
  assert.equal((await worker.fetch(remembered('/api/probe', cookie + 'bad'), env, context())).status, 401)
  assert.equal((await worker.fetch(remembered('/api/probe', cookie), { ...env, ADMIN_TOKEN: 'rotated' }, context())).status, 401)
  const cross = remembered('/api/probe', cookie)
  cross.headers.set('Origin', 'https://evil.example')
  assert.equal((await worker.fetch(cross, env, context())).status, 403)
  d.sql.exec('UPDATE admin_sessions SET expires_at=0')
  assert.equal((await worker.fetch(remembered('/api/probe', cookie), env, context())).status, 401)
})

test('AUTH-03: successful addition remembers device without exposing credentials publicly', async t => {
  const d = database(); t.after(d.close)
  mockNetwork(t, async () => new Response('OK'))
  const env = { DB: d.db, ADMIN_TOKEN: 'audit-secret' }
  const added = await worker.fetch(request('/api/monitors', 'POST', { name: 'New', url: 'https://example.com' }), env, context())
  assert.equal(added.status, 201)
  const cookie = added.headers.get('Set-Cookie')?.split(';')[0]
  assert.ok(cookie)
  const publicResponse = await worker.fetch(request('/api/status', 'GET', undefined, ''), env, context())
  assert.equal(publicResponse.headers.get('Set-Cookie'), null)
  assert.ok(!(await publicResponse.text()).includes('audit-secret'))
  assert.equal((await worker.fetch(remembered('/api/probe', cookie), env, context())).status, 200)
})

test('SCHED-01: completion seconds do not skip the next three-minute Cron slot', async t => {
  const d = database(); t.after(d.close)
  const slot = 1800000000
  t.mock.method(Date, 'now', () => (slot + 180) * 1000)
  seed(d.sql); beat(d.sql, 'audit', 1, slot + 7)
  let calls = 0
  mockNetwork(t, async () => { calls++; return new Response('OK') })
  assert.equal((await readStatus(d.db)).overall.next_check_at, slot + 180)
  const result = await runProbes({ DB: d.db }, { scheduled: true })
  assert.equal(result.probed_count, 1)
  assert.equal(calls, 1)
  assert.equal((await readStatus(d.db)).overall.next_check_at, slot + 360)
})

test('SCHED-02: non-multiple intervals stay fresh until their actual Cron slot', async t => {
  const d = database(); t.after(d.close)
  const slot = 1800000000
  t.mock.method(Date, 'now', () => (slot + 330) * 1000)
  seed(d.sql, { interval_min: 4, created_at: slot }); beat(d.sql, 'audit', 1, slot + 7)
  const status = await readStatus(d.db)
  assert.equal(status.monitors[0].next_check_at, slot + 360)
  assert.equal(status.monitors[0].current_status, 1)
  assert.ok(status.monitors[0].coverage_30d > 95, 'availability coverage must use the same freshness deadline')
  const ready = await worker.fetch(request('/api/health', 'GET', undefined, ''), { DB: d.db }, context())
  assert.equal(ready.status, 200, 'readiness must agree with the dashboard')
  assert.equal((await runProbes({ DB: d.db }, { scheduled: true })).probed_count, 0)
})
