import type { MonitorOptions } from '../types'

export type AdvancedValues = MonitorOptions & { interval_min: number; timeout_ms: number }
export const defaultAdvanced: AdvancedValues = {
  interval_min: 3,
  timeout_ms: 6000,
  keyword: '',
  json_path: '',
  json_expected: '',
  failure_threshold: 1,
  notify_recovery: 1,
  reminder_min: 0,
  maintenance_until: 0,
}

export function MonitorFields({
  value,
  onChange,
  method,
}: {
  value: AdvancedValues
  onChange: (value: AdvancedValues) => void
  method: string
}) {
  const set = (key: keyof AdvancedValues, v: string | number) => onChange({ ...value, [key]: v })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="manage-label">
          巡检间隔（分钟）
          <input
            className="manage-input"
            type="number"
            min="1"
            max="60"
            required
            value={value.interval_min}
            onChange={(e) => set('interval_min', e.target.valueAsNumber)}
          />
        </label>
        <label className="manage-label">
          单次超时（毫秒）
          <input
            className="manage-input"
            type="number"
            min="100"
            max="10000"
            required
            value={value.timeout_ms}
            onChange={(e) => set('timeout_ms', e.target.valueAsNumber)}
          />
        </label>
      </div>
      <p className="manage-help">
        服务端每 3
        分钟调度一次，间隔会向上对齐到调度时刻。失败后立即重试一次，单项最长约为超时的两倍。
      </p>
      <fieldset className="manage-section space-y-3" disabled={method === 'HEAD'}>
        <legend>内容断言（可选）</legend>
        <p className="manage-help">
          GET 响应最多读取 64 KiB；配置的断言需要同时通过。HEAD 仅检查状态码。
        </p>
        <label className="manage-label">
          正文必须包含
          <input
            className="manage-input"
            maxLength={1000}
            placeholder="例如：欢迎访问"
            value={value.keyword ?? ''}
            onChange={(e) => set('keyword', e.target.value)}
          />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="manage-label">
            JSON 字段路径
            <input
              className="manage-input"
              maxLength={200}
              placeholder="components.db.status"
              value={value.json_path ?? ''}
              onChange={(e) => set('json_path', e.target.value)}
            />
          </label>
          <label className="manage-label">
            期望值（JSON）
            <input
              className="manage-input"
              maxLength={1000}
              placeholder={'"UP" 或 true'}
              value={value.json_expected ?? ''}
              onChange={(e) => set('json_expected', e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="manage-section space-y-3">
        <legend>告警策略</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="manage-label">
            连续异常几轮后通知
            <input
              className="manage-input"
              type="number"
              min="1"
              max="10"
              required
              value={value.failure_threshold ?? 1}
              onChange={(e) => set('failure_threshold', e.target.valueAsNumber)}
            />
          </label>
          <label className="manage-label">
            持续异常提醒（分钟）
            <input
              className="manage-input"
              type="number"
              min="0"
              max="1440"
              required
              value={value.reminder_min ?? 0}
              onChange={(e) => set('reminder_min', e.target.valueAsNumber)}
            />
          </label>
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            checked={value.notify_recovery !== 0}
            onChange={(e) => set('notify_recovery', e.target.checked ? 1 : 0)}
          />
          恢复正常时通知
        </label>
        <p className="manage-help">
          一轮包含首次探测及重试；0 分钟关闭重复提醒。故障记录会立即保留，通知按策略发送。
        </p>
      </fieldset>
    </div>
  )
}
