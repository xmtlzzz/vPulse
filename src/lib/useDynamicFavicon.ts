import { useEffect } from 'react'
import { OverallStatus, Monitor } from '../types'

export function useDynamicFavicon(overall: OverallStatus, monitors: Monitor[]) {
  useEffect(() => {
    const isOutage = overall.status === 'outage'
    const isDegraded = overall.status === 'degraded'
    const downCount = monitors.filter((m) => m.current_status === 0).length

    // 1. Dynamic Title
    if (isOutage) {
      document.title = `🔴 (${downCount}项中断) vPulse · 边缘告警`
    } else if (isDegraded) {
      document.title = `🟡 (延迟偏高) vPulse · 边缘探活`
    } else {
      document.title = `🟢 vPulse · 全部服务正常运行`
    }

    // 2. Dynamic SVG Favicon (Green / Amber / Rose glowing dot)
    const color = isOutage ? '#f43f5e' : isDegraded ? '#f59e0b' : '#10b981'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="${color}"/>
      <path d="M7 16h4l2.5-6 5 12 2.5-6h4" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`
    const faviconUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`

    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'shortcut icon'
      document.head.appendChild(link)
    }
    link.href = faviconUrl
  }, [overall.status, monitors])
}
