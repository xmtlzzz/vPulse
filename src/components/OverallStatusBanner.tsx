import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react'
import { OverallStatus } from '../types'
import { formatUptimePercent, formatLatency, formatRelativeTime } from '../lib/format'

interface OverallStatusBannerProps {
  overall: OverallStatus
  isRefreshing?: boolean
}

export const OverallStatusBanner: React.FC<OverallStatusBannerProps> = ({
  overall,
  isRefreshing = false,
}) => {
  const isAllUp = overall.status === 'operational'
  const isDegraded = overall.status === 'degraded'

  const statusConfig = isAllUp
    ? {
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/30',
        textColor: 'text-emerald-500',
        title: '全部服务正常运行',
        subtitle: 'All Systems Operational · 全球边缘节点联通无阻',
        icon: CheckCircle2,
      }
    : isDegraded
      ? {
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-500/30',
          textColor: 'text-amber-500',
          title: '部分服务响应延迟偏高',
          subtitle: 'Partial Degradation · 正在持续自动重试中',
          icon: AlertTriangle,
        }
      : {
          bgColor: 'bg-rose-500/10',
          borderColor: 'border-rose-500/30',
          textColor: 'text-rose-500',
          title: '检测到服务异常中断',
          subtitle: 'Service Outage · 存在无法连通的端点',
          icon: XCircle,
        }

  const StatusIcon = statusConfig.icon

  return (
    <div
      className={`rounded-2xl border ${statusConfig.borderColor} ${statusConfig.bgColor} p-6 sm:p-7 shadow-xs backdrop-blur-xs transition-all duration-300`}
    >
      {/* Top Banner Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 ${statusConfig.textColor}`}
          >
            <StatusIcon className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--pulse-text)]">
              {statusConfig.title}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--pulse-text-muted)] mt-0.5">
              {statusConfig.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-center text-xs text-[var(--pulse-text-dim)]">
          <Clock className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
          <span className={isRefreshing ? 'font-medium text-emerald-500 animate-pulse' : ''}>
            {isRefreshing ? '正在全网探活巡检中...' : `上次巡检: ${formatRelativeTime(overall.updated_at)}`}
          </span>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="mt-6 pt-5 border-t border-[var(--pulse-border)] grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <span className="text-xs font-medium text-[var(--pulse-text-dim)] uppercase tracking-wider">
            30 天综合可用率
          </span>
          <p className="mt-1 font-mono-numeric text-xl sm:text-2xl font-semibold text-emerald-500">
            {formatUptimePercent(overall.uptime_30d)}
          </p>
        </div>

        <div>
          <span className="text-xs font-medium text-[var(--pulse-text-dim)] uppercase tracking-wider">
            边缘平均延迟
          </span>
          <p className="mt-1 font-mono-numeric text-xl sm:text-2xl font-semibold text-[var(--pulse-text)]">
            {formatLatency(overall.avg_latency_ms)}
          </p>
        </div>

        <div>
          <span className="text-xs font-medium text-[var(--pulse-text-dim)] uppercase tracking-wider">
            监控节点健康度
          </span>
          <p className="mt-1 font-mono-numeric text-xl sm:text-2xl font-semibold text-[var(--pulse-text)]">
            {overall.healthy_count} / {overall.monitors_count}
            <span className="text-xs text-emerald-500 ml-1.5 font-normal">正常</span>
          </p>
        </div>

        <div>
          <span className="text-xs font-medium text-[var(--pulse-text-dim)] uppercase tracking-wider">
            探活频次
          </span>
          <p className="mt-1 font-mono-numeric text-xl sm:text-2xl font-semibold text-[var(--pulse-text)]">
            每 3 分钟
          </p>
        </div>
      </div>
    </div>
  )
}
