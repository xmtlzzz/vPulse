import { useState, useEffect, useCallback, useMemo } from 'react'
import { Header } from './components/Header'
import { OverallStatusBanner } from './components/OverallStatusBanner'
import { MonitorGroup } from './components/MonitorGroup'
import { IncidentSection } from './components/IncidentSection'
import { GlobalNavPill } from './components/GlobalNavPill'
import { AddMonitorModal } from './components/AddMonitorModal'
import { useTheme } from './lib/useTheme'
import { fetchStatus, triggerProbe, FALLBACK_STATUS } from './lib/api'
import { StatusResponse, Monitor } from './types'

export function App() {
  const { isDark, toggleTheme } = useTheme()
  const [data, setData] = useState<StatusResponse>(FALLBACK_STATUS)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  const loadData = useCallback(async () => {
    const res = await fetchStatus()
    setData(res)
  }, [])

  useEffect(() => {
    void loadData()
    // Poll every 60 seconds
    const interval = setInterval(() => {
      void loadData()
    }, 60000)
    return () => clearInterval(interval)
  }, [loadData])

  const handleManualRefresh = async () => {
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
    }
  }

  // Group monitors by group_name
  const groupedMonitors = useMemo(() => {
    const groups: Record<string, Monitor[]> = {}
    for (const monitor of data.monitors) {
      const g = monitor.group_name || '其他服务'
      if (!groups[g]) groups[g] = []
      groups[g].push(monitor)
    }
    return groups
  }, [data.monitors])

  return (
    <div className="min-h-screen flex flex-col relative selection:bg-emerald-500 selection:text-black">
      {/* Top Refresh Laser Bar during probe */}
      {isRefreshing && (
        <div className="refresh-progress-bar">
          <div className="refresh-progress-indicator" />
        </div>
      )}

      {/* Ambient background light */}
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
      />

      {/* Add Monitor Dynamic Modal */}
      <AddMonitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => handleManualRefresh()}
      />

      {/* Main Status Container */}
      <main className="relative z-10 flex-1 mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 space-y-8 pb-28">
        {/* 1. Overall System Status Banner */}
        <OverallStatusBanner
          overall={data.overall}
          isRefreshing={isRefreshing}
        />

        {/* 2. Incidents & Announcements */}
        <IncidentSection incidents={data.incidents} />

        {/* 3. Grouped Monitor Cards */}
        <div className="space-y-8">
          {Object.entries(groupedMonitors).map(([groupName, monitors]) => (
            <MonitorGroup
              key={groupName}
              groupName={groupName}
              monitors={monitors}
              isRefreshing={isRefreshing}
            />
          ))}
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
