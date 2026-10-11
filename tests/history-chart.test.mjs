import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const chart = await load('src/lib/history-chart.ts')
const point = (timestamp, latency_ms = 100, count = 1) => ({
  timestamp,
  latency_ms,
  min_ms: latency_ms,
  max_ms: latency_ms,
  count,
  failures: 0,
})

test('scheduled samples form one trend even when the monitoring interval exceeds the bucket', () => {
  const segments = chart.historySegments([point(0), point(1800, 200), point(3600, 150)], 240, 30)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].length, 3)
})

test('missing rounds and null responses break the trend instead of implying healthy data', () => {
  const segments = chart.historySegments(
    [point(0), point(180), point(720), point(900, null), point(1080)],
    180,
    3
  )
  assert.deepEqual(
    segments.map((s) => s.map((p) => p.timestamp)),
    [[0, 180], [720], [1080]]
  )
})

test('history summary reports bucket means and does not count missing responses as zero latency', () => {
  const result = chart.historySummary([
    point(0, 100, 3),
    point(180, 300),
    { ...point(360, null, 2), failures: 2 },
  ])
  assert.equal(result.average, 200)
  assert.equal(result.samples, 6)
  assert.equal(result.failures, 2)
  assert.equal(chart.historySummary([]).average, null)
})
