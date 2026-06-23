# 定时任务实现思路总结

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户 / AI                          │
│  "1分钟后提醒我喝水"  →  cron_job 工具 (type=at)        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  ToolModule  (src/tool/)                                │
│  ├── CronJobToolService  → 暴露 'CRON_JOB_TOOL'         │
│  ├── QueryUserToolService → 暴露 'QUERY_USER_TOOL'       │
│  ├── SendMailToolService  → 暴露 'SEND_MAIL_TOOL'        │
│  ├── WebSearchToolService → 暴露 'WEB_SEARCH_TOOL'       │
│  ├── DbUsersCrudToolService → 暴露 'DB_USERS_CRUD_TOOL'  │
│  ├── TimeNowToolService  → 暴露 'TIME_NOW_TOOL'          │
│  └── CHAT_MODEL (ChatOpenAI 实例)                       │
└───────────────────────┬─────────────────────────────────┘
                        │
            ┌───────────┴────────────┐
            ▼                        ▼
┌──────────────────────┐   ┌─────────────────────────────┐
│  AiModule            │   │  JobModule                  │
│  ├── AiService       │   │  ├── JobService (调度管理)   │
│  └── AiController    │   │  └── JobAgentService (执行)  │
└──────────────────────┘   └─────────────────────────────┘
```

## 二、数据模型（Job 实体）

文件：`src/job/entities/job.entity.ts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `instruction` | text | 任务指令（自然语言，交给 AI 执行） |
| `type` | `cron` / `every` / `at` | 任务类型 |
| `cron` | varchar(100) | cron 表达式（type=cron 时用） |
| `everyMs` | int | 间隔毫秒（type=every 时用） |
| `at` | timestamp | 触发时间点（type=at 时用） |
| `isEnabled` | boolean | 是否启用 |
| `lastRun` | timestamp | 上次执行时间 |
| `createdAt` / `updatedAt` | timestamp | 自动维护 |

设计要点：**用同一张表、可空字段承载三种类型**，按 `type` 决定使用哪个时间字段。

## 三、三种任务类型与对应调度器

| 类型 | 时间规则 | 调度工具 | 适用场景 |
|------|---------|---------|---------|
| `cron` | cron 表达式 | `CronJob`（cron 库） | "每天 9 点"、"工作日每 30 分钟" |
| `every` | 任意毫秒间隔 | `setInterval`（Node 原生） | "每 1.5 秒"、"每 70 秒" |
| `at` | 某时间点执行一次 | `setTimeout`（Node 原生） | "1 分钟后"、"明天 9 点" |

**为什么不用 `CronJob` 统一处理三种？**
- `CronJob` 只擅长 cron 表达式，无法表达 `everyMs=1500` 这类任意毫秒
- `at` 类型用 `CronJob(date)` 虽可行但杀鸡用牛刀，`setTimeout` 更轻量
- 不同时间规则用最合适的工具，是合理的工程设计

## 四、核心组件职责

### 1. `JobService`（调度管理）
文件：`src/job/job.service.ts`

职责：**管理任务生命周期**，不直接执行任务内容

- `onApplicationBootstrap`：启动时从 DB 恢复所有启用任务
- `listJobs`：列举任务 + 计算运行状态
- `addJob`：创建任务（存 DB + 启动调度）
- `toggleJob`：启用/停用任务
- `startRuntime`：按类型创建定时器并注册到 `SchedulerRegistry`
- `stopRuntime`：按类型停止/清理定时器
- `createCronJob`：构建 `CronJob` 实例

### 2. `JobAgentService`（任务执行代理）
文件：`src/job/job-agent.service.ts`

职责：**到点后真正执行任务内容**

- 接收 `instruction`（自然语言）
- 驱动 AI 模型 + 工具链完成多轮工具调用
- 返回执行结果字符串

**工具集差异**：`JobAgentService` 不含 `cron_job` 工具（避免任务再建任务），但含 `time_now`（执行时需知当前时间）。

### 3. `SchedulerRegistry`（集中管理器）
来自 `@nestjs/schedule`

职责：**只是收纳箱，不负责调度**

- `addCronJob/Interval/Timeout` — 注册（存内部 Map）
- `getCronJobs/getIntervals/getTimeouts` — 列举
- `deleteCronJob/deleteInterval/deleteTimeout` — 清理

真正的计时触发靠 `CronJob` / `setInterval` / `setTimeout` 自己。

## 五、执行链路

```
用户："1分钟后提醒我喝水"
  │
  ├─ AiService 收到请求
  │    └─ AI 决定调用 cron_job 工具
  │         └─ CronJobToolService 执行
  │              └─ JobService.addJob({ type:'at', at:now+60s, instruction:'提醒我喝水' })
  │                   ├─ 存入数据库 jobs 表
  │                   └─ startRuntime()
  │                        └─ setTimeout(delay=60000, 回调)
  │                             └─ 注册到 SchedulerRegistry.addTimeout()
  │
  ├─ 60 秒后，Node.js 事件循环 timers 阶段触发回调
  │    └─ jobAgentService.runJob('提醒我喝水')
  │         └─ AI 模型 + 工具链执行
  │              └─ 返回结果
  │                   └─ logger.log 打印结果
  │                        └─ 更新 lastRun + isEnabled=false（at 类型执行完自动停用）
  │                             └─ SchedulerRegistry.deleteTimeout 清理
  │
  └─ 完成
```

## 六、持久化与重启恢复

**定时器在内存里，进程重启即丢失；任务定义在数据库里，不会丢。**

```
程序启动
  └─ onApplicationBootstrap (job.service.ts:27)
       └─ 从 DB 查出所有 isEnabled=true 的 Job
            └─ 对每个 Job 调 startRuntime()
                 └─ 重新创建 CronJob / setInterval / setTimeout
```

关键：`startRuntime` 前先检查 `SchedulerRegistry` 是否已注册，避免重复注册。

## 七、底层原理：Node.js 事件循环

```
┌────────────────────────────────────┐
│   NestJS 进程常驻运行（不退出）      │
│                                    │
│   ┌──────────────────────────────┐ │
│   │   事件循环 (libuv)           │ │
│   │                              │ │
│   │   timers 阶段                │ │ ← setTimeout/setInterval 到点回调
│   │   poll 阶段                  │ │ ← I/O 回调
│   │   check 阶段                 │ │ ← setImmediate
│   │   ...循环往复                 │ │
│   └──────────────────────────────┘ │
└────────────────────────────────────┘
```

定时任务能自动执行的本质：
1. **进程不退出**（NestJS 服务常驻）
2. **事件循环持续运转**（libuv 轮询各阶段）
3. **定时器到点回调**（timers 阶段触发）

## 八、关键设计点

1. **调度与执行解耦**：`JobService` 只管"什么时候触发"，`JobAgentService` 管"触发后做什么"
2. **统一 try/catch**：三处回调都用 try/catch 包裹 `runJob`，异常被吞掉不影响下次调度
3. **幂等启动**：`startRuntime` 前检查是否已注册，避免重复
4. **at 类型自动停用**：执行后 `isEnabled=false`，防止重复触发
5. **工具集隔离**：执行代理不含 `cron_job`，避免任务无限创建任务
6. **时间注入**：`time_now` 工具让 AI 执行时知道当前时间（解决模型用训练截止日期当"现在"的问题）
7. **模块化工具管理**：`ToolModule` 统一管理所有工具 service + token，`AiModule`/`JobModule` 共享

## 九、涉及文件清单

```
src/
├── job/
│   ├── entities/job.entity.ts       # Job 实体定义
│   ├── job.service.ts               # 调度管理（增删启停 + 恢复）
│   ├── job-agent.service.ts         # 任务执行代理（AI + 工具链）
│   └── job.module.ts                # JobModule 定义
├── tool/
│   ├── tool.module.ts               # 统一管理工具 + CHAT_MODEL
│   ├── cron-job-tool.service.ts     # 定时任务管理工具
│   ├── query-user-tool.service.ts   # 查询用户工具
│   ├── send-mail-tool.service.ts    # 发邮件工具
│   ├── web-search-tool.service.ts   # 网页搜索工具
│   ├── db-users-crud-tool.service.ts# 用户表 CRUD 工具
│   └── time-now-tool.service.ts     # 获取当前时间工具
└── ai/
    ├── ai.module.ts                 # AiModule（引入 ToolModule）
    ├── ai.service.ts                # 对话编排（含 cron_job 工具）
    └── ai.controller.ts             # HTTP/SSE 接口
```
