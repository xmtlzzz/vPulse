import { useState, useEffect, useCallback, useMemo } from 'react'
import { Header } from './components/Header'
import { OverallStatusBanner } from './components/OverallStatusBanner'
import { MonitorGroup } from './components/MonitorGroup'
import { MonitorToolbar } from './components/MonitorToolbar'
import { IncidentSection } from './components/IncidentSection'
import { GlobalNavPill } from './components/GlobalNavPill'
import { AddMonitorModal } from './components/AddMonitorModal'
import { useTheme } from './lib/useTheme'
import { useDynamicFavicon } from './lib/useDynamicFavicon'
import {
  fetchStatus,
  triggerProbe,
  probeSingleMonitorById,
  deleteMonitorById,
  FALLBACK_STATUS,
} from './lib/api'
import { StatusResponse, Monitor } from './types'

export function App() {
  const { isDark, toggleTheme } = useTheme()
  const [data, setData] = useState<StatusResponse>(FALLBACK_STATUS)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  // Dynamic Browser Title and Favicon
  useDynamicFavicon(data.overall, data.monitors)

  // View preferences
  const [viewMode, setViewMode] = useState<'compact' | 'cards'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vpulse-view-mode')
      if (saved === 'cards' || saved === 'compact') return saved
    }
    return 'compact'
  })

  // Set of currently expanded monitor IDs (accordion)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Search keyword query
  const [searchQuery, setSearchQuery] = useState('')

  const handleViewModeChange = (mode: 'compact' | 'cards') => {
    setViewMode(mode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('vpulse-view-mode', mode)
    }
  }

  const AUTO_PROBE_INTERVAL = 180 // 3 minutes (180s) auto probe cycle
  const [countdown, setCountdown] = useState(AUTO_PROBE_INTERVAL)
  const [isAutoProbeEnabled, setIsAutoProbeEnabled] = useState(true)

  const loadData = useCallback(async () => {
    const res = await fetchStatus()
    setData(res)
  }, [])

  const executeProbeCycle = useCallback(async () => {
    setIsRefreshing(true)
    const startTime = performance.now()
    try {
      await triggerProbe()
      await loadData()
    } finally {
      const elapsed = performance.now() - startTime
      if (elapsed < 600) {
        await new Promise((resolve) => setTimeout(resolve, 600 - elapsed))
      }
      setIsRefreshing(false)
      setCountdown(AUTO_PROBE_INTERVAL)
    }
  }, [loadData])

  // Initial load
  useEffect(() => {
    void loadData()
  }, [loadData])

  // Real second-by-second countdown and automatic probe trigger
  useEffect(() => {
    if (!isAutoProbeEnabled) return

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void executeProbeCycle()
          return AUTO_PROBE_INTERVAL
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [isAutoProbeEnabled, executeProbeCycle])

  // Auto reload when tab gains visibility
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadData()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loadData])

  const handleManualRefresh = () => {
    void executeProbeCycle()
  }

  const handleToggleAutoProbe = () => {
    setIsAutoProbeEnabled((prev) => !prev)
  }

  const handleSingleProbe = async (id: string) => {
    await probeSingleMonitorById(id)
    await loadData()
  }

  const handleDeleteMonitor = async (id: string) => {
    await deleteMonitorById(id)
    // Remove from expanded set if deleted
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    await loadData()
  }

  const handleToggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleToggleGroupExpand = (monitorIds: string[]) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      const allExpanded = monitorIds.every((id) => next.has(id))
      if (allExpanded) {
        for (const id of monitorIds) next.delete(id)
      } else {
        for (const id of monitorIds) next.add(id)
      }
      return next
    })
  }

  // Filtered monitors based on search
  const filteredMonitors = useMemo(() => {
    if (!searchQuery.trim()) return data.monitors
    const q = searchQuery.toLowerCase().trim()
    return data.monitors.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.url.toLowerCase().includes(q) ||
        (m.group_name && m.group_name.toLowerCase().includes(q))
    )
  }, [data.monitors, searchQuery])

  // Group monitors by group_name
  const groupedMonitors = useMemo(() => {
    const groups: Record<string, Monitor[]> = {}
    for (const monitor of filteredMonitors) {
      const g = monitor.group_name || '其他服务'
      if (!groups[g]) groups[g] = []
      groups[g].push(monitor)
    }
    return groups
  }, [filteredMonitors])

  const isAllExpanded =
    filteredMonitors.length > 0 &&
    filteredMonitors.every((m) => expandedIds.has(m.id))

  const handleToggleAllExpand = () => {
    if (isAllExpanded) {
      setExpandedIds(new Set())
    } else {
      setExpandedIds(new Set(filteredMonitors.map((m) => m.id)))
    }
  }

  const existingGroups = useMemo(() => {
    const set = new Set<string>()
    for (const m of data.monitors) {
      if (m.group_name && m.group_name.trim()) {
        set.add(m.group_name.trim())
      }
    }
    if (set.size === 0) {
      set.add('核心站点 (Portals)')
      set.add('边缘服务与存储 (Edge & Storage)')
    }
    return Array.from(set)
  }, [data.monitors])

  return (
    <div className="min-h-screen flex flex-col relative selection:bg-emerald-500 selection:text-black">
      {/* Top Refresh Laser Bar during probe */}
      {isRefreshing && (
        <div className="refresh-progress-bar">
          <div className="refresh-progress-indicator" />
        </div>
      )}

      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-emerald-500/5 blur-[120px]" />
      </div>

      {/* Top Header */}
      <Header
        isDark={isDark}
        onToggleTheme={toggleTheme}
        isRefreshing={isRefreshing}
        onRefresh={handleManualRefresh}
        lastUpdated={data.overall.updated_at}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        countdown={countdown}
        isAutoProbeEnabled={isAutoProbeEnabled}
        onToggleAutoProbe={handleToggleAutoProbe}
      />

      {/* Add Monitor Dynamic Modal */}
      <AddMonitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => handleManualRefresh()}
        existingGroups={existingGroups}
      />

      {/* Main Status Container */}
      <main className="relative z-10 flex-1 mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 space-y-7 pb-28">
        {/* 1. Overall System Status Banner */}
        <OverallStatusBanner
          overall={data.overall}
          isRefreshing={isRefreshing}
        />

        {/* 2. Incidents & Announcements */}
        <IncidentSection
          incidents={data.incidents}
          monitors={data.monitors}
        />

        {/* 3. Search & View Mode Toolbar */}
        <MonitorToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          isAllExpanded={isAllExpanded}
          onToggleAllExpand={handleToggleAllExpand}
          totalCount={data.monitors.length}
          healthyCount={data.overall.healthy_count}
        />

        {/* 4. Grouped Monitors (Uptime Kuma compact rows by default) */}
        <div className="space-y-7">
          {Object.keys(groupedMonitors).length === 0 ? (
            <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-8 text-center text-xs text-[var(--pulse-text-dim)]">
              未找到与 &quot;{searchQuery}&quot; 匹配的监控服务
            </div>
          ) : (
            Object.entries(groupedMonitors).map(([groupName, monitors]) => (
              <MonitorGroup
                key={groupName}
                groupName={groupName}
                monitors={monitors}
                isRefreshing={isRefreshing}
                viewMode={viewMode}
                expandedIds={expandedIds}
                onToggleExpand={handleToggleExpand}
                onToggleGroupExpand={handleToggleGroupExpand}
                onSingleProbe={handleSingleProbe}
                onDelete={handleDeleteMonitor}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <footer className="pt-8 border-t border-[var(--pulse-border)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--pulse-text-dim)]">
          <p>
            vPulse · 运行于 Cloudflare 全球边缘网络 (Workers + D1 + Cron)
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/louislam/uptime-kuma"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--pulse-text-muted)] transition-colors"
            >
              致敬 Uptime Kuma 交互美学
            </a>
            <span>·</span>
            <a
              href="https://vmaker.xmtlz.dev"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--pulse-text-muted)] transition-colors"
            >
              xmtlz 数字矩阵
            </a>
          </div>
        </footer>
      </main>

      {/* Global Ecosystem Floating Dock */}
      <GlobalNavPill />
    </div>
  )
}

export default App
