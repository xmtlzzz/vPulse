// A fixed UTC+8 calendar keeps archived dates consistent across visitor devices.
export const INCIDENT_TIME_ZONE = 'Asia/Shanghai'
const DAY = 86400
const OFFSET = 8 * 3600

export function incidentDate(timestamp: number): string {
  return new Date((timestamp + OFFSET) * 1000).toISOString().slice(0, 10)
}

export function incidentMonth(timestamp = Math.floor(Date.now() / 1000)): string {
  return incidentDate(timestamp).slice(0, 7)
}

export function monthBounds(month: string): [number, number] | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const year = Number(month.slice(0, 4)), m = Number(month.slice(5))
  if (year < 1970 || year > 9998) return null
  return [Date.UTC(year, m - 1, 1) / 1000 - OFFSET, Date.UTC(year, m, 1) / 1000 - OFFSET]
}

export function dayBounds(day: string): [number, number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !monthBounds(day.slice(0, 7))) return null
  const start = Date.parse(`${day}T00:00:00+08:00`) / 1000
  if (!Number.isFinite(start) || incidentDate(start) !== day) return null
  return [start, start + DAY]
}

export function shiftIncidentMonth(month: string, delta: number): string {
  const bounds = monthBounds(month)!
  const date = new Date((bounds[0] + OFFSET) * 1000)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return date.toISOString().slice(0, 7)
}

export function calendarDays(month: string): (string | null)[] {
  const [start, end] = monthBounds(month)!
  const weekday = (new Date((start + OFFSET) * 1000).getUTCDay() + 6) % 7
  const days: (string | null)[] = Array(weekday).fill(null)
  for (let t = start; t < end; t += DAY) days.push(incidentDate(t))
  while (days.length % 7) days.push(null)
  return days
}

export function incidentDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    timeZone: INCIDENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}
