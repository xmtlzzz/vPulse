import React from 'react'
import { Activity, RefreshCw, Plus } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

interface HeaderProps {
  isDark: boolean
  onToggleTheme: () => void
  isRefreshing: boolean
  onRefresh: () => void
  lastUpdated: number
  onOpenAddModal: () => void
  countdown?: number
  isAutoProbeEnabled?: boolean
  onToggleAutoProbe?: () => void
}

export const Header: React.FC<HeaderProps> = ({
  isDark,
  onToggleTheme,
  isRefreshing,
  onRefresh,
  onOpenAddModal,
  countdown,
  isAutoProbeEnabled = true,
  onToggleAutoProbe,
}) => {
  return (
    <header className="border-b border-[var(--pulse-border)] bg-[var(--pulse-bg)]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] shadow-xs">
            <Activity className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-[var(--pulse-text)]">
                vPulse
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500 ring-1 ring-emerald-500/30">
                Live
              </span>
            </div>
            <p className="text-xs text-[var(--pulse-text-dim)]">
              边缘分布式健康探针 · 自动化巡检
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Live Indicator Pill with Dynamic Countdown */}
          <button
            type="button"
            onClick={onToggleAutoProbe || onRefresh}
            title={
              isAutoProbeEnabled
                ? `自动巡检已开启 · 每 60 秒自动探测 · ${countdown ?? 60}s 后执行下一次探活 (点击可立即探活)`
                : '自动巡检已暂停 · 点击开启'
            }
            className={`hidden sm:flex items-center gap-2 rounded-full border bg-[var(--pulse-card)] px-3 py-1.5 text-xs transition-colors duration-200 cursor-pointer ${
              isRefreshing
                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5'
                : 'border-[var(--pulse-border)] text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)]'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span>
              {isRefreshing
                ? '全网探测执行中...'
                : isAutoProbeEnabled
                  ? `自动巡检 · ${countdown ?? 60}s`
                  : '自动巡检暂停'}
            </span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            type="button"
            className={`flex h-9 items-center gap-1.5 rounded-full border bg-[var(--pulse-card)] px-3 text-xs font-medium transition-all duration-200 disabled:opacity-75 ${
              isRefreshing
                ? 'border-emerald-500/40 text-emerald-400 shadow-xs'
                : 'border-[var(--pulse-border)] text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)]'
            }`}
            title="立刻触发全网节点探活"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`}
            />
            <span className="hidden sm:inline">
              {isRefreshing ? '探测中...' : '立即探活'}
            </span>
          </button>

          {/* Add Monitor Button */}
          <button
            onClick={onOpenAddModal}
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-3 text-xs font-medium text-[var(--pulse-text-muted)] transition-all hover:border-emerald-500/40 hover:text-emerald-400"
            title="添加新的监控服务项目"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-500" />
            <span className="hidden sm:inline">添加项目</span>
          </button>

          {/* Theme Toggle */}
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  )
}
