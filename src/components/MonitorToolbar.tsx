import React from 'react'
import {
  Search,
  X,
  LayoutList,
  LayoutGrid,
  ChevronsUpDown,
} from 'lucide-react'

interface MonitorToolbarProps {
  searchQuery: string
  onSearchChange: (val: string) => void
  viewMode: 'compact' | 'cards'
  onViewModeChange: (mode: 'compact' | 'cards') => void
  isAllExpanded: boolean
  onToggleAllExpand: () => void
  totalCount: number
  healthyCount: number
}

export const MonitorToolbar: React.FC<MonitorToolbarProps> = ({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  isAllExpanded,
  onToggleAllExpand,
  totalCount,
  healthyCount,
}) => {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-1">
      {/* Search Input */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--pulse-text-dim)]" />
        <input
          type="text"
          aria-label="搜索监控项目"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索监控项目名称、域名或分组..."
          className="w-full rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] pl-9 pr-8 py-2 text-xs text-[var(--pulse-text)] placeholder-[var(--pulse-text-dim)] focus:border-emerald-500/50 focus:outline-hidden transition-all shadow-xs"
        />
        {searchQuery && (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text)] p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Controls & Badges */}
      <div className="flex items-center justify-between sm:justify-end gap-2 text-xs">
        {/* Count Summary */}
        <div className="text-[11px] text-[var(--pulse-text-dim)] hidden md:block">
          共 <span className="font-mono-numeric text-[var(--pulse-text)]">{totalCount}</span> 项
          {totalCount === 0 ? <span className="ml-1">· 暂无监控</span> : healthyCount === totalCount ? (
            <span className="text-emerald-500 ml-1">· 全部正常</span>
          ) : (
            <span className="text-amber-500 ml-1">· {healthyCount}/{totalCount} 正常</span>
          )}
        </div>

        {/* Global Expand / Collapse All (in compact view) */}
        {viewMode === 'compact' && (
          <button
            type="button"
            onClick={onToggleAllExpand}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--pulse-text-muted)] hover:border-[var(--pulse-border-hover)] hover:text-[var(--pulse-text)] transition-colors"
            title="全部展开或收起所有监控项详情"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            <span>{isAllExpanded ? '全部收起' : '全部展开'}</span>
          </button>
        )}

        {/* View Mode Toggle */}
        <div className="flex items-center rounded-lg border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange('compact')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
              viewMode === 'compact'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text)]'
            }`}
            title="Uptime Kuma 紧凑条目视图 (点击可展开详情)"
          >
            <LayoutList className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">紧凑</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('cards')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
              viewMode === 'cards'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-[var(--pulse-text-dim)] hover:text-[var(--pulse-text)]'
            }`}
            title="传统大卡片视图"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">卡片</span>
          </button>
        </div>
      </div>
    </div>
  )
}
