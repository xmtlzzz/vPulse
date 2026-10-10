import React, { useState } from 'react'
import { X, Plus, Globe, Sparkles, Check } from 'lucide-react'
import { createNewMonitor } from '../lib/api'

interface AddMonitorModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const PRESETS = [
  {
    label: 'Cloudflare Worker',
    group: 'Cloudflare 边缘计算',
    name: 'CF Worker 服务',
    url: 'https://',
  },
  {
    label: 'Cloudflare Pages 站点',
    group: '核心站点 (Portals)',
    name: 'Pages 独立站点',
    url: 'https://',
  },
  {
    label: '边缘 API 接口',
    group: '边缘服务与存储',
    name: '边缘 API 健康探针',
    url: 'https://',
  },
  {
    label: '外部依赖服务',
    group: '外部依赖',
    name: '第三方依赖服务',
    url: 'https://',
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

  if (!isOpen) return null

  const handleApplyPreset = (preset: (typeof PRESETS)[0]) => {
    setGroupName(preset.group)
    setName(preset.name)
    setUrl(preset.url)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--pulse-border-hover)] bg-[var(--pulse-card)] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--pulse-border)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--pulse-text)]">
                添加监控项目
              </h2>
              <p className="text-xs text-[var(--pulse-text-dim)]">
                动态接入 Cloudflare 边缘服务、站点或 API 探针
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
          <div className="flex items-center gap-1.5 text-xs text-[var(--pulse-text-dim)] mb-2">
            <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
            <span>常用快捷模板：</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => handleApplyPreset(p)}
                className="rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-2.5 py-1.5 text-left text-[11px] text-[var(--pulse-text-muted)] hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
              服务名称 *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：vInvoice 发票管理系统 或 CF Worker API"
              className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--pulse-text-muted)] mb-1">
              探活 URL 目标地址 *
            </label>
            <div className="relative">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-bg)] px-3 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500 focus:outline-none"
              />
              <Globe className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-[var(--pulse-text-dim)]" />
            </div>
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
              placeholder="生产环境防未授权写入（开发/单机演示可留空）"
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
