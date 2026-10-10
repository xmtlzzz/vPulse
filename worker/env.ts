export interface Env extends Pick<CloudflareBindings, 'DB' | 'ASSETS'> {
  ADMIN_TOKEN?: string
  WEBHOOK_URL?: string
  WEBHOOK_TYPE?: 'generic' | 'discord' | 'telegram' | 'feishu' | 'dingtalk'
  TELEGRAM_CHAT_ID?: string
}
