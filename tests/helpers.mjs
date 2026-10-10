import { build } from 'esbuild'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function load(entry) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
  const directory = mkdtempSync(join(tmpdir(), 'vpulse-test-'))
  const file = join(directory, 'bundle.mjs')
  writeFileSync(file, output.outputFiles[0].text)
  try { return await import(pathToFileURL(file).href) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

export function database() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(readFileSync('schema.sql', 'utf8'))
  if (existsSync('migrations')) {
    for (const file of readdirSync('migrations').sort()) sql.exec(readFileSync(`migrations/${file}`, 'utf8'))
  }
  sql.exec('DELETE FROM monitors')
  const db = {
    prepare(query) {
      return {
        query, values: [],
        bind(...values) { return { ...this, values } },
        async all() { return { success: true, results: sql.prepare(query).all(...this.values), meta: { changes: 0 } } },
        async first() { return sql.prepare(query).get(...this.values) ?? null },
        async run() { const r = sql.prepare(query).run(...this.values); return { success: true, meta: { changes: Number(r.changes) } } },
      }
    },
    async batch(statements) {
      sql.exec('BEGIN')
      try { const results = statements.map(s => ({ success: true, results: sql.prepare(s.query).all(...s.values) })); sql.exec('COMMIT'); return results }
      catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { sql, db, close: () => sql.close() }
}

export function seed(sql, overrides = {}) {
  const m = { id: 'audit', name: 'Audit', group_name: 'Audit', url: 'https://example.com', method: 'GET', expected_status: 200, interval_min: 3, timeout_ms: 100, order_num: 1, enabled: 1, created_at: Math.floor(Date.now() / 1000) - 86400 * 30, ...overrides }
  sql.prepare('INSERT INTO monitors(id,name,group_name,url,method,expected_status,interval_min,timeout_ms,order_num,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(m))
  return m
}

export function beat(sql, id, status, timestamp, code = 200) {
  sql.prepare('INSERT INTO heartbeats(monitor_id,status,status_code,latency_ms,message,timestamp) VALUES(?,?,?,?,?,?)').run(id, status, code, status === 0 ? null : 20, 'test', timestamp)
}

export function context() { return { tasks: [], waitUntil(task) { this.tasks.push(task) } } }

// Model public DNS separately so probe assertions count target requests only.
export function dnsResponse(url, records = { A: ['93.184.216.34'], AAAA: [] }) {
  const query = new URL(url)
  const type = query.searchParams.get('type')
  return Response.json({ Status: 0, Answer: (records[type] ?? []).map(data => ({ type: type === 'A' ? 1 : 28, data })) })
}
export function mockNetwork(t, handler) {
  return t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (new URL(url, 'https://pulse.example').hostname === 'cloudflare-dns.com') return dnsResponse(url)
    return handler(url, init)
  })
}
export function request(path, method = 'GET', body, token = 'audit-secret') {
  return new Request(`https://pulse.example${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
