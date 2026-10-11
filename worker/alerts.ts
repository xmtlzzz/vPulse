import type { Env } from './env'
import { boundedJson } from './probe'

export interface Alert {
  monitor: string
  url: string
  status: 'DOWN' | 'UP' | 'DEGRADED'
  message: string
}

export function webhookPayload(
  alert: Alert,
  type: Env['WEBHOOK_TYPE'] = 'generic',
  chatId?: string
) {
  const text = `vPulse 状态变更\n项目: ${alert.monitor}\n状态: ${alert.status}\n地址: ${alert.url}\n说明: ${alert.message}`
  switch (type) {
    case 'discord':
      return { content: text.slice(0, 1900) }
    case 'telegram':
      if (!chatId) throw new Error('Telegram 告警需要 TELEGRAM_CHAT_ID')
      return { chat_id: chatId, text }
    case 'feishu':
      return { msg_type: 'text', content: { text } }
    case 'dingtalk':
      return { msgtype: 'text', text: { content: text } }
    default:
      return { ...alert, text }
  }
}

// Delivery has its own lease and runs after probe results have been returned.
export async function flushAlerts(env: Env) {
  if (!env.WEBHOOK_URL) return
  const now = Math.floor(Date.now() / 1000)
  const owner = crypto.randomUUID()
  const lease = await env.DB.prepare(
    `INSERT INTO probe_locks(key,owner,expires_at) VALUES('alerts',?,?)
    ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE probe_locks.expires_at<=? RETURNING owner`
  )
    .bind(owner, now + 60, now)
    .first()
  if (!lease) return
  try {
    const rows = await env.DB.prepare(
      'SELECT * FROM alert_outbox WHERE attempts<5 AND next_attempt_at<=? ORDER BY created_at,id LIMIT 3'
    )
      .bind(now)
      .all<{ id: string; payload: string; attempts: number; monitor_id?: string }>()
    for (const row of rows.results) {
      if (row.monitor_id) {
        const monitor = await env.DB.prepare(
          'SELECT m.enabled,COALESCE(s.maintenance_until,0) maintenance_until FROM monitors m LEFT JOIN monitor_settings s ON s.monitor_id=m.id WHERE m.id=?'
        )
          .bind(row.monitor_id)
          .first<{ enabled: number; maintenance_until: number }>()
        if (
          !monitor ||
          !monitor.enabled ||
          monitor.maintenance_until > Math.floor(Date.now() / 1000)
        ) {
          await env.DB.prepare('DELETE FROM alert_outbox WHERE id=?').bind(row.id).run()
          continue
        }
      }
      try {
        const signal = AbortSignal.timeout(5000)
        // Do not forward webhook payloads to redirects; non-2xx stays queued.
        const response = await fetch(env.WEBHOOK_URL, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            webhookPayload(JSON.parse(row.payload) as Alert, env.WEBHOOK_TYPE, env.TELEGRAM_CHAT_ID)
          ),
          signal,
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`Webhook HTTP ${response.status}`)
        }
        if (['telegram', 'feishu', 'dingtalk'].includes(env.WEBHOOK_TYPE ?? '')) {
          const body = await boundedJson(response, signal)
          if (!body || typeof body !== 'object') throw new Error('Webhook 返回无效结果')
          const value = body as Record<string, unknown>
          const accepted =
            env.WEBHOOK_TYPE === 'telegram'
              ? value.ok === true
              : env.WEBHOOK_TYPE === 'feishu'
                ? value.code === 0 || value.StatusCode === 0
                : value.errcode === 0
          if (!accepted) throw new Error('Webhook 平台拒绝消息，请检查渠道配置')
        } else {
          await response.body?.cancel()
        }
        const alert = JSON.parse(row.payload) as Alert
        await env.DB.batch([
          env.DB.prepare('DELETE FROM alert_outbox WHERE id=?').bind(row.id),
          env.DB.prepare(
            "INSERT INTO alert_deliveries(alert_id,monitor,status,attempt,message,timestamp) VALUES(?,?,'sent',?,'发送成功',?)"
          ).bind(row.id, alert.monitor, row.attempts + 1, Math.floor(Date.now() / 1000)),
        ])
      } catch (error) {
        const message =
          error instanceof Error && /^Webhook (HTTP \d{3}|平台拒绝|返回无效)/.test(error.message)
            ? error.message.slice(0, 200)
            : '发送失败或超时，请检查渠道配置'
        let monitor = '通知'
        try {
          monitor = (JSON.parse(row.payload) as Alert).monitor
        } catch {
          /* invalid legacy payload */
        }
        await env.DB.batch([
          env.DB.prepare(
            'UPDATE alert_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=?'
          ).bind(now + Math.min(3600, 60 * 2 ** row.attempts), row.id),
          env.DB.prepare(
            "INSERT INTO alert_deliveries(alert_id,monitor,status,attempt,message,timestamp) VALUES(?,?,'failed',?,?,?)"
          ).bind(row.id, monitor, row.attempts + 1, message, Math.floor(Date.now() / 1000)),
        ])
        console.error(
          JSON.stringify({
            event: 'alert_delivery_failed',
            alert_id: row.id,
            attempt: row.attempts + 1,
            reason: message,
          })
        )
      }
    }
    await env.DB.prepare('DELETE FROM alert_outbox WHERE created_at<?')
      .bind(now - 7 * 86400)
      .run()
    await env.DB.prepare('DELETE FROM alert_deliveries WHERE timestamp<?')
      .bind(now - 7 * 86400)
      .run()
  } finally {
    await env.DB.prepare("DELETE FROM probe_locks WHERE key='alerts' AND owner=?").bind(owner).run()
  }
}
