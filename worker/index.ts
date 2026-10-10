import { DEFAULT_MONITORS } from './default-monitors'
import { executeAllProbes } from './probe'
import { fetchMonitorsWithHistory, fetchIncidents } from './db'

export interface Env {
  DB?: D1Database
  ASSETS?: Fetcher
  SITE_URL?: string
  APP_NAME?: string
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

export default {
  // ── Scheduled Cron Trigger (Runs probe automatically) ──────────────────────
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(executeAllProbes(DEFAULT_MONITORS, env.DB))
  },

  // ── HTTP Fetch Handler ─────────────────────────────────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
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

    // ── API: /api/probe (Manual Immediate Probe Trigger) ─────────────────────
    if (url.pathname === '/api/probe' && request.method === 'POST') {
      const probeResults = await executeAllProbes(DEFAULT_MONITORS, env.DB)
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
