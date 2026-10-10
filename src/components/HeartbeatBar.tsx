import React, { useState } from 'react'
import { Heartbeat } from '../types'
import { formatDateTime, formatRelativeTime } from '../lib/format'

interface HeartbeatBarProps {
  heartbeats: Heartbeat[]
  uptimePercent: number
}

export const HeartbeatBar: React.FC<HeartbeatBarProps> = ({
  heartbeats,
  uptimePercent,
}) => {
  const [hoveredBeat, setHoveredBeat] = useState<{
    beat: Heartbeat
    x: number
    index: number
  } | null>(null)

  // Ensure we have up to 60 slots
  const slots = heartbeats.slice(-60)

  return (
    <div className="relative w-full">
      {/* Tooltip on hover */}
      {hoveredBeat && (
        <div
          className="pointer-events-none absolute -top-12 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--pulse-border-hover)] bg-[var(--pulse-card)] px-2.5 py-1 text-xs shadow-xl backdrop-blur-md"
          style={{ left: `${Math.max(8, Math.min(92, hoveredBeat.x))}%` }}
        >
          <div className="flex items-center gap-2">
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
              {hoveredBeat.beat.latency_ms} ms
            </span>
            <span className="text-[var(--pulse-text-dim)]">·</span>
            <span className="text-[var(--pulse-text-muted)]">
              {formatDateTime(hoveredBeat.beat.timestamp)}
            </span>
            <span className="text-[var(--pulse-text-dim)]">
              ({formatRelativeTime(hoveredBeat.beat.timestamp)})
            </span>
          </div>
        </div>
      )}

      {/* The 60-slot Capsule Pill Strip */}
      <div
        className="flex h-8 items-center justify-between gap-[3px] py-1"
        onMouseLeave={() => setHoveredBeat(null)}
      >
        {slots.map((beat, idx) => {
          const isUp = beat.status === 1
          const isDegraded = beat.status === 2

          const barColor = isUp
            ? 'bg-emerald-500 hover:bg-emerald-400'
            : isDegraded
              ? 'bg-amber-500 hover:bg-amber-400'
              : 'bg-rose-500 hover:bg-rose-400'

          return (
            <div
              key={`${beat.timestamp}-${idx}`}
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
              className={`heartbeat-capsule flex-1 h-6 cursor-pointer rounded-xs ${barColor}`}
            />
          )
        })}
      </div>

      {/* Labels below strip */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--pulse-text-dim)]">
        <span>60 次探活前 (约 3 小时)</span>
        <span className="font-mono-numeric font-medium text-emerald-500">
          {uptimePercent.toFixed(2)}% 可用率
        </span>
        <span>刚刚 (当前状态)</span>
      </div>
    </div>
  )
}
