import React, { useState, useRef } from 'react'
import { getAdminToken, saveAdminToken } from '../lib/storage'
import {
  X,
  Plus,
  Sparkles,
  Check,
  Zap,
  ChevronDown,
  Database,
  Layers,
} from 'lucide-react'
import { createNewMonitor, testConnectionProbe } from '../lib/api'

interface AddMonitorModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  existingGroups?: string[]
}

const HEALTH_EXAMPLE = `// 粘贴到你的任意 Cloudflare Worker 中暴露 KV/D1 深度探针:
if (url.pathname === '/api/health') {
  const t0 = performance.now();
  // 测试 KV 读写或 D1 数据库查询
  await env.MY_KV.get('__probe__'); // 或 await env.DB.prepare('SELECT 1').run();
  const latency = Math.round(performance.now() - t0);
  return Response.json({
    status: 'UP',
    components: { storage: { status: 'UP', latency_ms: latency } },
    colo: request.cf?.colo || 'EDGE'
  });
}`

const PRESETS = [
  {
    label: '⚡ CF Worker API',
    group: 'Cloudflare 边缘计算',
    name: 'Cloudflare Worker 服务',
    url: 'https://',
    method: 'GET' as const,
    expectedStatus: 200,
    hint: '探测 Worker 边缘计算冷启动与接口可用性',
  },
  {
    label: '🗄️ CF KV/D1 深度探针',
    group: '边缘服务与存储 (Edge & Storage)',
    name: 'Cloudflare 存储探针 (KV/D1)',
    url: 'https://',
    method: 'GET' as const,
    expectedStatus: 200,
    hint: '在 Worker 中暴露 /api/health，实测 KV 读写或 D1 查询延迟',
  },
  {
    label: '🌐 CF Pages 站点',
    group: '核心站点 (Portals)',
    name: 'Cloudflare Pages 独立站点',
    url: 'https://',
    method: 'GET' as const,
    expectedStatus: 200,
    hint: '探测前端静态网页与 SPA 首屏 HTTP 可达性',
  },
  {
    label: '📦 CF R2 存储桶',
    group: '边缘服务与存储 (Edge & Storage)',
    name: 'Cloudflare R2 存储探针',
    url: 'https://',
    method: 'HEAD' as const,
    expectedStatus: 200,
    hint: '探测 R2 公共存储桶或资源可达性',
  },
]

export const AddMonitorModal: React.FC<AddMonitorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingGroups,
}) => {
  const allAvailableGroups = React.useMemo(() => {
    const set = new Set<string>()
    if (existingGroups && existingGroups.length > 0) {
      for (const g of existingGroups) {
        if (g && g.trim()) set.add(g.trim())
      }
    }
    set.add('核心站点 (Portals)')
    set.add('边缘服务与存储 (Edge & Storage)')
    set.add('外部依赖与第三方 API')
    return Array.from(set)
  }, [existingGroups])

  const [name, setName] = useState('')
  const [url, setUrl] = useState('https://')
  const [groupMode, setGroupMode] = useState<'select' | 'custom'>('select')
  const [selectedGroup, setSelectedGroup] = useState(() => allAvailableGroups[0] || '核心站点 (Portals)')
  const [customGroup, setCustomGroup] = useState('')
  const [method, setMethod] = useState<'GET' | 'HEAD'>('GET')
  const [expectedStatus, setExpectedStatus] = useState(200)
  const [adminToken, setAdminToken] = useState(getAdminToken)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const testSequence = useRef(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Connection probe test state
  const [testState, setTestState] = useState<{
    loading: boolean
    success?: boolean
    statusCode?: number
    latencyMs?: number
    error?: string
  } | null>(null)

  // Expandable Cloudflare KV / D1 specification guide
  const [showCfGuide, setShowCfGuide] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  React.useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    if (isOpen && dialog && !dialog.open) {
      dialog.showModal()
      dialog.scrollTop = 0
      document.body.style.overflow = 'hidden'
    }
    if (!isOpen && dialog?.open) dialog.close()
    return () => {
      if (dialog?.open) dialog.close()
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  const containKeyboardFocus = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled)'))
      .filter(element => element.getClientRects().length > 0)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus() }
  }



  // Smart URL parser & auto-categorization
  const handleUrlChange = (newUrl: string) => {
    testSequence.current++
    setUrl(newUrl)
    setTestState(null)

    try {
      if (newUrl.startsWith('http://') || newUrl.startsWith('https://')) {
        const parsed = new URL(newUrl)
        const host = parsed.hostname

        // Auto suggest name if empty or generic
        if (!name || name.includes('站点') || name.includes('服务') || name.includes('探针')) {
          if (host.includes('.workers.dev')) {
            setName(`${host.split('.')[0]} Worker`)
          } else if (host.includes('.pages.dev')) {
            setName(`${host.split('.')[0]} Pages`)
          } else if (host) {
            setName(host)
          }
        }

        // Auto suggest group
        let autoGroup: string | null = null
        if (host.includes('workers.dev')) {
          autoGroup = 'Cloudflare 边缘计算'
        } else if (
          parsed.pathname.includes('health') ||
          parsed.pathname.includes('probe') ||
          parsed.pathname.includes('kv') ||
          parsed.pathname.includes('d1')
        ) {
          autoGroup = '边缘服务与存储 (Edge & Storage)'
        } else if (host.includes('pages.dev')) {
          autoGroup = '核心站点 (Portals)'
        }

        if (autoGroup) {
          if (allAvailableGroups.includes(autoGroup)) {
            setSelectedGroup(autoGroup)
            setGroupMode('select')
          } else {
            setCustomGroup(autoGroup)
            setGroupMode('custom')
          }
        }
      }
    } catch {
      // not a valid full url yet
    }
  }

  const handleApplyPreset = (preset: (typeof PRESETS)[0]) => {
    if (allAvailableGroups.includes(preset.group)) {
      setSelectedGroup(preset.group)
      setGroupMode('select')
    } else {
      setCustomGroup(preset.group)
      setGroupMode('custom')
    }
    testSequence.current++
    setName(preset.name)
    setUrl(preset.url)
    setMethod(preset.method)
    setExpectedStatus(preset.expectedStatus)
    setTestState(null)
  }

  const handleTestConnection = async () => {
    if (!url.trim() || !url.startsWith('http')) {
      setErrorMsg('请先输入合法的目标 URL 地址再进行测试')
      return
    }
    setErrorMsg('')
    const sequence = ++testSequence.current
    setTestState({ loading: true })

    const res = await testConnectionProbe(url.trim(), method, expectedStatus, adminToken)
    if (sequence !== testSequence.current) return
    if (res.success) {
      setTestState({
        loading: false,
        success: true,
        statusCode: res.statusCode,
        latencyMs: res.latencyMs,
      })
    } else {
      setTestState({
        loading: false,
        success: false,
        error: res.error || '探测失败',
      })
    }
  }

  const handleCopyCode = () => {

    void navigator.clipboard.writeText(HEALTH_EXAMPLE).then(() => { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000) }).catch(() => setErrorMsg('复制失败，请手动选择代码'))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrorMsg('请输入监控服务名称')
      return
    }
    if (!url.trim() || !url.startsWith('http')) {
      setErrorMsg('请输入合法的 HTTP/HTTPS 目标地址')
      return
    }

    setIsSubmitting(true)
    setErrorMsg('')

    saveAdminToken(adminToken)

    const finalGroupName =
      groupMode === 'custom'
        ? customGroup.trim() || '自定义服务'
        : selectedGroup.trim() || '核心站点 (Portals)'

    try {
      const res = await createNewMonitor(
        {
          name: name.trim(),
          url: url.trim(),
          group_name: finalGroupName,
          method,
          expected_status: expectedStatus,
        },
        adminToken
      )

      if (res.success) {
        onSuccess()
        onClose()
      } else {
        setErrorMsg(res.error || '添加监控项失败')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="add-monitor-title" onKeyDown={containKeyboardFocus} onCancel={event => { event.preventDefault(); if (!isSubmitting) onClose() }} className="monitor-dialog">
      <div className="relative w-full rounded-2xl border border-[var(--pulse-border-hover)] bg-[var(--pulse-card)] p-4 sm:p-6 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--pulse-card)] flex items-center justify-between pb-4 border-b border-[var(--pulse-border)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 id="add-monitor-title" className="text-base font-semibold text-[var(--pulse-text)]">
                快速添加监控项目
              </h2>
              <p className="text-xs text-[var(--pulse-text-dim)]">
                无缝接入 Cloudflare 边缘计算、KV/D1 深度探针与独立站点
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="关闭添加监控弹窗"
            type="button"
            className="rounded-lg p-1.5 text-[var(--pulse-text-muted)] hover:bg-white/5 hover:text-[var(--pulse-text)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Presets */}
        <div className="my-4">
          <div className="flex items-center justify-between text-xs text-[var(--pulse-text-dim)] mb-2">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
              Cloudflare 专属快捷预设：
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => handleApplyPreset(p)}
                className="rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2.5 py-2 text-left text-[11px] font-medium text-[var(--pulse-text-muted)] hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-[var(--pulse-card-hover)] transition-all"
                title={p.hint}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible Cloudflare KV/D1 Detection Principle Guide */}
        <div className="mb-4 rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-bg)]/60 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setShowCfGuide(!showCfGuide)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-[var(--pulse-text-muted)] hover:text-[var(--pulse-text)] transition-colors"
          >
            <span className="flex items-center gap-2 font-medium">
              <Database className="h-3.5 w-3.5 text-emerald-500" />
              Cloudflare KV / D1 存储资源如何合理检测？
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                showCfGuide ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showCfGuide && (
            <div className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-[var(--pulse-border)] text-[var(--pulse-text-dim)] animate-in fade-in duration-150">
              <p className="leading-relaxed">
                <strong className="text-[var(--pulse-text)]">💡 最佳检测机制：</strong>
                Cloudflare 的 KV 和 D1 属于私有边缘存储，没有公网 HTTP 端口。行业规范是通过业务 Worker 暴露一个轻量级{' '}
                <code className="text-emerald-400 font-mono">/api/health</code> 深度探针，在内部实测一次真实的读取延迟并返回 JSON。
              </p>
              <div className="relative rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-2.5 font-mono text-[11px] text-[var(--pulse-text-muted)] overflow-x-auto">
                <pre>{HEALTH_EXAMPLE}</pre>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="absolute right-2 top-2 rounded-md border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2 py-1 text-[10px] text-[var(--pulse-text-muted)] hover:text-emerald-400 transition-colors"
                >
                  {copiedCode ? '已复制' : '复制代码'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              {errorMsg}
            </div>
          )}

          {/* URL with Live Test Button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="monitor-url" className="text-xs font-medium text-[var(--pulse-text-muted)]">
                探活 URL 目标地址 *
              </label>
              <span className="text-[11px] text-[var(--pulse-text-dim)]">
                支持公网 HTTP / HTTPS 域名
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="url"
                id="monitor-url"
                required
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] pl-3 pr-24 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testState?.loading}
                className="absolute right-1.5 flex items-center gap-1 rounded-md border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-2 py-1 text-[11px] font-medium text-[var(--pulse-text-muted)] hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
                title="即时发起首轮握手测试"
              >
                <Zap
                  className={`h-3 w-3 ${
                    testState?.loading ? 'animate-spin text-emerald-400' : 'text-emerald-500'
                  }`}
                />
                <span>{testState?.loading ? '测试中' : '测试连通性'}</span>
              </button>
            </div>

            {/* Test result feedback badge */}
            {testState && !testState.loading && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                {testState.success ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    握手成功: HTTP {testState.statusCode} · 响应延迟 {testState.latencyMs} ms
                  </span>
                ) : (
                  <span className="text-rose-400">
                    ✕ 连接异常: {testState.error}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Service Name */}
          <div>
            <label htmlFor="monitor-name" className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
              服务名称 *
            </label>
            <input
              type="text"
              required
              id="monitor-name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：vBlog D1 探针 或 CF Worker API"
              className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Category / Group selection & Custom entry */}
          <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-bg)]/40 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <label htmlFor="monitor-group" className="text-xs font-medium text-[var(--pulse-text-muted)] flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-emerald-500" />
                所属分类分组 *
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setGroupMode('select')}
                  className={`transition-colors ${
                    groupMode === 'select'
                      ? 'text-emerald-400 font-medium'
                      : 'text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text-muted)]'
                  }`}
                >
                  从已有分类选择
                </button>
                <span className="text-[var(--pulse-border)]">|</span>
                <button
                  type="button"
                  onClick={() => {
                    setGroupMode('custom')
                    if (!customGroup && selectedGroup) setCustomGroup('')
                  }}
                  className={`transition-colors ${
                    groupMode === 'custom'
                      ? 'text-emerald-400 font-medium'
                      : 'text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text-muted)]'
                  }`}
                >
                  + 自行添加新分类
                </button>
              </div>
            </div>

            {/* Select existing vs Custom input */}
            {groupMode === 'select' ? (
              <div className="relative">
                <select
                  id="monitor-group"
                  value={selectedGroup}
                  onChange={(e) => {
                    if (e.target.value === '__NEW__') {
                      setGroupMode('custom')
                    } else {
                      setSelectedGroup(e.target.value)
                    }
                  }}
                  className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] pl-3 pr-8 py-2 text-xs text-[var(--pulse-text)] appearance-none focus:border-emerald-500 focus:outline-none cursor-pointer"
                >
                  {allAvailableGroups.map((g) => (
                    <option key={g} value={g} className="bg-[var(--pulse-card)] text-[var(--pulse-text)]">
                      {g}
                    </option>
                  ))}
                  <option value="__NEW__" className="bg-[var(--pulse-card)] text-emerald-400 font-medium">
                    ➕ 自行添加新分类...
                  </option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--pulse-text-dim)]" />
              </div>
            ) : (
              <div className="relative flex items-center">
                <input
                  type="text"
                  autoFocus
                  required
                  id="monitor-group"
                  maxLength={80}
                  value={customGroup}
                  onChange={(e) => setCustomGroup(e.target.value)}
                  placeholder="输入自定义分类名称 (例如: 微服务集群 / AI 代理 / 海外节点)"
                  className="w-full rounded-lg border border-emerald-500/50 bg-[var(--pulse-card)] pl-3 pr-20 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setGroupMode('select')}
                  className="absolute right-1.5 rounded-md border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2 py-1 text-[10px] text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text)] transition-colors"
                >
                  已有分类
                </button>
              </div>
            )}

            {/* Quick category tag pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] text-[var(--pulse-text-dim)] mr-0.5">常用分组:</span>
              {allAvailableGroups.map((g) => {
                const isActive = groupMode === 'select' && selectedGroup === g
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setSelectedGroup(g)
                      setGroupMode('select')
                    }}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition-all ${
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 font-medium'
                        : 'border border-[var(--pulse-border)] bg-[var(--pulse-card)] text-[var(--pulse-text-dim)] hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)]'
                    }`}
                  >
                    {g}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setGroupMode('custom')}
                className={`rounded-md px-2 py-0.5 text-[11px] border border-dashed transition-all ${
                  groupMode === 'custom'
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/50 font-medium'
                    : 'border-[var(--pulse-border)] text-[var(--pulse-text-dim)] hover:text-emerald-400 hover:border-emerald-500/40'
                }`}
              >
                + 自行添加
              </button>
            </div>
          </div>

          {/* Request Method & Expected Status Code */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="monitor-method" className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
                请求方式
              </label>
              <select
                id="monitor-method"
                value={method}
                onChange={(e) => { testSequence.current++; setTestState(null); setMethod(e.target.value as 'GET' | 'HEAD'); }}
                className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] focus:border-emerald-500 focus:outline-none cursor-pointer"
              >
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
              </select>
            </div>

            <div>
              <label htmlFor="monitor-status" className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
                期望状态码
              </label>
              <input
                type="number"
                id="monitor-status"
                min={200}
                max={599}
                value={expectedStatus}
                onChange={(e) => { testSequence.current++; setTestState(null); setExpectedStatus(Number(e.target.value)); }}
                className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] font-mono-numeric focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="monitor-token" className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
              管理密钥（仅当前标签页保存）
            </label>
            <input
              type="password"
              id="monitor-token"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="输入管理员配置的密钥，测试、添加和删除均需认证"
              className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button type="button" onClick={() => { setErrorMsg(saveAdminToken(adminToken) ? '管理密钥已更新，仅保存在当前标签页' : '浏览器禁止存储，无法保存密钥；当前添加和测试仍可使用') }} className="text-xs text-emerald-500">仅保存管理密钥</button>
          {/* Footer Actions */}
          <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--pulse-border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-[var(--pulse-border)] px-4 py-2 text-xs font-medium text-[var(--pulse-text-muted)] hover:bg-white/5 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{isSubmitting ? '正在接入并探活...' : '立即接入并探活'}</span>
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
