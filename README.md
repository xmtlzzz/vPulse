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
