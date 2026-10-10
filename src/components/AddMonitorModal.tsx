import React, { useState } from 'react'
import {
  X,
  Plus,
  Globe,
  Sparkles,
  Check,
  Zap,
  Code2,
  ChevronDown,
  Copy,
  Database,
  Layers,
  Server,
} from 'lucide-react'
import { createNewMonitor, testConnectionProbe } from '../lib/api'

interface AddMonitorModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

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
    hint: '探测前端静态网页、SPA 首屏可达性与 SSL 证书',
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
}) => {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('https://')
  const [groupName, setGroupName] = useState('核心站点 (Portals)')
  const [method, setMethod] = useState<'GET' | 'HEAD'>('GET')
  const [expectedStatus, setExpectedStatus] = useState(200)
  const [adminToken, setAdminToken] = useState(() => {
    return localStorage.getItem('vpulse-admin-token') || ''
  })
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
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Smart URL parser & auto-categorization
  const handleUrlChange = (newUrl: string) => {
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
        if (host.includes('workers.dev')) {
          setGroupName('Cloudflare 边缘计算')
        } else if (
          parsed.pathname.includes('health') ||
          parsed.pathname.includes('probe') ||
          parsed.pathname.includes('kv') ||
          parsed.pathname.includes('d1')
        ) {
          setGroupName('边缘服务与存储 (Edge & Storage)')
        } else if (host.includes('pages.dev')) {
          setGroupName('核心站点 (Portals)')
        }
      }
    } catch {
      // not a valid full url yet
    }
  }

  const handleApplyPreset = (preset: (typeof PRESETS)[0]) => {
    setGroupName(preset.group)
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
    setTestState({ loading: true })

    const res = await testConnectionProbe(url.trim(), method)
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
    const code = `// 粘贴到你的任意 Cloudflare Worker 中暴露 KV/D1 深度探针:
if (url.pathname === '/api/health') {
  const t0 = performance.now();
  // 测试 KV 读写或 D1 数据库查询
  await env.MY_KV.get('__probe__'); // 或 await env.DB.prepare('SELECT 1').run();
  const latency = Math.round(performance.now() - t0);
  return Response.json({
    status: 'UP',
    storage_latency_ms: latency,
    colo: request.cf?.colo || 'EDGE'
  });
}`
    void navigator.clipboard.writeText(code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
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

    if (adminToken) {
      localStorage.setItem('vpulse-admin-token', adminToken)
    }

    try {
      const res = await createNewMonitor(
        {
          name: name.trim(),
          url: url.trim(),
          group_name: groupName.trim() || '自定义服务',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-[var(--pulse-border-hover)] bg-[var(--pulse-card)] p-6 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--pulse-border)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--pulse-text)]">
                快速添加监控项目
              </h2>
              <p className="text-xs text-[var(--pulse-text-dim)]">
                无缝接入 Cloudflare 边缘计算、KV/D1 深度探针与独立站点
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
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
                <pre>{`// 粘贴到你的任意 Cloudflare Worker 中暴露 KV/D1 深度探针:
if (url.pathname === '/api/health') {
  const t0 = performance.now();
  await env.MY_KV.get('__probe__'); // 或 await env.DB.prepare('SELECT 1').run()
  const latency = Math.round(performance.now() - t0);
  return Response.json({ status: 'UP', storage_latency_ms: latency });
}`}</pre>
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
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              {errorMsg}
            </div>
          )}

          {/* URL with Live Test Button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--pulse-text-muted)]">
                探活 URL 目标地址 *
              </label>
              <span className="text-[11px] text-[var(--pulse-text-dim)]">
                支持 Workers.dev、Pages.dev 或自定义域名
              </span>
            </div>
            <div className="relative flex items-center">
              <input
                type="url"
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
            <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
              服务名称 *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：vBlog D1 探针 或 CF Worker API"
              className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
                所属分类分组
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="核心站点 / 边缘服务 / 外部依赖"
                className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
                  请求方式
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as 'GET' | 'HEAD')}
                  className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2 py-2 text-xs text-[var(--pulse-text)] focus:border-emerald-500 focus:outline-none"
                >
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
                  期望状态码
                </label>
                <input
                  type="number"
                  value={expectedStatus}
                  onChange={(e) => setExpectedStatus(Number(e.target.value))}
                  className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2 py-2 text-xs text-[var(--pulse-text)] font-mono-numeric focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
              管理密钥 (Admin Token, 可选)
            </label>
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Cloudflare 生产环境防未经授权写入（开发/单机演示可留空）"
              className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
            />
          </div>

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
    </div>
  )
}
