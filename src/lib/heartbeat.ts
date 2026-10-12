import type { Heartbeat } from '../types'

export const HEARTBEAT_SLOTS = 60

export function heartbeatWindow(heartbeats: Heartbeat[]) {
  const recent = heartbeats.slice(-HEARTBEAT_SLOTS)
  const records = recent.filter(beat => beat.status !== -1)
  const slots: Heartbeat[] = [
    ...Array.from({ length: HEARTBEAT_SLOTS - recent.length }, () => ({
      status: -1 as const, latency_ms: null, status_code: null,
      timestamp: 0, message: '等待探测',
    })),
    ...recent,
  ]
  const successPercent = records.length
    ? records.filter(beat => beat.status === 1).length / records.length * 100
    : null
  return { slots, records, successPercent }
}
