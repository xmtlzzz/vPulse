import test from 'node:test'
import assert from 'node:assert/strict'
import { load, database, context, request, mockNetwork, dnsResponse } from './helpers.mjs'

const worker = (await load('worker/index.ts')).default
const { probeSingleMonitor } = await load('worker/probe.ts')
const validation = await load('worker/validation.ts')
const config = { id: 'domain', name: 'Domain', group_name: 'Test', url: 'https://new-domain.example/health', method: 'GET', expected_status: 200, interval_min: 3, timeout_ms: 100, order_num: 1, enabled: 1 }

test('D01: admin tests, adds and schedules a new public domain without config edits', async t => {
  const d = database(); t.after(d.close)
  const targets = []
  mockNetwork(t, async url => { targets.push(url); return new Response('OK') })
  // A legacy deployed variable must not reintroduce the restriction.
  const env = { DB: d.db, ADMIN_TOKEN: 'audit-secret', PROBE_ALLOWED_HOSTS: 'old-domain.example' }
  const preview = await worker.fetch(request('/api/probe-test', 'POST', { url: config.url }), env, context())
  assert.equal(preview.status, 200)
  assert.equal((await preview.json()).success, true)
  delete env.PROBE_ALLOWED_HOSTS
  const created = await worker.fetch(request('/api/monitors', 'POST', { name: config.name, url: config.url }), env, context())
  assert.equal(created.status, 201)
  const monitor = (await created.json()).monitor
  assert.equal(monitor.url, config.url)
  d.sql.prepare('UPDATE heartbeats SET timestamp=?').run(Math.floor(Date.now() / 1000) - 181)
  const tasks = context()
  await worker.scheduled({}, env, tasks)
  await Promise.all(tasks.tasks)
  assert.deepEqual(targets, [config.url, config.url, config.url])
  assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM heartbeats').get().n, 2)
})

test('D02: a new domain still requires admin authentication before any network call', async t => {
  const d = database(); t.after(d.close)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('must not fetch') })
  for (const path of ['/api/probe-test', '/api/monitors']) {
    const res = await worker.fetch(request(path, 'POST', { name: config.name, url: config.url }, ''), { DB: d.db, ADMIN_TOKEN: 'audit-secret' }, context())
    assert.equal(res.status, 401)
  }
  assert.equal(calls, 0)
})

test('D03: private/reserved DNS answers and mixed public/private answers never reach a target', async t => {
  let records; let calls = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname === 'cloudflare-dns.com') return dnsResponse(url, records)
    calls++; return new Response('OK')
  })
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '172.16.0.1', '192.168.1.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
    records = { A: ['93.184.216.34', address], AAAA: [] }
    const result = await probeSingleMonitor(config)
    assert.equal(result.status, 0, address)
    assert.match(result.message, /公网/)
  }
  for (const address of ['::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2001::1', '2002:7f00:1::', '3fff::1']) {
    records = { A: ['93.184.216.34'], AAAA: [address] }
    assert.equal((await probeSingleMonitor(config)).status, 0, address)
  }
  assert.equal(calls, 0)
})

test('D04: redirects can reach another public domain but not private DNS or URL targets', async t => {
  let destination = 'https://other-domain.example/health'
  const targets = []
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url)
    if (parsed.hostname === 'cloudflare-dns.com') return dnsResponse(url,
      parsed.searchParams.get('name') === 'private-domain.example' ? { A: ['10.0.0.1'], AAAA: [] } : undefined)
    targets.push(url)
    return url === config.url ? new Response(null, { status: 302, headers: { Location: destination } }) : new Response('OK')
  })
  assert.equal((await probeSingleMonitor(config)).status, 1)
  assert.deepEqual(targets, [config.url, destination])
  for (destination of ['https://private-domain.example/health', 'http://127.0.0.1/admin']) {
    targets.length = 0
    assert.equal((await probeSingleMonitor(config)).status, 0)
    assert.ok(targets.every(url => url === config.url))
  }
})

test('D05: DNS errors, malformed and empty answers fail closed', async t => {
  let reply; let calls = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname !== 'cloudflare-dns.com') { calls++; return new Response('OK') }
    return reply()
  })
  for (reply of [() => new Response('offline', { status: 503 }), () => Response.json({ Status: 2 }), () => Response.json({ Status: 0 }), () => Response.json({ Status: 0, Answer: [{ type: 1, data: 'invalid' }] }), () => Response.json({ Status: 0, TC: true }), () => new Response('not json')]) {
    assert.equal((await probeSingleMonitor(config)).status, 0)
  }
  assert.equal(calls, 0)
})

test('D06: IPv6-only public targets work, unsafe URL forms remain rejected', async t => {
  t.mock.method(globalThis, 'fetch', async url => new URL(url).hostname === 'cloudflare-dns.com'
    ? dnsResponse(url, { A: [], AAAA: ['2606:4700:4700::1111'] }) : new Response('OK'))
  assert.equal((await probeSingleMonitor(config)).status, 1)
  for (const url of ['http://localhost', 'http://service.local', 'http://service.internal', 'http://service.home.arpa', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'https://user:password@example.com', 'http://example.com:8080', 'https://example.com/#secret']) {
    assert.throws(() => validation.targetUrl(url), error => error.status === 400, url)
  }
})

test('D07: DNS body reads share the probe deadline and cancel stalled responses', async t => {
  let canceled = 0; let targets = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname !== 'cloudflare-dns.com') { targets++; return new Response('OK') }
    return new Response(new ReadableStream({ cancel() { canceled++ } }), { headers: { 'Content-Type': 'application/dns-json' } })
  })
  const result = await Promise.race([probeSingleMonitor({ ...config, timeout_ms: 20 }), new Promise(resolve => setTimeout(() => resolve(null), 1000))])
  assert.ok(result)
  assert.equal(result.status, 0)
  assert.equal(targets, 0)
  assert.ok(canceled >= 2)
})

test('D08: retries recheck DNS instead of trusting a previous public answer', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname === 'cloudflare-dns.com') return dnsResponse(url,
      calls ? { A: ['10.0.0.1'], AAAA: [] } : undefined)
    calls++
    throw new Error('first connection failed')
  })
  const result = await probeSingleMonitor(config)
  assert.equal(result.status, 0)
  assert.match(result.message, /非公网/)
  assert.equal(calls, 1)
})
