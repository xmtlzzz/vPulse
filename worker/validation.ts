export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function targetUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new HttpError(400, '目标 URL 无效')
  let url: URL
  try { url = new URL(value) } catch { throw new HttpError(400, '目标 URL 无效') }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  // DNS names only; URL canonicalization also catches decimal/octal IPv4 forms.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
      (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') ||
      /^[\d.]+$/.test(host) || host.includes(':') || host.length > 253 ||
      !host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) ||
      /\.(localhost|localdomain|local|internal|lan|home|test|invalid|arpa|onion)$/.test(host)) {
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
    if (octets.some(octet => octet > 255)) return false
    const [a, b, c] = octets
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113))
  }
  try {
    const host = new URL(`https://[${address}]/`).hostname.slice(1, -1)
    const [first, second = '0'] = host.split(':')
    const prefix = parseInt(first, 16)
    return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2002 && prefix !== 0x3fff &&
      !(prefix === 0x2001 && (parseInt(second || '0', 16) < 0x200 || parseInt(second, 16) === 0xdb8))
  } catch { return false }
}

export function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value)) {
    throw new HttpError(400, `${label}必须为 1–${max} 字符的文本`)
  }
  return value.trim()
}

function integer(value: unknown, fallback: number, min: number, max: number, label: string) {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isInteger(result) || result < min || result > max) throw new HttpError(400, `${label}范围为 ${min}–${max}`)
  return result
}

export function monitorInput(body: Record<string, unknown>) {
  const method = body.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(400, '请求方式仅支持 GET / HEAD')
  return {
    name: text(body.name, '名称', 100),
    group_name: text(body.group_name ?? '自定义服务', '分组', 80),
    url: targetUrl(body.url).href,
    method,
    expected_status: integer(body.expected_status, 200, 200, 599, '状态码'),
    interval_min: integer(body.interval_min, 3, 1, 60, '巡检间隔（分钟）'),
    timeout_ms: integer(body.timeout_ms, 6000, 100, 10000, '超时（毫秒）'),
  } as const
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(415, '需要 application/json')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, '请求正文为空')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) { await reader.cancel(); throw new HttpError(413, '请求正文过大') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch { throw new HttpError(400, 'JSON 正文无效') }
}
