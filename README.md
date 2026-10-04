<div align="center">

# 巨天agent

**桌面 AI 工作台 — 对话 · 代码 · 集群 · Computer Use**

一句话，它把活干完。

[![Version](https://img.shields.io/badge/v7.0.0-10a37f?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![Platform](https://img.shields.io/badge/macOS%20·%20Windows-3b82f6?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![Tools](https://img.shields.io/badge/tools--38-10a37f?style=for-the-badge&labelColor=0a0a0b)](docs/)
[![MCP](https://img.shields.io/badge/MCP-ready-8b5cf6?style=for-the-badge&labelColor=0a0a0b)](docs/)
[![License](https://img.shields.io/badge/MIT-10a37f?style=for-the-badge&labelColor=0a0a0b)](./LICENSE)

[下载](https://github.com/deepseekv5/jutian-agent/releases) · [亮点](#-六件事做到位) · [架构](#-架构) · [路线图](#-路线图) · [FAQ](#-常见问题)

</div>

---

<br>

> 桌面，是 AI 最好的位置。
>
> 浏览器里的 AI 要你迁就它。装在桌面上的 AI，直接住进你的文件、终端和工作流。

<br>

## ✦ 六件事，做到位

**01 — 说人话，它动手**

38 个内置工具直连真实终端与文件系统。你说目标，它拆步骤、调工具、验证、给结果。不是建议，是执行。

**02 — 代码模式**

完整开发环境，不离开窗口。文件树、多标签、语法高亮、内置终端；每轮对话前自动快照，一整轮改动一键撤销。

**03 — 集群指挥室**

一个目标，一支团队。总管拆任务，员工互相 @ 接管，自动汇总交付。员工可自定义，可拉群，可指定老板。

**04 — 终端即入口**

装上 jtcode，一行命令唤起助手。终端里、脚本里、CI 里都能用，不用切窗口。

**05 — 一切皆插件**

LY HARNESS 插件中心：38 个工具逐个开关、MCP 服务即插即用、Skills 按消息挂载。工具 schema 单一来源，桌面 / 手机 / 服务端三方同步。

**06 — 越用越懂你**

长期记忆只存索引，细节按需取；知识库文档随时检索。它记得你的偏好、你的项目、你说话的方式。

<br>

## ✦ 子代理 — AI 派出 AI

主对话 AI 可自行派出 1–5 个并行子代理（worker 池，并发 3），每个子代理拥有完整工具能力。侧栏实时进度，随时可停。

```
  派出 ──▶ ┌─ 调研员 ──▶ 收集资料，输出 notes
           ├─ 开发   ──▶ 实现 + 自测
           └─ 审校   ──▶ 汇总交付
```

手机远程同样支持派发，进度卡片实时可见。

<br>

## ✦ Computer Use — 它操作这台电脑

说目标，它截屏观察、决定点哪里、输入什么，执行后再截图确认，直到完成。

```
  观察 → 决策 → 执行 → 验证 → (循环)
```

每一步可见、可打断；「逐步确认」模式下每个动作先等你放行。

<br>

## ✦ 手机远程 — 把工作台装进口袋

局域网扫码配对，配对码守着每一道接口。

```
  手机发消息 ──▶ 电脑干活 ──▶ 进度回手机
```

Markdown 全渲染、工具调用全展示、子代理进度实时同步。

<br>

## ✦ 三条原则，从不例外

**本地优先** — 数据留在这台电脑上，断网也能干活。

**一次到位** — 不说「你可以试试」，直接给结果。

**克制** — 界面只做一件事：不打扰。

<br>

## ✦ 数据一览

| **38** | **5+** | **6** | **0** |
|:---:|:---:|:---:|:---:|
| 内置工具 | 数字员工 | 核心界面 | 字节上云 |

<br>

## ✦ 快速开始

```bash
git clone https://github.com/deepseekv5/jutian-agent.git
cd jutian-agent
./run.sh                  # 自动装依赖 + 启动(Windows 下载后直接双击 run.bat)
npm run electron:build    # 打包 macOS (dmg + zip)
```

> 也可以手动执行 `npm install && npm start`。`run.sh` / `run.bat` 检测到缺依赖时会自动安装。

首次使用：**设置 → 推理** 填入任意 OpenAI 兼容服务的地址、密钥与模型名。
本软件不内置任何模型服务与密钥——你的配置只属于你。

<details>
<summary><b>📥 下载安装包</b></summary>

前往 [Releases](https://github.com/deepseekv5/jutian-agent/releases)：

| 文件 | 说明 |
|---|---|
| 巨天agent-x.x.x-arm64.dmg | macOS Apple Silicon |
| 巨天agent-x.x.x-arm64-mac.zip | macOS 免安装 |

> 首次打开：右键 → 打开，或 xattr -cr /Applications/巨天agent.app

</details>

<br>

## ✦ 架构

```
┌──────────────────────────────────────────────────┐
│                  Electron 主进程                   │
│  ┌─────────────┐  ┌────────────────────────────┐ │
│  │  serve.cjs  │  │    窗口 / 托盘 / 截屏        │ │
│  │  38 工具     │  │    Computer Use / 状态记忆   │ │
│  │  llm-proxy  │  └────────────────────────────┘ │
│  │  MCP 客户端  │                                  │
│  │  定时任务    │    ┌─────────────────────┐     │
│  │  diff 留底  │────│  手机远程 (配对码)     │     │
│  └─────────────┘    └─────────────────────┘     │
└──────────────────────────────────────────────────┘
        │ tools/execute         │ remote/file
        ▼                       ▼
  真实终端 · 文件系统       手机浏览器 (LAN)
```

<details>
<summary><b>📁 完整目录结构</b></summary>

```
├── index.html                 入口页面
├── serve.cjs                  后端服务（Electron 主进程内）
├── electron/                  主进程
├── src/
│   ├── renderer/
│   │   ├── app/               应用壳（TabBar/Sidebar/通知/LY HARNESS）
│   │   ├── chat/              主对话
│   │   ├── code/              代码模式
│   │   ├── agents/            集群
│   │   ├── computer/          Computer Use
│   │   ├── panels/            独立面板
│   │   ├── media/             多媒体
│   │   ├── settings/          设置
│   │   ├── engine/            流式引擎/子代理/代理循环
│   │   └── hooks/ store/ types/ utils/
│   └── shared/                工具 schema / MCP / 员工模型 / CLI
├── docs/                      产品官网（GitHub Pages）
├── public/                    手机端单页
└── scripts/                   构建与补丁
```

</details>

<br>

## ✦ 路线图

- [x] 集群指挥室（员工对话 / 群聊 / 指定老板）
- [x] 子代理并行池（并发 3）
- [x] 可编辑 diff（主对话 + 代码模式）
- [x] 手机远程（配对码 + 子代理 + 截图）
- [x] LY HARNESS 插件中心
- [x] screenshot 工具（多模态回喂）
- [ ] MCP SSE / streamable-http
- [ ] MCP 服务级权限开关
- [ ] 定时任务 × 集群编排
- [ ] 会话模板 / 导出 PDF

<br>

## ✦ 常见问题

**首次打开提示"无法验证开发者"？**
应用未做付费签名。右键 → 打开，或 xattr -cr /Applications/巨天agent.app

**模型服务怎么配置？**
设置 → 推理，填入任意 OpenAI 兼容服务。不内置任何服务与密钥。

**可以商用吗？**
可以。MIT 许可证允许任意使用（含商用），仅需保留版权声明。

**和网页版 AI 有什么区别？**
网页版 AI 要你迁就它。桌面版直接住进你的文件、终端和工作流。

<br>

## ✦ 贡献

欢迎 Issue 与 PR。提交前请阅读 [COPYRIGHT.md](./COPYRIGHT.md) 中的第三方组件说明。

<br>

---

<div align="center">

**巨天agent**

桌面，是 AI 最好的位置。

[![License: MIT](https://img.shields.io/badge/License-MIT-10a37f?style=flat-square)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/deepseekv5/jutian-agent?style=flat-square&color=10a37f)](https://github.com/deepseekv5/jutian-agent/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Windows-3b82f6?style=flat-square)]()

**巨天工作室** · 本地优先 · 数据归你

</div>
