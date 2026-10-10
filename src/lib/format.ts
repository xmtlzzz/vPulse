export function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.floor(Date.now() / 1000) - timestamp
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDays = Math.floor(diffHour / 24)
  return `${diffDays} 天前`
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function formatUptimePercent(val: number): string {
  return `${val.toFixed(2)}%`
}

export function formatLatency(val: number): string {
  return `${val} ms`
}
