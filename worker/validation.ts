export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export function targetUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new HttpError(400, '目标 URL 无效')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HttpError(400, '目标 URL 无效')
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  // DNS names only; URL canonicalization also catches decimal/octal IPv4 forms.
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && !['80', '443'].includes(url.port)) ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.length > 253 ||
    !host.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) ||
    /\.(localhost|localdomain|local|internal|lan|home|test|invalid|arpa|onion)$/.test(host)
  ) {
    throw new HttpError(400, '仅允许公开域名的 HTTP/HTTPS 地址，不允许凭据、私网地址或自定义端口')
  }
  url.hostname = host
  return url
}

// Fail closed for private, loopback, link-local, multicast and special-use DNS
// answers. IPv6 accepts native global unicast only, excluding transition ranges.
export function isPublicAddress(address: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const octets = address.split('.').map(Number)
    if (octets.some((octet) => octet > 255)) return false
    const [a, b, c] = octets
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  try {
    const host = new URL(`https://[${address}]/`).hostname.slice(1, -1)
    const [first, second = '0'] = host.split(':')
    const prefix = parseInt(first, 16)
    return (
      prefix >= 0x2000 &&
      prefix <= 0x3fff &&
      prefix !== 0x2002 &&
      prefix !== 0x3fff &&
      !(
        prefix === 0x2001 &&
        (parseInt(second || '0', 16) < 0x200 || parseInt(second, 16) === 0xdb8)
      )
    )
  } catch {
    return false
  }
}

export function text(value: unknown, label: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new HttpError(400, `${label}必须为 1–${max} 字符的文本`)
  }
  return value.trim()
}

function integer(value: unknown, fallback: number, min: number, max: number, label: string) {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isInteger(result) || result < min || result > max)
    throw new HttpError(400, `${label}范围为 ${min}–${max}`)
  return result
}

export function monitorInput(body: Record<string, unknown>) {
  const method = body.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(400, '请求方式仅支持 GET / HEAD')
  for (const key of ['keyword', 'json_path', 'json_expected'])
    if (body[key] !== undefined && typeof body[key] !== 'string')
      throw new HttpError(400, '内容断言必须为文本')
  const keyword = (body.keyword as string) ?? ''
  const json_path = (body.json_path as string) ?? ''
  const json_expected = (body.json_expected as string) ?? ''
  if (keyword.length > 1000 || json_expected.length > 1000 || json_path.length > 200)
    throw new HttpError(400, '内容断言过长')
  if (json_path && !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(json_path))
    throw new HttpError(400, 'JSON 路径需使用点分字段，如 components.db.status')
  if (json_path) {
    try {
      JSON.parse(json_expected)
    } catch {
      throw new HttpError(400, 'JSON 期望值必须是有效 JSON，如 true、200 或 "UP"')
    }
  }
  if (method === 'HEAD' && (keyword || json_path)) throw new HttpError(400, '内容断言需要 GET 请求')
  return {
    name: text(body.name, '名称', 100),
    group_name: text(body.group_name ?? '自定义服务', '分组', 80),
    url: targetUrl(body.url).href,
    method,
    expected_status: integer(body.expected_status, 200, 200, 599, '状态码'),
    interval_min: integer(body.interval_min, 3, 1, 60, '巡检间隔（分钟）'),
    timeout_ms: integer(body.timeout_ms, 6000, 100, 10000, '超时（毫秒）'),
    keyword,
    json_path,
    json_expected,
    failure_threshold: integer(body.failure_threshold, 1, 1, 10, '连续失败轮次'),
    notify_recovery: integer(body.notify_recovery, 1, 0, 1, '恢复通知'),
    reminder_min: integer(body.reminder_min, 0, 0, 1440, '重复提醒（分钟）'),
    maintenance_until: integer(
      body.maintenance_until,
      0,
      0,
      Math.floor(Date.now() / 1000) + 365 * 86400,
      '维护结束时间'
    ),
  } as const
}

export async function readJson(
  request: Request,
  maxBytes = 8192
): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.includes('application/json'))
    throw new HttpError(415, '需要 application/json')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, '请求正文为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new HttpError(413, '请求正文过大')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'JSON 正文无效')
  }
}
