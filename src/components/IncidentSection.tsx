import React, { useState, useMemo } from 'react'
import {
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  Activity,
  ChevronRight,
  Flame,
  CalendarDays,
} from 'lucide-react'
import { Incident, Monitor } from '../types'
import { formatDateTime, formatDuration } from '../lib/format'

interface IncidentSectionProps {
  incidents: Incident[]
  monitors?: Monitor[]
  hoveredMonitorId?: string | null
  onHoverMonitor?: (id: string | null) => void
  onSelectMonitor?: (id: string) => void
  onOpenHistory?: (id?: string) => void
}

export const IncidentSection: React.FC<IncidentSectionProps> = ({
  incidents,
  monitors = [],
  hoveredMonitorId,
  onHoverMonitor,
  onSelectMonitor,
  onOpenHistory,
}) => {
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('all')

  const activeIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved'),
    [incidents]
  )
  const resolvedIncidents = useMemo(
    () => incidents.filter((i) => i.status === 'resolved'),
    [incidents]
  )

  const filteredIncidents = useMemo(() => {
    if (filter === 'unresolved') return activeIncidents
    if (filter === 'resolved') return resolvedIncidents
    return incidents
  }, [filter, incidents, activeIncidents, resolvedIncidents])
  const currentUnknown = !monitors.length || monitors.some(m => m.stale || m.current_status === -1)

  return (
    <div className="rounded-2xl border border-[var(--pulse-border)] bg-[var(--pulse-card)]/90 backdrop-blur-sm p-4 sm:p-5 shadow-xs transition-all">
      {/* ── 1. Section Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-[var(--pulse-border)]">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--pulse-text)]">
            故障与恢复动态
          </h3>
        </div>

        {activeIncidents.length > 0 ? (
          <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">
            <Flame className="h-3 w-3" />
            <span>{activeIncidents.length} 项中断中</span>
          </span>
        ) : (
          <span className="px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {currentUnknown ? '暂无进行中事件' : '全站平稳'}
          </span>
        )}
      </div>

      {/* ── 2. Filter Pills (if multiple incidents exist) ─────────────────── */}
      {incidents.length > 2 && (
        <div className="flex items-center gap-1.5 mb-3.5 text-[11px]">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
              filter === 'all'
                ? 'bg-[var(--pulse-border-hover)] text-[var(--pulse-text)] border border-[var(--pulse-border)] font-semibold shadow-xs'
                : 'text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text-muted)]'
            }`}
          >
            近期 ({incidents.length})
          </button>
          {activeIncidents.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter('unresolved')}
              className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                filter === 'unresolved'
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                  : 'text-rose-600/80 dark:text-rose-400/80 hover:text-rose-600 dark:hover:text-rose-400'
              }`}
            >
              故障中 ({activeIncidents.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilter('resolved')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
              filter === 'resolved'
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                : 'text-[var(--pulse-text-dim)] hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
          >
            已恢复 ({resolvedIncidents.length})
          </button>
        </div>
      )}

      {/* ── 3. Timeline Track (vMaker .project-timeline style) ────────────── */}
      <div className="relative border-l border-[var(--pulse-border)] ml-2.5 sm:ml-3 pl-4 sm:pl-5 space-y-4 max-h-[calc(100vh-250px)] overflow-y-auto pr-1 custom-scrollbar">
        {filteredIncidents.length === 0 ? (
          <div className="relative group py-2">
            {/* Emerald Node Dot */}
            <span className="absolute -left-[21px] sm:-left-[25px] top-2.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-[var(--pulse-card)] shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <div className="rounded-xl border border-[var(--pulse-border)]/60 bg-[var(--pulse-card-hover)]/30 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                <span>{filter === 'resolved' ? '暂无近期恢复记录' : filter === 'unresolved' ? '暂无未解决事件' : '暂无事件记录'}</span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--pulse-text-dim)] leading-relaxed">
                可通过下方事件历史查看更早的故障与恢复记录。
              </p>
            </div>
          </div>
        ) : (
          filteredIncidents.map((incident) => {
            const isResolved = incident.status === 'resolved'
            const isTargetHovered = Boolean(hoveredMonitorId && incident.monitor_id === hoveredMonitorId)
            const durationSec =
              isResolved && incident.resolved_at && incident.created_at
                ? Math.max(0, incident.resolved_at - incident.created_at)
                : null

            return (
              <div
                key={incident.id}
                onMouseEnter={() => incident.monitor_id && onHoverMonitor?.(incident.monitor_id)}
                onMouseLeave={() => onHoverMonitor?.(null)}
                onClick={() => incident.monitor_id && onSelectMonitor?.(incident.monitor_id)}
                className={`relative group cursor-pointer transition-all duration-200 select-none ${
                  isTargetHovered ? 'translate-x-1' : 'hover:translate-x-1'
                }`}
                title={incident.monitor_id ? '点击定位并展开对应监控项' : undefined}
              >
                {/* Node Dot on the vertical line */}
                <span
                  className={`absolute -left-[21px] sm:-left-[25px] top-2.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--pulse-card)] transition-all duration-200 group-hover:scale-125 ${
                    isResolved
                      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                      : incident.severity === 'major'
                      ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)] animate-pulse'
                      : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                  }`}
                />

                {/* Incident Card Body */}
                <div
                  className={`rounded-xl border p-3 -m-1.5 transition-all duration-200 ${
                    isTargetHovered
                      ? 'border-emerald-500/40 bg-[var(--pulse-card-hover)] shadow-xs'
                      : isResolved
                      ? 'border-transparent hover:border-[var(--pulse-border)] hover:bg-[var(--pulse-card-hover)]/70'
                      : 'border-rose-500/30 bg-rose-500/5 hover:border-rose-500/50 hover:bg-rose-500/10'
                  }`}
                >
                  {/* Top Meta Row: Date & Status Tag */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[10px] tracking-wider text-[var(--pulse-text-dim)] uppercase">
                      {formatDateTime(incident.created_at)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium font-mono rounded ${
                        isResolved
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 animate-pulse'
                      }`}
                    >
                      {isResolved ? (
                        <>
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          <span>已恢复</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-2.5 w-2.5" />
                          <span>观测中</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Incident Title & Service Name */}
                  <div className="flex items-center justify-between gap-1.5">
                    <h4 className="text-xs font-semibold text-[var(--pulse-text)] group-hover:text-emerald-400 transition-colors truncate">
                      {incident.title}
                    </h4>
                    {incident.monitor_id && (
                      <ChevronRight className="h-3 w-3 text-[var(--pulse-text-dim)] group-hover:text-[var(--pulse-text-muted)] group-hover:translate-x-0.5 transition-all shrink-0" />
                    )}
                  </div>

                  {/* Diagnostic / Error Message */}
                  <p className="mt-1 text-[11px] text-[var(--pulse-text-muted)] leading-relaxed break-words line-clamp-2 group-hover:line-clamp-none font-mono text-[10.5px]">
                    {incident.description}
                  </p>

                  {/* Resolution duration footer */}
                  {isResolved && incident.resolved_at && (
                    <div className="mt-2 pt-1.5 border-t border-[var(--pulse-border)]/40 flex items-center justify-between gap-2 text-[10px] font-mono text-[var(--pulse-text-dim)]">
                      <span className="flex items-center gap-1 text-emerald-500/80">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>历时 {durationSec !== null ? formatDuration(durationSec) : '—'}</span>
                      </span>
                      <span>恢复: {formatDateTime(incident.resolved_at)}</span>
                    </div>
                  )}
                  {onOpenHistory && <button type="button" className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                    onClick={(e) => { e.stopPropagation(); onOpenHistory(incident.id) }}>查看事件过程 <span aria-hidden="true">→</span></button>}
                </div>
              </div>
            )
          })
        )}
      </div>
      {onOpenHistory && <button type="button" onClick={() => onOpenHistory()}
        className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg border border-[var(--pulse-border)] py-2.5 text-xs font-medium text-[var(--pulse-text-muted)] hover:text-emerald-500 hover:border-emerald-500/40 transition-colors">
        <CalendarDays className="h-3.5 w-3.5" /> 查看全部事件历史
      </button>}
      <p className="mt-2 text-center text-[10px] text-[var(--pulse-text-dim)]">首页展示当前故障与最近 5 条恢复记录</p>
    </div>
  )
}
