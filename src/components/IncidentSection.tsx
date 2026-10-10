import React from 'react'
import { ShieldCheck, AlertCircle } from 'lucide-react'
import { Incident } from '../types'
import { formatDateTime } from '../lib/format'

interface IncidentSectionProps {
  incidents: Incident[]
}

export const IncidentSection: React.FC<IncidentSectionProps> = ({ incidents }) => {
  const activeIncidents = incidents.filter((i) => i.status !== 'resolved')

  if (activeIncidents.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-4 text-xs text-[var(--pulse-text-muted)]">
        <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <span>近期未记录任何系统级故障或计划内停机维护。</span>
          <span className="text-[var(--pulse-text-dim)]">过去 30 天全部平稳</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-wide text-[var(--pulse-text)] uppercase px-1">
        当前故障与事件提醒
      </h3>
      {activeIncidents.map((inc) => (
        <div
          key={inc.id}
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-[var(--pulse-text)]"
        >
          <div className="flex items-center gap-2 mb-1.5 font-semibold text-amber-500">
            <AlertCircle className="h-4 w-4" />
            <span>{inc.title}</span>
            <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20">
              {inc.status}
            </span>
          </div>
          <p className="text-[var(--pulse-text-muted)]">{inc.description}</p>
          <span className="block mt-2 text-[10px] text-[var(--pulse-text-dim)]">
            更新时间: {formatDateTime(inc.updated_at)}
          </span>
        </div>
      ))}
    </div>
  )
}
