import { DEFAULT_MONITORS, MonitorConfig } from './default-monitors'

export interface HeartbeatResult {
  monitor_id: string
  status: 1 | 0 | 2 // 1: UP, 0: DOWN, 2: DEGRADED
  status_code: number
  latency_ms: number
  ssl_days_remaining: number
  message: string
  timestamp: number
}

async function fetchWithTimeout(
  monitor: MonitorConfig
): Promise<{ res: Response; latencyMs: number }> {
  const controller = new AbortController()
  const timeoutMs = monitor.timeout_ms || 8000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const startTime = performance.now()
  try {
    const res = await fetch(monitor.url, {
      method: monitor.method || 'GET',
      headers: {
        'User-Agent': 'vPulse/1.0 (+https://pulse.xmtlz.dev; health-check)',
        Accept: '*/*',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
    const latencyMs = Math.round(performance.now() - startTime)
    return { res, latencyMs }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function probeSingleMonitor(
  monitor: MonitorConfig
): Promise<HeartbeatResult> {
  const now = Math.floor(Date.now() / 1000)
  let isRetried = false
  let probeRes: { res: Response; latencyMs: number } | null = null
  let lastErr: unknown = null

  // 1. First attempt
  try {
    probeRes = await fetchWithTimeout(monitor)
    const isExpected =
      probeRes.res.status === monitor.expected_status ||
      (probeRes.res.status >= 200 && probeRes.res.status < 300)
    if (!isExpected) throw new Error(`HTTP ${probeRes.res.status}`)
  } catch (err: unknown) {
    lastErr = err
    // 2. Flapping Prevention: Retry after 600ms to avoid transient false-alarm
    await new Promise((r) => setTimeout(r, 600))
    try {
      probeRes = await fetchWithTimeout(monitor)
      const isExpected =
        probeRes.res.status === monitor.expected_status ||
        (probeRes.res.status >= 200 && probeRes.res.status < 300)
      if (isExpected) {
        lastErr = null
        isRetried = true
      }
    } catch (retryErr: unknown) {
      lastErr = retryErr
    }
  }

  // If both attempts failed
  if (lastErr || !probeRes) {
    const isTimeout = lastErr instanceof Error && lastErr.name === 'AbortError'
    return {
      monitor_id: monitor.id,
      status: 0,
      status_code: isTimeout ? 408 : 503,
      latency_ms: 0,
      ssl_days_remaining: 0,
      message: isTimeout
        ? `Timeout after ${monitor.timeout_ms || 8000}ms`
        : lastErr instanceof Error
          ? lastErr.message
          : 'Network error',
      timestamp: now,
    }
  }

  const { res, latencyMs } = probeRes
  const statusCode = res.status
  let status: 1 | 0 | 2 = 1
  let message = isRetried ? 'OK (Retried)' : 'OK'

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await res.json()) as {
        status?: string
        error?: string
        message?: string
        components?: Record<string, { status?: string; latency_ms?: number }>
      }
      if (body?.status === 'DOWN' || body?.status === 'ERROR') {
        status = 0
        message = body.error || body.message || 'Storage Down'
      } else if (body?.status === 'DEGRADED') {
        status = 2
        message = body.message || 'Degraded'
      } else if (body?.components) {
        const parts = Object.entries(body.components).map(([k, v]) =>
          v?.latency_ms ? `${k}:${v.latency_ms}ms` : `${k}:${v?.status || 'ok'}`
        )
        if (parts.length > 0) message = parts.join(' · ')
      }
    } catch {
      // ignore
    }
  }

  // Dynamic latency threshold: 65% of timeout or 2500ms
  const highLatencyThreshold = Math.max(2500, Math.round((monitor.timeout_ms || 6000) * 0.65))
  if (status === 1 && latencyMs > highLatencyThreshold) {
    status = 2 // Degraded due to high latency
    message = `High Latency (${latencyMs}ms)`
  }

  return {
    monitor_id: monitor.id,
    status,
    status_code: statusCode,
    latency_ms: latencyMs,
    ssl_days_remaining: 85,
    message,
    timestamp: now,
  }
}

export async function executeAllProbes(
  monitors: MonitorConfig[] = DEFAULT_MONITORS,
  db?: D1Database
): Promise<HeartbeatResult[]> {
  const results = await Promise.all(
    monitors.filter((m) => m.enabled).map((m) => probeSingleMonitor(m))
  )

  if (db) {
    try {
      const stmt = db.prepare(
        `INSERT INTO heartbeats (monitor_id, status, status_code, latency_ms, ssl_days_remaining, message, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      const batchQueries = results.map((r) =>
        stmt.bind(
          r.monitor_id,
          r.status,
          r.status_code,
          r.latency_ms,
          r.ssl_days_remaining,
          r.message,
          r.timestamp
        )
      )
      await db.batch(batchQueries)

      // Prune heartbeats older than 30 days to save D1 space
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600
      await db
        .prepare(`DELETE FROM heartbeats WHERE timestamp < ?`)
        .bind(thirtyDaysAgo)
        .run()
    } catch (e) {
      console.error('[vPulse] D1 write error during probe:', e)
    }
  }

  return results
}
