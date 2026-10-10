# ⚡ vPulse — 边缘无服务器状态监控与健康巡检看板

> 致敬 **Uptime Kuma** 经典状态页交互美学的 **Cloudflare Workers + D1 原生无服务器**（Serverless）轻量健康监控看板。  
> 与 **vMaker**（作品索引）和 **vBlog**（独立博客）组成统一设计调性的“个人开发者全家桶（v-Ecosystem）”。

---

## 🌟 核心特性与亮点

1. **零服务器运维与零成本（$0/月）**：
   - 依赖 Cloudflare 免费计划：**Workers (API & Cron 探活)** + **D1 (SQLite 边缘数据存储)** + **Workers Static Assets (极速静态托管)**。
   - 永远不用担心单台 VPS 宕机导致状态页无法访问，全球边缘高可用多机房容灾。
2. **纯粹聚焦监控重点（Anti-Slop / 高信息密度）**：
   - **全局运行状态大徽章**（All Systems Operational）+ 30 天可用率、平均延迟与健康节点统计。
   - **经典 60 槽位心跳胶囊条（Heartbeat Pill Bar）**：完全复刻 Uptime Kuma 标志性设计，支持鼠标悬停精确查看单次探活时间戳、HTTP 状态码及毫秒级延迟。
   - **SSL 证书到期倒计时**：自动展示 TLS 证书剩余有效天数，防止过期。
   - **服务分组展示**：核心站点、边缘服务、外部依赖清晰分层。
3. **统一视觉系统（v-Tokens）**：
   - 支持深色（Dark）与浅色（Light）模式瞬时无感过渡（260ms 平滑动画）。
   - 底部常驻微光全家桶切换胶囊（`[ 🚀 vMaker | ✍️ vBlog | ⚡ vPulse ]`）。

---

## 🏗️ 架构与数据流

```
                    ┌────────────────────────┐
                    │  Cloudflare Cron (3m)  │
                    └───────────┬────────────┘
                                │ 触发定时巡检
                                ▼
┌────────────────────────────────────────────────────────┐
│             vPulse Cloudflare Worker                   │
│                                                        │
│  并发探测各端点 (HEAD/GET):                            │
│  - vMaker: https://vmaker.xmtlz.dev                    │
│  - vBlog:  https://vblog.xmtlz.dev                     │
│  - D1 API: https://vblog.xmtlz.dev/api/health          │
│  - GitHub: https://api.github.com/users/xmtlz          │
└───────────────────────┬────────────────────────────────┘
                        │ 写入心跳结果 / 自动清理 >30 天记录
                        ▼
            ┌──────────────────────┐
            │  Cloudflare D1 (DB)  │
            └──────────────────────┘
                        │ 状态查询 API: /api/status
                        ▼
            ┌──────────────────────┐
            │  vPulse 前端 SPA     │
            │  (React 19 + Vite)   │
            └──────────────────────┘
```

---

## 🚀 本地开发与启动

### 1. 安装依赖
```bash
npm install
```

### 2. 启动前端预览
```bash
npm run dev
# 访问 http://localhost:5174
```
*提示：前端内置了高保真离线 Mock 数据与自动保底机制，即使本地尚未连接 D1 数据库也能瞬间完整展示 60 槽位心跳条与完整卡片。*

---

## ☁️ 部署到 Cloudflare

### 1. 创建 D1 数据库
```bash
npx wrangler d1 create vpulse-db
```
在控制台输出中获取生成的 `database_id`，并填入 `wrangler.toml` 中的 `[[d1_databases]]`。

### 2. 初始化数据库表结构
```bash
# 本地测试环境
npm run d1:init

# 线上正式环境
npm run d1:init:remote
```

### 3. 一键编译并部署
```bash
npm run deploy
```
Worker 会自动接管静态资源与 `/api` 路由，并在边缘网络中每 3 分钟自动执行一次全量服务探活！

---

## 🛠️ 如何动态添加后续的项目与 Cloudflare 服务（告别硬编码）

vPulse 彻底摆脱了传统静态站点的硬编码束缚，支持通过三种途径随时随地接入您在 Cloudflare 上的新项目：

### 途径 1：网页端一键添加（最方便推荐）
1. 访问看板页面，点击右上角的 **「+ 添加项目」** 按钮；
2. 弹出的模态框提供了常用快捷模板（**Cloudflare Worker**、**Cloudflare Pages 站点**、**边缘 API 接口**、**外部依赖**）；
3. 填入您的服务名称（例如 `vInvoice 发票系统`）与探活 URL（例如 `https://invoice.xmtlz.dev`）；
4. 点击「立即接入并探活」，系统将自动录入 Cloudflare D1 数据库并即刻发起第一次测速，心跳条立即开始记录！

### 途径 2：通过 Cloudflare D1 命令行批量导入（适合多项目运维）
如果您有多个现成的 Cloudflare Workers / Pages 域名需要一次性导入，可直接在终端执行 D1 批量插入语句：
```bash
npx wrangler d1 execute vpulse-db --remote --command="
  INSERT INTO monitors (id, name, group_name, url, method, expected_status, interval_min, timeout_ms, order_num, enabled, created_at)
  VALUES 
    ('vmusic', 'vMusic 在线音乐', 'Cloudflare 边缘计算', 'https://music.xmtlz.dev', 'GET', 200, 3, 6000, 5, 1, strftime('%s', 'now')),
    ('vinvoice', 'vInvoice 财务系统', '核心站点 (Portals)', 'https://invoice.xmtlz.dev', 'GET', 200, 3, 6000, 6, 1, strftime('%s', 'now'));
"
```

### 途径 3：通过 REST API 自动化打卡与接入
支持在 CI/CD 流水线或新项目部署完成后自动注册探针：
```bash
curl -X POST https://pulse.xmtlz.dev/api/monitors \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "name": "新部署的 Worker 服务",
    "url": "https://api.example.com/health",
    "group_name": "Cloudflare 边缘计算",
    "method": "GET",
    "expected_status": 200
  }'
```

