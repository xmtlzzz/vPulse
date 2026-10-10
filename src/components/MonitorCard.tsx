import React from 'react'
import { ExternalLink, ShieldCheck, ShieldAlert, Zap, Globe } from 'lucide-react'
import { Monitor } from '../types'
import { HeartbeatBar } from './HeartbeatBar'
import { formatLatency } from '../lib/format'

interface MonitorCardProps {
  monitor: Monitor
  isRefreshing?: boolean
  isHighlighted?: boolean
}

export const MonitorCard: React.FC<MonitorCardProps> = ({
  monitor,
  isRefreshing = false,
  isHighlighted = false,
}) => {
  const isUp = monitor.current_status === 1
  const isDegraded = monitor.current_status === 2
  const isUnknown = monitor.current_status === -1

  const statusBadge = isUnknown
    ? { bg: 'bg-slate-500/10 text-slate-400 border-slate-500/25', dot: 'bg-slate-400', label: monitor.stale && monitor.last_checked_at ? '数据已过期' : '等待探测' }
    : isUp
    ? {
        bg: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/25',
        dot: 'bg-emerald-500',
        label: '运行正常',
      }
    : isDegraded
      ? {
          bg: 'bg-amber-500/10 text-amber-500 border-amber-500/25',
          dot: 'bg-amber-500',
          label: '服务降级',
        }
      : {
          bg: 'bg-rose-500/10 text-rose-500 border-rose-500/25',
          dot: 'bg-rose-500',
          label: '无法连通',
        }

  return (
    <div
      id={`monitor-${monitor.id}`}
      className={`group rounded-xl border transition-all duration-300 p-4 sm:p-5 ${
        isHighlighted
          ? 'border-emerald-500/60 ring-2 ring-emerald-500/30 bg-[var(--pulse-card-hover)] shadow-[0_0_20px_rgba(16,185,129,0.15)]'
          : 'border-[var(--pulse-border)] bg-[var(--pulse-card)] hover:border-[var(--pulse-border-hover)] hover:bg-[var(--pulse-card-hover)]'
      } ${
        isRefreshing ? 'card-probing' : ''
      }`}
    >
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        {/* Name & URL */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--pulse-bg)] border border-[var(--pulse-border)] text-[var(--pulse-text-muted)]">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-semibold text-[var(--pulse-text)] truncate">
                {monitor.name}
              </h2>
            </div>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer"
              className="group/link flex items-center gap-1 text-xs text-[var(--pulse-text-dim)] hover:text-emerald-500 transition-colors truncate"
            >
              <span className="truncate">{monitor.url}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-60 group-hover/link:opacity-100" />
            </a>
          </div>
        </div>

        {/* Status & Latency Badges */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          {/* Latency */}
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2.5 py-1 text-xs font-mono-numeric text-[var(--pulse-text)]">
            <Zap
              className={`h-3 w-3 ${isRefreshing ? 'animate-pulse text-emerald-400' : 'text-emerald-500'}`}
            />
            <span>
              {isRefreshing ? '实时测速中' : formatLatency(monitor.current_latency_ms)}
            </span>
          </div>

          {/* Status Badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${statusBadge.bg}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot} ${
                isRefreshing ? 'animate-ping' : ''
              }`}
            />
            {isRefreshing ? '检测中' : statusBadge.label}
          </span>
        </div>
      </div>

      {/* Heartbeat Strip */}
      <div className="my-3">
        <HeartbeatBar
          heartbeats={monitor.heartbeats}
          uptimePercent={monitor.uptime_30d}
          isRefreshing={isRefreshing}
        />
      </div>

      <p className="text-[11px] text-[var(--pulse-text-dim)]">30 天观测覆盖：{monitor.coverage_30d}%</p>

      {/* Footer Meta Row */}
      <div className="mt-3 pt-3 border-t border-[var(--pulse-border)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--pulse-text-dim)]">
        <div className="flex items-center gap-1.5">
          {monitor.url.toLowerCase().startsWith('https://') ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[var(--pulse-text-muted)] font-medium">配置为 HTTPS</span>
            </>
          ) : (
            <>
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[var(--pulse-text-dim)]">明文 HTTP 协议</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span>
            {monitor.method} 响应期望: {monitor.expected_status}
          </span>
          <span>·</span>
          <span>
            平均延迟: <strong className="font-mono-numeric font-normal text-[var(--pulse-text)]">{formatLatency(monitor.avg_latency_ms)}</strong>
          </span>
        </div>
      </div>
    </div>
  )
}
