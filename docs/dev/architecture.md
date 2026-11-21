# 架构

**简体中文** | [English](../en/dev/architecture.md)

> [← 返回文档索引](../../README.md#docs)

巨天agent 是三层结构,每一层都可以独立理解:

```
┌──────────────────────────────────────────────────────┐
│                   Electron 主进程                     │
│  ┌──────────────┐   ┌──────────────────────────────┐ │
│  │   serve.cjs  │   │  窗口 / 托盘 / 全局快捷键      │ │
│  │  (HTTP :3211)│   │  窗口状态记忆                 │ │
│  │  58 内置工具  │   │                              │ │
│  │  llm-proxy   │   └──────────────────────────────┘ │
│  │  MCP 客户端   │   ┌──────────────────────────────┐ │
│  │  定时任务     │───│  手机远程门卫 (配对码)          │ │
│  │  通知桥      │   └──────────────────────────────┘ │
│  │  diff 留底   │                                    │
│  └──────────────┘                                    │
└───────────────────────────┬──────────────────────────┘
                            │ HTTP (同宿主)
              ┌─────────────┴─────────────┐
              ▼                           ▼
      React 渲染层 (:5173 dev)      手机浏览器 (LAN)
      /api/* 相对路径               remote.html 单页
```

## 三层职责

### 1. serve.ts — 单进程后端(唯一源码 `src/server/serve.ts`)

- **工具 API**:58 个内置工具的实现,全部返回 `{ success, output }` 形状
- **llm-proxy**:`/api/llm-proxy` 转发 OpenAI 兼容流式请求;上游错误原样透传状态码
- **MCP 客户端**:stdio JSON-RPC 2.0,管理外部工具生态
- **门卫链**:OPTIONS 预检 → 不可信 Origin 403 → DNS-rebinding 421 → 非本机走配对码
- **持久化**:SQLite(`~/.lyclaw/data.db`)经 `src/shared/db.cjs`

> 构建产物 `serve.cjs` 由 `npm run build:server` 生成,**不要手改**。

### 2. Electron 主进程(`electron/`)

- 窗口生命周期、托盘、状态记忆(window-state 持久化)
- 打包时 serve.cjs 直接运行在主进程内,无需独立终端窗口

### 3. React 渲染层(`src/renderer/`)

按域组织,一个功能域一个目录:

```
src/renderer/
├── app/        应用壳:TabBar / Sidebar / 通知中心 / LY HARNESS 面板
├── chat/       主对话:composer / 消息气泡 / 思考档位 / 模式开关
├── code/       代码模式:文件树 / 多标签编辑器 / 终端 / diff
├── agents/     集群:员工对话 / 群聊
├── panels/     独立面板:免费模型 / 知识库 / PPT 等
├── settings/   设置:推理 / 远程 / 语言 / 备份
├── media/      语音 / 音频
├── engine/     流式引擎 / 子代理并行池 / 代理循环
└── hooks/ store/ types/ utils/
```

## 推理内核(`src/shared`)

四套内核共用同一份工具清单与安全门禁,源码在 `src/shared/`,构建产物(`.cjs`)服务端与渲染层共用:

| 内核 | 文件 | 说明 |
|---|---|---|
| JT Core Pro+ | `agentLoop.ts` | 五阶段工具循环(准备 → 请求 → 流式 → 门禁 → 执行),细节见 [内核架构](kernel-architecture.md) |
| JT Core Ultra | `jtCoreUltra.ts` + `ultra/` | gemini-cli 护栏全量移植(FSM / 循环检测 / 模型回落),子系统拆在 `ultra/` 下 |
| JT Core Auto | `autoCore.ts` | 自主目标闭环:把 `agentLoop` 当一轮执行,独立评估器逐轮判完成度 + 自动续跑;三态保护 / 停滞检测 / 封顶 5 轮 |
| JT Core Super | `superCore.ts` + `super/` | 全自动路由编排层:11 阶段流水线把前三套当执行器,见 [超级内核架构](super-kernel.md) |

`src/shared/super/` 五模块互不 import,只依赖 `super/types.ts` 类型契约;编排集中在 `super/` 之外的 `superCore.ts`:

```
src/shared/super/
├── signals/     信号采集(extractor)
├── analysis/    复杂度评分(complexity)+ 任务分析(analyzer)
├── planning/    执行计划(planner)+ 依赖图(dependencyGraph)+ 策略选择(strategies)
├── routing/     内核路由(router)+ 模型选择(modelSelector)+ 自适应学习(adaptation)
├── context/     上下文工程(assembler)
├── guardrails/  护栏链(chain)
├── runtime/     事件总线(events)+ 调度器(scheduler)
└── types.ts     跨模块类型契约(唯一依赖面)
```

引擎档位由 `agentEngine` 设置分发:渲染层三档(vercel / server / client)与四内核并存;服务端内核循环经 `/api/agent/run` 提供,桌面 server 档、TUI 与手机远程共用同一条链路。

## 关键数据流

**一轮对话**:renderer 发 `POST /api/llm-proxy`(SSE)→ 模型回 `tool_calls` → renderer 逐个 `POST /api/tools/execute` → serve 执行(或转 MCP)→ 结果回喂 → 循环至模型给最终回答。工具的 schema 来自 `src/shared/builtin-tools.json`(三端单一来源)。

**子代理**:engine/subagent.ts 的 worker 池(并发 3)各自走完整工具循环,进度经 `subagent-progress` 窗口事件推给侧栏与手机端。

## 端口约定

| 端口 | 用途 |
|---|---|
| 3211 | 后端 API + 生产模式页面(固定,勿改;远程访问也走它) |
| 5173 | Vite 开发服务器(仅 dev,`/api` 代理到 3211) |

## 安全设计

门卫语义、掩码规则、命令黑名单的完整说明见根目录 [SECURITY.md](../../SECURITY.md);改动 `serve.ts` 的跨站逻辑前,先读文件头部注释。
