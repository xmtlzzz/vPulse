import type { Env } from './env'
import { HttpError } from './validation'

const COOKIE = 'vpulse-session'
const SESSION_SECONDS = 30 * 86400
const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('')
const digest = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
const signingKey = (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

export async function authorize(request: Request, env: Env, freshToken = false): Promise<void> {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, '管理员尚未配置 ADMIN_TOKEN，管理操作已关闭')
  const header = request.headers.get('Authorization')
  if (header !== null) {
    const match = /^Bearer (\S+)$/i.exec(header)
    if (!match || match[1].length > 1024) throw new HttpError(401, '需要有效的管理员密钥')
    const key = await signingKey(hex(crypto.getRandomValues(new Uint8Array(32)).buffer))
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(match[1]))
    if (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(env.ADMIN_TOKEN))) return
    throw new HttpError(401, '管理员密钥无效')
  }
  if (freshToken) throw new HttpError(401, '添加项目或记住设备需要重新输入管理员密钥确认')
  const cookie = request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  if (cookie && /^[a-f0-9]{64}$/.test(cookie)) {
    const tokenHash = await digest(cookie)
    const row = await env.DB.prepare(
      'SELECT credential_tag FROM admin_sessions WHERE token_hash=? AND expires_at>?'
    )
      .bind(tokenHash, Math.floor(Date.now() / 1000))
      .first<{ credential_tag: string }>()
    if (row && /^[a-f0-9]{64}$/.test(row.credential_tag)) {
      const signature = Uint8Array.from(row.credential_tag.match(/../g)!, (byte) =>
        parseInt(byte, 16)
      )
      if (
        await crypto.subtle.verify(
          'HMAC',
          await signingKey(env.ADMIN_TOKEN),
          signature,
          encoder.encode(tokenHash)
        )
      )
        return
    }
  }
  throw new HttpError(401, '设备授权未验证或已过期，请在“添加项目”中验证管理密钥并记住设备')
}

// Only a random session is sent to the browser; D1 stores its hash and a tag
// bound to ADMIN_TOKEN. Rotating that secret revokes every existing session.
export async function rememberDevice(request: Request, env: Env): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const tokenHash = await digest(token)
  const tag = hex(
    await crypto.subtle.sign('HMAC', await signingKey(env.ADMIN_TOKEN!), encoder.encode(tokenHash))
  )
  const now = Math.floor(Date.now() / 1000)
  const oldCookie = request.headers
    .get('Cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    ...(oldCookie
      ? [
          env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(
            await digest(oldCookie)
          ),
        ]
      : []),
    env.DB.prepare(
      'INSERT INTO admin_sessions(token_hash,credential_tag,expires_at) VALUES(?,?,?)'
    ).bind(tokenHash, tag, now + SESSION_SECONDS),
    env.DB.prepare(
      'INSERT INTO session_devices(token_hash,id,label,created_at) VALUES(?,?,?,?)'
    ).bind(
      tokenHash,
      crypto.randomUUID(),
      (request.headers.get('User-Agent') ?? '浏览器设备').slice(0, 160),
      now
    ),
  ])
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`
}

export async function deviceList(request: Request, env: Env) {
  const cookie = request.headers
    .get('Cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  const current = cookie ? await digest(cookie) : ''
  const rows = await env.DB.prepare(
    `SELECT d.id,d.label,d.created_at,s.expires_at,s.token_hash,s.credential_tag FROM session_devices d
    JOIN admin_sessions s ON s.token_hash=d.token_hash WHERE s.expires_at>? ORDER BY d.created_at DESC`
  )
    .bind(Math.floor(Date.now() / 1000))
    .all<{
      id: string
      label: string
      created_at: number
      expires_at: number
      token_hash: string
      credential_tag: string
    }>()
  const devices = []
  for (const row of rows.results) {
    const tag = Uint8Array.from(row.credential_tag.match(/../g) ?? [], (b) => parseInt(b, 16))
    if (
      await crypto.subtle.verify(
        'HMAC',
        await signingKey(env.ADMIN_TOKEN!),
        tag,
        encoder.encode(row.token_hash)
      )
    ) {
      devices.push({
        id: row.id,
        label: row.label,
        created_at: row.created_at,
        expires_at: row.expires_at,
        current: row.token_hash === current,
      })
    }
  }
  return devices
}

export async function logout(request: Request, env: Env) {
  const cookie = request.headers
    .get('Cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  if (cookie)
    await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?')
      .bind(await digest(cookie))
      .run()
  return `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}
