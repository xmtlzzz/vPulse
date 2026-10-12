import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

const migration = readFileSync('migrations/0005_vmaker_health.sql', 'utf8')
function setup(t, fresh = false) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec('PRAGMA foreign_keys=ON')
  let schema = readFileSync('schema.sql', 'utf8')
  if (!fresh) schema = schema.slice(0, schema.indexOf('-- Seed Initial Monitors'))
  db.exec(schema)
  for (const file of readdirSync('migrations').sort().filter(f => f < '0005'))
    db.exec(readFileSync(`migrations/${file}`, 'utf8'))
  if (!fresh) db.exec(`INSERT INTO monitors VALUES('vmaker','Custom title','Sites','https://vmaker.xmtlz.dev','GET',200,3,6000,1,1,100)`)
  return db
}

test('upgrade preserves history and separates new endpoint state', t => {
  const db = setup(t)
  db.exec(`INSERT INTO heartbeats(monitor_id,status,status_code,timestamp) VALUES('vmaker',0,503,100);
    INSERT INTO monitor_settings(monitor_id,failure_threshold,maintenance_until) VALUES('vmaker',3,9999999999);
    INSERT INTO alert_state VALUES('vmaker',4,0,100);`)
  db.exec(migration)
  assert.equal(db.prepare("SELECT url FROM monitors WHERE id='vmaker'").get().url, 'https://vmaker.xmtlz.dev/api/health')
  assert.equal(db.prepare("SELECT name FROM monitors WHERE id='vmaker'").get().name, 'Custom title')
  assert.deepEqual({ ...db.prepare("SELECT interval_min,enabled FROM monitors WHERE id='vmaker-homepage'").get() }, { interval_min: 30, enabled: 1 })
  assert.deepEqual({ ...db.prepare("SELECT failure_threshold,maintenance_until,probe_after_id FROM monitor_settings WHERE monitor_id='vmaker'").get() }, { failure_threshold: 3, maintenance_until: 9999999999, probe_after_id: 1 })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM heartbeats').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alert_state').get().n, 0)
  assert.equal(db.prepare("SELECT maintenance_until FROM monitor_settings WHERE monitor_id='vmaker-homepage'").get().maintenance_until, 9999999999)
  db.exec(migration)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM monitors').get().n, 2)
})

test('custom URLs, intervals, methods and content assertions are untouched', t => {
  for (const change of ["UPDATE monitors SET url='https://example.com/'", 'UPDATE monitors SET interval_min=15', "UPDATE monitors SET method='HEAD'", "INSERT INTO monitor_settings(monitor_id,keyword) VALUES('vmaker','portfolio')", "INSERT INTO monitor_settings(monitor_id,json_path) VALUES('vmaker','status')"]) {
    const db = setup(t)
    db.exec(change)
    const before = db.prepare('SELECT * FROM monitors').all()
    db.exec(migration)
    assert.deepEqual(db.prepare('SELECT * FROM monitors').all(), before)
  }
})

test('paused monitor stays paused in both checks', t => {
  const db = setup(t)
  db.exec('UPDATE monitors SET enabled=0')
  db.exec(migration)
  assert.deepEqual(db.prepare('SELECT enabled FROM monitors').all().map(r => r.enabled), [0, 0])
})

test('existing homepage and full monitor capacity do not create duplicates', t => {
  for (const full of [false, true]) {
    const db = setup(t)
    const insert = db.prepare("INSERT INTO monitors SELECT ?,name,group_name,?,method,expected_status,interval_min,timeout_ms,order_num,enabled,created_at FROM monitors WHERE id='vmaker'")
    if (full) for (let i = 0; i < 19; i++) insert.run(`other-${i}`, `https://example.com/${i}`)
    else insert.run('existing-home', 'https://vmaker.xmtlz.dev/')
    const count = db.prepare('SELECT COUNT(*) n FROM monitors').get().n
    db.exec(migration)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM monitors').get().n, count)
  }
})

test('fresh installs have health and homepage checks without extra rows', t => {
  const db = setup(t, true)
  db.exec(migration)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM monitors').get().n, 4)
  assert.equal(db.prepare("SELECT interval_min FROM monitors WHERE id='vmaker'").get().interval_min, 3)
  assert.equal(db.prepare("SELECT interval_min FROM monitors WHERE id='vmaker-homepage'").get().interval_min, 30)
})
