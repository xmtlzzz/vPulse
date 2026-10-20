import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Header } from './components/Header'
import { OverallStatusBanner } from './components/OverallStatusBanner'
import { MonitorGroup } from './components/MonitorGroup'
import { MonitorToolbar } from './components/MonitorToolbar'
import { IncidentSection } from './components/IncidentSection'
import { IncidentArchive } from './components/IncidentArchive'
import { GlobalNavPill } from './components/GlobalNavPill'
import { AddMonitorModal } from './components/AddMonitorModal'
import { FloatingNotification } from './components/FloatingNotification'
import { ManagementPanel } from './components/ManagementPanel'
import { useTheme } from './lib/useTheme'
import { useDynamicFavicon } from './lib/useDynamicFavicon'
import {
  apiRequest,
  fetchStatus,
  triggerProbe,
  probeSingleMonitorById,
  deleteMonitorById,
  EMPTY_STATUS,
} from './lib/api'
import { readPreference, savePreference } from './lib/storage'
import { groupMonitors, markUnavailable, remainingSeconds, projectFreshness } from './lib/status'
import type { StatusResponse, ProbeProgress } from './types'

export function App() {
  const { isDark, toggleTheme } = useTheme()
  const [data, setData] = useState<StatusResponse>(EMPTY_STATUS)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasStatusError, setHasStatusError] = useState(false)
  const [networkError, setNetworkError] = useState('')
  const [notice, setNotice] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [incidentArchive, setIncidentArchive] = useState<{ id?: string } | null>(null)
  const [management, setManagement] = useState<{ id?: string; tab: 'monitors' | 'history' } | null>(
    null
  )
  const [progress, setProgress] = useState<ProbeProgress>({
    success: true,
    active: false,
    items: [],
  })
  const [progressError, setProgressError] = useState(false)
  const progressActive = useRef(false)
  const [viewMode, setViewMode] = useState<'compact' | 'cards'>(() =>
    readPreference('vpulse-view-mode') === 'cards' ? 'cards' : 'compact'
  )
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [isAutoProbeEnabled, setIsAutoProbeEnabled] = useState(true)
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000))
  const [hoveredMonitorId, setHoveredMonitorId] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const isProbingRef = useRef(false)
  const displayData = useMemo(() => projectFreshness(data, clock), [data, clock])
  const countdown = remainingSeconds(displayData.overall.next_check_at, clock)
  useDynamicFavicon(displayData.overall, displayData.monitors)

  const activeNotice = networkError
    ? '状态读取失败：' +
      networkError +
      (data.monitors.length
        ? '。已保留最后一次记录，当前状态未知。'
        : '。当前状态未知，暂无历史记录可展示。')
    : notice

  const handleDismissNotice = useCallback(() => {
    setNotice('')
    setNetworkError('')
  }, [])

  // Auto-dismiss notification after 3.2s
  useEffect(() => {
    if (!notice && !networkError) return
    const timer = window.setTimeout(() => {
      setNotice('')
      setNetworkError('')
    }, 3200)
    return () => window.clearTimeout(timer)
  }, [notice, networkError])

  const hasActiveIncident = useMemo(
    () => displayData.incidents.some((i) => i.status !== 'resolved'),
    [displayData.incidents]
  )

  const handleSelectMonitorFromIncident = (monitorId: string) => {
    setExpandedIds((prev) => new Set(prev).add(monitorId))
    const el = document.getElementById(`monitor-${monitorId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const handleViewModeChange = (mode: 'compact' | 'cards') => {
    setViewMode(mode)
    savePreference('vpulse-view-mode', mode)
  }
  const loadData = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current
    try {
      const result = await fetchStatus(signal)
      if (sequence !== requestSequence.current || signal?.aborted) return
      setData(result)
      setNetworkError('')
      setHasStatusError(false)
    } catch (error) {
      if (sequence !== requestSequence.current || signal?.aborted) return
      setData(markUnavailable)
      setHasStatusError(true)
      setNetworkError(error instanceof Error ? error.message : '无法读取监控状态')
    } finally {
      if (sequence === requestSequence.current && !signal?.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => {
      controller.abort()
      requestSequence.current++
    }
  }, [loadData])
  useEffect(() => {
    const timer = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!isAutoProbeEnabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadData()
    }, 15000)
    const visible = () => {
      if (document.visibilityState === 'visible') void loadData()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [isAutoProbeEnabled, loadData])

  useEffect(() => {
    if (!isAutoProbeEnabled && !isRefreshing) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (document.visibilityState === 'visible') {
          const next = await apiRequest<ProbeProgress>('/api/progress', {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
          })
          if (controller.signal.aborted) return
          setProgress(next)
          setProgressError(false)
          if (progressActive.current && !next.active) void loadData()
          progressActive.current = next.active
        }
      } catch {
        if (!controller.signal.aborted) {
          setProgressError(true)
          setProgress({ success: false, active: false, items: [] })
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), isRefreshing || progressActive.current ? 2000 : 10000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [isAutoProbeEnabled, isRefreshing, loadData])

  const handleManualRefresh = async () => {
    if (isProbingRef.current) return
    isProbingRef.current = true
    setIsRefreshing(true)
    setNotice('')
    try {
      const result = await triggerProbe()
      setNotice(result.debounced ? result.message || '当前处于探测冷却期，未重复探测' : '巡检完成')
      await loadData()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '巡检失败')
    } finally {
      isProbingRef.current = false
      setIsRefreshing(false)
    }
  }
  const handleToggleAutoProbe = () => setIsAutoProbeEnabled((value) => !value)
  const handleSingleProbe = async (id: string) => {
    try {
      const result = await probeSingleMonitorById(id)
      setNotice(
        result.debounced ? result.message || '该监控项处于冷却期，未重复探测' : '单项巡检完成'
      )
      await loadData()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '单项巡检失败')
    }
  }
  const handleDeleteMonitor = async (id: string) => {
    const result = await deleteMonitorById(id)
    if (!result.success) {
      setNotice(result.error || '删除失败')
      return
    }
    setExpandedIds((previous) => {
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    setNotice('监控项已删除')
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
    if (!searchQuery.trim()) return displayData.monitors
    const q = searchQuery.toLowerCase().trim()
    return displayData.monitors.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.url.toLowerCase().includes(q) ||
        (m.group_name && m.group_name.toLowerCase().includes(q))
    )
  }, [displayData.monitors, searchQuery])

  // Group monitors by group_name
  const groupedMonitors = useMemo(() => groupMonitors(filteredMonitors), [filteredMonitors])

  const isAllExpanded =
    filteredMonitors.length > 0 && filteredMonitors.every((m) => expandedIds.has(m.id))

  const handleToggleAllExpand = () => {
    if (isAllExpanded) {
      setExpandedIds(new Set())
    } else {
      setExpandedIds(new Set(filteredMonitors.map((m) => m.id)))
    }
  }

  const existingGroups = useMemo(() => {
    const set = new Set<string>()
    for (const m of displayData.monitors) {
      if (m.group_name && m.group_name.trim()) {
        set.add(m.group_name.trim())
      }
    }
    if (set.size === 0) {
      set.add('核心站点 (Portals)')
      set.add('边缘服务与存储 (Edge & Storage)')
    }
    return Array.from(set)
  }, [displayData.monitors])

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
        isRefreshing={isRefreshing || progress.active}
        progressLabel={
          progress.active
            ? `巡检中 · ${progress.items.filter((p) => p.stage === 'complete' || p.stage === 'failed').length}/${progress.items.length}`
            : undefined
        }
        isLoading={isLoading}
        statusError={hasStatusError}
        onRefresh={handleManualRefresh}
        lastUpdated={displayData.overall.updated_at}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onOpenManagement={() => setManagement({ tab: 'monitors' })}
        countdown={countdown}
        isAutoProbeEnabled={isAutoProbeEnabled}
        onToggleAutoProbe={handleToggleAutoProbe}
      />

      {/* Add Monitor Dynamic Modal */}
      <AddMonitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          setNotice('监控项已接入')
          void loadData()
        }}
        existingGroups={existingGroups}
      />
      {management && (
        <ManagementPanel
          monitors={displayData.monitors}
          initialId={management.id}
          initialTab={management.tab}
          onClose={() => setManagement(null)}
          onChange={() => void loadData()}
        />
      )}
      {incidentArchive && <IncidentArchive initialId={incidentArchive.id} onClose={() => setIncidentArchive(null)} />}

      {/* Floating Alert / Status Notification (Zero Layout Shift & Guaranteed Auto-Dismiss) */}
      <FloatingNotification
        message={activeNotice}
        isError={Boolean(networkError)}
        onDismiss={handleDismissNotice}
      />

      {/* Main Status Container */}
      <main className="relative z-10 flex-1 mx-auto w-full max-w-[1680px] px-4 py-8 sm:px-6 lg:px-8 xl:px-10 space-y-8 pb-28">
        {/* 1. Overall System Status Banner (Top Panoramic Health Metrics) */}
        <OverallStatusBanner overall={displayData.overall} isRefreshing={isRefreshing} />
        {progressError && (
          <p role="status" className="manage-help">
            巡检进度暂不可用；状态数据仍按计划刷新。
          </p>
        )}
        {progress.active && (
          <div role="status" className="manage-section text-sm flex flex-wrap gap-4">
            <strong>服务端巡检中</strong>
            <span>排队 {progress.items.filter((p) => p.stage === 'queued').length}</span>
            <span>探测 {progress.items.filter((p) => p.stage === 'probing').length}</span>
            <span>重试 {progress.items.filter((p) => p.stage === 'retrying').length}</span>
            <span>完成 {progress.items.filter((p) => p.stage === 'complete').length}</span>
          </div>
        )}

        {/* 2. Asymmetric Dual-Column Layout (vMaker Editorial Design) */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[440px_minmax(0,1fr)] gap-8 xl:gap-10 items-start">
          {/* Left Column: Incident & Recovery Timeline (Sticky on desktop, matching vMaker commit list) */}
          <aside
            className={`${hasActiveIncident ? 'order-1' : 'order-2'} lg:order-1 lg:sticky lg:top-24 space-y-4`}
          >
            <IncidentSection
              incidents={displayData.incidents}
              monitors={displayData.monitors}
              hoveredMonitorId={hoveredMonitorId}
              onHoverMonitor={setHoveredMonitorId}
              onSelectMonitor={handleSelectMonitorFromIncident}
              onOpenHistory={(id) => setIncidentArchive({ id })}
            />
          </aside>

          {/* Right Column: Search Toolbar & Grouped Monitors */}
          <div
            className={`${hasActiveIncident ? 'order-2' : 'order-1'} lg:order-2 min-w-0 space-y-6`}
          >
            {/* Search & View Mode Toolbar */}
            <MonitorToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              isAllExpanded={isAllExpanded}
              onToggleAllExpand={handleToggleAllExpand}
              totalCount={displayData.monitors.length}
              healthyCount={displayData.overall.healthy_count}
              activeCount={displayData.overall.monitors_count}
            />

            {/* Grouped Monitors (Uptime Kuma compact rows by default) */}
            <div className="space-y-7">
              {groupedMonitors.size === 0 ? (
                <div className="rounded-xl border border-[var(--pulse-border)] bg-[var(--pulse-card)] p-8 text-center text-xs text-[var(--pulse-text-dim)]">
                  {isLoading
                    ? '正在读取真实监控状态…'
                    : searchQuery
                      ? '未找到匹配的监控服务'
                      : networkError || hasStatusError
                        ? '暂无可用的监控数据'
                        : '尚未添加监控服务'}
                </div>
              ) : (
                Array.from(groupedMonitors).map(([groupName, monitors]) => (
                  <MonitorGroup
                    key={groupName}
                    groupName={groupName}
                    monitors={monitors}
                    viewMode={viewMode}
                    expandedIds={expandedIds}
                    onToggleExpand={handleToggleExpand}
                    onToggleGroupExpand={handleToggleGroupExpand}
                    onSingleProbe={handleSingleProbe}
                    onDelete={handleDeleteMonitor}
                    progress={progress}
                    onManage={(id, tab) => setManagement({ id, tab })}
                    hoveredMonitorId={hoveredMonitorId}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="pt-8 border-t border-[var(--pulse-border)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--pulse-text-dim)]">
          <p>vPulse · Cloudflare 定时巡检 (Workers + D1 + Cron)</p>
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
