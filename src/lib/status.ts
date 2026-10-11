import type { Monitor, StatusResponse, OverallStatus } from '../types'
import { nextScheduledCheck } from './schedule'

export function groupMonitors(monitors: Monitor[]): Map<string, Monitor[]> {
  const groups = new Map<string, Monitor[]>()
  for (const monitor of monitors) {
    const name = monitor.group_name || '其他服务'
    const list = groups.get(name) ?? []
    list.push(monitor)
    groups.set(name, list)
  }
  return groups
}

export function markUnavailable(data: StatusResponse): StatusResponse {
  return {
    ...data,
    success: false,
    overall: { ...data.overall, status: 'unknown', healthy_count: 0, avg_latency_ms: null },
    monitors: data.monitors.map((m) => ({
      ...m,
      stale: true,
      current_status: -1,
      current_latency_ms: null,
    })),
  }
}

export function remainingSeconds(nextCheck: number | null, now: number): number | null {
  return nextCheck === null ? null : Math.max(0, nextCheck - now)
}

export function overallStatus(allMonitors: Monitor[]): OverallStatus {
  const now = Math.floor(Date.now() / 1000)
  const monitors = allMonitors.filter((m) => m.enabled !== 0 && (m.maintenance_until ?? 0) <= now)
  const measured = monitors.filter((m) => m.uptime_30d !== null)
  const latencies = monitors.filter((m) => m.current_latency_ms !== null && m.current_status !== 0)
  const checked = monitors.map((m) => m.last_checked_at).filter((n): n is number => n !== null)
  const next = monitors.map((m) => m.next_check_at).filter((n): n is number => n !== null)
  return {
    status: monitors.some((m) => m.current_status === 0)
      ? 'outage'
      : !monitors.length || monitors.some((m) => m.current_status === -1)
        ? 'unknown'
        : monitors.some((m) => m.current_status === 2)
          ? 'degraded'
          : 'operational',
    uptime_30d: measured.length
      ? Math.round((measured.reduce((s, m) => s + m.uptime_30d!, 0) / measured.length) * 100) / 100
      : null,
    avg_latency_ms: latencies.length
      ? Math.round(latencies.reduce((s, m) => s + m.current_latency_ms!, 0) / latencies.length)
      : null,
    monitors_count: monitors.length,
    healthy_count: monitors.filter((m) => m.current_status === 1).length,
    updated_at: checked.length ? Math.min(...checked) : null,
    next_check_at: next.length ? Math.min(...next) : null,
  }
}

export function projectFreshness(data: StatusResponse, now: number): StatusResponse {
  if (!data.success) return data
  const monitors = data.monitors.map((m) => {
    const suppressed = m.enabled === 0 || (m.maintenance_until ?? 0) > now
    const expired =
      suppressed ||
      m.last_checked_at === null ||
      now >
        nextScheduledCheck(m.last_checked_at, m.interval_min) +
          Math.max(60, Math.ceil((m.timeout_ms * 2) / 1000))
    const latest = m.heartbeats.at(-1)
    return {
      ...m,
      stale: expired,
      current_status: expired ? (-1 as const) : (latest?.status ?? m.current_status),
      current_latency_ms: expired ? null : (latest?.latency_ms ?? m.current_latency_ms),
      next_check_at:
        suppressed || m.last_checked_at === null
          ? null
          : nextScheduledCheck(m.last_checked_at, m.interval_min),
    }
  })
  return { ...data, monitors, overall: overallStatus(monitors) }
}
