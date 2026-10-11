import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { Monitor, HistoryResponse } from '../types'
import { apiRequest } from '../lib/api'
import { formatDateTime, formatLatency } from '../lib/format'
import { historySummary } from '../lib/history-chart'
import { HistoryChart } from './HistoryChart'

export function HistoryView({ monitor }: { monitor: Monitor }) {
  const [range, setRange] = useState('24h'),
    [errors, setErrors] = useState(false),
    [page, setPage] = useState(0)
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [filter, setFilter] = useState({ from: '', to: '' })
  const [data, setData] = useState<HistoryResponse | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setData(null)
    const query = new URLSearchParams({
      id: monitor.id,
      range,
      errors: errors ? '1' : '0',
      page: String(page),
    })
    if (filter.from) query.set('from', String(Math.floor(new Date(filter.from).getTime() / 1000)))
    if (filter.to) query.set('to', String(Math.floor(new Date(filter.to).getTime() / 1000)))
    void apiRequest<HistoryResponse>(`/api/history?${query}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取历史失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [monitor.id, range, errors, page, filter, revision])
  const summary = data ? historySummary(data.points) : null
  return (
    <div className="history-view">
      <div className="history-toolbar">
        <div className="history-ranges" aria-label="历史时间范围">
          {['24h', '7d', '30d'].map((r) => (
            <button
              type="button"
              className={`manage-tab ${range === r && !filter.from && !filter.to ? 'is-selected' : ''}`}
              aria-pressed={range === r && !filter.from && !filter.to}
              key={r}
              onClick={() => {
                setRange(r)
                setPage(0)
                setFilter({ from: '', to: '' })
                setFrom('')
                setTo('')
              }}
            >
              {r === '24h' ? '24 小时' : r === '7d' ? '7 天' : '30 天'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="manage-button"
          disabled={loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新记录
        </button>
      </div>
      <details className="history-custom-range">
        <summary>
          <CalendarDays size={14} />
          自定义时间{filter.from || filter.to ? ' · 已应用' : ''}
        </summary>
        <form
          className="history-date-filter"
          onSubmit={(event) => {
            event.preventDefault()
            if (from && to && new Date(from) >= new Date(to)) {
              setError('结束时间必须晚于开始时间')
              return
            }
            setPage(0)
            setFilter({ from, to })
          }}
        >
          <label className="manage-label">
            开始时间
            <input
              className="manage-input"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="manage-label">
            结束时间
            <input
              className="manage-input"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button className="manage-button" disabled={loading}>
            应用时间
          </button>
        </form>
      </details>
      {error && (
        <p role="alert" className="manage-error">
          {error}
        </p>
      )}
      {loading && (
        <div role="status" className="history-loading">
          <RefreshCw size={20} className="animate-spin" />
          正在读取探测历史…
        </div>
      )}
      {data && (
        <>
          <div className="history-metrics">
            <div>
              <span>平均分段延迟</span>
              <strong>
                {formatLatency(summary!.average === null ? null : Math.round(summary!.average))}
              </strong>
            </div>
            <div>
              <span>探测采样</span>
              <strong>
                {summary!.samples.toLocaleString()}
                <small> 次</small>
              </strong>
            </div>
            <div>
              <span>失败采样</span>
              <strong className={summary!.failures ? 'history-failed' : ''}>
                {summary!.failures.toLocaleString()}
                <small> 次</small>
              </strong>
            </div>
          </div>
          <section className="manage-section history-trend-panel">
            <div className="history-panel-heading">
              <div>
                <h3>响应时间趋势</h3>
                <p className="manage-help">{monitor.name} · 响应时间（ms）</p>
              </div>
              <span className="manage-help">
                每 {Math.round((data.bucket_seconds / 60) * 10) / 10} 分钟聚合
              </span>
            </div>
            {data.points.length ? (
              <>
                <HistoryChart data={data} name={monitor.name} intervalMin={monitor.interval_min} />
                {!data.points.some((p) => p.latency_ms !== null) && (
                  <p className="manage-help">该时段没有有效响应延迟，失败记录见下方日志。</p>
                )}
              </>
            ) : (
              <div className="history-empty">这个时间范围内暂无探测记录</div>
            )}
            <p className="history-caption">
              {formatDateTime(data.from)} — {formatDateTime(data.to)} · 缺测及无响应时段断开显示
            </p>
          </section>
          <section className="manage-section history-records">
            <div className="history-panel-heading">
              <div>
                <h3>探测记录</h3>
                <p className="manage-help">每一次请求的状态与响应结果</p>
              </div>
              <label className="history-errors">
                <input
                  type="checkbox"
                  checked={errors}
                  onChange={(e) => {
                    setErrors(e.target.checked)
                    setPage(0)
                  }}
                />
                仅看中断与降级
              </label>
            </div>
            {data.records.length ? (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>探测时间</th>
                      <th>状态</th>
                      <th>响应</th>
                      <th className="history-number">延迟</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((record, i) => (
                      <tr key={`${record.timestamp}-${i}`}>
                        <td>
                          <time>{formatDateTime(record.timestamp)}</time>
                        </td>
                        <td>
                          <span className={`history-status status-${record.status}`}>
                            {record.status === 0 ? '中断' : record.status === 2 ? '降级' : '正常'}
                          </span>
                        </td>
                        <td>
                          <span>
                            {record.status_code === null
                              ? '网络异常'
                              : `HTTP ${record.status_code}`}
                          </span>
                          {record.message && <p className="history-message">{record.message}</p>}
                        </td>
                        <td className="history-number">{formatLatency(record.latency_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="history-empty">没有符合条件的日志</div>
            )}
            <div className="history-pagination">
              <span className="manage-help">第 {page + 1} 页 · 每页 100 条</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="manage-button"
                  disabled={!page || loading}
                  onClick={() => setPage((n) => n - 1)}
                >
                  <ChevronLeft size={14} />
                  上一页
                </button>
                <button
                  type="button"
                  className="manage-button"
                  disabled={!data.has_more || loading}
                  onClick={() => setPage((n) => n + 1)}
                >
                  下一页
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
