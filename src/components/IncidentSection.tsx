import React from 'react'
import { ShieldCheck, AlertCircle, AlertTriangle } from 'lucide-react'
import { Incident, Monitor } from '../types'
import { formatDateTime } from '../lib/format'

interface IncidentSectionProps {
  incidents: Incident[]
  monitors?: Monitor[]
}

export const IncidentSection: React.FC<IncidentSectionProps> = ({
  incidents,
  monitors = [],
}) => {
  const manualActiveIncidents = incidents.filter((i) => i.status !== 'resolved')

  // Auto-synthesize incidents for any monitor currently DOWN (Flapping-verified)
  const downMonitors = monitors.filter((m) => m.current_status === 0)
  const synthesizedIncidents: Incident[] = downMonitors.map((m) => ({
    id: `auto-${m.id}`,
    title: `服务连接中断: ${m.name}`,
    description: `目标端点 ${m.url} 经双重重试确认均无法建立连接。系统已触发高频自动巡检，恢复后将自动归档。`,
    severity: 'major',
    status: 'investigating',
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  }))

  const allActive = [...synthesizedIncidents, ...manualActiveIncidents]

  if (allActive.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-4 text-xs text-[var(--pulse-text-muted)]">
        <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <span>近期未记录任何系统级故障或计划内停机维护。</span>
          <span className="text-[var(--pulse-text-dim)]">全球边缘探活指标全绿</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold tracking-wide text-rose-400 uppercase flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          当前服务异常与故障通告 ({allActive.length})
        </h3>
        <span className="text-xs text-[var(--pulse-text-dim)]">自动化实时追踪</span>
      </div>

      {allActive.map((inc) => (
        <div
          key={inc.id}
          className={`rounded-xl border p-4 text-xs ${
            inc.severity === 'major'
              ? 'border-rose-500/40 bg-rose-500/10 text-[var(--pulse-text)]'
              : 'border-amber-500/30 bg-amber-500/10 text-[var(--pulse-text)]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5 font-semibold">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{inc.title}</span>
            </div>
            <span className="uppercase text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-mono">
              {inc.status === 'investigating' ? '持续观测中' : inc.status}
            </span>
          </div>
          <p className="text-[var(--pulse-text-muted)] leading-relaxed">{inc.description}</p>
          <span className="block mt-2 text-[10px] text-[var(--pulse-text-dim)]">
            更新时间: {formatDateTime(inc.updated_at)}
          </span>
        </div>
      ))}
    </div>
  )
}
