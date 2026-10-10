export type HealthStatus = -1 | 0 | 1 | 2
export interface MonitorConfig {
  id: string
  name: string
  group_name: string
  url: string
  method: 'GET' | 'HEAD'
  expected_status: number
  interval_min: number
  timeout_ms: number
  order_num: number
  enabled: number
  created_at?: number
}
export interface Heartbeat {
  status: HealthStatus
  status_code: number | null
  latency_ms: number | null
  timestamp: number
  message?: string
}
export interface Monitor extends MonitorConfig {
  current_status: HealthStatus
  current_latency_ms: number | null
  uptime_30d: number | null
  coverage_30d: number
  avg_latency_ms: number | null
  last_checked_at: number | null
  next_check_at: number | null
  stale: boolean
  heartbeats: Heartbeat[]
}
export interface OverallStatus {
  status: 'operational' | 'degraded' | 'outage' | 'unknown'
  uptime_30d: number | null
  avg_latency_ms: number | null
  monitors_count: number
  healthy_count: number
  updated_at: number | null
  next_check_at: number | null
}
export interface Incident {
  id: string
  monitor_id?: string | null
  title: string
  description: string
  severity: 'minor' | 'major' | 'maintenance'
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  created_at: number
  updated_at: number
  resolved_at: number | null
}
export interface StatusResponse {
  success: boolean
  overall: OverallStatus
  monitors: Monitor[]
  incidents: Incident[]
}
export interface ProbeResponse {
  success: boolean
  debounced: boolean
  probed_count: number
  cooldown_remaining_sec?: number
  message?: string
}
