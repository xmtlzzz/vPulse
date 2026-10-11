import { useEffect, useRef, useState } from 'react'
import { X, Settings2, ChartNoAxesCombined, Bell, Database, Laptop, RefreshCw } from 'lucide-react'
import type { Monitor, MonitorConfig, HistoryResponse } from '../types'
import { apiRequest, confirmAdminSession } from '../lib/api'
import { formatDateTime, formatLatency } from '../lib/format'
import { MonitorFields, defaultAdvanced } from './MonitorFields'

type Tab = 'monitors' | 'history' | 'alerts' | 'data' | 'devices'
type Alerts = {
  configured: boolean
  channel: string
  pending: { id: string; attempts: number; next_attempt_at: number }[]
  deliveries: {
    id: number
    monitor: string
    status: string
    attempt: number
    message: string
    timestamp: number
  }[]
}
type Device = {
  id: string
  label: string
  current: boolean
  created_at: number
  expires_at: number
}
const tabs = [
  ['monitors', '项目', Settings2],
  ['history', '历史', ChartNoAxesCombined],
  ['alerts', '告警', Bell],
  ['data', '配置', Database],
  ['devices', '设备', Laptop],
] as const
const post = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const localDate = (seconds: number) => {
  const d = new Date(seconds * 1000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作失败')

export function ManagementPanel({
  monitors,
  initialId,
  initialTab = 'monitors',
  onClose,
  onChange,
}: {
  monitors: Monitor[]
  initialId?: string
  initialTab?: Tab
  onClose: () => void
  onChange: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<Tab>(initialTab),
    [selected, setSelected] = useState(initialId ?? monitors[0]?.id ?? '')
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [alerts, setAlerts] = useState<Alerts | null>(null),
    [devices, setDevices] = useState<Device[]>([])
  const [token, setToken] = useState(''),
    [config, setConfig] = useState(''),
    [importToken, setImportToken] = useState('')
  const [revision, setRevision] = useState(0)
  const monitor = monitors.find((m) => m.id === selected)
  useEffect(() => {
    const previous = document.body.style.overflow
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element?.close()
      document.body.style.overflow = previous
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  useEffect(() => {
    if (dialog.current) dialog.current.scrollTop = 0
  }, [tab])
  useEffect(() => {
    if (tab !== 'alerts' && tab !== 'devices') return
    const controller = new AbortController()
    const load = async () => {
      try {
        if (tab === 'alerts')
          setAlerts(await apiRequest<Alerts>('/api/admin/alerts', { signal: controller.signal }))
        else
          setDevices(
            (
              await apiRequest<{ devices: Device[] }>('/api/admin/devices', {
                signal: controller.signal,
              })
            ).devices
          )
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e))
      }
    }
    void load()
    const timer = tab === 'alerts' ? setInterval(() => void load(), 5000) : undefined
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [tab, revision])
  const act = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(message)
      setRevision((n) => n + 1)
      onChange()
    } catch (e) {
      setError(errorText(e))
      if (dialog.current) dialog.current.scrollTop = 0
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="monitor-dialog management-dialog"
      aria-labelledby="management-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      <header className="sticky top-0 bg-[var(--pulse-card)] z-10 border-b border-[var(--pulse-border)] p-4 sm:p-5">
        <div className="flex justify-between items-center gap-3">
          <div>
            <h2 id="management-title" className="font-semibold text-lg">
              监控管理
            </h2>
            <p className="manage-help mt-1">设置巡检、查阅记录和管理设备授权</p>
          </div>
          <button
            className="manage-button"
            aria-label="关闭监控管理"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <nav aria-label="管理栏目" className="flex gap-1 mt-4 overflow-x-auto">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              aria-current={tab === key ? 'page' : undefined}
              className={`manage-tab ${tab === key ? 'is-selected' : ''}`}
              onClick={() => {
                setTab(key)
                setError('')
                setNotice('')
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="p-4 sm:p-6 space-y-5">
        {error && (
          <p role="alert" className="manage-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="manage-success">
            {notice}
          </p>
        )}
        {(tab === 'monitors' || tab === 'history') && (
          <label className="manage-label">
            监控项目
            <select
              className="manage-input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {!monitors.length && <option value="">尚未添加项目</option>}
              {monitors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.enabled === 0
                    ? ' · 已暂停'
                    : (m.maintenance_until ?? 0) > Date.now() / 1000
                      ? ' · 维护中'
                      : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {tab === 'monitors' && monitor && (
          <MonitorEditor
            key={monitor.id}
            monitor={monitor}
            busy={busy}
            onSave={(value) =>
              act(
                () =>
                  apiRequest(
                    `/api/monitors?id=${encodeURIComponent(monitor.id)}`,
                    post(value, 'PATCH')
                  ),
                '项目设置已保存'
              )
            }
          />
        )}
        {tab === 'history' && monitor && <HistoryView key={monitor.id} monitor={monitor} />}
        {tab === 'alerts' && (
          <div className="space-y-4">
            <div className="manage-section flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">
                  {alerts
                    ? alerts.configured
                      ? `已配置 · ${alerts.channel}`
                      : '尚未配置渠道'
                    : '正在读取渠道…'}
                </h3>
                <p className="manage-help mt-1">
                  通知在后台发送；失败退避 1、2、4、8 分钟后，由后续巡检重试，最多尝试 5 次。
                </p>
              </div>
              <button
                className="manage-button"
                disabled={busy || !alerts?.configured}
                onClick={() =>
                  void act(
                    () => apiRequest('/api/admin/alerts/test', { method: 'POST' }),
                    '测试通知已排队，请查看下方发送结果'
                  )
                }
              >
                发送测试通知
              </button>
            </div>
            <p className="manage-help">
              支持 generic、Discord、Telegram、飞书和钉钉。渠道由 Worker 的 WEBHOOK_URL /
              WEBHOOK_TYPE 配置；Telegram 还需要 TELEGRAM_CHAT_ID。
            </p>
            <h3 className="font-medium">待发送（{alerts?.pending.length ?? 0}）</h3>
            {alerts?.pending.map((p) => (
              <div className="manage-section flex flex-wrap justify-between gap-3" key={p.id}>
                <div className="text-sm">
                  已尝试 {p.attempts} 次 ·{' '}
                  {p.attempts >= 5 ? '已停止自动重试' : `下次 ${formatDateTime(p.next_attempt_at)}`}
                </div>
                <button
                  className="manage-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        apiRequest(`/api/admin/alerts/retry?id=${encodeURIComponent(p.id)}`, {
                          method: 'POST',
                        }),
                      '已重新加入发送队列'
                    )
                  }
                >
                  重新发送
                </button>
              </div>
            ))}
            <h3 className="font-medium">最近发送记录 · 保留 7 天</h3>
            {!alerts?.deliveries.length && <p className="manage-help">暂无发送记录</p>}
            <div className="space-y-2">
              {alerts?.deliveries.map((d) => (
                <div key={d.id} className="manage-section text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className={d.status === 'sent' ? 'text-emerald-500' : 'text-rose-500'}>
                      {d.status === 'sent' ? '发送成功' : '发送失败'} · {d.monitor}
                    </strong>
                    <time className="manage-help">{formatDateTime(d.timestamp)}</time>
                  </div>
                  <p className="manage-help mt-1">
                    第 {d.attempt} 次 · {d.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'data' && (
          <div className="space-y-4">
            <h3 className="font-medium">配置备份与批量导入</h3>
            <p className="manage-help">
              只导出项目配置，不包含密钥、设备授权或历史记录。导入将追加项目，已有项目保持原样，总数最多
              20 项；启用的项目将在下一轮巡检探测。
            </p>
            <button
              className="manage-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const data = await apiRequest<{ version: number; monitors: unknown[] }>(
                    '/api/admin/export'
                  )
                  const blob = new Blob(
                    [JSON.stringify({ version: data.version, monitors: data.monitors }, null, 2)],
                    { type: 'application/json' }
                  )
                  const href = URL.createObjectURL(blob),
                    a = document.createElement('a')
                  a.href = href
                  a.download = `vpulse-config-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  setTimeout(() => URL.revokeObjectURL(href), 1000)
                }, '配置已导出')
              }
            >
              导出 JSON 配置
            </button>
            <label className="manage-label">
              选择配置文件
              <input
                className="manage-input"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 65536) {
                    setError('配置文件不能超过 64 KiB')
                    return
                  }
                  void file
                    .text()
                    .then(setConfig)
                    .catch((e) => setError(errorText(e)))
                }}
              />
            </label>
            <label className="manage-label">
              或粘贴配置 JSON
              <textarea
                className="manage-input font-mono min-h-44"
                maxLength={65536}
                placeholder={
                  '{"version":1,"monitors":[{"name":"示例","url":"https://example.com"}]}'
                }
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
            </label>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void act(async () => {
                  try {
                    const input: unknown = JSON.parse(config)
                    await apiRequest('/api/admin/import', post(input), importToken)
                    setConfig('')
                  } finally {
                    setImportToken('')
                  }
                }, '整批配置已导入')
              }}
            >
              <label className="manage-label">
                确认管理员密钥
                <input
                  className="manage-input"
                  type="password"
                  autoComplete="off"
                  required
                  value={importToken}
                  onChange={(e) => setImportToken(e.target.value)}
                />
              </label>
              <p className="manage-help">
                导入会添加项目，需要重新输入密钥确认。所有项目通过校验后才会写入。
              </p>
              <button
                className="manage-button primary"
                disabled={busy || !config.trim() || !importToken.trim()}
              >
                确认导入
              </button>
            </form>
          </div>
        )}
        {tab === 'devices' && (
          <div className="space-y-4">
            <form
              className="manage-section space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void act(async () => {
                  try {
                    await confirmAdminSession(token)
                  } finally {
                    setToken('')
                  }
                }, '此设备已授权，30 天内可直接管理和探活')
              }}
            >
              <label className="manage-label">
                记住此设备
                <input
                  className="manage-input"
                  autoComplete="off"
                  type="password"
                  required
                  placeholder="管理员密钥"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <button className="manage-button" disabled={busy || !token.trim()}>
                验证并记住设备
              </button>
            </form>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">已授权设备（{devices.length}）</h3>
              <button
                className="manage-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => apiRequest('/api/session', { method: 'DELETE' }),
                    '当前设备已退出授权'
                  )
                }
              >
                退出当前设备
              </button>
            </div>
            <p className="manage-help">
              设备名称来自浏览器标识。撤销后该设备需重新验证；变更服务端管理员密钥会使全部设备授权失效。
            </p>
            {devices.map((d) => (
              <div key={d.id} className="manage-section space-y-2">
                <div className="flex justify-between gap-3">
                  <strong className="text-sm">{d.current ? '当前设备' : '浏览器设备'}</strong>
                  <button
                    className="manage-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          apiRequest(`/api/admin/devices?id=${encodeURIComponent(d.id)}`, {
                            method: 'DELETE',
                          }),
                        '设备授权已撤销'
                      )
                    }
                  >
                    撤销授权
                  </button>
                </div>
                <p className="text-xs break-all text-[var(--pulse-text-muted)]">{d.label}</p>
                <p className="manage-help">
                  授权 {formatDateTime(d.created_at)} · 到期 {formatDateTime(d.expires_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </dialog>
  )
}

function MonitorEditor({
  monitor,
  busy,
  onSave,
}: {
  monitor: Monitor
  busy: boolean
  onSave: (value: MonitorConfig) => Promise<void>
}) {
  const [value, setValue] = useState<MonitorConfig>({ ...defaultAdvanced, ...monitor })
  const [maintenance, setMaintenance] = useState(
    (monitor.maintenance_until ?? 0) > Date.now() / 1000
      ? localDate(monitor.maintenance_until!)
      : ''
  )
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave({
          ...value,
          maintenance_until: maintenance ? Math.floor(new Date(maintenance).getTime() / 1000) : 0,
        })
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="manage-label">
            名称
            <input
              className="manage-input"
              required
              maxLength={100}
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </label>
          <label className="manage-label">
            分组
            <input
              className="manage-input"
              required
              maxLength={80}
              value={value.group_name}
              onChange={(e) => setValue({ ...value, group_name: e.target.value })}
            />
          </label>
        </div>
        <label className="manage-label">
          目标 URL
          <input
            className="manage-input"
            required
            type="url"
            maxLength={2048}
            value={value.url}
            onChange={(e) => setValue({ ...value, url: e.target.value })}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="manage-label">
            请求方式
            <select
              className="manage-input"
              value={value.method}
              onChange={(e) =>
                setValue({
                  ...value,
                  method: e.target.value as 'GET' | 'HEAD',
                  ...(e.target.value === 'HEAD'
                    ? { keyword: '', json_path: '', json_expected: '' }
                    : {}),
                })
              }
            >
              <option>GET</option>
              <option>HEAD</option>
            </select>
          </label>
          <label className="manage-label">
            期望 HTTP 状态码
            <input
              className="manage-input"
              type="number"
              required
              min="200"
              max="599"
              value={value.expected_status}
              onChange={(e) => setValue({ ...value, expected_status: e.target.valueAsNumber })}
            />
          </label>
        </div>
        <MonitorFields
          value={{ ...defaultAdvanced, ...value }}
          onChange={(v) => setValue({ ...value, ...v })}
          method={value.method}
        />
        <fieldset className="manage-section space-y-3">
          <legend>运行与维护</legend>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.enabled !== 0}
              onChange={(e) => setValue({ ...value, enabled: e.target.checked ? 1 : 0 })}
            />
            启用监控
          </label>
          <label className="manage-label">
            维护至（本地时间，留空结束维护）
            <input
              className="manage-input"
              type="datetime-local"
              value={maintenance}
              onChange={(e) => setMaintenance(e.target.value)}
            />
          </label>
          {maintenance && (
            <button className="manage-button" type="button" onClick={() => setMaintenance('')}>
              结束维护
            </button>
          )}
          <p className="manage-help">
            暂停或维护期间跳过探测和通知，保留全部历史。维护结束后自动恢复调度。
          </p>
        </fieldset>
        <button className="manage-button primary" type="submit">
          {busy ? '正在保存…' : '保存项目设置'}
        </button>
      </fieldset>
    </form>
  )
}

function HistoryView({ monitor }: { monitor: Monitor }) {
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
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [monitor.id, range, errors, page, filter, revision])
  const max = Math.max(1, ...(data?.points.map((p) => p.max_ms ?? 0) ?? []))
  const x = (timestamp: number) =>
    data ? 45 + ((timestamp - data.from) / (data.to - data.from)) * 700 : 0
  const y = (latency: number) => 180 - (latency / max) * 145
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          {['24h', '7d', '30d'].map((r) => (
            <button
              className={`manage-tab ${range === r ? 'is-selected' : ''}`}
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
          className="manage-button"
          aria-label="刷新历史记录"
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setFilter({ from, to })
        }}
      >
        <label className="manage-label flex-1 min-w-40">
          开始时间
          <input
            className="manage-input"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="manage-label flex-1 min-w-40">
          结束时间
          <input
            className="manage-input"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="manage-button">筛选时间</button>
      </form>
      {error && (
        <p role="alert" className="manage-error">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="manage-help">
          正在读取历史…
        </p>
      )}
      {data && (
        <>
          <div className="manage-section">
            <h3 className="text-sm font-medium">响应延迟 · 每个时间段的平均值</h3>
            <p className="manage-help mt-1">
              绿点为正常采样，红点表示该段有失败；缺测和无响应处断开。悬停查看范围。
            </p>
            {data.points.length ? (
              <svg
                role="img"
                aria-label={`${monitor.name}响应延迟历史曲线`}
                viewBox="0 0 780 215"
                className="w-full mt-3"
              >
                {[0, 0.5, 1].map((f) => (
                  <g key={f}>
                    <line
                      x1="45"
                      x2="745"
                      y1={y(max * f)}
                      y2={y(max * f)}
                      stroke="var(--pulse-border)"
                    />
                    <text x="0" y={y(max * f) + 4} fill="var(--pulse-text-dim)" fontSize="11">
                      {Math.round(max * f)}
                    </text>
                  </g>
                ))}
                {data.points.map((p, i) => {
                  const prev = data.points[i - 1]
                  return (
                    <g key={p.timestamp}>
                      {p.latency_ms !== null &&
                        prev?.latency_ms != null &&
                        p.timestamp - prev.timestamp <= data.bucket_seconds * 1.5 && (
                          <line
                            x1={x(prev.timestamp)}
                            y1={y(prev.latency_ms)}
                            x2={x(p.timestamp)}
                            y2={y(p.latency_ms)}
                            stroke="var(--pulse-emerald)"
                            strokeWidth="2"
                          />
                        )}
                      <circle
                        cx={x(Math.max(data.from, p.timestamp))}
                        cy={y(p.latency_ms ?? 0)}
                        r={p.failures ? 4 : 2.5}
                        fill={p.failures ? 'var(--pulse-rose)' : 'var(--pulse-emerald)'}
                      >
                        <title>
                          {formatDateTime(p.timestamp)} · 均值 {formatLatency(p.latency_ms)} · 最小{' '}
                          {formatLatency(p.min_ms)} / 最大 {formatLatency(p.max_ms)} · {p.count} 次
                          / 失败 {p.failures} 次
                        </title>
                      </circle>
                    </g>
                  )
                })}
                <text x="45" y="208" fill="var(--pulse-text-dim)" fontSize="11">
                  {formatDateTime(data.from)}
                </text>
                <text x="745" y="208" textAnchor="end" fill="var(--pulse-text-dim)" fontSize="11">
                  {formatDateTime(data.to)}
                </text>
              </svg>
            ) : (
              <p className="manage-help py-8 text-center">这个时间范围内暂无记录</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={errors}
              onChange={(e) => {
                setErrors(e.target.checked)
                setPage(0)
              }}
            />
            仅看中断与降级日志
          </label>
          <div className="space-y-2">
            {data.records.map((h, i) => (
              <div className="manage-section text-xs" key={`${h.timestamp}-${i}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <strong
                    className={
                      h.status === 0
                        ? 'text-rose-500'
                        : h.status === 2
                          ? 'text-amber-500'
                          : 'text-emerald-500'
                    }
                  >
                    {h.status === 0 ? '中断' : h.status === 2 ? '降级' : '正常'} ·{' '}
                    {h.status_code === null ? '网络异常' : `HTTP ${h.status_code}`} ·{' '}
                    {formatLatency(h.latency_ms)}
                  </strong>
                  <time className="manage-help">{formatDateTime(h.timestamp)}</time>
                </div>
                <p className="mt-1 break-words text-[var(--pulse-text-muted)]">{h.message}</p>
              </div>
            ))}
          </div>
          {!data.records.length && <p className="manage-help">没有符合条件的日志</p>}
          <div className="flex items-center justify-between gap-3">
            <button
              className="manage-button"
              disabled={!page}
              onClick={() => setPage((n) => n - 1)}
            >
              上一页
            </button>
            <span className="manage-help">第 {page + 1} 页 · 每页 100 条</span>
            <button
              className="manage-button"
              disabled={!data.has_more}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  )
}
