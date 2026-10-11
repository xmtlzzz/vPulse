import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load, mockNetwork } from './helpers.mjs'

const { probeSingleMonitor } = await load('worker/probe.ts')
const monitor = { id:'audit', name:'Audit', url:'https://example.com/', method:'GET', expected_status:200, interval_min:3, timeout_ms:1000, enabled:1, order_num:0 }

test('Cloudflare CPU exhaustion is reported without immediately invoking the failing Worker again', async t => {
  const network = mockNetwork(t, () => new Response('error code: 1102', {status:503,headers:{server:'cloudflare'}}))
  const result = await probeSingleMonitor(monitor)
  assert.equal(result.status, 0)
  assert.match(result.message, /1102/)
  assert.equal(network.mock.callCount(), 3) // two DNS queries, one target
})

test('rate limits, retry-after and permanent HTTP failures do not trigger immediate retries', async t => {
  for (const [status,headers] of [[429,{}],[503,{'Retry-After':'120'}],[404,{}]]) {
    const network = mockNetwork(t, () => new Response('unavailable',{status,headers}))
    const result = await probeSingleMonitor(monitor)
    assert.equal(result.status, 0)
    assert.equal(network.mock.callCount(), 3)
    network.mock.restore()
  }
})

test('a 200 response whose HTML stream fails is not reported healthy', async t => {
  mockNetwork(t, () => new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<html>'));},pull(c){c.error(new Error('SSR stream failed'))}}),{headers:{'Content-Type':'text/html'}}))
  const result = await probeSingleMonitor(monitor)
  assert.equal(result.status, 0)
  assert.match(result.message, /SSR stream failed/)
})

test('a transient failure can still recover on a bounded retry', async t => {
  let calls=0
  mockNetwork(t, () => ++calls===1 ? new Response('unavailable',{status:503}) : new Response('<html>ready</html>',{headers:{'Content-Type':'text/html'}}))
  const result=await probeSingleMonitor(monitor)
  assert.equal(calls,2)
  assert.equal(result.status,1)
  assert.match(result.message,/重试后恢复/)
})


test('oversized HTML is degraded instead of falsely healthy or down', async t => {
  mockNetwork(t, () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)))
  const result = await probeSingleMonitor(monitor)
  assert.equal(result.status, 2)
  assert.match(result.message, /2 MiB/)
})

test('a stalled HTML body shares the attempt deadline and is cancelled', async t => {
  let cancelled = 0
  mockNetwork(t, () => new Response(new ReadableStream({ cancel() { cancelled++ } })))
  const started = Date.now()
  const result = await probeSingleMonitor({ ...monitor, timeout_ms: 50 })
  assert.equal(result.status, 0)
  assert.match(result.message, /超时/)
  assert.equal(cancelled, 2)
  assert.ok(Date.now() - started < 1500)
})

test('HEAD does not consume the document body', async t => {
  mockNetwork(t, () => new Response(new ReadableStream({ pull() { throw new Error('must not read HEAD body') } })))
  assert.equal((await probeSingleMonitor({ ...monitor, method: 'HEAD' })).status, 1)
})
