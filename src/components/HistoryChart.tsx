import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { HistoryResponse } from '../types'
import { historySegments } from '../lib/history-chart'
import { formatDateTime, formatLatency } from '../lib/format'

export function HistoryChart({
  data,
  name,
  intervalMin,
}: {
  data: HistoryResponse
  name: string
  intervalMin: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)
  const gradient = useId().replace(/:/g, '')
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width))
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setActive(null), [data])
  const segments = useMemo(
    () => historySegments(data.points, data.bucket_seconds, intervalMin),
    [data, intervalMin]
  )
  const left = 46,
    right = width - 14,
    top = 18,
    bottom = 212,
    height = 248
  const max = Math.max(1, ...data.points.map((p) => p.latency_ms ?? 0)) * 1.15
  const x = (timestamp: number) =>
    left +
    ((Math.max(data.from, timestamp) - data.from) / Math.max(1, data.to - data.from)) *
      (right - left)
  const y = (latency: number) => bottom - (latency / max) * (bottom - top)
  const selected = active === null ? null : data.points[active]
  const ticks = width < 420 ? 3 : 5
  const time = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleString(
      'zh-CN',
      data.to - data.from > 86400
        ? { month: '2-digit', day: '2-digit' }
        : { hour: '2-digit', minute: '2-digit', hour12: false }
    )
  return (
    <div ref={container} className="history-chart-wrap">
      <svg
        className="history-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        tabIndex={0}
        aria-label={`${name}响应延迟趋势。左右方向键查看采样，缺测处断开。`}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setActive((n) =>
            Math.max(
              0,
              Math.min(data.points.length - 1, (n ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))
            )
          )
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const target = ((event.clientX - rect.left) / rect.width) * width
          let nearest = 0
          data.points.forEach((p, i) => {
            if (
              Math.abs(x(p.timestamp) - target) <
              Math.abs(x(data.points[nearest].timestamp) - target)
            )
              nearest = i
          })
          setActive(nearest)
        }}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--pulse-emerald)" stopOpacity=".22" />
            <stop offset="100%" stopColor="var(--pulse-emerald)" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="history-grid" x1={left} x2={right} y1={y(max * f)} y2={y(max * f)} />
            <text x={left - 10} y={y(max * f) + 4} textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {segments.map((segment, i) => {
          const path = segment
            .map((p, j) => `${j ? 'L' : 'M'}${x(p.timestamp)},${y(p.latency_ms!)}`)
            .join(' ')
          return (
            <g key={i}>
              {segment.length > 1 ? (
                <>
                  <path
                    d={`${path} L${x(segment.at(-1)!.timestamp)},${bottom} L${x(segment[0].timestamp)},${bottom} Z`}
                    fill={`url(#${gradient})`}
                  />
                  <path d={path} className="history-trend" />
                </>
              ) : (
                <line
                  x1={x(segment[0].timestamp) - 3}
                  x2={x(segment[0].timestamp) + 3}
                  y1={y(segment[0].latency_ms!)}
                  y2={y(segment[0].latency_ms!)}
                  className="history-trend"
                />
              )}
            </g>
          )
        })}
        {data.points
          .filter((p) => p.failures > 0)
          .map((p) => (
            <line
              key={p.timestamp}
              x1={x(p.timestamp)}
              x2={x(p.timestamp)}
              y1={bottom - 5}
              y2={bottom}
              stroke="var(--pulse-rose)"
              strokeWidth="3"
            />
          ))}
        {Array.from({ length: ticks }, (_, i) => (
          <text
            key={i}
            x={left + (i / (ticks - 1)) * (right - left)}
            y={height - 10}
            textAnchor={i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle'}
          >
            {time(data.from + (i / (ticks - 1)) * (data.to - data.from))}
          </text>
        ))}
        {selected && (
          <g>
            <line
              x1={x(selected.timestamp)}
              x2={x(selected.timestamp)}
              y1={top}
              y2={bottom}
              stroke="var(--pulse-text-dim)"
              strokeDasharray="3 4"
            />
            {selected.latency_ms !== null && (
              <circle
                cx={x(selected.timestamp)}
                cy={y(selected.latency_ms)}
                r="4"
                fill="var(--pulse-emerald)"
                stroke="var(--pulse-card)"
                strokeWidth="2"
              />
            )}
          </g>
        )}
      </svg>
      <div className="history-chart-detail" aria-live="polite">
        {selected ? (
          <>
            <time>{formatDateTime(selected.timestamp)}</time>
            <span>
              均值{' '}
              <strong>
                {formatLatency(
                  selected.latency_ms === null ? null : Math.round(selected.latency_ms)
                )}
              </strong>
            </span>
            <span>
              范围 {formatLatency(selected.min_ms)} – {formatLatency(selected.max_ms)}
            </span>
            <span>
              {selected.count} 次 / {selected.failures} 次失败
            </span>
          </>
        ) : (
          <>
            <span className="history-key">响应延迟均值</span>
            <span className="history-key failure">含失败的时段</span>
            <span>移动指针、触摸或用方向键查看采样</span>
          </>
        )}
      </div>
    </div>
  )
}
