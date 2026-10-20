# ⚡ vPulse — 次世代边缘健康监控与状态看板

<div align="center">

![vPulse Banner](https://img.shields.io/badge/vPulse-Live_Edge_Monitor-059669?style=for-the-badge&logo=cloudflare&logoColor=white)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1_SQLite-F38020?style=flat-square&logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS_v4-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)

**致敬 [Uptime Kuma](https://github.com/louislam/uptime-kuma) 经典交互美学的 Cloudflare 原生全栈 Serverless 健康探针**<br>
与 **[vMaker](https://vmaker.xmtlz.dev)**（创意开发档案）及 **[vBlog](https://vblog.xmtlz.dev)**（独立博客）构成统一设计语言的现代化开发者全家桶。

[🌐 在线演示 (Live Demo)](https://vpulse.xmtlzloveasuka.workers.dev) · [✨ 核心特性](#-核心特性) · [🏗️ 架构设计](#-架构设计) · [🚀 快速开始](#-快速开始) · [☁️ 部署指南](#-cloudflare-部署指南) · [📖 API 手册](#-rest-api-接口规范)

</div>

> 部署在 Cloudflare 边缘运行时；当前实现不包含主动多地域采样或地域聚合。在线演示以实际部署版本为准。

---

## 🌟 核心特性

### 1. 极致交互美学（Uptime Kuma 紧凑风）

* **48px 紧凑流线行（Compact Row）**：默认以极高信息密度的单行形态罗列各项服务，包含实时状态雷达脉冲灯、服务名称、域名徽标、36 槽位微型心跳条、最近一次探测的毫秒级响应延迟与 30 天观测可用率。
* **平滑手风琴抽屉（Accordion Drawer）**：基于现代 CSS Grid (`0fr` $\to$ `1fr`) 实现 300ms 丝滑展开，展开后呈现：
  * **60 周期全景心跳时序（Interactive Heartbeat Bar）**：支持悬停任意色块查看单次探测的精确时间、延迟及诊断信息。
  * **4 维关键指标卡片**：实时延迟、60 周期均值、30 天观测可用率、HTTPS 配置状态（不检测 TLS 版本或证书有效期）。
  * **快捷操作工具栏**：即刻单站测速、一键复制地址、直达站点、删除项目。
  * **最近 5 次探活日志流水**：实时展示 Cloudflare 边缘节点返回的状态码与响应描述。
* **卡片与紧凑双视图无缝切换**：右上角支持一键切换卡片视图与紧凑视图，选择自动持久化至本地存储。

### 2. 真实时间锚点与巡检倒计时

* **服务端时间锚点**：顶栏胶囊显示 `下次巡检 · 2:45`，倒计时依据服务端返回的 **`next_check_at`** 与当前时间计算。调度与看板统一按每 3 分钟的 Cron 时间槽计算，避免探测完成的秒数偏差跳过下一轮；非 3 的倍数间隔向上取整到时间槽。没有记录时显示等待首次巡检，到期后显示巡检已到期、等待更新；读取失败单独提示。暂停按钮只暂停当前页面刷新，服务端巡检继续运行。
* **页面可见性同步（Page Visibility API）**：浏览器标签页切换或电脑休眠唤醒切回页面时，自动校准最新数据。

### 3. 空白槽位尾部推进机制（Tail Push-Forward）

* 新添加的监控服务完成首次真实探测后，60 槽位心跳条呈现 **59 个半透明等待槽位 + 1 个尾部首探槽位**；紧凑行使用 36 槽位。
* 随着每轮自动巡检的持续进行，新的心跳色块按真实结果显示绿、黄或红，从右侧尾部逐格向前推进并替换等待格，物理呈现真实的历史积累过程，彻底告别冷启动伪造数据。

### 4. 服务端多层防抖冷却锁（Debounce Lock）

* **全量探活 90 秒冷却锁**：管理员调用 `POST /api/probe` 时，服务端校验 D1 中最近一次全量巡检完成时间。若不足 90 秒，返回冷却提示；单站测速不会重置全量冷却。定时巡检另按每项监控的到期时间执行。
* **单站测速 30 秒冷却锁**：单站点手动测速内置 30 秒独立保护。
* **强制巡检通道**：管理员可通过 `?force=1` 跳过冷却；仍受 D1 原子租约和请求限流约束，避免并发重复执行。新增、删除和手动探测均需管理员鉴权。

### 5. Cloudflare D1 & KV 深度合成探针（Synthetic Health Check）

* 不仅仅做浅层 HTTP Ping：在**业务 Worker** 中提供 `/api/health` 端点，实际执行 `SELECT 1` 与 `KV.get()` 并返回组件结果，vPulse 从 HTTP 响应中读取存储耗时（如 `d1:23ms · kv:6ms`）及健康状态。vPulse 不直接访问其他 Worker 的私有绑定。

### 6. 动态分类选择与自适应防碰撞

* **所属分类双模式**：添加新监控项时，既可以从现有数据库中已存在的分组下拉选择（配有常用分类快捷胶囊一键切换），也可以直接切换为自行新增分类。
* **ID 防碰撞机制**：使用 UUID 和普通 `INSERT` 创建独立记录，避免因名称重复而覆盖已有监控；创建数量上限在数据库写入时检查。

### 7. 动态 Favicon 与标题告警

* 监听全局监控状态：全站正常时呈现绿色心跳图标与「全部服务正常」；发生部分降级或服务宕机时，网页标题与 Favicon 变为黄/红报警状态；无记录、缺测或数据过期时显示灰色未知状态。

### 8. Serverless 托管与资源预算

* 全栈使用 Cloudflare Workers + D1 + Cron + Static Assets，无需自行维护常驻服务器。
* **基础消耗估算（按 3 监控项、每项 3 分钟巡检一次）**：
  * **Cron 调度**：每 3 分钟检查到期项目，每天约 480 次调度；不等同于每天全部 Worker 请求数。
  * **心跳记录**：正常调度下每天约 1,440 条，额外手动探测会增加记录，每次尝试包含 A/AAAA DNS 检查及目标 HTTP 请求，失败重试和重定向会增加外部请求。
  * **D1 用量**：还包含索引、巡检租约、故障事件、通知和缓存等读写，不能只按心跳行数估算。
  * **存储与访问**：心跳保留最近 30 天及边界计算所需的宽限数据；公开状态共享快照最多缓存 60 秒，探测及监控增删后失效。实际成本取决于访客量、数据量和账户计划，不承诺固定为 $0/月。

> **可用率口径**：30 天观测可用率按真实样本维持的时间加权，UP 与 DEGRADED 计为可用，缺测时间不计入分母，观测覆盖率单独显示。样本最多维持到其新鲜度期限，不足 30 天或存在缺测时不能视为完整 SLA；总体可用率为有观测项目的等权均值。平均延迟取最近 60 次中非 DOWN 且有有效延迟的记录。

**D1 增量读取**：巡检与健康接口按监控项利用索引取最新有效心跳，不再对全部历史做 `GROUP BY/MAX`。最近 60 次明细继续按索引限量读取。30 天可用率持久化保存累计秒数及心跳 ID 游标，后续仅补算新增时间段并扣除移出窗口的时间段；正常探测不会清空这些累计结果。首次读取、间隔/超时配置变更、补写较旧样本，或长时间未读取导致窗口边界数据可能被清理时，才重新初始化受影响监控项。新鲜度、缺测、DEGRADED 和配置变更后旧样本失效规则保持不变。部署时先应用 `0006_incremental_reads.sql` 迁移，再发布 Worker；迁移保留已有监控和心跳，累计统计按需初始化。

**事件档案与追溯**：首页保留当前故障和最近 5 条恢复记录，点击“查看全部事件历史”可公开查看月份日历、按日期筛选和游标分页的完整事件历史。日历按北京时间（UTC+8）标记事件开始、状态变化及恢复日期；跨月恢复可从恢复日找到原始事件。详情记录每次故障状态变化及恢复时的诊断，持续相同状态的巡检不会重复生成事件。事件及时间线长期保留，独立于 30 天心跳清理；删除监控后仍保留事件、监控名称快照和停止追踪记录。旧版本只保存最后摘要，升级后标为“旧版历史快照”，不伪造旧的诊断过程。先应用 `0007_incident_history.sql` 再发布 Worker；迁移保留原始记录并追加索引和历史表。月份查询只聚合选定月份的活动，日志采用游标分页，不扫描全部年份历史；同一个月内的活动量仍会影响月历聚合成本。

公开历史接口：`GET /api/incidents?month=YYYY-MM&day=YYYY-MM-DD`（day 可选），返回日历、每页 20 条事件及 `next_cursor`；下一页将返回的游标通过 URL 编码放入 `cursor`。`GET /api/incidents/:id` 返回事件详情和每页 20 条过程记录，同样使用 `next_cursor`。历史接口不限制在最近 30 天，不需要管理员授权。

### 9. 项目、告警和设备管理

顶栏“管理”与项目详情的“编辑与维护 / 历史曲线”提供以下入口：

* **真实巡检进度**：D1 记录当前一轮的排队、探测、重试与完成状态。灰点表示未知、过期、暂停或维护，悬停可看原因和最后探测时间；蓝点表示实际探测中。页面在巡检中每 2 秒读取进度，空闲时每 10 秒读取。
* **编辑、暂停与维护**：修改名称、分组、URL、方法、状态码、间隔和超时；暂停或指定维护结束时间后跳过探测与通知，历史保留。维护到期自动恢复调度。修改目标或断言后，旧结果保留为历史，当前状态等待新探测。
* **内容断言**：GET 正文包含关键词、点分 JSON 路径与期望 JSON 值；配置的检查需全部通过，响应最多读取 64 KiB。
* **告警策略与记录**：连续 1–10 轮异常后通知、可关闭恢复通知、可设持续异常提醒（0 关闭）。通知后台发送，独立租约避免并发投递；查看渠道类型、发送结果、待发队列、测试通知及手动重试。首次正常不通知，故障事件仍立即记录。
* **历史分析**：24 小时 / 7 天 / 30 天延迟曲线、指定时间范围、异常日志筛选与分页。曲线按时间桶聚合，包含均值、最小/最大延迟和失败数，缺测不补正常数据。
* **配置备份与设备授权**：导出不含凭据的 JSON 配置，整批校验后原子追加导入（总数最多 20 项）；导入新增项目需重新输入管理员密钥。查看设备授权和到期时间、撤销授权或退出当前设备。

---

## 🏗️ 架构设计

```
                            ┌────────────────────────────────────────┐
                            │    Cloudflare Cron (*/3 * * * *)       │
                            └───────────────────┬────────────────────┘
                                                │ 每 3 分钟检查，按各项间隔巡检
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                             vPulse Cloudflare Worker                               │
│                                                                                    │
│   并发边缘探测 (HEAD / GET，最多 3 项并发 + 瞬时故障重试一次):                         │
│   ├── vMaker 存活接口:  https://vmaker.xmtlz.dev/api/health (每 3 分钟)             │
│   ├── vMaker 首页渲染:  https://vmaker.xmtlz.dev/ (每 30 分钟)                     │
│   ├── vBlog 独立博客:   https://vblog.xmtlz.dev (200 OK)                           │
│   ├── D1/KV 深度探针:   https://vblog.xmtlz.dev/api/health (d1:23ms · kv:6ms)      │
│   └── 用户自定义监控项:  https://...                                               │
│                                                                                    │
│   核心控制层 (上方地址与耗时为示例):                                               │
│   ├── 管理员鉴权、90s 全量冷却与 D1 原子租约                                       │
│   ├── 只读状态查询、共享快照缓存与逐项新鲜度检查                                   │
│   └── Webhook 告警、恢复通知与持久化重试                                           │
└───────────────────────────┬──────────────────────────────────┬─────────────────────┘
                            │ 心跳保留 30 天及边界数据         │ 响应 JSON 状态
                            ▼                                  ▼
                ┌──────────────────────┐           ┌──────────────────────┐
                │  Cloudflare D1 (DB)  │           │   vPulse 前端 SPA    │
                │  (vpulse-db SQLite)  │           │   (React 19 + Vite)  │
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
│   │   ├── api.ts                # 统一 REST API 客户端与管理员鉴权
│   │   ├── status.ts             # 新鲜度判定与未知状态投影
│   │   ├── storage.ts            # 本地偏好存储的容错封装
│   │   ├── format.ts             # 时间戳、延迟与相对时间格式化
│   │   ├── useTheme.ts           # 暗黑/浅色模式平滑切换 Hook
│   │   └── useDynamicFavicon.ts  # 状态驱动的浏览器标题与 Favicon 变色
│   ├── types.ts                  # 全局 TypeScript 接口定义
│   ├── App.tsx                   # 根应用组件 (状态刷新、时间锚点同步与手动巡检)
│   └── main.tsx                  # 应用入口挂载点
├── worker/                       # Cloudflare Worker 后端源码
│   ├── index.ts                  # Worker 路由网关、Cron 调度与防抖锁
│   ├── probe.ts                  # 并发 HTTP 探活、JSON 深度解析与容错重试
│   ├── db.ts                     # D1 数据库驱动、观测统计与故障事件
│   ├── scheduler.ts             # 到期巡检、并发租约与状态持久化
│   ├── alerts.ts                # Webhook 消息协议与持久化重试
│   ├── status.ts                # 共享状态快照与版本失效
│   ├── validation.ts            # 输入、域名与公网地址校验
│   └── env.ts                   # Worker 环境类型
├── dist/                         # 生产打包静态产物目录
├── schema.sql                    # 初始数据库结构及预置监控
├── migrations/                   # D1 增量迁移
├── tests/                        # 隔离数据库与网络替身回归测试
├── worker-configuration.d.ts      # Wrangler 生成的绑定类型
├── .dev.vars.example             # 本地管理员密钥配置示例
├── wrangler.toml                 # Cloudflare Worker、D1 绑定与 Cron 配置
├── deploy.ps1                    # Windows 测试、构建、迁移与部署脚本
├── vite.config.ts                # Vite 配置文件
└── package.json                  # 项目依赖与执行脚本
```

---

## 🚀 快速开始

### 1. 克隆项目与安装依赖

需要 **Node.js 22.19 或更新版本**（测试使用 Node 内置 SQLite）。

```bash
git clone https://github.com/xmtlzzz/vPulse.git
cd vPulse
npm ci
```

### 2. 本地开发调试

先构建静态资源并初始化本地 D1：

```bash
npm run build
npm run d1:init
```

复制 [`.dev.vars.example`](.dev.vars.example) 为 `.dev.vars`，设置自己的 `ADMIN_TOKEN`。管理员可直接在页面添加可信的公网 HTTP(S) 域名，无需维护 TOML 域名白名单或重新部署。

两个终端分别启动后端和前端：

```bash
npm run worker:dev
```

```bash
npm run dev
# 浏览器访问 http://localhost:5174
```

> **提示**：Vite 将 `/api` 代理至本地 Wrangler（127.0.0.1:5175），使用真实 Worker 逻辑和本地 D1。Wrangler 本地开发不会自动运行 Cron；可在“添加项目”弹窗保存管理员密钥，再点击“立即探活”生成真实记录。测试定时入口可使用启动日志提供的 scheduled URL。`npm run preview` 仅预览静态资源，不能独立提供 API。

### 3. 本地检查与构建生产资源

```bash
npm run check                 # 回归测试、类型检查及前端构建
npm run types                 # 绑定配置变更后重新生成类型
npx wrangler deploy --dry-run # Worker 打包验证
```

仅构建前端可运行 `npm run build`。CI 执行回归测试和构建检查；测试包含真实 workerd 运行时、隔离数据库与网络替身，不请求生产目标。

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

将该 `database_id` 填入项目根目录下的 [`wrangler.toml`](wrangler.toml) 中。

### 2. 执行数据库结构初始化

仅对**全新数据库**创建基础表、预置监控并应用增量迁移：

```bash
npm run d1:init:remote
```

已有数据库升级只应用 `migrations/` 中的增量迁移，不要重新执行 `schema.sql`，以免重新插入预置监控。部署命令会自动执行迁移。

vMaker 使用两层巡检：`/api/health` 每 3 分钟验证 Worker 存活，不进入 SSR 或查询 GitHub；首页每 30 分钟验证页面访问。首页缓存未命中时仍可能触及免费 Worker 的 CPU 限制，存活成功不代表页面渲染成功。部署前须先确保 vMaker 已提供健康接口。

迁移 `0005_vmaker_health.sql` 只调整原始的 vMaker 首页监控（GET、200、3 分钟且无内容断言），保留历史、暂停和维护设置，重置新接口的当前判定与待发告警。已自定义的 URL、周期、方法或断言不改动；已有首页监控或达到 20 项上限时不另建首页项。新安装默认预置两项。

### 3. 配置管理员并一键部署到 Cloudflare

首次部署设置管理员密钥：

```bash
npx wrangler secret put ADMIN_TOKEN
```

管理员密钥未配置时，管理入口返回 503；密钥错误时返回 401。在“添加项目”弹窗输入密钥，点击“验证并记住此设备”，或成功添加项目后，服务端会在 D1 `admin_sessions` 表保存随机会话 token 的 SHA-256 摘要与管理员密钥绑定的 HMAC 标签，浏览器通过 HttpOnly、SameSite=Strict Cookie 记住设备 30 天（HTTPS 下启用 Secure）。刷新、重开页面后，立即探活、单项探活、连接测试和删除可复用该会话；每次添加项目必须重新输入管理员密钥，服务端不接受仅凭 Cookie 添加。更换 `ADMIN_TOKEN` 或会话到期后需要重新验证。旧浏览器存储中的密钥会在首次管理操作时兑换会话并清除；新流程不保存管理员原文，也不通过公开 API 返回任何凭据。不要将密钥提交到仓库，也不要在公开展示的监控 URL 中包含私密查询参数。

使用项目附带的自动化部署脚本（依次测试、构建、应用迁移及部署，支持从其他目录调用）：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

或者使用 npm 脚本：

```bash
npm run deploy
```

部署完成后，Cloudflare 将输出 Worker 访问地址（例如 `https://vpulse.<你的域名>.workers.dev`），Cron 每 3 分钟检查到期项目，并按各项 `interval_min` 筛选巡检目标（默认 3 分钟；自动调度最小粒度为 3 分钟）。

### 4. 配置 Webhook 告警（可选）

在 `wrangler.toml` 设置 `WEBHOOK_TYPE`：`generic`、`discord`、`telegram`、`feishu` 或 `dingtalk`。通过 Secret 保存地址：

```bash
npx wrangler secret put WEBHOOK_URL
# Telegram 还需配置：
npx wrangler secret put TELEGRAM_CHAT_ID
```

异常及恢复会生成持久化事件，通知按每项告警策略在后台发送，首次正常不通知。投递限时 5 秒，失败退避重试，最多 5 次，记录保留 7 天；响应丢失可能导致重复投递。飞书、钉钉需使用接受文本消息的 Webhook，目前不支持平台特有的签名鉴权。未配置地址时不投递。

---

## 📖 REST API 接口规范

vPulse 提供 REST API，可对接第三方 CI/CD 或自动化运维系统。公开查询不发起外部探测；管理接口接受 `Authorization: Bearer <ADMIN_TOKEN>` 或已记住设备的 Cookie，新增项目、批量导入及签发设备会话必须重新携带 Bearer 密钥。管理请求不允许跨站调用。

### 1. 获取完整监控状态与心跳

```http
GET /api/status
```

* **说明**：拉取所有监控项、最近延迟、30 天观测可用率/覆盖率、最近 60 次心跳及故障历史。无记录、读取失败或超过新鲜度期限的结果显示未知。
* **参数**：
  * `probe=1`（可选，需管理员鉴权）：兼容入口，等待强制巡检完成后返回状态；仍受租约和限流约束。

### 2. 触发全网探活

```http
POST /api/probe
Authorization: Bearer <ADMIN_TOKEN>
```

* **说明**：立即对所有已启用的监控服务发起并发探活。支持 Bearer 管理密钥或已记住设备的会话 Cookie；前端自动携带 Cookie。
* **参数**：
  * `id=<monitor_id>`（可选）：仅针对指定单个服务发起测速（含 30s 独立冷却）。
  * `force=1`（可选）：跳过全量或单站冷却，仍受租约和限流约束。
* **防抖响应示例**：
```json
{
  "success": true,
  "debounced": true,
  "probed_count": 0,
  "cooldown_remaining_sec": 76
}
```

### 3. 实时连接性探测预览

```http
POST /api/probe-test
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{
  "url": "https://api.example.com",
  "method": "GET"
}
```

* **说明**：在添加项目前，测试公网目标端点及毫秒级响应延迟，不保存为监控记录，无需预先配置域名。

### 4. 动态注册新监控项

```http
POST /api/monitors
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{
  "name": "新边缘服务",
  "url": "https://service.xmtlz.dev",
  "group_name": "核心站点 (Portals)",
  "method": "GET",
  "expected_status": 200,
  "interval_min": 3,
  "timeout_ms": 6000
}
```

* **说明**：管理员可直接添加新的公网域名；每次必须以 Bearer 密钥重新确认，Cookie 会话不能替代。创建时执行首次真实探测并记住设备，后续由定时任务持续巡检。

### 5. 删除监控服务

```http
DELETE /api/monitors?id=<monitor_id>
Authorization: Bearer <ADMIN_TOKEN>
```

* **说明**：删除监控与心跳，关闭关联活动事件，保留故障历史。

### 6. 其他公开查询与请求边界

* `POST /api/session`：使用 `Authorization: Bearer <ADMIN_TOKEN>` 验证并记住设备，通过 Set-Cookie 返回 30 天会话；错误密钥不创建会话。需要先应用 `0003_admin_sessions.sql` 迁移（标准部署脚本自动执行）。

* `GET /api/monitors`：返回监控及最近 60 次记录。
* `GET /api/health`：检查 D1 可用性与各项监控新鲜度；依赖或调度异常返回 503。
* 最多 20 项监控、3 项并发；间隔 1–60 分钟，单次尝试超时 100–10000ms，瞬时网络故障或 5xx 最多延迟 500ms 重试一次；Cloudflare 1102、429、带 Retry-After 的错误以及除 408 外的 4xx 不立即重试，等待下一轮巡检。默认 6 秒超时时，一项最慢约 12.5 秒（两次尝试及重试间隔）。仅支持 GET/HEAD，HTTP 状态须精确匹配配置。
* 手动探测、新增/删除和签发设备会话各限 20 次/分钟，连接测试限 6 次/分钟；管理写请求另共享 60 次/分钟上限。目标须为公网 HTTP(S) 域名，拒绝 URL 凭据、IP 字面量、私网后缀与非标准端口。每次尝试及重定向前，通过 Cloudflare DNS over HTTPS 检查 A/AAAA 解析结果，拒绝非公网地址，DNS 失败时不请求目标；重定向最多 3 次。请求正文上限 8 KiB（批量导入 64 KiB），普通 GET 流式检查完整正文（上限 2 MiB，超出记为降级而非正常），流中断记为失败，HEAD 仅检查响应头；延迟包含正文接收时间。健康接口/内容断言正文上限 64 KiB，DNS 检查也受单次尝试的超时及正文上限约束。

### 7. 管理与历史接口（需应用 0004_management.sql）

| 接口 | 鉴权与用途 |
| --- | --- |
| `GET /api/progress` | 公开，只读当前巡检进度；执行中断且租约失效后标记未完成。 |
| `GET /api/history?id=...&range=24h` | 公开，范围支持 `24h/7d/30d`，可加 `from/to` 秒级时间戳、`errors=1`、`page=0`。每页 100 条日志，最多查询最近 30 天。 |
| `PATCH /api/monitors?id=...` | 管理鉴权；部分更新配置，`enabled:0/1` 暂停/启用，`maintenance_until` 为秒级时间戳（0 结束维护）。 |
| `GET /api/admin/alerts` | 管理鉴权；渠道是否配置、类型、最近 100 条发送记录及待发通知，不返回渠道地址。 |
| `POST /api/admin/alerts/test` | 管理鉴权；测试消息进入队列，发送结果在通知记录查询。 |
| `POST /api/admin/alerts/retry?id=...` | 管理鉴权；将待发通知重新加入发送队列。 |
| `GET /api/admin/export` | 管理鉴权；导出 `{version:1,monitors:[...]}`，不含设备会话、密钥和历史数据。 |
| `POST /api/admin/import` | 必须新 Bearer 密钥；正文同导出格式，上限 64 KiB，整批原子追加，启用项目在后续巡检探测。 |
| `GET /api/admin/devices` | 管理鉴权；设备 ID、浏览器标识、创建/到期时间和是否当前设备。 |
| `DELETE /api/admin/devices?id=...` | 管理鉴权；撤销指定设备后续请求的授权。 |
| `DELETE /api/session` | 管理鉴权；撤销当前 Cookie 会话并清除 Cookie。 |

创建、编辑与导入的可选字段：`keyword`、`json_path`、`json_expected`（JSON 文本，如 `"true"` 或 `"\"UP\""`）、`failure_threshold`（1–10，默认 1）、`notify_recovery`（0/1，默认 1）、`reminder_min`（0–1440，默认 0）。HEAD 不接受内容断言。通知单次投递限时 5 秒，每批最多 3 条；失败退避后由后续 Cron 或管理员操作重试，响应丢失仍可能造成重复投递。

> 域名安全检查使用 [Cloudflare DNS over HTTPS](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。DNS 预检查与 Worker 的实际连接分别解析域名，不提供 DNS 重绑定的绝对隔离；管理员应添加可信的公网服务。旧的 `PROBE_ALLOWED_HOSTS` 变量不再使用，可移除。

---

## 💡 最佳实践：如何为 Cloudflare KV / D1 编写探针

要检查业务 Worker 内部的 KV 和 D1 绑定，可在该 Worker 中提供轻量级探针端点：

```typescript
// 集成到已有业务 Worker 的路由中，并配置 DB 与 MY_KV 绑定:
interface HealthEnv {
  DB: D1Database;
  MY_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: HealthEnv) {
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
          d1: { status: 'UP', latency_ms: d1Latency },
          kv: { status: 'UP', latency_ms: kvLatency },
        },
        colo: request.cf?.colo || 'EDGE'
      });
    }

    // ... 其他业务路由
    return new Response('Not found', { status: 404 });
  }
}
```

管理员在 vPulse 中以 GET 添加该健康端点地址即可，无需修改域名配置。vPulse 会在诊断信息中展示 `d1:23ms · kv:6ms` 等组件耗时；延迟指标仍表示整个 HTTP 探测耗时。JSON 顶层及组件的 DOWN/ERROR/FAIL/FAILED/UNHEALTHY 判为故障，DEGRADED/WARN/WARNING 判为降级；普通无健康字段的 JSON 依据 HTTP 状态判断。

---

## 📄 开源许可证

审查与修复验证见 [REVIEW_REPORT.md](REVIEW_REPORT.md)。

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎 Star、Fork 或提交 Pull Request！

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://vmaker.xmtlz.dev">xmtlz</a> · Powered by Cloudflare Global Edge</sub>
</div>
