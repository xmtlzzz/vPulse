import React from 'react'
import { Activity, RefreshCw, Plus, Settings2 } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

interface HeaderProps {
  isDark: boolean
  onToggleTheme: () => void
  isRefreshing: boolean
  isLoading?: boolean
  statusError?: boolean
  onRefresh: () => void
  lastUpdated: number | null
  onOpenAddModal: () => void
  onOpenManagement: () => void
  progressLabel?: string
  countdown?: number | null
  isAutoProbeEnabled?: boolean
  onToggleAutoProbe?: () => void
}

export const Header: React.FC<HeaderProps> = ({
  isDark,
  onToggleTheme,
  isRefreshing,
  isLoading = false,
  statusError = false,
  onRefresh,
  onOpenAddModal,
  onOpenManagement,
  progressLabel,
  countdown,
  isAutoProbeEnabled = true,
  onToggleAutoProbe,
}) => {
  return (
    <header className="border-b border-[var(--pulse-border)] bg-[var(--pulse-bg)]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8 xl:px-10">
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
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-500 ring-1 ring-emerald-500/30">
                Live
              </span>
            </div>
            <p className="text-xs text-[var(--pulse-text-dim)]">服务健康探针 · 服务端定时巡检</p>
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
                ? '每 15 秒刷新看板；点击暂停当前页面刷新，服务端巡检继续运行'
                : '当前页面刷新已暂停；点击恢复，服务端巡检继续运行'
            }
            className={`hidden sm:flex items-center gap-2 rounded-full border bg-[var(--pulse-card)] px-3 py-1.5 text-xs transition-colors duration-200 cursor-pointer ${
              isRefreshing
                ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                : 'border-[var(--pulse-border)] text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)]'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span>
              {isRefreshing
                ? progressLabel || '正在提交巡检...'
                : isAutoProbeEnabled
                  ? isLoading
                    ? '正在同步状态...'
                    : statusError
                      ? '状态同步失败'
                      : countdown == null
                        ? '等待首次巡检'
                        : countdown === 0
                          ? '巡检已到期 · 等待更新'
                          : `下次巡检 · ${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')}`
                  : '页面刷新暂停'}
            </span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            type="button"
            className={`flex h-9 items-center gap-1.5 rounded-full border bg-[var(--pulse-card)] px-3 text-xs font-medium transition-all duration-200 disabled:opacity-75 ${
              isRefreshing
                ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'border-[var(--pulse-border)] text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)]'
            }`}
            title="管理员：立即巡检全部监控"
            aria-label="立即巡检全部监控"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-emerald-600 dark:text-emerald-400' : ''}`}
            />
            <span className="hidden sm:inline">{isRefreshing ? '探测中...' : '立即探活'}</span>
          </button>

          {/* Add Monitor Button */}
          <button
            onClick={onOpenAddModal}
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-3 text-xs font-medium text-[var(--pulse-text-muted)] transition-all hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400"
            title="添加新的监控服务项目"
            aria-label="添加新的监控服务项目"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-500" />
            <span className="hidden sm:inline">添加项目</span>
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={onOpenManagement}
            className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--pulse-border)] px-3 text-xs text-[var(--pulse-text-muted)] hover:text-[var(--pulse-text)]"
            aria-label="打开监控管理"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">管理</span>
          </button>
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  )
}
