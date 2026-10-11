import type { HistoryResponse } from '../types'

export type HistoryPoint = HistoryResponse['points'][number]

export function historySegments(
  points: HistoryPoint[],
  bucketSeconds: number,
  intervalMin: number
): HistoryPoint[][] {
  // Cron runs every three minutes; bucket quantization may shift a sample by one bucket.
  const cadence = Math.ceil(intervalMin / 3) * 180
  const maxGap = Math.max(
    bucketSeconds * 1.5,
    Math.ceil(cadence / bucketSeconds) * bucketSeconds * 1.1
  )
  const segments: HistoryPoint[][] = []
  let segment: HistoryPoint[] = []
  for (const point of points) {
    if (point.latency_ms === null || !Number.isFinite(point.latency_ms)) {
      segment = []
      continue
    }
    const previous = segment.at(-1)
    if (!previous || point.timestamp - previous.timestamp > maxGap) {
      segment = []
      segments.push(segment)
    }
    segment.push(point)
  }
  return segments
}

export function historySummary(points: HistoryPoint[]) {
  const measured = points.filter((p) => p.latency_ms !== null)
  return {
    average: measured.length
      ? measured.reduce((sum, p) => sum + p.latency_ms!, 0) / measured.length
      : null,
    samples: points.reduce((sum, p) => sum + p.count, 0),
    failures: points.reduce((sum, p) => sum + p.failures, 0),
  }
}
