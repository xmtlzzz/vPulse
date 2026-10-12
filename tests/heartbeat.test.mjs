import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { heartbeatWindow } = await load('src/lib/heartbeat.ts')
const beat = (status, timestamp) => ({ status, timestamp, status_code: status === 1 ? 200 : 503, latency_ms: 10 })

test('the latest window retains old failures alongside 36 recent successes', () => {
  const history = Array.from({ length: 70 }, (_, i) => beat(i < 34 ? 0 : 1, i))
  const { slots, records, successPercent } = heartbeatWindow(history)
  assert.equal(slots.length, 60)
  assert.deepEqual(slots, history.slice(10))
  assert.equal(records.length, 60)
  assert.equal(slots.filter(b => b.status === 0).length, 24)
  assert.equal(successPercent, 60)
  assert.equal(history.length, 70)
})

test('padding and unknown records are excluded while degradation is not a success', () => {
  const { slots, records, successPercent } = heartbeatWindow([beat(-1, 1), beat(0, 2), beat(2, 3), beat(1, 4)])
  assert.equal(slots.length, 60)
  assert.equal(slots.filter(b => b.status === -1).length, 57)
  assert.deepEqual(records.map(b => b.timestamp), [2, 3, 4])
  assert.ok(Math.abs(successPercent - 100 / 3) < 1e-10)
})

test('no observations never imply 100 percent success', () => {
  const { slots, records, successPercent } = heartbeatWindow([])
  assert.equal(slots.length, 60)
  assert.ok(slots.every(b => b.status === -1))
  assert.equal(records.length, 0)
  assert.equal(successPercent, null)
})
