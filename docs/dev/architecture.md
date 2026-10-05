# 架构

> [← 返回文档索引](../../README.md#docs)

巨天agent 是三层结构,每一层都可以独立理解:

```
┌──────────────────────────────────────────────────────┐
│                   Electron 主进程                     │
│  ┌──────────────┐   ┌──────────────────────────────┐ │
│  │   serve.cjs  │   │  窗口 / 托盘 / 全局快捷键      │ │
│  │  (HTTP :3211)│   │  computer-use.cjs            │ │
│  │  38 内置工具  │   │  (desktopCapturer + 自动化)   │ │
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

- **工具 API**:38 个内置工具的实现,全部返回 `{ success, output }` 形状
- **llm-proxy**:`/api/llm-proxy` 转发 OpenAI 兼容流式请求;上游错误原样透传状态码
- **MCP 客户端**:stdio JSON-RPC 2.0,管理外部工具生态
- **门卫链**:OPTIONS 预检 → 不可信 Origin 403 → DNS-rebinding 421 → 非本机走配对码
- **持久化**:SQLite(`~/.lyclaw/data.db`)经 `src/shared/db.cjs`

> 构建产物 `serve.cjs` 由 `npm run build:server` 生成,**不要手改**。

### 2. Electron 主进程(`electron/`)

- 窗口生命周期、托盘、状态记忆(window-state 持久化)
- `computer-use.cjs`:desktopCapturer 截屏 + 系统级自动化(Computer Use 的执行端)
- 打包时 serve.cjs 直接运行在主进程内,无需独立终端窗口

### 3. React 渲染层(`src/renderer/`)

按域组织,一个功能域一个目录:

```
src/renderer/
├── app/        应用壳:TabBar / Sidebar / 通知中心 / LY HARNESS 面板
├── chat/       主对话:composer / 消息气泡 / 思考档位 / 模式开关
├── code/       代码模式:文件树 / 多标签编辑器 / 终端 / diff
├── agents/     集群:员工对话 / 群聊
├── computer/   Computer Use:预览 / 逐步确认
├── panels/     独立面板:知识库 / PPT 等
├── settings/   设置:推理 / 远程 / 语言 / 备份
├── media/      语音 / 音频
├── engine/     流式引擎 / 子代理并行池 / 代理循环
└── hooks/ store/ types/ utils/
```

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
