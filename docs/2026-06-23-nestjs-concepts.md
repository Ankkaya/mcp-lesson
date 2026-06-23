# NestJS 概念总结

> 整理日期：2026-06-23
> 来源：cron-job-tool 项目开发过程中的概念性解释

---

## 1. TypeORM 实体注册（forRoot vs forFeature）

### 集中注册（forRoot）

```typescript
// app.module.ts
TypeOrmModule.forRootAsync({
  // ...
  entities: [User, Job],  // 所有实体集中写在这里
})
```

- 简单直接，一目了然所有数据库表
- 适合小项目或学习项目
- **缺点**：每加一个实体都要改 `app.module.ts`，且要在顶部 import

### 分散注册（forFeature，NestJS 推荐）

```typescript
// app.module.ts —— 不写 entities
TypeOrmModule.forRootAsync({ /* 只配置连接 */ })

// users.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([User])],  // 本模块用到的实体
})
// job.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([Job])],
})
```

- **高内聚低耦合**：每个模块只管自己用到的实体
- 加新实体时只改对应业务模块，不动 `app.module.ts`
- 更符合 NestJS 模块化设计思想
- 中大型项目推荐

### 关键区别

| 对比项 | 集中注册 | 分散注册 |
|--------|---------|---------|
| 实体声明位置 | app.module.ts | 各业务模块 |
| `forFeature` | 不需要 | 必须 |
| 扩展性 | 较差 | 好 |
| 适用场景 | 小项目/学习 | 中大型项目 |

---

## 2. 依赖注入方式对比（直接 Service vs useFactory + token）

### 方式 1：直接注入 Service

```typescript
// ai.module.ts
providers: [WebSearchToolService]

// ai.service.ts
@Inject(WebSearchToolService) private readonly webSearchToolService: WebSearchToolService
// 使用时
this.webSearchToolService.getTool()
```

### 方式 2：useFactory + token

```typescript
// ai.module.ts
providers: [
  WebSearchToolService,
  {
    provide: 'WEB_SEARCH_TOOL',
    useFactory: (svc: WebSearchToolService) => svc.getTool(),
    inject: [WebSearchToolService],
  },
]

// ai.service.ts
@Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: StructuredTool
// 使用时
this.webSearchTool  // 直接就是 tool，无需调方法
```

### 核心区别

| 维度 | 方式 1（直接 Service） | 方式 2（useFactory + token） |
|------|----------------------|---------------------------|
| 注入的是 | Service 实例 | Tool 实例（factory 返回值） |
| 使用时 | 每次 `svc.getTool()` | 直接用 |
| 能访问 service 其他方法 | 能 | 不能 |
| token 类型 | 类引用（类型安全） | 字符串（无类型检查） |
| 适用场景 | 需要 service 其他方法 | 只需要 tool，想更简洁 |

### 选择建议

- 工具 service **只暴露 tool** → 用 **方式 2**，`AiService` 不用知道 `getTool()` 的存在
- 工具 service **有其他方法**需要调用 → 用 **方式 1**

本项目最终统一用方式 2，因为所有 tool service 都只有 `getTool()` 一个方法。

---

## 3. `@Inject` 装饰器（类引用 vs 字符串 token）

### 类引用注入（类型安全）

```typescript
@Inject(JobService) private readonly jobService: JobService
```

- NestJS 根据 class 引用查找 provider
- 编译期类型检查，写错名字会报错
- 推荐

### 字符串 token 注入

```typescript
@Inject('CHAT_MODEL') model: ChatOpenAI
```

- 用字符串作为 provider 的唯一标识
- **无类型约束**，`@Inject('CHAT_MODEL')` 拿到的类型需手动声明
- 写错 token 名编译期不报错，运行时才报 `UnknownDependenciesException`
- 适用于 `useFactory` 创建的对象（没有对应 class）

### 本项目的用法

```typescript
// 类引用 —— 注入 service
@Inject(JobService) private readonly jobService: JobService
@Inject(EntityManager) private readonly entityManager: EntityManager

// 字符串 token —— 注入 factory 产出的工具
@Inject('CHAT_MODEL') model: ChatOpenAI
@Inject('QUERY_USER_TOOL') private readonly queryUserTool: StructuredTool
@Inject('SEND_MAIL_TOOL') private readonly sendMailTool: StructuredTool
```

---

## 4. `forwardRef` 循环依赖

### 问题场景

```
模块 A → 依赖 B
模块 B → 依赖 A   ← 循环依赖，"先有鸡还是先有蛋"
```

### 解决方式：两边都用 `forwardRef`

```typescript
// tool.module.ts
imports: [forwardRef(() => JobModule)]

// job.module.ts
imports: [forwardRef(() => ToolModule)]
```

`forwardRef` 告诉 NestJS："我要用这个模块，但它可能还没初始化完，等需要时再解析。"

### 本项目的循环依赖

```
ToolModule → 需要 JobModule（因为 CronJobToolService 依赖 JobService）
JobModule  → 需要 ToolModule（因为 JobAgentService 依赖工具 token）
```

### 注意事项

- `forwardRef` 是循环依赖的**权宜之计**，不是最佳实践
- 盲目加 `forwardRef` 是反模式——它掩盖了本应重构的循环依赖问题
- 如果能通过调整模块边界消除循环依赖，优先重构

### 单向依赖不需要 forwardRef

```typescript
// ToolModule 单向依赖 JobModule，JobModule 不反向依赖 ToolModule
imports: [JobModule]  // 普通导入即可，不需要 forwardRef
```

---

## 5. Module imports 规则

### 核心规则

**要使用某个模块 exports 的 provider，必须在 imports 里导入那个模块。**

```typescript
// job.module.ts
@Module({
  providers: [JobService],
  exports: [JobService],  // 对外暴露 JobService
})
export class JobModule {}

// tool.module.ts
@Module({
  imports: [JobModule],  // ← 不导入就拿不到 JobService
  providers: [CronJobToolService],  // CronJobToolService 注入 JobService
})
```

### 注入链路示例

```
JobModule
  └─ providers: [JobService]
  └─ exports: [JobService]          ← 对外暴露
       │
ToolModule
  └─ imports: [JobModule]           ← 引入 JobModule
  └─ providers: [CronJobToolService]
       └─ constructor(@Inject(JobService))  ← 注入 JobService
```

### 全局 provider 例外

有些 provider 是全局的，不需要 imports：
- `ConfigService`（`ConfigModule.forRoot({ isGlobal: true })`）
- `EntityManager`（TypeORM 内部注册）
- `MailerService`（`MailerModule.forRoot` 配置）

---

## 6. `OnApplicationBootstrap` 生命周期

### NestJS 启动生命周期（部分）

```
onModuleInit          → 所有模块初始化
onApplicationBootstrap → 所有模块初始化完成，准备开始服务
onModuleDestroy       → 应用关闭
```

### 本项目用法：定时任务启动恢复

```typescript
@Injectable()
export class JobService implements OnApplicationBootstrap {
  async onApplicationBootstrap() {
    // 从 DB 查出所有 isEnabled=true 的 Job
    const enabledJobs = await this.entityManager.find(Job, {
      where: { isEnabled: true },
    });
    // 重建定时器
    for (const job of enabledJobs) {
      await this.startRuntime(job);
    }
  }
}
```

### 为什么用 `onApplicationBootstrap`

- 此时所有 provider 已注入完成，可以安全使用 `EntityManager`、`SchedulerRegistry` 等
- 所有模块都就绪，跨模块依赖可用
- 是"应用准备好服务请求"的标志点，适合做启动恢复

### 持久化 + 重启恢复设计

```
定时器在内存里 → 进程重启即丢失
任务定义在 DB 里 → 不会丢

重启时：onApplicationBootstrap → 读 DB → 重建定时器
```

---

## 7. useFactory 包装模式

### 场景

Tool Service 暴露的是 `getTool()` 方法，但消费方（`AiService`）只想直接拿到 `StructuredTool` 实例，不想知道 service 的存在。

### 模式

```typescript
{
  provide: 'CRON_JOB_TOOL',                                    // token
  useFactory: (svc: CronJobToolService) => svc.getTool(),      // 包装
  inject: [CronJobToolService],                                // 依赖
}
```

### 三要素

| 要素 | 作用 |
|------|------|
| `provide` | 定义注入 token（字符串或 class） |
| `useFactory` | 工厂函数，返回要注入的对象 |
| `inject` | 工厂函数的参数依赖列表 |

### 本项目统一应用

```typescript
// tool.module.ts —— 5 个工具 + 1 个模型，全部用 useFactory
{
  provide: 'CHAT_MODEL',       useFactory: (cs) => new ChatOpenAI({...}), inject: [ConfigService],
},
{
  provide: 'QUERY_USER_TOOL',  useFactory: (svc) => svc.getTool(), inject: [QueryUserToolService],
},
{
  provide: 'SEND_MAIL_TOOL',   useFactory: (svc) => svc.getTool(), inject: [SendMailToolService],
},
// ... 其他工具同理
```

### 优势

- 消费方只依赖 token，不感知 service 存在
- `AiService` 构造函数干净：`@Inject('XXX_TOOL') tool: StructuredTool`
- 中间转换逻辑（`getTool()`）封装在 module 里

---

## 8. 模块化组织（ToolModule 统一管理）

### 重构前：工具散落在 ai.module.ts

```typescript
// ai.module.ts（316 行，混杂工具 factory + 模型 + service）
providers: [
  AiService,
  { provide: 'CRON_JOB_TOOL', useFactory: ..., inject: [...] },  // 140 行
  { provide: 'QUERY_USER_TOOL', useFactory: ..., inject: [...] },
  { provide: 'SEND_MAIL_TOOL', useFactory: ..., inject: [...] },
  { provide: 'WEB_SEARCH_TOOL', useFactory: ..., inject: [...] },
  { provide: 'DB_USERS_CRUD_TOOL', useFactory: ..., inject: [...] },
  { provide: 'CHAT_MODEL', useFactory: ..., inject: [...] },
]
```

### 重构后：ToolModule 统一管理

```
src/tool/
├── tool.module.ts               # 统一管理所有工具 + CHAT_MODEL
├── cron-job-tool.service.ts     # 各工具 service 独立文件
├── query-user-tool.service.ts
├── send-mail-tool.service.ts
├── web-search-tool.service.ts
├── db-users-crud-tool.service.ts
└── time-now-tool.service.ts
```

```typescript
// tool.module.ts
@Module({
  imports: [UsersModule, forwardRef(() => JobModule)],
  providers: [
    UserService,  // QueryUserToolService 的依赖
    // 5 个 tool service
    CronJobToolService, QueryUserToolService, SendMailToolService,
    WebSearchToolService, DbUsersCrudToolService, TimeNowToolService,
    // 6 个 token（5 工具 + 1 模型）
    { provide: 'CHAT_MODEL', useFactory: ..., inject: [ConfigService] },
    { provide: 'QUERY_USER_TOOL', useFactory: ..., inject: [...] },
    // ...
  ],
  exports: [
    'CHAT_MODEL', 'QUERY_USER_TOOL', 'SEND_MAIL_TOOL',
    'WEB_SEARCH_TOOL', 'DB_USERS_CRUD_TOOL', 'CRON_JOB_TOOL', 'TIME_NOW_TOOL',
  ],
})
export class ToolModule {}

// ai.module.ts（28 行，只关心 AI 编排）
@Module({
  imports: [ToolModule, UsersModule],
  providers: [AiService],
})
export class AiModule {}

// job.module.ts（11 行，只关心任务调度 + 执行）
@Module({
  imports: [forwardRef(() => ToolModule)],
  providers: [JobService, JobAgentService],
  exports: [JobService],
})
export class JobModule {}
```

### 设计要点

1. **单一职责**：`ToolModule` 管工具，`AiModule` 管对话，`JobModule` 管调度
2. **共享 provider**：`CHAT_MODEL` 放 `ToolModule` 并 export，`AiModule` 和 `JobModule` 都能用
3. **依赖方向**：`ToolModule ↔ JobModule` 循环依赖（`forwardRef` 解决）
4. **高内聚**：工具相关代码全在 `src/tool/` 目录下
5. **ai.module.ts 从 316 行 → 28 行**，只保留编排逻辑

---

## 概念速查表

| 概念 | 一句话 | 关键 API |
|------|--------|---------|
| 实体注册 | entities 要让 TypeORM 知道 | `forRoot({ entities })` / `forFeature([...])` |
| 依赖注入 | NestJS 自动创建并传入依赖 | `@Inject()` / 构造函数 |
| useFactory | 工厂函数创建注入对象 | `{ provide, useFactory, inject }` |
| 字符串 token | 用字符串标识 provider | `@Inject('TOKEN')` |
| 类引用注入 | 用 class 标识 provider，类型安全 | `@Inject(JobService)` |
| forwardRef | 解决循环依赖 | `forwardRef(() => Module)` |
| Module imports | 要用 exports 必须先 imports | `imports: [JobModule]` |
| exports | 模块对外暴露的 provider | `exports: [JobService]` |
| 生命周期钩子 | 应用各阶段回调 | `OnApplicationBootstrap` |
| 模块化 | 按职责拆分模块 | `@Module({})` |
