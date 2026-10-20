import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { load, database, seed, beat, request, context } from './helpers.mjs'

const worker = (await load('worker/index.ts')).default
const { storeProbe } = await load('worker/scheduler.ts')
const { removeMonitor, fetchIncidents } = await load('worker/db.ts')
const { incidentHistory, ACTIVE_INCIDENT_SQL, RECENT_INCIDENTS_SQL } = await load('worker/incidents.ts')
const calendar = await load('src/lib/incident-calendar.ts')
const NOW = Date.parse('2026-10-15T12:00:00+08:00') / 1000
const stamp = value => Date.parse(`${value}+08:00`) / 1000
const env = db => ({ DB: db })
const get = (db, path) => worker.fetch(request(path, 'GET', undefined, ''), env(db), context())
const heartbeat = (status, timestamp, message = `status ${status}`) => ({ status, timestamp, status_code: status === 1 ? 200 : 503, latency_ms: 20, message })

function incident(sql, id, created, resolved = created + 60) {
  sql.prepare(`INSERT INTO incidents(id,title,description,status,severity,created_at,updated_at,resolved_at)
    VALUES(?,?,'fixture',?,'minor',?,?,?)`).run(id, `Event ${id}`, resolved === null ? 'investigating' : 'resolved', created, resolved ?? created, resolved)
}

test('calendar uses UTC+8, validates real dates, and builds Monday-first leap-month grids', () => {
  assert.equal(calendar.incidentDate(stamp('2026-10-01T00:00:00')), '2026-10-01')
  assert.equal(calendar.incidentDate(stamp('2026-10-01T00:00:00') - 1), '2026-09-30')
  assert.equal(calendar.dayBounds('2026-02-29'), null)
  assert.equal(calendar.dayBounds('2024-02-29')[1] - calendar.dayBounds('2024-02-29')[0], 86400)
  assert.equal(calendar.monthBounds('2026-13'), null)
  assert.equal(calendar.shiftIncidentMonth('2026-01', -1), '2025-12')
  const days = calendar.calendarDays('2024-02')
  assert.equal(days.filter(Boolean).length, 29)
  assert.equal(days.indexOf('2024-02-01'), 3)
  assert.equal(days.length % 7, 0)
})

test('legacy upgrade preserves records, monitor snapshots and last-known diagnostics without fabricating transitions', () => {
  const sql = new DatabaseSync(':memory:')
  try {
    sql.exec('PRAGMA foreign_keys=ON')
    sql.exec(readFileSync('schema.sql', 'utf8'))
    for (const file of readdirSync('migrations').sort().filter(f => f < '0007')) sql.exec(readFileSync(`migrations/${file}`, 'utf8'))
    incident(sql, 'legacy', NOW - 500, NOW - 100)
    sql.prepare("INSERT INTO incident_monitors VALUES('legacy','vmaker')").run()
    const before = sql.prepare('SELECT id,title,description,status,created_at,resolved_at FROM incidents').all()
    sql.exec(readFileSync('migrations/0007_incident_history.sql', 'utf8'))
    assert.deepEqual(sql.prepare('SELECT id,title,description,status,created_at,resolved_at FROM incidents').all(), before)
    const row = sql.prepare("SELECT * FROM incidents WHERE id='legacy'").get()
    assert.equal(row.monitor_id_snapshot, 'vmaker')
    assert.ok(row.monitor_name)
    const updates = sql.prepare('SELECT * FROM incident_updates').all()
    assert.equal(updates.length, 1)
    assert.equal(updates[0].kind, 'snapshot')
    assert.equal(updates[0].timestamp, NOW - 100)
    assert.equal(updates[0].description, 'fixture')
  } finally { sql.close() }
})

test('opened, changed and recovery diagnostics append atomically while unchanged probes do not duplicate events', async t => {
  const d = database(); t.after(d.close)
  const m = seed(d.sql)
  await storeProbe(env(d.db), m, heartbeat(0, NOW - 180, 'HTTP 503'))
  await storeProbe(env(d.db), m, heartbeat(0, NOW - 120, 'still HTTP 503'))
  await storeProbe(env(d.db), m, heartbeat(2, NOW - 60, 'slow response'))
  await storeProbe(env(d.db), m, heartbeat(1, NOW, 'HTTP 200'))
  const updates = d.sql.prepare('SELECT * FROM incident_updates ORDER BY id').all()
  assert.deepEqual(updates.map(u => [u.kind, u.description]), [['opened', 'HTTP 503'], ['updated', 'slow response'], ['resolved', 'HTTP 200']])
  assert.equal(updates[0].severity, 'major')
  assert.equal(updates[1].severity, 'minor')
  const i = d.sql.prepare('SELECT * FROM incidents').get()
  assert.equal(i.monitor_name, m.name)
  assert.equal(i.monitor_id_snapshot, m.id)
  assert.equal(i.resolved_at, NOW)
  // Heartbeat retention cannot erase the audit trail.
  d.sql.exec('DELETE FROM heartbeats')
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM incident_updates').get().n, 3)
  t.mock.method(Date, 'now', () => NOW * 1000)
  const detail = await (await get(d.db, `/api/incidents/${i.id}`)).json()
  assert.equal(detail.updates.length, 3)
  const archive = await (await get(d.db, '/api/incidents?month=2026-10&day=2026-10-15')).json()
  assert.equal(archive.incidents.length, 1)
  assert.equal(archive.days.find(x => x.date === '2026-10-15').total, 1)
})

test('failure inserting a timeline entry rolls back the incident, heartbeat and revision together', async t => {
  const d = database(); t.after(d.close)
  const m = seed(d.sql)
  d.sql.exec("CREATE TRIGGER fail_update BEFORE INSERT ON incident_updates BEGIN SELECT RAISE(ABORT,'timeline unavailable'); END")
  const revision = d.sql.prepare('SELECT revision FROM status_revision').get().revision
  await assert.rejects(storeProbe(env(d.db), m, heartbeat(0, NOW)), /timeline unavailable/)
  for (const table of ['heartbeats', 'incidents', 'incident_updates']) assert.equal(d.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0)
  assert.equal(d.sql.prepare('SELECT revision FROM status_revision').get().revision, revision)
})

test('archive includes a recovery in a later month and the original opening on its actual UTC+8 date', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  incident(d.sql, 'cross-month', stamp('2026-09-30T23:59:30'), stamp('2026-10-01T00:01:00'))
  const september = await (await get(d.db, '/api/incidents?month=2026-09&day=2026-09-30')).json()
  const october = await (await get(d.db, '/api/incidents?month=2026-10&day=2026-10-01')).json()
  assert.equal(september.incidents[0].id, 'cross-month')
  assert.equal(october.incidents[0].id, 'cross-month')
  assert.equal(september.days[0].date, '2026-09-30')
  assert.equal(september.days[0].opened, 1)
  assert.equal(october.days[0].date, '2026-10-01')
  assert.equal(october.days[0].resolved, 1)
  assert.equal(october.time_zone, 'Asia/Shanghai')
})

test('calendar keeps the opening severity when a later day degrades and recovers', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  const m = seed(d.sql)
  await storeProbe(env(d.db), m, heartbeat(0, stamp('2026-10-13T23:59:30'), 'outage'))
  await storeProbe(env(d.db), m, heartbeat(2, stamp('2026-10-14T00:00:30'), 'degraded'))
  await storeProbe(env(d.db), m, heartbeat(1, stamp('2026-10-15T00:00:30'), 'recovered'))
  const data = await (await get(d.db, '/api/incidents?month=2026-10')).json()
  assert.equal(data.days.find(d => d.date === '2026-10-13').severity, 2)
  assert.equal(data.days.find(d => d.date === '2026-10-14').severity, 1)
  assert.equal(data.days.find(d => d.date === '2026-10-15').severity, 0)
})

test('a legacy incident remains discoverable on the date of its last-known unresolved snapshot', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  incident(d.sql, 'old-active', stamp('2026-09-01T08:00:00'), null)
  d.sql.prepare(`INSERT INTO incident_updates(incident_id,kind,status,severity,title,description,timestamp)
    VALUES('old-active','snapshot','investigating','minor','old','last known diagnostic',?)`).run(NOW - 10)
  const data = await (await get(d.db, '/api/incidents?month=2026-10&day=2026-10-15')).json()
  assert.equal(data.incidents[0].id, 'old-active')
  assert.equal(data.days[0].date, '2026-10-15')
})

test('month and day histories paginate beyond five with stable activity timestamp/id ties', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  for (let i = 0; i < 47; i++) incident(d.sql, `event-${String(i).padStart(3, '0')}`, NOW - 120, NOW - 60)
  assert.equal((await fetchIncidents(d.db)).length, 5, 'home remains a bounded recent snapshot')
  const ids = []
  let cursor = null, rounds = 0
  do {
    const query = new URLSearchParams({ month: '2026-10', day: '2026-10-15', ...(cursor ? { cursor } : {}) })
    const data = await (await get(d.db, `/api/incidents?${query}`)).json()
    assert.ok(data.incidents.length <= 20)
    ids.push(...data.incidents.map(i => i.id)); cursor = data.next_cursor
    assert.equal(data.days[0].total, 47)
    assert.ok(++rounds < 5)
  } while (cursor)
  assert.equal(ids.length, 47)
  assert.equal(new Set(ids).size, 47)
  assert.deepEqual(ids, [...ids].sort().reverse())
})

test('timeline keyset pages include every update with tied timestamps', async t => {
  const d = database(); t.after(d.close)
  incident(d.sql, 'many-updates', NOW - 100)
  for (let i = 0; i < 45; i++) d.sql.prepare(`INSERT INTO incident_updates(incident_id,kind,status,severity,title,description,timestamp)
    VALUES('many-updates','updated','investigating','minor','update',?,?)`).run(`diagnostic ${i}`, NOW - 50)
  let cursor = null, ids = []
  do {
    const data = await (await get(d.db, `/api/incidents/many-updates?${new URLSearchParams(cursor ? { cursor } : {})}`)).json()
    ids.push(...data.updates.map(u => u.id)); cursor = data.next_cursor
    assert.ok(ids.length <= 45)
  } while (cursor)
  assert.equal(ids.length, 45)
  assert.equal(new Set(ids).size, 45)
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b))
})

test('old incidents remain discoverable years later, independent of 30-day heartbeat retention', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  incident(d.sql, 'old', stamp('2024-02-29T08:00:00'))
  const data = await (await get(d.db, '/api/incidents?month=2024-02')).json()
  assert.equal(data.incidents[0].id, 'old')
  assert.equal(data.earliest_month, '2024-02')
  assert.equal(data.days[0].date, '2024-02-29')
})

test('removing a failing monitor retains its name, incident and end-of-tracking timeline', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  const m = seed(d.sql, { name: 'Archived Service' })
  await storeProbe(env(d.db), m, heartbeat(0, NOW - 60))
  const id = d.sql.prepare('SELECT id FROM incidents').get().id
  assert.equal(await removeMonitor(m.id, d.db), true)
  const data = await (await get(d.db, `/api/incidents/${id}`)).json()
  assert.equal(data.incident.monitor_id, null)
  assert.equal(data.incident.monitor_id_snapshot, m.id)
  assert.equal(data.incident.monitor_name, 'Archived Service')
  assert.equal(data.incident.status, 'resolved')
  assert.match(data.updates.at(-1).description, /停止追踪/)
  assert.equal(data.updates.at(-1).kind, 'resolved')
})

test('archive validates months, dates, cursors, missing IDs and request methods', async t => {
  const d = database(); t.after(d.close)
  t.mock.method(Date, 'now', () => NOW * 1000)
  for (const query of ['month=garbage', 'month=2026-13', 'month=2026-11', 'month=2026-02&day=2026-02-29',
    'month=2026-10&day=2026-09-01', 'cursor=broken', 'cursor=[-1,"id"]', 'cursor=[0,"id"]']) {
    assert.equal((await get(d.db, `/api/incidents?${query}`)).status, 400, query)
  }
  assert.equal((await get(d.db, '/api/incidents/missing')).status, 404)
  incident(d.sql, 'existing', NOW - 50)
  assert.equal((await get(d.db, '/api/incidents/existing?cursor=[0,"invalid"]')).status, 400)
  const read = await get(d.db, '/api/incidents?month=2026-10')
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('cache-control'), 'no-store')
  assert.equal((await worker.fetch(request('/api/incidents', 'POST', {}, 'secret'), { DB: d.db, ADMIN_TOKEN: 'secret' }, context())).status, 405)
})

test('recent and active incident queries avoid lifetime history scans', async t => {
  const d = database(); t.after(d.close)
  const m = seed(d.sql)
  d.sql.exec('BEGIN')
  for (let i = 0; i < 10000; i++) {
    incident(d.sql, `history-${i}`, NOW - 100000 - i)
    d.sql.prepare('INSERT INTO incident_monitors VALUES(?,?)').run(`history-${i}`, m.id)
  }
  d.sql.exec('COMMIT')
  const recentPlan = d.sql.prepare('EXPLAIN QUERY PLAN ' + RECENT_INCIDENTS_SQL).all().map(r => r.detail).join('\n')
  const activePlan = d.sql.prepare('EXPLAIN QUERY PLAN ' + ACTIVE_INCIDENT_SQL).all(m.id).map(r => r.detail).join('\n')
  assert.match(recentPlan, /idx_incidents_active/)
  assert.match(recentPlan, /idx_incidents_resolved/)
  assert.match(activePlan, /SCAN i USING (?:COVERING )?INDEX idx_incidents_active/)
  assert.doesNotMatch(activePlan, /idx_incident_monitors_monitor/)
  assert.equal(d.sql.prepare(ACTIVE_INCIDENT_SQL).get(m.id), undefined)
  await storeProbe(env(d.db), m, heartbeat(0, NOW))
  assert.ok(d.sql.prepare(ACTIVE_INCIDENT_SQL).get(m.id))
})

test('local D1 archive read cost stays bounded as history outside the month grows', { timeout: 60000 }, async t => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("archive cost")}}', cf: false, d1Databases: { DB: 'incident-history-cost' } }))
  t.after(() => runtime.dispose())
  const raw = await runtime.getD1Database('DB')
  for (const file of ['schema.sql', ...readdirSync('migrations').sort().map(f => `migrations/${f}`)]) {
    for (const statement of readFileSync(file, 'utf8').replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await raw.prepare(statement).run()
  }
  const totals = []
  let reads = 0
  const wrap = statement => ({ bind(...values) { return wrap(statement.bind(...values)) }, async all() { const r = await statement.all(); reads += r.meta.rows_read; return r }, async first() { return (await this.all()).results[0] ?? null } })
  const metered = { prepare: sql => wrap(raw.prepare(sql)) }
  for (const count of [1000, 10000]) {
    await raw.prepare('DELETE FROM incidents').run()
    await raw.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
      INSERT INTO incidents(id,title,description,status,created_at,updated_at,resolved_at)
      SELECT 'old-'||n,'old','old','resolved',1600000000+n,1600000060+n,1600000060+n FROM seq`).bind(count).run()
    for (let i = 0; i < 3; i++) await raw.prepare(`INSERT INTO incidents(id,title,description,status,created_at,updated_at,resolved_at)
      VALUES(?,'current','current','resolved',?,?,?)`).bind(`current-${i}`, NOW - 1000 - i, NOW - i, NOW - i).run()
    reads = 0
    const result = await incidentHistory(new URL('https://audit.example/api/incidents?month=2026-10'), metered)
    assert.equal(result.incidents.length, 3)
    assert.ok(reads < 200, `${count} older incidents: ${reads} reads`)
    totals.push(reads)
    console.log(JSON.stringify({ audit: 'incident_archive', older_incidents: count, rows_read: reads }))
    await raw.prepare("INSERT INTO incident_monitors SELECT id,'vmaker' FROM incidents").run()
    const active = await raw.prepare(ACTIVE_INCIDENT_SQL).bind('vmaker').all()
    const recent = await raw.prepare(RECENT_INCIDENTS_SQL).all()
    assert.equal(active.results.length, 0)
    assert.ok(active.meta.rows_read <= 5, `active lookup read ${active.meta.rows_read}`)
    assert.equal(recent.results.length, 5)
    assert.ok(recent.meta.rows_read <= 40, `recent incidents read ${recent.meta.rows_read}`)
    console.log(JSON.stringify({ audit: 'incident_queries', older_incidents: count,
      active_rows_read: active.meta.rows_read, recent_rows_read: recent.meta.rows_read }))
  }
  assert.equal(totals[0], totals[1])
})
