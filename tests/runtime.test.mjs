import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions, Response as MockResponse } from 'miniflare'

// Exercise real workerd fetch validation, keeping every outbound request local.
// Node fetch mocks alone accept options that the production runtime rejects.
test('workerd: probes recover incidents and DNS/webhook redirects are never followed', { timeout: 60000 }, async t => {
  const { outputFiles } = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' })
  const compatibilityDate = /compatibility_date\s*=\s*"([^"]+)"/.exec(readFileSync('wrangler.toml', 'utf8'))[1]
  let dnsRedirect = false, webhookRedirect = false
  const targets = [], webhooks = [], unexpected = []
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate, cf: false,
    d1Databases: { DB: 'runtime-test-db' },
    bindings: { ADMIN_TOKEN: 'runtime-test-secret', WEBHOOK_URL: 'https://hooks.example/alert', WEBHOOK_TYPE: 'generic' },
    outboundService: async request => {
      const url = new URL(request.url)
      if (url.hostname === 'cloudflare-dns.com') {
        if (dnsRedirect) return new MockResponse(null, { status: 302, headers: { Location: 'https://unexpected.example/dns' } })
        return MockResponse.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] })
      }
      if (url.hostname === 'target.example') { targets.push(request.url); return new MockResponse('OK') }
      if (url.hostname === 'hooks.example') {
        webhooks.push(await request.json())
        return new MockResponse(null, { status: webhookRedirect ? 302 : 204, headers: webhookRedirect ? { Location: 'https://unexpected.example/hook' } : {} })
      }
      unexpected.push(request.url)
      throw new Error('Unexpected outbound request')
    },
  }))
  t.after(() => runtime.dispose())
  const db = await runtime.getD1Database('DB')
  for (const file of ['schema.sql', ...readdirSync('migrations').sort().map(name => `migrations/${name}`)]) {
    for (const statement of readFileSync(file, 'utf8').replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
  }
  await db.prepare('DELETE FROM monitors').run()
  const call = async (path, body) => {
    const response = await runtime.dispatchFetch(`https://pulse.example${path}`, { method: 'POST', headers: { Authorization: 'Bearer runtime-test-secret', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    assert.equal(response.status, path === '/api/monitors' ? 201 : 200)
    return response.json()
  }
  const preview = await call('/api/probe-test', { url: 'https://target.example/health' })
  assert.equal(preview.success, true, JSON.stringify(preview))
  const created = await call('/api/monitors', { name: 'Runtime target', url: 'https://target.example/health' })
  const id = created.monitor.id
  assert.equal((await db.prepare('SELECT status FROM heartbeats WHERE monitor_id=?').bind(id).first()).status, 1)
  assert.equal(webhooks.length, 0, 'first UP must not notify')

  dnsRedirect = true
  const targetCount = targets.length
  await call(`/api/probe?id=${id}&force=1`)
  assert.equal(targets.length, targetCount, 'DNS redirects must not reach the target')
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status!='resolved'").first()).n, 1)
  assert.equal(webhooks.at(-1).status, 'DOWN')
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM alert_outbox').first()).n, 0, 'accepted webhook must leave the queue')

  dnsRedirect = false
  await call(`/api/probe?id=${id}&force=1`)
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status='resolved'").first()).n, 1)
  assert.equal(webhooks.at(-1).status, 'UP')

  webhookRedirect = true
  await db.prepare('INSERT INTO alert_outbox(id,payload,next_attempt_at,created_at) VALUES(?,?,0,?)')
    .bind('redirect-test', JSON.stringify({ monitor: 'Runtime target', url: 'https://target.example/health', status: 'DOWN', message: 'test' }), Math.floor(Date.now() / 1000)).run()
  await call(`/api/probe?id=${id}&force=1`)
  assert.equal((await db.prepare('SELECT attempts FROM alert_outbox WHERE id=?').bind('redirect-test').first()).attempts, 1)
  assert.deepEqual(unexpected, [], 'neither DNS nor webhook redirects may be followed')
})
