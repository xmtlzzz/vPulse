import React, { useState } from 'react'
import {
  ChevronDown,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Zap,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Clock,
  Radio,
  Server,
} from 'lucide-react'
import { Monitor } from '../types'
import { HeartbeatBar } from './HeartbeatBar'
import { formatLatency, formatDateTime, formatRelativeTime, formatUptimePercent } from '../lib/format'

interface CompactMonitorRowProps {
  monitor: Monitor
  isRefreshing?: boolean
  isExpanded?: boolean
  isHighlighted?: boolean
  onToggleExpand: () => void
  onSingleProbe?: (id: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}

export const CompactMonitorRow: React.FC<CompactMonitorRowProps> = ({
  monitor,
  isRefreshing = false,
  isExpanded = false,
  isHighlighted = false,
  onToggleExpand,
  onSingleProbe,
  onDelete,
}) => {
  const [isProbingThis, setIsProbingThis] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  const isUp = monitor.current_status === 1
  const isDegraded = monitor.current_status === 2
  const isUnknown = monitor.current_status === -1
  const [actionError, setActionError] = useState('')

  // Extract hostname cleanly
  const hostname = (() => {
    try {
      return new URL(monitor.url).hostname
    } catch {
      return monitor.url
    }
  })()

  // Last 36 slots for compact inline strip
  const inlineSlots = monitor.heartbeats.slice(-36)

  // Recent 5 events for detailed event stream in expanded drawer
  const recentEvents = [...monitor.heartbeats].slice(-5).reverse()

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(monitor.url)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch { setActionError('无法复制，请手动选择地址') }
  }

  const handleSingleProbe = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onSingleProbe || isProbingThis) return
    setIsProbingThis(true)
    try {
      await onSingleProbe(monitor.id)
    } finally {
      setIsProbingThis(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onDelete) return
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true)
      setTimeout(() => setIsConfirmingDelete(false), 4000)
      return
    }
    await onDelete(monitor.id)
  }

  return (
    <div
      id={`monitor-${monitor.id}`}
      className={`group transition-all duration-300 ${
        isHighlighted
          ? 'bg-emerald-500/10 ring-1 ring-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.12)]'
          : isExpanded
          ? 'bg-[var(--pulse-card-hover)]/40'
          : ''
      }`}
    >
      {/* ── 1. The Compact Uptime-Kuma Row (Slim, ~48px) ────────────────── */}
      <div
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={`details-${monitor.id}`}
        aria-label={`${monitor.name}详情`}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggleExpand() } }}
        className="flex items-center justify-between gap-3 px-4 py-3 sm:py-3.5 cursor-pointer hover:bg-[var(--pulse-card-hover)] select-none transition-colors"
      >
        {/* Left: Status Dot & Name & Hostname */}
        <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-initial sm:min-w-[240px] md:min-w-[300px]">
          {/* Status Indicator Dot with live radar pulse */}
          <div className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            {isUnknown ? <span className="relative h-2.5 w-2.5 rounded-full bg-slate-400" /> : isUp ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </>
            ) : isDegraded ? (
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/30" />
            ) : (
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-rose-500/30 animate-pulse" />
            )}
          </div>

          {/* Name & Host Pill */}
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--pulse-text)] truncate">
              {monitor.name}
            </span>
            <span className="hidden md:inline-block rounded-md border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--pulse-text-dim)] truncate max-w-[150px]">
              {hostname}
            </span>
          </div>
        </div>

        {/* Center: Inline Mini-Heartbeat Bar (The Signature Uptime Kuma Look) */}
        <div className="hidden sm:flex items-center gap-[2.5px] max-w-[220px] md:max-w-[320px] h-5 px-1.5 rounded-md bg-[var(--pulse-bg)]/80 border border-[var(--pulse-border)]/60">
          {inlineSlots.map((beat, idx) => {
            const isBlank = beat.status === -1
            const barBg = isBlank
              ? 'bg-[var(--pulse-border)]/40 hover:bg-[var(--pulse-border)]/70'
              : beat.status === 1
                ? 'bg-emerald-500 hover:bg-emerald-400'
                : beat.status === 2
                  ? 'bg-amber-500 hover:bg-amber-400'
                  : 'bg-rose-500 hover:bg-rose-400'
            return (
              <div
                key={`inline-${beat.timestamp}-${idx}`}
                className={`w-[4px] h-3.5 rounded-xs transition-transform hover:scale-125 ${barBg} ${
                  isRefreshing || isProbingThis ? 'opacity-80' : ''
                }`}
                title={
                  isBlank
                    ? '排队等待探活'
                    : `${formatLatency(beat.latency_ms)} · HTTP ${beat.status_code ?? '无响应'} · ${beat.message || ''} · ${formatRelativeTime(beat.timestamp)}`
                }
              />
            )
          })}
        </div>

        {/* Right: Metrics & Chevron */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Latency Pill */}
          <div className="flex items-center gap-1 text-xs font-mono-numeric text-[var(--pulse-text-muted)]">
            <Zap
              className={`h-3 w-3 ${
                isProbingThis || isRefreshing
                  ? 'animate-spin text-emerald-400'
                  : 'text-emerald-500/80'
              }`}
            />
            <span>
              {isProbingThis ? '探测中' : formatLatency(monitor.current_latency_ms)}
            </span>
          </div>

          {/* 30d Uptime Percentage */}
          <div className="hidden xs:block text-xs font-mono-numeric font-medium text-emerald-500 min-w-[50px] text-right">
            {formatUptimePercent(monitor.uptime_30d)}
          </div>

          {/* Expand Chevron Icon */}
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-[var(--pulse-text-dim)] transition-all group-hover:border-[var(--pulse-border)] group-hover:text-[var(--pulse-text)] ${
              isExpanded ? 'rotate-180 text-[var(--pulse-text)] border-[var(--pulse-border)]' : ''
            }`}
          >
            <ChevronDown className="h-4 w-4 transition-transform duration-200" />
          </div>
        </div>
      </div>

      {/* ── 2. Expanded Accordion Details Drawer with GPU-accelerated Grid Animation ── */}
      <div
        id={`details-${monitor.id}`}
        className={`accordion-grid ${isExpanded ? 'is-expanded' : ''}`}
        aria-hidden={!isExpanded}
        inert={!isExpanded}
      >
        <div className="accordion-inner">
          <div className="border-t border-[var(--pulse-border)] bg-[var(--pulse-bg)]/40 px-4 py-5 sm:px-6 space-y-5">
          {/* A. Full Heartbeat Bar with Interactive Hover Inspection */}
          <div>
            <div className="flex items-center justify-between text-xs text-[var(--pulse-text-dim)] mb-2">
              <span className="font-medium text-[var(--pulse-text-muted)] flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-emerald-500" />
                全景心跳时序 (最近 60 次探测)
              </span>
              <span>悬停方块可查看每次探测详情</span>
            </div>
            <HeartbeatBar
              heartbeats={monitor.heartbeats}
              uptimePercent={monitor.uptime_30d}
              isRefreshing={isRefreshing || isProbingThis}
            />
          </div>

          {/* B. Four High-Density Core Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-3">
              <div className="flex items-center justify-between text-xs text-[var(--pulse-text-dim)] mb-1">
                <span>实时响应延迟</span>
                <Zap className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono-numeric text-[var(--pulse-text)]">
                {formatLatency(monitor.current_latency_ms)}
              </div>
              <div className="text-[11px] text-emerald-500 mt-0.5">
                {isUnknown ? '未探测或数据已过期' : isUp ? '当前连接通畅' : isDegraded ? '服务降级' : '探测失败'}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-3">
              <div className="flex items-center justify-between text-xs text-[var(--pulse-text-dim)] mb-1">
                <span>平均响应耗时</span>
                <Clock className="h-3.5 w-3.5 text-[var(--pulse-text-muted)]" />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono-numeric text-[var(--pulse-text)]">
                {formatLatency(monitor.avg_latency_ms)}
              </div>
              <div className="text-[11px] text-[var(--pulse-text-dim)] mt-0.5">
                最近 60 次有效均值
              </div>
            </div>

            <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-3">
              <div className="flex items-center justify-between text-xs text-[var(--pulse-text-dim)] mb-1">
                <span>30 天观测可用率</span>
                <Server className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              <div className="text-base sm:text-lg font-bold font-mono-numeric text-emerald-500">
                {formatUptimePercent(monitor.uptime_30d)}
              </div>
              <div className="text-[11px] text-[var(--pulse-text-dim)] mt-0.5">
                观测覆盖率 {monitor.coverage_30d.toFixed(2)}%
              </div>
            </div>

            <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-3">
              <div className="flex items-center justify-between text-xs text-[var(--pulse-text-dim)] mb-1">
                <span>TLS / 传输加密</span>
                {monitor.url.toLowerCase().startsWith('https://') ? (
                  <Lock className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                )}
              </div>
              <div className="text-sm sm:text-base font-bold text-[var(--pulse-text)] mt-0.5">
                {monitor.url.toLowerCase().startsWith('https://') ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 font-mono text-xs sm:text-sm">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" /> 配置为 HTTPS
                  </span>
                ) : (
                  <span className="text-[var(--pulse-text-muted)] text-xs sm:text-sm font-mono">
                    明文 HTTP 协议
                  </span>
                )}
              </div>
              <div className="text-[11px] mt-1 text-[var(--pulse-text-dim)]">
                {monitor.url.toLowerCase().startsWith('https://') ? (
                  <span className="text-[var(--pulse-text-dim)]">未测量 TLS 版本与证书有效期</span>
                ) : (
                  <span className="text-amber-500/80">未启用 TLS 证书加密</span>
                )}
              </div>
            </div>
          </div>

          {/* C. Config Specifications & Action Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-t border-[var(--pulse-border)]">
            {/* Target Specs */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--pulse-text-dim)]">
              <span className="rounded bg-[var(--pulse-card)] border border-[var(--pulse-border)] px-2 py-0.5 font-mono text-[var(--pulse-text-muted)]">
                {monitor.method}
              </span>
              <span>期望状态: <strong className="text-[var(--pulse-text)] font-mono">{monitor.expected_status}</strong></span>
              <span>·</span>
              <span>频率: 每 <strong className="text-[var(--pulse-text)] font-mono">{monitor.interval_min}</strong> 分钟</span>
              <span>·</span>
              <span>超时: <strong className="text-[var(--pulse-text)] font-mono">{monitor.timeout_ms}</strong>ms</span>
              <span>·</span>
              <span className="font-mono text-[var(--pulse-text-muted)] truncate max-w-[220px]">
                {monitor.url}
              </span>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              {/* Ping Now */}
              <button
                type="button"
                onClick={handleSingleProbe}
                disabled={isProbingThis}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-3 py-1.5 text-xs font-medium text-[var(--pulse-text)] hover:border-emerald-500/40 hover:text-emerald-400 transition-colors disabled:opacity-50"
                title="针对该单个站点立即执行一次测速"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isProbingThis ? 'animate-spin text-emerald-400' : ''}`}
                />
                <span>{isProbingThis ? '测速中...' : '即刻测速'}</span>
              </button>

              {/* Copy URL */}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-3 py-1.5 text-xs font-medium text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)] transition-colors"
                title="复制该服务监控地址"
              >
                {isCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>复制地址</span>
                  </>
                )}
              </button>

              {/* Open in new tab */}
              <a
                href={monitor.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-3 py-1.5 text-xs font-medium text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)] transition-colors"
                title="在新标签页中访问目标站点"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>直达站点</span>
              </a>

              {/* Delete Button */}
              {onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isConfirmingDelete
                      ? 'border-rose-500/50 bg-rose-500/10 text-rose-400'
                      : 'border-[var(--pulse-border)] bg-[var(--pulse-card)] text-[var(--pulse-text-dim)] hover:border-rose-500/30 hover:text-rose-400'
                  }`}
                  title="删除该监控项"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{isConfirmingDelete ? '确认删除?' : '删除'}</span>
                </button>
              )}
            </div>
          </div>

          {/* D. Recent Event Stream (Uptime Kuma Style Incident / Heartbeat Logs) */}
          {actionError && <p role="alert" className="text-xs text-amber-500">{actionError}</p>}
          <div className="pt-2 border-t border-[var(--pulse-border)]">
            <div className="flex items-center justify-between text-xs text-[var(--pulse-text-muted)] mb-2 font-medium">
              <span>近期探活日志流水 (最近 5 次)</span>
              <span className="text-[11px] text-[var(--pulse-text-dim)]">
                最近真实探测记录
              </span>
            </div>
            <div className="rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] overflow-hidden divide-y divide-[var(--pulse-border)] text-xs">
              {recentEvents.map((evt, idx) => {
                const evtUp = evt.status === 1
                return (
                  <div
                    key={`evt-${evt.timestamp}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[var(--pulse-text-dim)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          evtUp ? 'bg-emerald-500' : evt.status === 2 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                      />
                      <span className="text-[var(--pulse-text)] font-mono">
                        {evt.status === -1 ? '等待探测' : evt.status_code !== null ? `HTTP ${evt.status_code}` : '网络异常'}
                      </span>
                      <span className="text-[var(--pulse-text-muted)] break-all">
                        {evt.message || (evtUp ? '正常响应' : '未提供诊断信息')}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono-numeric text-[var(--pulse-text)]">
                        {formatLatency(evt.latency_ms)}
                      </span>
                      <span className="text-[11px] text-[var(--pulse-text-dim)]">
                        {formatDateTime(evt.timestamp)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)
}
