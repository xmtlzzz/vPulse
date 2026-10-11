import type { StatusResponse, ProbeResponse, MonitorOptions } from '../types'
import { getLegacyAdminToken, clearLegacyAdminToken } from './storage'

export const EMPTY_STATUS: StatusResponse = {
  success: false,
  overall: {
    status: 'unknown',
    uptime_30d: null,
    avg_latency_ms: null,
    monitors_count: 0,
    healthy_count: 0,
    updated_at: null,
    next_check_at: null,
  },
  monitors: [],
  incidents: [],
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  const secret = (token ?? '').trim()
  if (secret) headers.set('Authorization', `Bearer ${secret}`)
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers,
    signal: options.signal ?? AbortSignal.timeout(240000),
  })
  const data: unknown = await response.json().catch(() => null)
  if (
    !response.ok ||
    !data ||
    typeof data !== 'object' ||
    !('success' in data) ||
    data.success !== true
  ) {
    const error =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `请求失败（HTTP ${response.status}）`
    throw new Error(error)
  }
  return data as T
}

export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const data = await apiRequest<StatusResponse>('/api/status', {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  })
  if (!data.overall || !Array.isArray(data.monitors) || !Array.isArray(data.incidents))
    throw new Error('状态接口返回的数据格式无效')
  return data
}

export async function confirmAdminSession(token: string): Promise<void> {
  if (!token.trim()) throw new Error('请输入管理员密钥')
  await apiRequest('/api/session', { method: 'POST' }, token)
  clearLegacyAdminToken()
}

async function migrateLegacySession(): Promise<void> {
  const token = getLegacyAdminToken()
  if (token) await confirmAdminSession(token)
}

export async function triggerProbe(): Promise<ProbeResponse> {
  await migrateLegacySession()
  return apiRequest('/api/probe', { method: 'POST' })
}
export async function probeSingleMonitorById(id: string): Promise<ProbeResponse> {
  await migrateLegacySession()
  return apiRequest(`/api/probe?id=${encodeURIComponent(id)}`, { method: 'POST' })
}

export async function testConnectionProbe(
  url: string,
  method = 'GET',
  expected_status = 200,
  token?: string,
  options: MonitorOptions & { timeout_ms?: number } = {}
): Promise<{ success: boolean; statusCode?: number; latencyMs?: number; error?: string }> {
  try {
    if (!token) await migrateLegacySession()
    return await apiRequest(
      '/api/probe-test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, expected_status, ...options }),
      },
      token
    )
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '连接测试失败' }
  }
}

type OperationResult = { success: boolean; error?: string }
export async function createNewMonitor(
  data: MonitorOptions & {
    name: string
    url: string
    group_name: string
    method?: string
    expected_status?: number
    interval_min?: number
    timeout_ms?: number
  },
  token?: string
): Promise<OperationResult> {
  try {
    if (!token?.trim()) throw new Error('添加项目需要重新输入管理员密钥确认')
    await apiRequest(
      '/api/monitors',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      token
    )
    clearLegacyAdminToken()
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '创建失败' }
  }
}
export async function deleteMonitorById(id: string, token?: string): Promise<OperationResult> {
  try {
    if (!token) await migrateLegacySession()
    await apiRequest(`/api/monitors?id=${encodeURIComponent(id)}`, { method: 'DELETE' }, token)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '删除失败' }
  }
}
