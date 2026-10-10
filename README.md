# ⚡ vPulse — 次世代边缘分布式健康监控与状态看板

<div align="center">

![vPulse Banner](https://img.shields.io/badge/vPulse-Live_Edge_Monitor-059669?style=for-the-badge&logo=cloudflare&logoColor=white)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1_SQLite-F38020?style=flat-square&logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS_v4-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)

**致敬 [Uptime Kuma](https://github.com/louislam/uptime-kuma) 经典交互美学的 Cloudflare 原生全栈 Serverless 分布式健康探针**  
与 **[vMaker](https://vmaker.xmtlz.dev)**（创意开发档案）及 **[vBlog](https://vblog.xmtlz.dev)**（独立博客）构成统一设计语言的现代化开发者全家桶。

[🌐 在线演示 (Live Demo)](https://vpulse.xmtlzloveasuka.workers.dev) · [✨ 核心特性](#-核心特性) · [🏗️ 架构设计](#-架构设计) · [🚀 快速开始](#-快速开始) · [☁️ 部署指南](#-cloudflare-部署指南) · [📖 API 手册](#-rest-api-接口规范)

</div>

---

## 🌟 核心特性

### 1. 极致交互美学（Uptime Kuma 紧凑风）
* **48px 紧凑流线行（Compact Row）**：默认以极高信息密度的单行形态罗列各项服务，包含实时状态雷达脉冲灯、服务名称、域名徽标、36 槽位微型心跳条、实时毫秒级响应延迟与 30 天 SLA 可用率。
* **GPU 硬件加速手风琴抽屉（Accordion Drawer）**：基于现代 CSS Grid (`0fr` $\to$ `1fr`) 实现 300ms 丝滑展开，展开后呈现：
  * **60 周期全景心跳时序（Interactive Heartbeat Bar）**：支持悬停任意色块查看单次探测的精确时间、延迟及诊断信息。
  * **4 维关键指标卡片**：实时延迟、60 周期均值、30 天可用率、TLS 1.3 传输加密状态。
  * **快捷操作工具栏**：即刻单站测速、一键复制地址、直达站点、删除项目。
  * **最近 5 次探活日志流水**：实时展示 Cloudflare 边缘节点返回的状态码与响应描述。
* **卡片与紧凑双视图无缝切换**：右上角支持一键切换卡片视图与紧凑视图，选择自动持久化至本地存储。

### 2. 真实时间锚点与持久化倒计时
* **真·倒计时持久化**：顶栏胶囊实时显示 `自动巡检 · 2:45`，倒计时直接与服务端最近一次探活的**真实时间戳（`updated_at`）**与 LocalStorage 进行绝对时间差锚定。**页面刷新（F5）或重新打开标签页绝不重置为 3:00**，彻底杜绝虚假内存计数。
* **页面可见性同步（Page Visibility API）**：浏览器标签页切换或电脑休眠唤醒切回页面时，自动校准最新数据。

### 3. 空白槽位尾部推进机制（Tail Push-Forward）
* 新添加的监控服务初始呈现 **59 个半透明等待槽位 + 1 个尾部首探槽位**。
* 随着每轮自动巡检的持续进行，新的绿色心跳色块从右侧尾部逐格向前推进并替换等待格，物理呈现真实的历史积累过程，彻底告别冷启动伪造数据。

### 4. 服务端多层防抖冷却锁（Debounce Lock）
* **全量探活 90 秒冷却锁**：当客户端调用 `POST /api/probe` 时，服务端自动校验 D1 数据库中最新心跳时间戳。若距离上次探测不足 90 秒，直接复用最新状态并返回冷却提示，彻底避免多访客并发踩踏或被测站点遭受无意冲击。
* **单站测速 30 秒冷却锁**：单站点手动测速内置 30 秒独立保护。
* **强制穿透通道**：管理员确需立即测试时可通过 `?force=1` 绕过防抖锁。

### 5. Cloudflare D1 & KV 深度合成探针（Synthetic Health Check）
* 不仅仅做浅层 HTTP Ping：针对私有边缘存储（KV、D1），通过规范的 `/api/health` 探针在 Worker 内部实际执行 `SELECT 1` 与 `KV.get()`，实时返回真实底层存储延迟（如 `d1:23ms · kv:6ms`），在控制面板一目了然。

### 6. 动态分类选择与自适应防碰撞
* **所属分类双模式**：添加新监控项时，既可以从现有数据库中已存在的分组下拉选择（配有常用分类快捷胶囊一键切换），也可以直接切换为自行新增分类。
* **ID 防碰撞机制**：服务标识自适应附加唯一随机短哈希与 `INSERT OR REPLACE` 策略，彻底杜绝主键唯一约束（`UNIQUE constraint failed`）报错。

### 7. 动态 Favicon 与标题告警
* 监听全局监控状态：全站正常时呈现绿色心跳图标与「全部服务正常」；发生部分降级或服务宕机时，网页标题与 Favicon 实时变为黄/红报警状态。

### 8. 零运维成本（$0/月）与额度安全精算
* 全栈托管于 Cloudflare 免费计划：Workers + D1 + Cron + Static Assets。
* **资源消耗精算（按 3 监控项、3 分钟巡检一次）**：
  * **Worker 请求数**：每天仅 480 次（占 10 万次免费额度的 **0.48%**）。
  * **D1 写入行数**：每天仅 1,440 行（占 10 万行免费额度的 **1.44%**）。
  * **D1 存储容量**：内置 30 天自动滚动清理机制，常驻数据约 13 MB（占 5 GB 额度的 **0.26%**）。
  * 额度极其安全，彻底告别单点服务器宕机风险。

---

## 🏗️ 架构设计

```
                            ┌────────────────────────────────────────┐
                            │    Cloudflare Cron (*/3 * * * *)       │
                            └───────────────────┬────────────────────┘
                                                │ 触发 3 分钟定时巡检
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                             vPulse Cloudflare Worker                               │
│                                                                                    │
│   并发边缘探测 (HEAD / GET 并发控制器 + 1x 防抖重试机制):                            │
│   ├── vMaker 独立站:    https://vmaker.xmtlz.dev (200 OK)                          │
│   ├── vBlog 独立博客:   https://vblog.xmtlz.dev (200 OK)                           │
│   ├── D1/KV 深度探针:   https://vblog.xmtlz.dev/api/health (d1:23ms · kv:6ms)      │
│   └── 用户自定义监控项:  https://...                                               │
│                                                                                    │
│   核心控制层:                                                                      │
│   ├── 90s 全网防抖冷却锁 (Debounce Lock)                                           │
│   ├── 懒加载兜底探活 (Stale Auto-Probe via ctx.waitUntil)                           │
│   └── Webhook 告警分发 (支持飞书、钉钉、Telegram、Discord)                         │
└───────────────────────────┬──────────────────────────────────┬─────────────────────┘
                            │ 写入心跳流水 (自动裁剪 >30 天)   │ 响应 JSON 状态
                            ▼                                  ▼
                ┌──────────────────────┐           ┌──────────────────────┐
                │  Cloudflare D1 (DB)  │           │   vPulse 前端 SPA    │
                │  (vpulse-db 分布式)  │           │   (React 19 + Vite)  │
                └──────────────────────┘           └──────────────────────┘
```

---

## 📂 项目结构

```
vPulse/
├── src/                          # 前端应用源码 (React 19 + TypeScript)
│   ├── components/               # UI 组件库
│   │   ├── CompactMonitorRow.tsx # Uptime Kuma 风格 48px 紧凑行 & 手风琴抽屉
│   │   ├── HeartbeatBar.tsx      # 60 槽位交互式心跳时序胶囊条
│   │   ├── Header.tsx            # 顶部品牌栏与动态时间戳倒计时胶囊
│   │   ├── OverallStatusBanner.tsx# 系统总体健康度仪表盘
│   │   ├── MonitorToolbar.tsx    # 实时搜索与视图模式切换栏
│   │   ├── AddMonitorModal.tsx   # 动态分类选择与连通性测试模态框
│   │   ├── IncidentSection.tsx   # 故障事件广播与自动降级公告
│   │   └── GlobalNavPill.tsx     # v-Ecosystem 全家桶快速跳转 Dock
│   ├── lib/                      # 核心工具库
│   │   ├── api.ts                # REST API 客户端与本地离线回退引擎
│   │   ├── format.ts             # 时间戳、延迟与相对时间格式化
│   │   ├── useTheme.ts           # 暗黑/浅色模式平滑切换 Hook
│   │   └── useDynamicFavicon.ts  # 状态驱动的浏览器标题与 Favicon 变色
│   ├── types.ts                  # 全局 TypeScript 接口定义
│   ├── dev-middleware.ts         # Vite 本地开发环境探活中间件 (带 3min 定时引擎)
│   ├── App.tsx                   # 根应用组件 (时间锚点同步与探活调度)
│   └── main.tsx                  # 应用入口挂载点
├── worker/                       # Cloudflare Worker 后端源码
│   ├── index.ts                  # Worker 路由网关、Cron 调度与防抖锁
│   ├── probe.ts                  # 并发 HTTP 探活、JSON 深度解析与容错重试
│   ├── db.ts                     # D1 数据库驱动、心跳查询与防碰撞插入
│   └── default-monitors.ts       # 默认系统监控服务预设
├── dist/                         # 生产打包静态产物目录
├── schema.sql                    # Cloudflare D1 数据库结构与初始化索引
├── wrangler.toml                 # Cloudflare Worker、D1 绑定与 Cron 配置
├── deploy.ps1                    # 自动化 Windows 代理感知与一键构建部署脚本
├── vite.config.ts                # Vite 配置文件
└── package.json                  # 项目依赖与执行脚本
```

---

## 🚀 快速开始

### 1. 克隆项目与安装依赖

```bash
git clone https://github.com/xmtlzzz/vPulse.git
cd vPulse
npm install
```

### 2. 本地开发调试

```bash
npm run dev
# 浏览器访问 http://localhost:5173
```
> **提示**：本地开发环境由 [`src/dev-middleware.ts`](file:///c:/Users/Administrator/Desktop/code/vPulse/src/dev-middleware.ts) 全权接管，内置了真实的 3 分钟定时探活机制与防抖模拟，无需连接远程 Cloudflare 即可完整体验绿格子从尾部持续推进的效果！

### 3. 本地构建生产资源

```bash
npm run build
```

---

## ☁️ Cloudflare 部署指南

### 1. 准备 Cloudflare D1 数据库

在终端中登录 Wrangler 并创建数据库：

```bash
npx wrangler d1 create vpulse-db
```

命令执行完毕后，控制台会输出类似如下配置：
```toml
[[d1_databases]]
binding = "DB"
database_name = "vpulse-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

将该 `database_id` 填入项目根目录下的 [`wrangler.toml`](file:///c:/Users/Administrator/Desktop/code/vPulse/wrangler.toml) 中。

### 2. 执行数据库结构初始化

在远程 D1 数据库中创建表与索引：

```bash
# 执行本地 schema.sql 到远程 Cloudflare D1
npx wrangler d1 execute vpulse-db --file=./schema.sql --remote
```

### 3. 一键编译并部署到 Cloudflare

使用项目附带的自动化部署脚本（支持 Windows 代理自动识别与构建验证）：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

或者使用 npm 脚本：

```bash
npm run deploy
```

部署完成后，Cloudflare 将输出 Worker 访问地址（例如 `https://vpulse.<你的域名>.workers.dev`），全局 3 分钟定时巡检自动上线运行！

---

## 📖 REST API 接口规范

vPulse 提供纯粹无状态的 REST API，可轻松对接到第三方 CI/CD 或自动化运维系统：

### 1. 获取完整监控状态与心跳
```http
GET /api/status
```
* **说明**：拉取所有监控项、当前延迟、30天 SLA 以及最近 60 次心跳流水。
* **参数**：
  * `probe=1`（可选）：强制唤醒边缘后台即刻探测最新状态。

### 2. 触发全网探活
```http
POST /api/probe
```
* **说明**：立即对所有已启用的监控服务发起并发探活。
* **参数**：
  * `id=<monitor_id>`（可选）：仅针对指定单个服务发起测速（含 30s 独立冷却）。
  * `force=1`（可选）：穿透 90 秒防抖锁，强制发起全网探测。
* **防抖响应示例**：
```json
{
  "success": true,
  "debounced": true,
  "cooldown_remaining_sec": 76,
  "message": "系统处于防抖冷却保护期（剩余 76 秒），已复用最新全网心跳"
}
```

### 3. 实时连接性探测预览
```http
POST /api/probe-test
Content-Type: application/json

{
  "url": "https://api.example.com",
  "method": "GET"
}
```
* **说明**：在添加项目前，测试目标端点握手状态与毫秒级延迟。

### 4. 动态注册新监控项
```http
POST /api/monitors
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN> (可选)

{
  "name": "新边缘服务",
  "url": "https://service.xmtlz.dev",
  "group_name": "核心站点 (Portals)",
  "method": "GET",
  "expected_status": 200
}
```

### 5. 删除监控服务
```http
DELETE /api/monitors?id=<monitor_id>
Authorization: Bearer <ADMIN_TOKEN> (可选)
```

---

## 💡 最佳实践：如何为 Cloudflare KV / D1 编写探针

由于 Cloudflare KV 和 D1 属于私有边缘资源，没有公网 HTTP 接口，行业标准规范是在您的业务 Worker 中开放轻量级探针端点：

```typescript
// 粘贴到你的任意 Cloudflare Worker 代码中:
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      const t0 = performance.now();
      
      // 测试 D1 数据库查询延迟与 KV 读取延迟
      await env.DB.prepare('SELECT 1').run();
      const d1Latency = Math.round(performance.now() - t0);

      const t1 = performance.now();
      await env.MY_KV.get('__probe__');
      const kvLatency = Math.round(performance.now() - t1);

      return Response.json({
        status: 'UP',
        components: {
          d1: { latency_ms: d1Latency },
          kv: { latency_ms: kvLatency },
        },
        colo: request.cf?.colo || 'EDGE'
      });
    }

    // ... 其他业务路由
  }
}
```

在 vPulse 添加项目时填入该 Worker 地址，vPulse 将自动提取并展示 `d1:23ms · kv:6ms` 的深层存储耗时！

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎 Star、Fork 或提交 Pull Request！

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://vmaker.xmtlz.dev">xmtlz</a> · Powered by Cloudflare Global Edge</sub>
</div>
