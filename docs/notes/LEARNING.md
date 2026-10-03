# 持续学习日志（对标 Zode 及同类产品）

> 本文件是 v5.0 起的持续学习机制：每次向对标产品（Zode / Zed / Claude Code 等）吸收一个可落地的范式，
> 记录「学到了什么 → 落地为什么 → 下一步」。不写空话，只写已实现与计划。

## 对标对象

| 产品 | 定位 | 值得学的 |
|---|---|---|
| **Zode** | 终端向、AI 原生的开源编程智能体 | MCP 工具生态、终端-first 交互、schema 严格的工具协议 |
| Zed | 高性能编辑器 + Agent Panel | 可编辑 diff、多模型并行的面板交互 |
| Claude Code | 终端编码智能体 | 权限分级、检查点、subagent 编排 |

## 2026-09 · v5.0 已落地

### 1. MCP 工具生态（学自 Zode）
- **学到了什么**：Zode 把「外部工具」标准化为 MCP Server——任何符合协议的工具都能即插即用，而不是每个工具硬编码进产品。
- **落地为什么**：
  - `src/shared/mcp.cjs`：stdio JSON-RPC 2.0 客户端（initialize 握手 → tools/list 缓存 → tools/call），
    进程退出自动重启、请求 20s 超时、结果统一转 `{success, output}`。
  - 工具命名 `mcp__<server>__<tool>`，经 `/api/tools/execute` 与内置 37 个工具走**同一条执行链路**
    （含安全策略检查），主对话与集群零改动获得 MCP 工具。
  - 设置 → 安全 → 「MCP 外部工具」：添加/启停/删除服务、拉取工具清单。
- **验证**：用最小 MCP Server 实测——握手 ✓、发现 2 个工具 ✓、echo/add 调用 ✓、对话链路调用返回 42 ✓。
- **v5.2 追加**：调用前按 inputSchema 预校验（required 缺失 / number·boolean 类型不符 → 明确中文错误），学的是 Zode 对工具 schema 的严格态度。
- **下一步**：
  - [ ] 支持 SSE / streamable-http 传输（当前仅 stdio）
  - [ ] server 级权限开关（读/写/网络），纳入安全策略
  - [ ] 集群员工按 MCP 工具声明专长（自动分工）

### 2. Computer Use（对标 Operator / Claude Computer Use）
- 截屏感知 + 系统级执行（cliclick 优先 / osascript 回退），专属标签页跑「观察→决策→执行→验证」循环。
- **v5.2 追加**：「逐步确认」安全开关——每个动作执行前等用户放行（学 Claude Computer Use 把确认权交给人的设计），状态持久化。
- 下一步：动作级权限白名单、Windows 拖拽补齐、鼠标滚轮原生支持。

## 2026-09 · v7.0 已落地

### 3. 手机远程成为完整代理端
- **学到了什么**：远程端不该是"只读聊天窗"，而应与桌面同能力——同一套工具循环、同一套编排。
- **落地为什么**：手机端实现子代理派发（嵌套循环 + 进度卡，防递归：子轮不派发）、
  screenshot 工具（serve.cjs 主进程 desktopCapturer 直采，存盘 + 配对码 URL）、
  截图渲染进工具卡并把图片转 dataURL 回喂多模态模型。
- **验证**：安全门卫 8 项、页面加载、会话同步此前已过；本轮交付。

### 4. LY HARNESS 插件中心（一切皆插件）
- **学到了什么**：harness 的本质是能力的可插拔编排。
- **落地为什么**：独立插件中心标签页（工具 38 个逐个开关 + 搜索、MCP 启停、Skills 入口）、
  streamChat 发送前过滤被停用工具、工具 schema 单源 builtin-tools.json（桌面/手机/服务端三方共用）。

### 5. 子代理并行池 + 可编辑 diff 全端覆盖
- 子代理从串行改为**并发 3 的 worker 池**，结果按原始顺序聚合。
- DiffCardView 抽为共享组件：代码模式与**主对话**都能看到真实旧→新 diff，支持撤销/编辑应用。

## 观察清单（未落地，保持跟踪）

- **Zode 的工具 schema 严格校验**：调用前用 inputSchema 预检参数，减少无效调用（计划 v5.1）。
- **Zed 的可编辑 diff**：代码模式把 AI 改动渲染为可逐块接受的 diff。
- **Claude Code 的 subagent**：集群员工已有雏形，缺「子任务独立上下文」的隔离执行。
