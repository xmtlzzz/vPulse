import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_MONITORS, MonitorConfig } from '../worker/default-monitors'
import { probeSingleMonitor } from '../worker/probe'
import { Monitor, Heartbeat } from './types'

function generateMockHeartbeats(baseLatency: number): Heartbeat[] {
  const heartbeats: Heartbeat[] = []
  const now = Math.floor(Date.now() / 1000)
  for (let i = 59; i >= 0; i--) {
    const timestamp = now - i * 180
    const jitter = Math.floor(Math.sin(i * 0.5) * 10 + (i % 5))
    heartbeats.push({
      status: 1,
      latency_ms: Math.max(15, baseLatency + jitter),
      timestamp,
      message: 'OK',
    })
  }
  return heartbeats
}

function generateInitialBlankHeartbeats(
  latestProbe: { status: 1 | 0 | 2; latency_ms: number; timestamp: number; message: string }
): Heartbeat[] {
  const heartbeats: Heartbeat[] = []
  const now = latestProbe.timestamp
  // 59 unprobed blank slots
  for (let i = 59; i >= 1; i--) {
    heartbeats.push({
      status: -1,
      latency_ms: 0,
      timestamp: now - i * 180,
      message: '等待探活',
    })
  }
  // 1 fresh real probe result at the tail
  heartbeats.push({
    status: latestProbe.status,
    latency_ms: latestProbe.latency_ms,
    timestamp: latestProbe.timestamp,
    message: latestProbe.message,
  })
  return heartbeats
}

let devMonitors: Monitor[] = [
  {
    id: 'vmaker',
    name: 'vMaker 创意作品集',
    group_name: '核心站点 (Portals)',
    url: 'https://vmaker.xmtlz.dev',
    method: 'GET',
    expected_status: 200,
    interval_min: 3,
    timeout_ms: 6000,
    order_num: 1,
    enabled: 1,
    current_status: 1,
    current_latency_ms: 42,
    ssl_days_remaining: 85,
    uptime_30d: 100.0,
    avg_latency_ms: 38,
    heartbeats: generateMockHeartbeats(38),
  },
  {
    id: 'vblog',
    name: 'vBlog 个人独立博客',
    group_name: '核心站点 (Portals)',
    url: 'https://vblog.xmtlz.dev',
    method: 'GET',
    expected_status: 200,
    interval_min: 3,
    timeout_ms: 6000,
    order_num: 2,
    enabled: 1,
    current_status: 1,
    current_latency_ms: 56,
    ssl_days_remaining: 82,
    uptime_30d: 99.98,
    avg_latency_ms: 54,
    heartbeats: generateMockHeartbeats(54),
  },
  {
    id: 'vblog-api',
    name: 'vBlog D1 边缘健康探针',
    group_name: '边缘服务与存储 (Edge & Storage)',
    url: 'https://vblog.xmtlz.dev/api/health',
    method: 'GET',
    expected_status: 200,
    interval_min: 3,
    timeout_ms: 5000,
    order_num: 3,
    enabled: 1,
    current_status: 1,
    current_latency_ms: 22,
    ssl_days_remaining: 82,
    uptime_30d: 100.0,
    avg_latency_ms: 20,
    heartbeats: generateMockHeartbeats(20),
  },
]

let isDevProbing = false
async function executeDevProbes() {
  if (isDevProbing) return
  isDevProbing = true
  try {
    for (const m of devMonitors) {
      if (!m.enabled) continue
      const r = await probeSingleMonitor({
        ...m,
        method: (m.method as 'GET' | 'HEAD' | 'POST') || 'GET',
      })
      m.current_status = r.status
      m.current_latency_ms = r.latency_ms
      if (r.ssl_days_remaining) {
        m.ssl_days_remaining = r.ssl_days_remaining
      }
      m.heartbeats.push({
        status: r.status,
        latency_ms: r.latency_ms,
        timestamp: r.timestamp,
        message: r.message,
      })
      if (m.heartbeats.length > 60) {
        m.heartbeats.shift()
      }
      const realBeats = m.heartbeats.filter((h) => h.status !== -1)
      if (realBeats.length > 0) {
        const upCount = realBeats.filter((h) => h.status === 1).length
        m.uptime_30d = Math.round((upCount / realBeats.length) * 10000) / 100
        const totalLat = realBeats.reduce((acc, h) => acc + h.latency_ms, 0)
        m.avg_latency_ms = Math.round(totalLat / realBeats.length)
      }
    }
  } catch (err) {
    console.warn('[vPulse Dev] Auto probe error:', err)
  } finally {
    isDevProbing = false
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

function sendJson(res: ServerResponse, data: any, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

export function edgeApiDevPlugin(): Plugin {
  return {
    name: 'vpulse-edge-api-dev-middleware',
    configureServer(server) {
      // 1. Initial live probe 1.5s after boot
      setTimeout(() => {
        void executeDevProbes()
      }, 1500)

      // 2. Automated continuous background probe every 60s
      const autoProbeTimer = setInterval(() => {
        void executeDevProbes()
      }, 60000)

      server.httpServer?.on('close', () => {
        clearInterval(autoProbeTimer)
      })

      server.middlewares.use(async (req, res, next) => {
        const urlStr = req.url || ''
        const [path, queryStr] = urlStr.split('?')
        const params = new URLSearchParams(queryStr || '')

        // ── GET /api/status ──────────────────────────────────────────────
        if (path === '/api/status' && req.method === 'GET') {
          const down = devMonitors.filter((m) => m.current_status === 0)
          const degraded = devMonitors.filter((m) => m.current_status === 2)
          const status = down.length > 0 ? 'outage' : degraded.length > 0 ? 'degraded' : 'operational'

          const totalUptime = devMonitors.reduce((acc, m) => acc + m.uptime_30d, 0)
          const avgUptime =
            devMonitors.length > 0 ? Math.round((totalUptime / devMonitors.length) * 100) / 100 : 100
          const totalLat = devMonitors.reduce((acc, m) => acc + m.current_latency_ms, 0)
          const avgLat = devMonitors.length > 0 ? Math.round(totalLat / devMonitors.length) : 0

          return sendJson(res, {
            success: true,
            overall: {
              status,
              uptime_30d: avgUptime,
              avg_latency_ms: avgLat,
              monitors_count: devMonitors.length,
              healthy_count: devMonitors.filter((m) => m.current_status === 1).length,
              updated_at: Math.floor(Date.now() / 1000),
            },
            monitors: devMonitors,
            incidents: [],
          })
        }

        // ── POST /api/monitors ───────────────────────────────────────────
        if (path === '/api/monitors' && req.method === 'POST') {
          const body = await readBody(req)
          if (!body.name || !body.url) {
            return sendJson(res, { error: 'Name and URL are required' }, 400)
          }

          const id =
            body.name
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '') || `mon-${Date.now()}`

          const monConfig: MonitorConfig = {
            id,
            name: body.name,
            group_name: body.group_name || '自定义服务',
            url: body.url,
            method: body.method || 'GET',
            expected_status: body.expected_status || 200,
            interval_min: 3,
            timeout_ms: 6000,
            order_num: devMonitors.length + 1,
            enabled: 1,
          }

          // Probe in real-time right now!
          const probeResult = await probeSingleMonitor(monConfig)
          const heartbeats = generateInitialBlankHeartbeats(probeResult)

          const newMonitor: Monitor = {
            ...monConfig,
            current_status: probeResult.status,
            current_latency_ms: probeResult.latency_ms,
            ssl_days_remaining: probeResult.ssl_days_remaining || 80,
            uptime_30d: probeResult.status === 1 ? 100.0 : 0.0,
            avg_latency_ms: probeResult.latency_ms,
            heartbeats,
          }

          devMonitors.push(newMonitor)
          return sendJson(res, { success: true, monitor: newMonitor }, 201)
        }

        // ── DELETE /api/monitors ─────────────────────────────────────────
        if (path === '/api/monitors' && req.method === 'DELETE') {
          const id = params.get('id')
          if (!id) return sendJson(res, { error: 'Missing monitor id' }, 400)
          devMonitors = devMonitors.filter((m) => m.id !== id)
          return sendJson(res, { success: true, deleted_id: id })
        }

        // ── POST /api/probe ──────────────────────────────────────────────
        if (path === '/api/probe' && req.method === 'POST') {
          const targetId = params.get('id')
          if (targetId) {
            const target = devMonitors.find((m) => m.id === targetId)
            if (!target) return sendJson(res, { error: 'Monitor not found' }, 404)
            const r = await probeSingleMonitor({
              ...target,
              method: (target.method as 'GET' | 'HEAD' | 'POST') || 'GET',
            })
            target.current_status = r.status
            target.current_latency_ms = r.latency_ms
            target.heartbeats.push({
              status: r.status,
              latency_ms: r.latency_ms,
              timestamp: r.timestamp,
              message: r.message,
            })
            if (target.heartbeats.length > 60) target.heartbeats.shift()
            return sendJson(res, { success: true, monitor: target, result: r })
          }

          const results = await Promise.all(
            devMonitors.map(async (m) => {
              const r = await probeSingleMonitor({
                ...m,
                method: (m.method as 'GET' | 'HEAD' | 'POST') || 'GET',
              })
              m.current_status = r.status
              m.current_latency_ms = r.latency_ms
              m.heartbeats.push({
                status: r.status,
                latency_ms: r.latency_ms,
                timestamp: r.timestamp,
                message: r.message,
              })
              if (m.heartbeats.length > 60) m.heartbeats.shift()
              return r
            })
          )
          return sendJson(res, { success: true, probed_count: results.length })
        }

        // ── POST /api/probe-test (Live Connection Test Preview) ──────────
        if (path === '/api/probe-test' && req.method === 'POST') {
          const body = await readBody(req)
          if (!body.url) return sendJson(res, { error: 'URL is required' }, 400)
          const startTime = performance.now()
          try {
            const resp = await fetch(body.url, {
              method: body.method || 'GET',
              signal: AbortSignal.timeout(6000),
              headers: { 'User-Agent': 'vPulse-HealthCheck/1.0' },
            })
            const latency = Math.round(performance.now() - startTime)
            return sendJson(res, {
              success: true,
              statusCode: resp.status,
              latencyMs: latency,
              statusText: resp.statusText,
            })
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '连接超时或网络错误'
            return sendJson(res, {
              success: false,
              error: msg,
            })
          }
        }

        // ── GET /api/health ──────────────────────────────────────────────
        if (path === '/api/health') {
          return sendJson(res, {
            status: 'UP',
            service: 'vPulse Vite Dev Server',
            timestamp: Math.floor(Date.now() / 1000),
          })
        }

        next()
      })
    },
  }
}
