import type { Heartbeat, MonitorConfig } from '../src/types'
import { isPublicAddress, targetUrl } from './validation'

export interface HeartbeatResult extends Heartbeat {
  monitor_id: string
  status: 0 | 1 | 2
  ssl_days_remaining: null
  message: string
}

const MAX_JSON_BYTES = 64 * 1024

function equalJson(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object')
    return false
  if (Array.isArray(actual) || Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((v, i) => equalJson(v, expected[i]))
    )
  const a = actual as Record<string, unknown>,
    b = expected as Record<string, unknown>
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]))
  )
}

export async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  return JSON.parse(await boundedText(response, signal))
}

async function boundedText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('健康接口正文为空')
  const chunks: Uint8Array[] = []
  let length = 0
  let rejectAbort: (reason: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    void reader.cancel().catch(() => {})
    rejectAbort(new Error('探测超时'))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (signal.aborted) throw new Error('探测超时')
      if (done) break
      length += value.byteLength
      if (length > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new Error('健康接口 JSON 超过 64 KiB')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return new TextDecoder().decode(bytes)
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

function jsonHealth(body: unknown): { status: 0 | 1 | 2; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('健康接口 JSON 必须为对象')
  const data = body as Record<string, unknown>
  const classify = (s: unknown) =>
    typeof s !== 'string'
      ? 1
      : /^(DOWN|ERROR|FAIL|FAILED|UNHEALTHY)$/i.test(s)
        ? 0
        : /^(DEGRADED|WARN|WARNING)$/i.test(s)
          ? 2
          : 1
  let status = classify(data.status)
  const parts: string[] = []
  if (data.components && typeof data.components === 'object' && !Array.isArray(data.components)) {
    for (const [name, raw] of Object.entries(data.components)) {
      if (!raw || typeof raw !== 'object') continue
      const component = raw as Record<string, unknown>
      const state = classify(component.status)
      if (state === 0) status = 0
      else if (state === 2 && status !== 0) status = 2
      parts.push(
        `${name}:${typeof component.latency_ms === 'number' ? `${component.latency_ms}ms` : String(component.status ?? 'ok')}`
      )
    }
  }
  const detail = [data.error, data.message].find((v) => typeof v === 'string') as string | undefined
  return {
    status: status as 0 | 1 | 2,
    message: (detail || parts.join(' · ') || (status === 0 ? '应用健康检查失败' : 'OK')).slice(
      0,
      500
    ),
  }
}

async function assertPublicDns(url: URL, signal: AbortSignal): Promise<void> {
  const answers = await Promise.all(
    ['A', 'AAAA'].map(async (type) => {
      const query = new URL('https://cloudflare-dns.com/dns-query')
      query.searchParams.set('name', url.hostname)
      query.searchParams.set('type', type)
      // workerd only supports follow/manual. A DNS redirect is rejected below
      // rather than followed to an untrusted resolver.
      const response = await fetch(query.href, {
        headers: { Accept: 'application/dns-json' },
        redirect: 'manual',
        signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('无法验证目标域名的公网 DNS')
      }
      const body = (await boundedJson(response, signal)) as {
        Status?: number
        TC?: boolean
        Answer?: { type: number; data: string }[]
      } | null
      if (
        !body ||
        body.Status !== 0 ||
        body.TC ||
        (body.Answer !== undefined && !Array.isArray(body.Answer))
      ) {
        throw new Error('无法验证目标域名的公网 DNS')
      }
      return (body.Answer ?? []).flatMap((record) => {
        if (!record || typeof record.type !== 'number') throw new Error('目标域名的 DNS 响应无效')
        if (record.type !== 1 && record.type !== 28) return []
        if (typeof record.data !== 'string' || !isPublicAddress(record.data))
          throw new Error('目标域名解析到非公网地址，已拒绝探测')
        return [record.data]
      })
    })
  )
  if (!answers.flat().length) throw new Error('目标域名没有可用的公网 DNS 地址')
}

async function attempt(monitor: MonitorConfig): Promise<HeartbeatResult> {
  const controller = new AbortController()
  // Bound legacy configurations too; old database rows bypass creation validation.
  const timeout = Number.isFinite(monitor.timeout_ms)
    ? Math.max(1, Math.min(10000, monitor.timeout_ms))
    : 6000
  const timer = setTimeout(() => controller.abort(), timeout)
  let started = performance.now()
  let code: number | null = null
  try {
    if (monitor.method !== 'GET' && monitor.method !== 'HEAD')
      throw new Error('请求方式仅支持 GET / HEAD')
    let url = targetUrl(monitor.url)
    let response: Response | undefined
    for (let redirects = 0; redirects <= 3; redirects++) {
      // Validate each hop and every retry; no static host list or DNS trust cache.
      await assertPublicDns(url, controller.signal)
      if (redirects === 0) started = performance.now()
      response = await fetch(url.href, {
        method: monitor.method,
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'vPulse/1.0 health-check', Accept: '*/*' },
      })
      code = response.status
      if (![301, 302, 303, 307, 308].includes(code) || !response.headers.has('location')) break
      const location = response.headers.get('location')!
      await response.body?.cancel()
      if (redirects === 3) throw new Error('重定向超过 3 次')
      url = targetUrl(new URL(location, url).href)
    }
    if (!response) throw new Error('未收到响应')
    let status: 0 | 1 | 2 = 1
    let message = 'OK'
    if (response.status !== monitor.expected_status) {
      status = 0
      message = `HTTP ${response.status}（期望 ${monitor.expected_status}）`
      await response.body?.cancel()
    } else if (
      monitor.method !== 'HEAD' &&
      (monitor.keyword ||
        monitor.json_path ||
        (response.status !== 204 &&
          /\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')))
    ) {
      const text = await boundedText(response, controller.signal)
      if (monitor.keyword && !text.includes(monitor.keyword))
        throw new Error('内容断言失败：未找到期望关键词')
      if (
        monitor.json_path ||
        /\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')
      ) {
        const body: unknown = JSON.parse(text)
        if (monitor.json_path) {
          let actual: unknown = body
          for (const key of monitor.json_path.split('.')) {
            actual =
              actual && typeof actual === 'object' && Object.hasOwn(actual, key)
                ? (actual as Record<string, unknown>)[key]
                : undefined
          }
          if (!equalJson(actual, JSON.parse(monitor.json_expected ?? 'null')))
            throw new Error(`JSON 断言失败：${monitor.json_path} 与期望值不符`)
        }
        const health = jsonHealth(body)
        status = health.status
        message = health.message
      }
    } else {
      await response.body?.cancel()
    }
    if (controller.signal.aborted) throw new Error('探测超时')
    const latency = Math.round(performance.now() - started)
    if (status === 1 && latency > Math.max(2500, timeout * 0.65)) {
      status = 2
      message = `响应偏慢 (${latency}ms)`
    }
    return {
      monitor_id: monitor.id,
      status,
      status_code: code,
      latency_ms: latency,
      ssl_days_remaining: null,
      message,
      timestamp: Math.floor(Date.now() / 1000),
    }
  } catch (error) {
    return {
      monitor_id: monitor.id,
      status: 0,
      status_code: code,
      latency_ms: null,
      ssl_days_remaining: null,
      message: controller.signal.aborted
        ? `探测超时（${timeout}ms）`
        : (error instanceof Error ? error.message : '网络错误').slice(0, 500),
      timestamp: Math.floor(Date.now() / 1000),
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

export async function probeSingleMonitor(
  monitor: MonitorConfig,
  progress?: (stage: 'probing' | 'retrying') => Promise<void>
): Promise<HeartbeatResult> {
  await progress?.('probing')
  const first = await attempt(monitor)
  if (first.status !== 0) return first
  await progress?.('retrying')
  const second = await attempt(monitor)
  if (second.status !== 0) second.message = `${second.message}（重试后恢复）`
  return second
}
