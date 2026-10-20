import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, RefreshCw, X } from 'lucide-react'
import type { Incident, IncidentDetailResponse, IncidentHistoryResponse } from '../types'
import { apiRequest } from '../lib/api'
import { calendarDays, incidentDate, incidentDateTime, incidentMonth, shiftIncidentMonth } from '../lib/incident-calendar'
import { formatDuration } from '../lib/format'

const statusLabel = (i: Incident) => i.status === 'resolved' ? '已恢复' : i.severity === 'major' ? '服务中断' : '服务降级'
const message = (e: unknown) => e instanceof Error ? e.message : '事件历史暂时无法读取'
const kindLabels = { opened: '发现故障', updated: '故障状态变化', resolved: '恢复 / 结束追踪', snapshot: '旧版历史快照' }

function IncidentDetails({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<IncidentDetailResponse | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true); setError('')
    const params = new URLSearchParams(cursor ? { cursor } : {})
    void apiRequest<IncidentDetailResponse>(`/api/incidents/${encodeURIComponent(id)}?${params}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    }).then(next => {
      if (controller.signal.aborted) return
      setData(previous => cursor && previous ? { ...next, updates: [...previous.updates, ...next.updates] } : next)
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [id, cursor, refresh])
  return <section className="incident-detail" aria-label="事件详情" aria-busy={busy}>
    <button className="archive-text-button" onClick={onBack}><ArrowLeft size={15} /> 返回事件列表</button>
    {error && <div role="alert" className="archive-error">{error}<button onClick={() => setRefresh(v => v + 1)}>重试</button></div>}
    {!data && busy && <p className="archive-empty" role="status">正在读取事件详情…</p>}
    {data && <>
      <div className="archive-detail-heading">
        <span className={`archive-badge ${data.incident.status === 'resolved' ? 'is-resolved' : `severity-${data.incident.severity}`}`}>{statusLabel(data.incident)}</span>
        <h3>{data.incident.title}</h3>
        {data.incident.monitor_name && <p>{data.incident.monitor_name}</p>}
      </div>
      <dl className="archive-metadata">
        <div><dt>开始时间</dt><dd>{incidentDateTime(data.incident.created_at)}</dd></div>
        <div><dt>恢复 / 结束</dt><dd>{data.incident.resolved_at !== null ? incidentDateTime(data.incident.resolved_at) : '仍在观测'}</dd></div>
        <div><dt>持续时间</dt><dd>{formatDuration(Math.max(0, (data.incident.resolved_at ?? Math.floor(Date.now() / 1000)) - data.incident.created_at))}</dd></div>
      </dl>
      {data.updates.some(u => u.kind === 'snapshot') && <p className="archive-legacy">此事件来自旧版本。开始与恢复时间已保留；旧版本仅保存最后摘要，无法还原此前完整诊断过程。</p>}
      <h4 className="archive-timeline-heading">事件时间线</h4>
      <ol className="archive-timeline">
        {data.updates.map(update => <li key={update.id} className={update.kind === 'resolved' ? 'is-resolved' : ''}>
          <div><strong>{kindLabels[update.kind]}</strong><time dateTime={new Date(update.timestamp * 1000).toISOString()}>{incidentDateTime(update.timestamp)}</time></div>
          <p>{update.description}</p>
        </li>)}
      </ol>
      {!data.updates.length && <p className="manage-help">此事件没有单独的过程记录，已有时间和摘要仍可查阅。</p>}
      {data.next_cursor && <button className="archive-load-more" disabled={busy} onClick={() => setCursor(data.next_cursor)}>{busy ? '正在读取…' : '加载后续过程'}</button>}
      {busy && data && <p role="status" className="manage-help">正在读取…</p>}
    </>}
  </section>
}

export function IncidentArchive({ onClose, initialId }: { onClose: () => void; initialId?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [month, setMonth] = useState(incidentMonth())
  const [day, setDay] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [history, setHistory] = useState<IncidentHistoryResponse | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const today = incidentDate(Math.floor(Date.now() / 1000))
  const dates = useMemo(() => calendarDays(month), [month])
  const byDay = useMemo(() => new Map(history?.days.map(d => [d.date, d]) ?? []), [history])
  const currentMonth = incidentMonth()

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const overflow = document.body.style.overflow
    element?.showModal(); document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true); setError('')
    if (!cursor) setHistory(null)
    const params = new URLSearchParams({ month, ...(day ? { day } : {}), ...(cursor ? { cursor } : {}) })
    void apiRequest<IncidentHistoryResponse>(`/api/incidents?${params}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    }).then(next => {
      if (controller.signal.aborted) return
      setHistory(previous => cursor && previous ? {
        ...next, incidents: [...new Map([...previous.incidents, ...next.incidents].map(i => [i.id, i])).values()],
      } : next)
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [month, day, cursor, refresh])

  const changeMonth = (value: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value < '1970-01' || value > currentMonth) return
    setMonth(value); setDay(null); setCursor(null); setSelectedId(null)
  }
  const selectDay = (value: string | null) => { setDay(value); setCursor(null); setSelectedId(null) }
  const monthLabel = `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`
  return <dialog ref={dialog} className="monitor-dialog incident-archive" aria-labelledby="incident-archive-title"
    onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <header className="archive-header">
      <div><h2 id="incident-archive-title"><CalendarDays size={20} /> 事件档案</h2><p>按日期回看故障、状态变化与恢复</p></div>
      <div className="archive-header-actions"><span>北京时间 · UTC+8</span><button aria-label="关闭事件档案" onClick={onClose}><X size={20} /></button></div>
    </header>
    <div className="archive-body">
      <aside className="archive-calendar-panel">
        <div className="archive-month-nav">
          <button aria-label="上个月" disabled={month <= (history?.earliest_month ?? '1970-01')} onClick={() => changeMonth(shiftIncidentMonth(month, -1))}><ChevronLeft size={18} /></button>
          <label><span className="sr-only">选择事件月份</span><input aria-label="选择事件月份" type="month" min={history?.earliest_month ?? '1970-01'} max={currentMonth} value={month} onChange={e => changeMonth(e.target.value)} /></label>
          <button aria-label="下个月" disabled={month >= currentMonth} onClick={() => changeMonth(shiftIncidentMonth(month, 1))}><ChevronRight size={18} /></button>
        </div>
        <div className="archive-weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(d => <span key={d}>{d}</span>)}</div>
        <div className="archive-calendar" aria-label={`${monthLabel}事件日历`}>
          {dates.map((date, index) => {
            const activity = date ? byDay.get(date) : undefined
            return date ? <button key={date} disabled={date > today}
              aria-label={`${date}${activity ? `，${activity.total} 项事件` : '，暂无事件记录'}`}
              aria-pressed={day === date} aria-current={date === today ? 'date' : undefined}
              title={activity ? `${activity.opened} 次开始 · ${activity.resolved} 次恢复` : undefined}
              className={`${day === date ? 'is-selected' : ''} ${date === today ? 'is-today' : ''} ${activity ? `has-activity level-${activity.severity}` : ''}`}
              onClick={() => selectDay(day === date ? null : date)}>
              <span>{Number(date.slice(8))}</span>{activity && <small>{activity.total}</small>}
            </button> : <span key={`blank-${index}`} />
          })}
        </div>
        <div className="archive-calendar-legend"><span className="level-2">中断</span><span className="level-1">降级 / 变化</span><span className="level-0">恢复</span></div>
        <p className="archive-calendar-note">标记事件开始、变化和恢复的日期。点击日期查看当日记录；未标记日期表示暂无事件记录。</p>
        <div className="archive-calendar-actions"><button onClick={() => selectDay(null)} className={!day ? 'is-selected' : ''}>查看整月</button><button onClick={() => changeMonth(currentMonth)}>回到本月</button></div>
        <p className="archive-retention"><Clock size={14} /> 事件长期保留，可跨月回溯</p>
      </aside>
      <main className="archive-content">
        {selectedId ? <IncidentDetails key={selectedId} id={selectedId} onBack={() => setSelectedId(null)} /> : <>
          <div className="archive-list-heading"><div><h3>{day ? `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日` : monthLabel}</h3><p>{day ? '这一天发生、变化或恢复的事件' : '本月发生、变化或恢复的事件'}</p></div>
            <button className="archive-text-button" aria-label="刷新事件历史" disabled={busy} onClick={() => { setCursor(null); setRefresh(v => v + 1) }}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> 刷新</button>
          </div>
          {error && <div className="archive-error" role="alert">{error}<button onClick={() => setRefresh(v => v + 1)}>重试</button></div>}
          {busy && !history && <p className="archive-empty" role="status">正在读取事件档案…</p>}
          {history && !history.incidents.length && <div className="archive-empty"><CalendarDays size={27} /><strong>暂无事件记录</strong><p>可选择其他日期或月份继续查看。</p></div>}
          {history && history.incidents.length > 0 && <>
            <div className="archive-incident-list" aria-busy={busy}>
              {history.incidents.map(incident => <button key={incident.id} className="archive-incident" onClick={() => setSelectedId(incident.id)}>
                <div className="archive-incident-top"><time>{incidentDateTime(incident.last_activity_at ?? incident.created_at)}</time><span className={`archive-badge ${incident.status === 'resolved' ? 'is-resolved' : `severity-${incident.severity}`}`}>{incident.status === 'resolved' && <CheckCircle2 size={11} />}{statusLabel(incident)}</span></div>
                <div className="archive-incident-title"><h4>{incident.title}</h4><ChevronRight size={16} /></div>
                <p>{incident.description}</p>
                <footer><span>开始 {incidentDateTime(incident.created_at)}</span><span>{incident.resolved_at !== null ? `恢复 ${incidentDateTime(incident.resolved_at)}` : '仍在观测'}</span></footer>
              </button>)}
            </div>
            <div className="archive-list-footer"><span>已加载 {history.incidents.length} 条事件</span>{history.next_cursor ? <button className="archive-load-more" disabled={busy} onClick={() => setCursor(history.next_cursor)}>{busy ? '正在读取…' : '加载更早事件'}</button> : <span>本次范围已全部显示</span>}</div>
          </>}
        </>}
      </main>
    </div>
  </dialog>
}
