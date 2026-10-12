import React, { useState } from 'react'
import { Heartbeat } from '../types'
import { heartbeatWindow } from '../lib/heartbeat'
import { formatDateTime, formatRelativeTime, formatLatency, formatUptimePercent } from '../lib/format'

interface HeartbeatBarProps {
  heartbeats: Heartbeat[]
  isRefreshing?: boolean
}

export const HeartbeatBar: React.FC<HeartbeatBarProps> = ({
  heartbeats,
  isRefreshing = false,
}) => {
  const [hoveredBeat, setHoveredBeat] = useState<{
    beat: Heartbeat
    x: number
    index: number
  } | null>(null)

  const { slots, records: realSlots, successPercent } = heartbeatWindow(heartbeats)

  return (
    <div className="relative w-full">
      {/* Tooltip on hover */}
      {hoveredBeat && (
        <div
          className="pointer-events-none absolute top-full mt-2 z-30 -translate-x-1/2 w-56 max-w-full rounded-lg border border-[var(--pulse-border-hover)] bg-[var(--pulse-card)] px-2.5 py-1 text-xs shadow-xl"
          style={{ left: `clamp(min(7rem, 50%), ${hoveredBeat.x}%, max(calc(100% - 7rem), 50%))` }}
        >
          {hoveredBeat.beat.status === -1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--pulse-text-dim)]" />
              <span className="text-[var(--pulse-text-dim)]">等待探活队列</span>
              <span className="text-[var(--pulse-text-dim)]">·</span>
              <span className="text-[var(--pulse-text-muted)]">
                尚无记录
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  hoveredBeat.beat.status === 1
                    ? 'bg-emerald-500'
                    : hoveredBeat.beat.status === 2
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                }`}
              />
              <span className="font-mono-numeric font-medium text-[var(--pulse-text)]">
                {formatLatency(hoveredBeat.beat.latency_ms)}
              </span>
              <span className="text-[var(--pulse-text-dim)]">·</span>
              <span className="text-[var(--pulse-text-muted)]">
                {formatDateTime(hoveredBeat.beat.timestamp)}
              </span>
              <span className="text-[var(--pulse-text-dim)]">
                ({formatRelativeTime(hoveredBeat.beat.timestamp)})
              </span>
            </div>
          )}
          <p className="mt-1 break-words text-[var(--pulse-text-muted)]">{hoveredBeat.beat.status_code !== null ? `HTTP ${hoveredBeat.beat.status_code} · ` : ''}{hoveredBeat.beat.message}</p>
        </div>
      )}

      {/* The 60-slot Capsule Pill Strip Container */}
      <div className="relative overflow-hidden rounded-xs">
        {/* Radar Scanning Line during Refresh */}
        {isRefreshing && <div className="radar-scan-line" />}

        <div
          className="flex h-8 items-center justify-between gap-[3px] py-1"
          onMouseLeave={() => setHoveredBeat(null)}
        >
          {slots.map((beat, idx) => {
            const isBlank = beat.status === -1
            const isUp = beat.status === 1
            const isDegraded = beat.status === 2
            const isLatest = idx === slots.length - 1

            const barColor = isBlank
              ? 'bg-[var(--pulse-border)]/40 hover:bg-[var(--pulse-border)]/70'
              : isUp
                ? 'bg-emerald-500 hover:bg-emerald-400'
                : isDegraded
                  ? 'bg-amber-500 hover:bg-amber-400'
                  : 'bg-rose-500 hover:bg-rose-400'

            return (
              <div
                key={`${beat.timestamp}-${idx}`}
                style={
                  isRefreshing
                    ? { animationDelay: `${(idx % 15) * 60}ms` }
                    : undefined
                }
                onPointerDown={(e) => { if (e.pointerType !== 'mouse') setHoveredBeat({ beat, x: (idx + 0.5) / slots.length * 100, index: idx }) }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.parentElement?.getBoundingClientRect()
                  const beatRect = e.currentTarget.getBoundingClientRect()
                  if (rect) {
                    const relativeX =
                      ((beatRect.left + beatRect.width / 2 - rect.left) / rect.width) *
                      100
                    setHoveredBeat({ beat, x: relativeX, index: idx })
                  }
                }}
                title={isBlank ? '等待探测' : `${formatDateTime(beat.timestamp)} · ${beat.status_code === null ? '无 HTTP 响应' : `HTTP ${beat.status_code}`} · ${beat.message || ''}`}
                className={`heartbeat-capsule flex-1 h-6 cursor-pointer rounded-xs ${barColor} ${
                  isRefreshing ? 'capsule-refreshing' : isLatest && !isBlank ? 'latest-slot-ping' : ''
                }`}
              />
            )
          })}
        </div>
      </div>

      {/* Labels below strip */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--pulse-text-dim)]">
        <span>{realSlots.length ? formatRelativeTime(realSlots[0].timestamp) : '等待首次探测'}</span>
        <span className="font-mono-numeric font-medium text-emerald-500">
          {realSlots.length
            ? `最近 ${realSlots.length} 次成功率 ${formatUptimePercent(successPercent)}`
            : '暂无真实探测记录'}
        </span>
        <span>{realSlots.length ? formatRelativeTime(realSlots.at(-1)!.timestamp) : '暂无记录'}</span>
      </div>
    </div>
  )
}
