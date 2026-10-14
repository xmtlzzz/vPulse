import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { load, database, seed, beat, request, context, mockNetwork } from './helpers.mjs'

const { latestHeartbeats, LATEST_HEARTBEAT_SQL } = await load('worker/latest.ts')
const { availabilityStats } = await load('worker/availability.ts')
const { fetchMonitorsWithHistory, getAllMonitors, updateMonitor } = await load('worker/db.ts')
const { readStatus } = await load('worker/status.ts')
const { runProbes, storeProbe } = await load('worker/scheduler.ts')
const worker = (await load('worker/index.ts')).default
const WINDOW = 30 * 86400
const START = 1800000000

// Independent baseline: the previous full-window SQL and its public semantics.
function reference(sql, monitor, now) {
  return sql.prepare(`WITH intervals AS (
    SELECT status,timestamp,LEAD(timestamp,1,?) OVER (ORDER BY timestamp,id) AS next_ts
    FROM heartbeats WHERE monitor_id=? AND timestamp>=?
  ), durations AS (
    SELECT status,MAX(0,MIN(next_ts,(CAST(timestamp/180 AS INTEGER)+CAST((?+2)/3 AS INTEGER))*180+MAX(60,?*2/1000),?)-MAX(timestamp,?)) AS seconds FROM intervals
  ) SELECT COALESCE(SUM(seconds),0) covered,
    COALESCE(SUM(CASE WHEN status IN (1,2) THEN seconds ELSE 0 END),0) available FROM durations`
  ).get(now, monitor.id, now-WINDOW-7200, monitor.interval_min, monitor.timeout_ms, now, now-WINDOW)
}

function trace(db) {
  const queries = []
  const wrapped = {
    prepare(query) { queries.push(query); return db.prepare(query) },
    batch(statements) { return db.batch(statements) },
  }
  return { db: wrapped, queries, bootstraps: () => queries.filter(q => q.includes('LEAD(')).length }
}

async function agrees(d, monitors, now, db = d.db) {
  const results = await availabilityStats(db, monitors, now)
  for (const m of monitors) assert.deepEqual({ ...results.get(m.id) }, { ...reference(d.sql, m, now) }, `${m.id} at ${now}`)
  return results
}

test('latest sample uses timestamp/id ordering and respects invalidation without a history aggregate', async t => {
  const d=database(); t.after(d.close)
  const m=seed(d.sql)
  for(let i=0;i<10000;i++) beat(d.sql,m.id,i%3,START-30000+i)
  beat(d.sql,m.id,1,START); beat(d.sql,m.id,0,START-180)
  assert.equal((await latestHeartbeats(d.db,[m])).get(m.id),START)
  const max=d.sql.prepare('SELECT MAX(id) id FROM heartbeats').get().id
  assert.equal((await latestHeartbeats(d.db,[{...m,probe_after_id:max}])).has(m.id),false)
  beat(d.sql,m.id,1,START-60)
  assert.equal((await latestHeartbeats(d.db,[{...m,probe_after_id:max}])).get(m.id),START-60)
  const plan=d.sql.prepare('EXPLAIN QUERY PLAN '+LATEST_HEARTBEAT_SQL).all(m.id,0,m.id,0).map(p=>p.detail).join('\n')
  assert.match(plan,/idx_heartbeats_monitor_id/)
  assert.match(plan,/idx_heartbeats_monitor_time/)
  assert.doesNotMatch(plan,/SCAN heartbeats|TEMP B-TREE/)
})

test('idle Cron and health use latest indexed samples; a single manual probe only reads its target', async t => {
  const d=database(); t.after(d.close)
  t.mock.method(Date,'now',()=>START*1000)
  const a=seed(d.sql), b=seed(d.sql,{id:'other'})
  for(let i=0;i<2000;i++){beat(d.sql,a.id,1,START-20000+i);beat(d.sql,b.id,1,START-20000+i)}
  beat(d.sql,a.id,1,START);beat(d.sql,b.id,1,START)
  const traced=trace(d.db)
  const network=mockNetwork(t,()=>new Response('OK'))
  assert.equal((await runProbes({DB:traced.db},{scheduled:true})).probed_count,0)
  assert.equal((await worker.fetch(request('/api/health'),{DB:traced.db},context())).status,200)
  assert.equal(network.mock.callCount(),0)
  traced.queries.length=0
  assert.equal((await runProbes({DB:traced.db},{id:a.id})).debounced,true)
  assert.equal(traced.queries.filter(q=>q===LATEST_HEARTBEAT_SQL).length,1)
  assert.ok(!traced.queries.some(q=>q.includes('GROUP BY')&&q.includes('heartbeats')))
})

test('availability reuses durable totals and only advances newly observed time, including ties', async t => {
  const d=database(); t.after(d.close)
  const m=seed(d.sql)
  for(let i=0;i<8000;i++) beat(d.sql,m.id,i%3,START-8000*180+i*180)
  const traced=trace(d.db)
  await agrees(d,[m],START,traced.db)
  assert.equal(traced.bootstraps(),1)
  // A new bundle/Worker isolate must use the database checkpoint too.
  const fresh=await load('worker/availability.ts')
  await fresh.availabilityStats(traced.db,[m],START+30)
  for(let i=1;i<=6;i++){
    beat(d.sql,m.id,i%3,START+i*180)
    d.sql.exec("UPDATE status_revision SET revision=revision+1 WHERE key='status'")
    await agrees(d,[m],START+i*180+20,traced.db)
  }
  beat(d.sql,m.id,0,START+1100);beat(d.sql,m.id,2,START+1100)
  await agrees(d,[m],START+1130,traced.db)
  assert.equal(traced.bootstraps(),1,'ordinary new probes must not rescan prior history')
})

test('rolling window subtracts partial expired observations and survives retention cleanup', async t => {
  const d=database(); t.after(d.close)
  const m=seed(d.sql,{interval_min:4})
  for(const [offset,status] of [[-400,1],[-120,0],[30,2],[250,0],[500,1]]) beat(d.sql,m.id,status,START-WINDOW+offset)
  beat(d.sql,m.id,1,START-200)
  const traced=trace(d.db)
  await agrees(d,[m],START,traced.db)
  for(let i=1;i<=12;i++){
    const now=START+i*180
    if(i%2===0) beat(d.sql,m.id,i%3,now-20)
    d.sql.prepare('DELETE FROM heartbeats WHERE timestamp<?').run(now-WINDOW-7200)
    await agrees(d,[m],now,traced.db)
  }
  assert.equal(traced.bootstraps(),1)
})

test('empty histories, future records and long missing gaps keep coverage truthful', async t => {
  const d=database(); t.after(d.close)
  const m=seed(d.sql)
  await agrees(d,[m],START)
  beat(d.sql,m.id,1,START+180)
  await agrees(d,[m],START+60)
  await agrees(d,[m],START+200)
  await agrees(d,[m],START+1000)
  await agrees(d,[m],START+20000)
  const after=await agrees(d,[m],START+WINDOW+20000)
  assert.deepEqual({...after.get(m.id)},{covered:0,available:0})
})

test('configuration changes and backfills rebuild only the affected monitor', async t => {
  const d=database(); t.after(d.close)
  const a=seed(d.sql),b=seed(d.sql,{id:'other'})
  beat(d.sql,a.id,1,START-500);beat(d.sql,b.id,0,START-500)
  const traced=trace(d.db)
  await agrees(d,[a,b],START,traced.db)
  assert.equal(traced.bootstraps(),2)
  d.sql.prepare('UPDATE monitors SET interval_min=10 WHERE id=?').run(a.id)
  const changed={...a,interval_min:10}
  await agrees(d,[changed,b],START+60,traced.db)
  assert.equal(traced.bootstraps(),3)
  beat(d.sql,b.id,1,START-100)
  await agrees(d,[changed,b],START+120,traced.db)
  assert.equal(traced.bootstraps(),4)
  d.sql.prepare('DELETE FROM monitors WHERE id=?').run(b.id)
  assert.equal(d.sql.prepare('SELECT COUNT(*) n FROM availability_cache').get().n,1)
})

test('a write racing with availability publication cannot overwrite the previous checkpoint', async t => {
  const d=database(); t.after(d.close)
  const m=seed(d.sql);beat(d.sql,m.id,1,START-180)
  await agrees(d,[m],START)
  let injected=false
  const racing={...d.db,async batch(statements){
    if(!injected&&statements.some(s=>s.query.includes('INSERT INTO availability_cache'))){
      injected=true
      beat(d.sql,m.id,0,START+60)
      d.sql.exec("UPDATE status_revision SET revision=revision+1 WHERE key='status'")
    }
    return d.db.batch(statements)
  }}
  await availabilityStats(racing,[m],START+120)
  assert.equal(d.sql.prepare('SELECT computed_at FROM availability_cache').get().computed_at,START)
  await agrees(d,[m],START+120)
})

test('status rebuilds keep the latest 60 samples and reuse availability after every probe', async t => {
  const d=database(); t.after(d.close)
  let now=START
  t.mock.method(Date,'now',()=>now*1000)
  const m=seed(d.sql)
  for(let i=120;i>=1;i--)beat(d.sql,m.id,i>60?0:1,START-i*180)
  const traced=trace(d.db)
  await readStatus(traced.db)
  for(let i=1;i<=3;i++){
    now+=180
    await storeProbe({DB:d.db},m,{status:i%3,status_code:200,latency_ms:20,message:'test',timestamp:now})
    const status=await readStatus(traced.db)
    assert.equal(status.monitors[0].heartbeats.length,60)
    assert.equal(status.monitors[0].current_status,i%3)
    const expected=reference(d.sql,m,now)
    assert.equal(status.monitors[0].uptime_30d,Math.round(expected.available/expected.covered*10000)/100)
  }
  assert.equal(traced.bootstraps(),1)
  await updateMonitor(m.id,{url:'https://example.org'},d.db)
  const [changed]=await fetchMonitorsWithHistory(d.db)
  assert.equal(changed.current_status,-1)
  assert.equal(changed.last_checked_at,null)
  assert.equal((await latestHeartbeats(d.db,await getAllMonitors(d.db))).has(m.id),false)
})

test('20-monitor cold and incremental status reads stay within a 50-query invocation budget', async t => {
  const d=database();t.after(d.close)
  let now=START
  t.mock.method(Date,'now',()=>now*1000)
  for(let i=0;i<20;i++){
    const m=seed(d.sql,{id:`monitor-${i}`})
    beat(d.sql,m.id,1,START-180)
  }
  const traced=trace(d.db)
  assert.equal((await readStatus(traced.db)).monitors.length,20)
  assert.ok(traced.queries.length<=50,`cold SQL count: ${traced.queries.length}`)
  assert.equal(traced.bootstraps(),20)
  traced.queries.length=0
  now+=180
  for(let i=0;i<20;i++)beat(d.sql,`monitor-${i}`,i%3,now)
  d.sql.exec("UPDATE status_revision SET revision=revision+1 WHERE key='status'")
  assert.equal((await readStatus(traced.db)).monitors.length,20)
  assert.ok(traced.queries.length<30,`incremental SQL count: ${traced.queries.length}`)
  assert.equal(traced.bootstraps(),0)
})

test('local D1 rows_read for latest samples and incremental stats stays bounded as history grows', {timeout:60000}, async t => {
  const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local cost test")}}',cf:false,d1Databases:{DB:'cost-test'}}))
  t.after(()=>runtime.dispose())
  const db=await runtime.getD1Database('DB')
  await db.exec("CREATE TABLE heartbeats(id INTEGER PRIMARY KEY AUTOINCREMENT,monitor_id TEXT NOT NULL,status INTEGER NOT NULL,timestamp INTEGER NOT NULL); CREATE TABLE monitors(id TEXT PRIMARY KEY,interval_min INTEGER,timeout_ms INTEGER); INSERT INTO monitors VALUES('audit',3,100); CREATE TABLE status_revision(key TEXT PRIMARY KEY,revision INTEGER); INSERT INTO status_revision VALUES('status',0); CREATE INDEX idx_heartbeats_monitor_time ON heartbeats(monitor_id,timestamp DESC,id DESC); CREATE INDEX idx_heartbeats_monitor_id ON heartbeats(monitor_id,id);")
  await db.prepare(readFileSync('migrations/0006_incremental_reads.sql','utf8').match(/CREATE TABLE IF NOT EXISTS availability_cache[\s\S]*?;/)[0]).run()
  const reads=[]
  const wrap=raw=>({raw,bind(...values){return wrap(raw.bind(...values))},async all(){const r=await raw.all();reads.push(r.meta.rows_read);return r},async first(){return (await this.all()).results[0]??null}})
  const metered={prepare:query=>wrap(db.prepare(query)),async batch(statements){const results=await db.batch(statements.map(s=>s.raw));for(const r of results)reads.push(r.meta.rows_read);return results}}
  const m={id:'audit',interval_min:3,timeout_ms:100}
  for(const count of [1000,10000]){
    await db.prepare('DELETE FROM heartbeats').run()
    await db.prepare('DELETE FROM availability_cache').run()
    await db.prepare("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?) INSERT INTO heartbeats(monitor_id,status,timestamp) SELECT 'audit',1,?+n FROM seq").bind(count,START).run()
    const latest=await db.prepare(LATEST_HEARTBEAT_SQL).bind(m.id,0,m.id,0).all()
    assert.equal(latest.results[0].timestamp,START+count)
    assert.ok(latest.meta.rows_read<=5,`latest with ${count} history rows: ${latest.meta.rows_read}`)
    const max=(await db.prepare('SELECT MAX(id) id FROM heartbeats').first()).id
    const reset=await db.prepare(LATEST_HEARTBEAT_SQL).bind(m.id,max,m.id,max).all()
    assert.equal(reset.results[0].timestamp,null)
    assert.ok(reset.meta.rows_read<=5)
    await availabilityStats(metered,[m],START+count)
    reads.length=0
    await db.prepare("INSERT INTO heartbeats(monitor_id,status,timestamp) VALUES('audit',0,?)").bind(START+count+179).run()
    await db.prepare("UPDATE status_revision SET revision=revision+1 WHERE key='status'").run()
    await availabilityStats(metered,[m],START+count+180)
    const total=reads.reduce((a,b)=>a+b,0)
    assert.ok(total<=50,`incremental stats with ${count} history rows: ${total}`)
    assert.equal(reads.length,4,'metadata, revision, all time slices and one checkpoint write')
  }
})
