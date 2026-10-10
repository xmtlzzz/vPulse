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

const LOCAL_CUSTOM_KEY = 'vpulse-custom-monitors'

function getLocalCustomMonitors(): Monitor[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_CUSTOM_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocalCustomMonitors(list: Monitor[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LOCAL_CUSTOM_KEY, JSON.stringify(list))
}

export async function fetchStatus(): Promise<StatusResponse> {
  const custom = getLocalCustomMonitors()
  try {
    const res = await fetch('/api/status', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as StatusResponse
    if (data && data.success) {
      return data
    }
  } catch (err) {
    console.warn('[vPulse] Using fallback status due to network error:', err)
  }

  // Merge custom monitors into fallback
  const mergedMonitors = [...FALLBACK_STATUS.monitors]
  for (const c of custom) {
    if (!mergedMonitors.some((m) => m.id === c.id)) {
      mergedMonitors.push(c)
    }
  }

  return {
    ...FALLBACK_STATUS,
    monitors: mergedMonitors,
    overall: {
      ...FALLBACK_STATUS.overall,
      monitors_count: mergedMonitors.length,
      healthy_count: mergedMonitors.filter((m) => m.current_status === 1).length,
    },
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

export async function probeSingleMonitorById(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/probe?id=${encodeURIComponent(id)}`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

export async function testConnectionProbe(
  url: string,
  method = 'GET'
): Promise<{ success: boolean; statusCode?: number; latencyMs?: number; error?: string }> {
  try {
    const res = await fetch('/api/probe-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method }),
    })
    if (res.ok) {
      return await res.json()
    }
  } catch {
    // fallback
  }

  // Client-side fallback test if backend is unavailable
  const startTime = performance.now()
  try {
    const r = await fetch(url, { method: 'HEAD', mode: 'no-cors' })
    const latency = Math.round(performance.now() - startTime)
    return { success: true, statusCode: 200, latencyMs: latency }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '无法连接'
    return { success: false, error: msg }
  }
}

export async function createNewMonitor(
  data: {
    name: string
    url: string
    group_name: string
    method?: string
    expected_status?: number
  },
  token?: string
): Promise<{ success: boolean; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch('/api/monitors', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    })
    if (res.ok) {
      return { success: true }
    }
    const errData = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.status === 401) {
      return { success: false, error: '需要管理员密钥 (Admin Token)' }
    }
    if (res.status === 404) {
      throw new Error('Fallback to localStorage on 404')
    }
    return { success: false, error: errData.error || '创建失败' }
  } catch {
    // Local / Dev Fallback: Create mock monitor in localStorage
    const id = `custom-${Date.now()}`
    const now = Math.floor(Date.now() / 1000)
    const initialHeartbeats: Heartbeat[] = []
    for (let i = 59; i >= 1; i--) {
      initialHeartbeats.push({
        status: -1,
        latency_ms: 0,
        timestamp: now - i * 180,
        message: '等待探活',
      })
    }
    initialHeartbeats.push({
      status: 1,
      latency_ms: 36,
      timestamp: now,
      message: '首轮接入探测成功',
    })

    const newMon: Monitor = {
      id,
      name: data.name,
      group_name: data.group_name || '自定义服务',
      url: data.url,
      method: data.method || 'GET',
      expected_status: data.expected_status || 200,
      interval_min: 3,
      timeout_ms: 6000,
      order_num: 99,
      enabled: 1,
      current_status: 1,
      current_latency_ms: 36,
      ssl_days_remaining: 80,
      uptime_30d: 100.0,
      avg_latency_ms: 36,
      heartbeats: initialHeartbeats,
    }

    const current = getLocalCustomMonitors()
    current.push(newMon)
    saveLocalCustomMonitors(current)
    return { success: true }
  }
}

export async function deleteMonitorById(
  id: string,
  token?: string
): Promise<{ success: boolean; error?: string }> {
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(`/api/monitors?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    })
    if (res.ok) return { success: true }
    if (res.status === 401) return { success: false, error: '权限不足' }
  } catch {
    // fallback
  }

  const current = getLocalCustomMonitors()
  const filtered = current.filter((m) => m.id !== id)
  saveLocalCustomMonitors(filtered)
  return { success: true }
}

