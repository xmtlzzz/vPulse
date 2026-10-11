import type { Monitor, ProbeProgress } from '../types'
import { formatDateTime } from './format'

export function monitorState(m: Monitor, stage?: ProbeProgress['items'][number]['stage']) {
  const label =
    m.enabled === 0
      ? '已暂停'
      : (m.maintenance_until ?? 0) > Date.now() / 1000
        ? '维护中'
        : stage === 'queued'
          ? '排队中'
          : stage === 'probing'
            ? '探测中'
            : stage === 'retrying'
              ? '重试中'
              : stage === 'failed'
                ? '巡检未完成'
                : m.current_status === -1
                  ? m.last_checked_at
                    ? '数据已过期'
                    : '等待首次探测'
                  : m.current_status === 0
                    ? '服务中断'
                    : m.current_status === 2
                      ? '服务降级'
                      : '运行正常'
  const reason =
    m.enabled === 0
      ? '已暂停探测，历史记录保留'
      : (m.maintenance_until ?? 0) > Date.now() / 1000
        ? `维护至 ${formatDateTime(m.maintenance_until!)}，暂不探测`
        : m.current_status === -1
          ? '没有新鲜的探测结果；灰点表示未知状态'
          : (m.heartbeats.at(-1)?.message ?? '')
  return {
    label,
    title: `${label} · ${reason}\n最后探测：${m.last_checked_at ? formatDateTime(m.last_checked_at) : '暂无'}`,
    active:
      m.enabled !== 0 &&
      (m.maintenance_until ?? 0) <= Date.now() / 1000 &&
      (stage === 'probing' || stage === 'retrying'),
    queued: stage === 'queued',
  }
}
