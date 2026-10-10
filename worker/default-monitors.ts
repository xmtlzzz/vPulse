export interface MonitorConfig {
  id: string
  name: string
  group_name: string
  url: string
  method: 'GET' | 'HEAD' | 'POST'
  expected_status: number
  interval_min: number
  timeout_ms: number
  order_num: number
  enabled: number
}

export const DEFAULT_MONITORS: MonitorConfig[] = [
  {
    id: 'vmaker',
    name: 'vMaker 创意作品集',
    group_name: '核心站点 (Portals)',
    url: 'https://vmaker.xmtlz.dev',
    method: 'GET',
    expected_status: 200,
    interval_min: 3,
    timeout_ms: 6000,
    order_num: 1,
    enabled: 1,
  },
  {
    id: 'vblog',
    name: 'vBlog 个人独立博客',
    group_name: '核心站点 (Portals)',
    url: 'https://vblog.xmtlz.dev',
    method: 'GET',
    expected_status: 200,
    interval_min: 3,
    timeout_ms: 6000,
    order_num: 2,
    enabled: 1,
  },
  {
    id: 'vblog-api',
    name: 'vBlog D1 边缘健康探针',
    group_name: '边缘服务与存储 (Edge & Storage)',
    url: 'https://vblog.xmtlz.dev/api/health',
    method: 'GET',
    expected_status: 200,
    interval_min: 3,
    timeout_ms: 5000,
    order_num: 3,
    enabled: 1,
  },
  {
    id: 'github-api',
    name: 'GitHub API (xmtlz 档案限额)',
    group_name: '外部依赖 (External Dependencies)',
    url: 'https://api.github.com/users/xmtlz',
    method: 'GET',
    expected_status: 200,
    interval_min: 5,
    timeout_ms: 8000,
    order_num: 4,
    enabled: 1,
  },
]
