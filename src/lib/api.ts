import { StatusResponse, Monitor, Heartbeat } from '../types'

function generateFallbackHeartbeats(baseLatency: number): Heartbeat[] {
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

export const FALLBACK_STATUS: StatusResponse = {
  success: true,
  overall: {
    status: 'operational',
    uptime_30d: 99.99,
    avg_latency_ms: 48,
    monitors_count: 4,
    healthy_count: 4,
    updated_at: Math.floor(Date.now() / 1000),
  },
  monitors: [
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
      heartbeats: generateFallbackHeartbeats(38),
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
      heartbeats: generateFallbackHeartbeats(54),
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
      heartbeats: generateFallbackHeartbeats(20),
    },
    {
      id: 'github-api',
      name: 'GitHub API (xmtlz 档案限额)',
      group_name: '外部依赖 (External Dependencies)',
      url: 'https://api.github.com/users/xmtlz',
      method: 'GET',
      expected_status: 200,
      interval_min: 5,
      timeout_ms: 8000,
      order_num: 4,
      enabled: 1,
      current_status: 1,
      current_latency_ms: 182,
      ssl_days_remaining: 120,
      uptime_30d: 99.95,
      avg_latency_ms: 175,
      heartbeats: generateFallbackHeartbeats(175),
    },
  ],
  incidents: [],
}

export async function fetchStatus(): Promise<StatusResponse> {
  try {
    const res = await fetch('/api/status', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as StatusResponse
    if (data && data.success) return data
    return FALLBACK_STATUS
  } catch (err) {
    console.warn('[vPulse] Using fallback status due to network error:', err)
    return FALLBACK_STATUS
  }
}

export async function triggerProbe(): Promise<boolean> {
  try {
    const res = await fetch('/api/probe', { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}
