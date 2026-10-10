import React from 'react'
import { Monitor } from '../types'
import { MonitorCard } from './MonitorCard'
import { CompactMonitorRow } from './CompactMonitorRow'
import { ChevronsUpDown } from 'lucide-react'
import { formatUptimePercent } from '../lib/format'

interface MonitorGroupProps {
  groupName: string
  monitors: Monitor[]
  isRefreshing?: boolean
  viewMode?: 'compact' | 'cards'
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  onToggleGroupExpand: (monitorIds: string[]) => void
  onSingleProbe?: (id: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  hoveredMonitorId?: string | null
}

export const MonitorGroup: React.FC<MonitorGroupProps> = ({
  groupName,
  monitors,
  isRefreshing = false,
  viewMode = 'compact',
  expandedIds,
  onToggleExpand,
  onToggleGroupExpand,
  onSingleProbe,
  onDelete,
  hoveredMonitorId,
}) => {
  const allHealthy = monitors.every((m) => m.current_status === 1)
  const measured = monitors.filter(m => m.uptime_30d !== null)
  const avgGroupUptime = measured.length ? measured.reduce((acc, m) => acc + m.uptime_30d!, 0) / measured.length : null

  const monitorIds = monitors.map((m) => m.id)
  const isAllGroupExpanded = monitorIds.length > 0 && monitorIds.every((id) => expandedIds.has(id))

  return (
    <div className="space-y-3">
      {/* Group Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--pulse-text)] break-all">
            {groupName}
          </h2>
          <span className="rounded-full bg-[var(--pulse-card)] border border-[var(--pulse-border)] px-2 py-0.5 text-[11px] font-mono-numeric text-[var(--pulse-text-dim)]">
            {monitors.length}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {/* Group Expand / Collapse Toggle (for compact view) */}
          {viewMode === 'compact' && monitors.length > 0 && (
            <button
              type="button"
              onClick={() => onToggleGroupExpand(monitorIds)}
              className="flex items-center gap-1 text-[11px] text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text)] transition-colors px-2 py-0.5 rounded border border-transparent hover:border-[var(--pulse-border)]"
            >
              <ChevronsUpDown className="h-3 w-3" />
              <span>{isAllGroupExpanded ? '收起本组' : '展开本组'}</span>
            </button>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-[var(--pulse-text-dim)] hidden sm:inline">可用率</span>
            <span className="font-mono-numeric font-medium text-emerald-500">
              {formatUptimePercent(avgGroupUptime)}
            </span>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                allHealthy ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Render based on viewMode */}
      {viewMode === 'compact' ? (
        <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] overflow-hidden divide-y divide-[var(--pulse-border)] shadow-xs transition-all">
          {monitors.map((monitor) => (
            <CompactMonitorRow
              key={monitor.id}
              monitor={monitor}
              isRefreshing={isRefreshing}
              isExpanded={expandedIds.has(monitor.id)}
              isHighlighted={hoveredMonitorId === monitor.id}
              onToggleExpand={() => onToggleExpand(monitor.id)}
              onSingleProbe={onSingleProbe}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {monitors.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              isRefreshing={isRefreshing}
              isHighlighted={hoveredMonitorId === monitor.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
