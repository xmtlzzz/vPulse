import React from 'react'
import { Monitor } from '../types'
import { MonitorCard } from './MonitorCard'

interface MonitorGroupProps {
  groupName: string
  monitors: Monitor[]
  isRefreshing?: boolean
}

export const MonitorGroup: React.FC<MonitorGroupProps> = ({
  groupName,
  monitors,
  isRefreshing = false,
}) => {
  const allHealthy = monitors.every((m) => m.current_status === 1)
  const avgGroupUptime =
    monitors.reduce((acc, m) => acc + m.uptime_30d, 0) / (monitors.length || 1)

  return (
    <div className="space-y-3">
      {/* Group Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--pulse-text)] uppercase">
            {groupName}
          </h2>
          <span className="rounded-full bg-[var(--pulse-card)] border border-[var(--pulse-border)] px-2 py-0.5 text-[11px] font-mono-numeric text-[var(--pulse-text-dim)]">
            {monitors.length}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--pulse-text-dim)]">分组可用率</span>
          <span className="font-mono-numeric font-medium text-emerald-500">
            {avgGroupUptime.toFixed(2)}%
          </span>
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              allHealthy ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
        </div>
      </div>

      {/* Cards List */}
      <div className="space-y-3">
        {monitors.map((monitor) => (
          <MonitorCard
            key={monitor.id}
            monitor={monitor}
            isRefreshing={isRefreshing}
          />
        ))}
      </div>
    </div>
  )
}
