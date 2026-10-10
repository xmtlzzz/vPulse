export function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return '尚无探测记录'
  const diffSec = Math.floor(Date.now() / 1000) - timestamp
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDays = Math.floor(diffHour / 24)
  return `${diffDays} 天前`
}

export function formatDateTime(timestamp: number | null): string {
  if (timestamp === null) return '尚无探测记录'
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

export function formatUptimePercent(val: number | null): string {
  return val === null ? '—' : `${val.toFixed(2)}%`
}

export function formatLatency(val: number | null): string {
  return val === null ? '—' : `${val} ms`
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分钟` : `${hours} 小时`
  }
  const days = Math.floor(hours / 24)
  return `${days} 天`
}

