export type HealthStatus = 1 | 0 | 2 // 1: UP (正常), 0: DOWN (宕机), 2: DEGRADED (高延迟或非预期状态)

export interface Heartbeat {
  status: HealthStatus
  latency_ms: number
  timestamp: number
  message?: string
}

export interface Monitor {
  id: string
  name: string
  group_name: string
  url: string
  method: string
  expected_status: number
  interval_min: number
  timeout_ms: number
  order_num: number
  enabled: number
  current_status: HealthStatus
  current_latency_ms: number
  ssl_days_remaining: number
  uptime_30d: number
  avg_latency_ms: number
  heartbeats: Heartbeat[]
}

export interface OverallStatus {
  status: 'operational' | 'degraded' | 'outage'
  uptime_30d: number
  avg_latency_ms: number
  monitors_count: number
  healthy_count: number
  updated_at: number
}

export interface Incident {
  id: string
  title: string
  description: string
  severity: 'minor' | 'major' | 'maintenance'
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  created_at: number
  updated_at: number
  resolved_at?: number
}

export interface StatusResponse {
  success: boolean
  overall: OverallStatus
  monitors: Monitor[]
  incidents: Incident[]
}
