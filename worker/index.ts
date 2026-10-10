import { DEFAULT_MONITORS } from './default-monitors'
import { executeAllProbes, probeSingleMonitor } from './probe'
import {
  fetchMonitorsWithHistory,
  fetchIncidents,
  getAllMonitors,
  createMonitor,
  removeMonitor,
} from './db'

export interface Env {
  DB?: D1Database
  ASSETS?: Fetcher
  SITE_URL?: string
  APP_NAME?: string
  ADMIN_TOKEN?: string
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

function verifyAuth(request: Request, env: Env): boolean {
  // If ADMIN_TOKEN is not configured on Cloudflare, allow in dev/demo mode
  if (!env.ADMIN_TOKEN) return true
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  return token === env.ADMIN_TOKEN
}

export default {
  // ── Scheduled Cron Trigger (Runs probe automatically) ──────────────────────
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const monitors = await getAllMonitors(env.DB)
    ctx.waitUntil(executeAllProbes(monitors, env.DB))
  },

  // ── HTTP Fetch Handler ─────────────────────────────────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    // ── API: /api/status ────────────────────────────────────────────────────
    if (url.pathname === '/api/status' && request.method === 'GET') {
      const monitors = await fetchMonitorsWithHistory(env.DB)
      const incidents = await fetchIncidents(env.DB)

      const downMonitors = monitors.filter((m) => m.current_status === 0)
      const degradedMonitors = monitors.filter((m) => m.current_status === 2)

      let overallStatus: 'operational' | 'degraded' | 'outage' = 'operational'
      if (downMonitors.length > 0) {
        overallStatus = 'outage'
      } else if (degradedMonitors.length > 0) {
        overallStatus = 'degraded'
      }

      const totalUptime = monitors.reduce((acc, m) => acc + m.uptime_30d, 0)
      const avgUptime30d =
        monitors.length > 0
          ? Math.round((totalUptime / monitors.length) * 100) / 100
          : 100

      const totalLatency = monitors.reduce((acc, m) => acc + m.current_latency_ms, 0)
      const avgLatency =
        monitors.length > 0 ? Math.round(totalLatency / monitors.length) : 0

      return jsonResponse({
        success: true,
        overall: {
          status: overallStatus,
          uptime_30d: avgUptime30d,
          avg_latency_ms: avgLatency,
          monitors_count: monitors.length,
          healthy_count: monitors.filter((m) => m.current_status === 1).length,
          updated_at: Math.floor(Date.now() / 1000),
        },
        monitors,
        incidents,
      })
    }

    // ── API: /api/monitors (Dynamic Monitor Management) ──────────────────────
    if (url.pathname === '/api/monitors') {
      if (request.method === 'GET') {
        const monitors = await getAllMonitors(env.DB)
        return jsonResponse({ success: true, monitors })
      }

      if (request.method === 'POST') {
        if (!verifyAuth(request, env)) {
          return jsonResponse({ error: 'Unauthorized: Invalid Admin Token' }, 401)
        }
        try {
          const body = (await request.json()) as {
            name: string
            url: string
            group_name?: string
            method?: 'GET' | 'HEAD' | 'POST'
            expected_status?: number
          }
          if (!body.name || !body.url) {
            return jsonResponse({ error: 'Name and URL are required' }, 400)
          }

          const newMonitor = await createMonitor(
            { ...body, group_name: body.group_name || '自定义服务' },
            env.DB
          )
          // Run immediate initial probe
          const initialProbe = await probeSingleMonitor(newMonitor)
          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO heartbeats (monitor_id, status, status_code, latency_ms, ssl_days_remaining, message, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
              .bind(
                initialProbe.monitor_id,
                initialProbe.status,
                initialProbe.status_code,
                initialProbe.latency_ms,
                initialProbe.ssl_days_remaining,
                initialProbe.message,
                initialProbe.timestamp
              )
              .run()
          }

          return jsonResponse({ success: true, monitor: newMonitor }, 201)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Invalid request'
          return jsonResponse({ error: msg }, 400)
        }
      }

      if (request.method === 'DELETE') {
        if (!verifyAuth(request, env)) {
          return jsonResponse({ error: 'Unauthorized: Invalid Admin Token' }, 401)
        }
        const id = url.searchParams.get('id')
        if (!id) return jsonResponse({ error: 'Missing monitor id' }, 400)
        await removeMonitor(id, env.DB)
        return jsonResponse({ success: true, deleted_id: id })
      }
    }

    // ── API: /api/probe (Manual Immediate Probe Trigger) ─────────────────────
    if (url.pathname === '/api/probe' && request.method === 'POST') {
      const monitors = await getAllMonitors(env.DB)
      const probeResults = await executeAllProbes(monitors, env.DB)
      return jsonResponse({
        success: true,
        probed_count: probeResults.length,
        results: probeResults,
      })
    }

    // ── API: /api/health (Self Health Check) ─────────────────────────────────
    if (url.pathname === '/api/health') {
      return jsonResponse({
        status: 'UP',
        service: 'vPulse Edge Worker',
        timestamp: Math.floor(Date.now() / 1000),
      })
    }

    // ── Fallback to Cloudflare Static Assets (SPA) ──────────────────────────
    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('vPulse Edge API is running. Build and deploy frontend assets.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
