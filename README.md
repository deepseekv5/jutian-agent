<div align="center">

# 巨天agent
# ⚠️建议使用OpenRouter Free Models Router作为主力免费模型,仍可使用自己的模型⚠️

**桌面 AI 工作台 — 对话 · 代码 · 集群 · 免费模型**

一句话,它把活干完。

[English](README_EN.md) | **简体中文**

[![CI](https://img.shields.io/github/actions/workflow/status/deepseekv5/jutian-agent/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/v8.0.0-10a37f?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![Platform](https://img.shields.io/badge/macOS%20·%20Windows-3b82f6?style=for-the-badge&labelColor=0a0a0b)](https://github.com/deepseekv5/jutian-agent/releases)
[![Docs](https://img.shields.io/badge/docs-12%20篇-8b5cf6?style=for-the-badge&labelColor=0a0a0b)](#docs)
[![License](https://img.shields.io/badge/MIT-10a37f?style=for-the-badge&labelColor=0a0a0b)](./LICENSE)

[下载](https://github.com/deepseekv5/jutian-agent/releases) · [文档](#docs) · [快速开始](#quick-start) · [架构](#architecture) · [FAQ](#faq)

</div>

---

<br>

> 桌面,是 AI 最好的位置。
>
> 科技不是高高在上,而是服务于人民。
>
> 浏览器里的 AI 要你迁就它。装在桌面上的 AI,直接住进你的文件、终端和工作流。

<br>

## 📖 目录

| | | |
|---|---|---|
| [六件事,做到位](#highlights) | [子代理 — AI 派出 AI](#swarm) | [免费模型 — AI 没有门槛](#free-models) |
| [手机远程](#remote) | [三条原则](#principles) | [📖 文档导航](#docs) |
| [快速开始](#quick-start) | [架构](#architecture) | [数据一览](#stats) |
| [路线图](#roadmap) | [常见问题](#faq) | [参与贡献](#contributing) |

<br>

<a id="highlights"></a>

## ✦ 六件事,做到位

**01 — 说人话,它动手**

38 个内置工具直连真实终端与文件系统。你说目标,它拆步骤、调工具、验证、给结果。不是建议,是执行。

**02 — 代码模式**

完整开发环境,不离开窗口。文件树、多标签、语法高亮、内置终端;每轮对话前自动快照,一整轮改动一键撤销。

**03 — 集群指挥室**

一个目标,一支团队。总管拆任务,员工互相 @ 接管,自动汇总交付。员工可自定义,可拉群,可指定老板。

**04 — 终端即入口**

装上 jtcode,一行命令唤起助手。终端里、脚本里、CI 里都能用,不用切窗口。

**05 — 一切皆插件**

LY HARNESS 插件中心:38 个工具逐个开关、MCP 服务即插即用、Skills 按消息挂载。工具 schema 单一来源,桌面 / 手机 / 服务端三方同步。

**06 — 越用越懂你**

长期记忆只存索引,细节按需取;知识库文档随时检索。它记得你的偏好、你的项目、你说话的方式。

<br>

<a id="swarm"></a>

## ✦ 子代理 — AI 派出 AI

主对话 AI 可自行派出 1–5 个并行子代理(worker 池,并发 3),每个子代理拥有完整工具能力。侧栏实时进度,随时可停。

```
  派出 ──▶ ┌─ 调研员 ──▶ 收集资料,输出 notes
           ├─ 开发   ──▶ 实现 + 自测
           └─ 审校   ──▶ 汇总交付
```

手机远程同样支持派发,进度卡片实时可见。

→ **完整文档**:[子代理集群](docs/guide/swarm.md)

<br>

<a id="free-models"></a>

## ✦ 免费模型 — AI 没有门槛

内置**免费模型面板**:默认 OpenRouter Free Models Router(`openrouter/free`,聚合 20+ 免费模型自动路由),共 21 个免费档免 key 一键切换,不注册、不付费、每 IP 200 次/小时,空响应自动重试;配一个 Kilo 账户密钥即可解锁全部 378 个付费档。科技不是高高在上,而是服务于人民。

```
  免费档 ──▶ kilo-auto 自动路由 · Nemotron 3 Ultra 550B · Step 3.7 Flash …
  付费档 ──▶ 配置 Kilo 密钥,同一切换体验
```

→ **完整文档**:[免费模型与模型接入](docs/guide/free-models.md)

<br>

<a id="remote"></a>

## ✦ 手机远程 — 把工作台装进口袋

局域网扫码配对,配对码守着每一道接口。

```
  手机发消息 ──▶ 电脑干活 ──▶ 进度回手机
```

Markdown 全渲染、工具调用全展示、子代理进度实时同步。

→ **完整文档**:[手机远程](docs/guide/remote.md)

<br>

<a id="principles"></a>

## ✦ 三条原则,从不例外

**本地优先** — 数据留在这台电脑上,断网也能干活。

**一次到位** — 不说「你可以试试」,直接给结果。

**克制** — 界面只做一件事:不打扰。

<br>

<a id="docs"></a>

## ✦ 📖 文档导航

### 用户指南

| 文档 | 一句话 |
|---|---|
| [📥 安装与启动](docs/guide/install.md) | 安装包 / 源码 / 手动三种方式,首次配置,常见安装问题 |
| [🧠 模型接入](docs/guide/models.md) | OpenAI 兼容配置、拉取模型、思考档位、模式开关、语音 |
| [🧩 子代理集群](docs/guide/swarm.md) | 集群指挥室 vs 并行池、团队模板、@接力、通知聚合 |
| [🎁 免费模型](docs/guide/free-models.md) | Kilo 免 key 免费档一键切换、账户密钥配置、付费档解锁 |
| [📱 手机远程](docs/guide/remote.md) | 扫码配对、能力清单、局域网信任模型、常见问题 |
| [🔌 LY HARNESS](docs/guide/harness.md) | 38 工具逐个开关、MCP 管理、Skills 挂载 |
| [📚 知识库与记忆](docs/guide/knowledge.md) | RAG 检索、embedding 配置、记忆与知识库怎么选 |
| [🔒 数据与隐私](docs/guide/privacy.md) | 数据目录总表、什么会上网、密钥掩码、备份、彻底删除 |

### 开发者

| 文档 | 一句话 |
|---|---|
| [🏗 架构](docs/dev/architecture.md) | 三层结构、一轮对话的数据流、端口约定、目录导览 |
| [📦 构建与发布](docs/dev/build.md) | 命令总表、mac/win 打包、补丁更新、CI 策略、发布 checklist |
| [🛠 新增一个工具](docs/dev/add-tool.md) | 从实现到 schema 到三端可用的完整步骤 |

### 工程

| 文档 | 一句话 |
|---|---|
| [🤝 贡献指南](CONTRIBUTING.md) | 环境准备、提交规范、红线 |
| [🔐 安全策略](SECURITY.md) | 漏洞私密报告渠道、安全模型、支持版本 |
| [📜 更新日志](CHANGELOG.md) | 每个版本改了什么 |
| [⚖️ 版权说明](COPYRIGHT.md) | MIT + 第三方组件清单 |

<br>

<a id="quick-start"></a>

## ✦ 快速开始

```bash
git clone https://github.com/deepseekv5/jutian-agent.git
cd jutian-agent
./run.sh                  # 自动装依赖 + 启动(Windows 下载后直接双击 run.bat)
npm run electron:build    # 打包 macOS (dmg + zip)
```

> 也可以手动执行 `npm install && npm start`。`run.sh` / `run.bat` 检测到缺依赖时会自动安装。

首次使用:**设置 → 推理** 填入任意 OpenAI 兼容服务的地址、密钥与模型名。
本软件不内置任何模型服务与密钥——你的配置只属于你。

→ **详细步骤**:[安装与启动](docs/guide/install.md) · [模型接入](docs/guide/models.md)

<details>
<summary><b>📥 下载安装包</b></summary>

前往 [Releases](https://github.com/deepseekv5/jutian-agent/releases):

| 文件 | 说明 |
|---|---|
| 巨天agent-x.x.x-arm64.dmg | macOS Apple Silicon |
| 巨天agent-x.x.x-arm64-mac.zip | macOS 免安装 |

> 首次打开:右键 → 打开,或 xattr -cr /Applications/巨天agent.app

</details>

<br>

<a id="architecture"></a>

## ✦ 架构

```
┌──────────────────────────────────────────────────┐
│                  Electron 主进程                   │
│  ┌─────────────┐  ┌────────────────────────────┐ │
│  │  serve.cjs  │  │    窗口 / 托盘 / 状态记忆     │ │
│  │  38 工具     │  │    窗口 / 托盘 / 状态记忆     │ │
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
├── serve.cjs                  后端服务(构建产物,源码在 src/server/serve.ts)
├── electron/                  主进程
├── src/
│   ├── renderer/
│   │   ├── app/               应用壳(TabBar/Sidebar/通知/LY HARNESS)
│   │   ├── chat/              主对话
│   │   ├── code/              代码模式
│   │   ├── agents/            集群
│   │   ├── panels/            独立面板(免费模型/知识库/PPT)
│   │   ├── media/             多媒体
│   │   ├── settings/          设置
│   │   ├── engine/            流式引擎/子代理/代理循环
│   │   └── hooks/ store/ types/ utils/
│   ├── server/serve.ts        后端唯一源码
│   └── shared/                工具 schema / MCP / 员工模型 / CLI
├── docs/                      产品官网(Pages)+ 全部文档
│   ├── guide/                 用户指南(8 篇)
│   ├── dev/                   开发者文档(3 篇)
│   └── notes/                 工程笔记
├── public/                    手机端单页
└── scripts/                   构建与补丁
```

</details>

→ **深入阅读**:[架构](docs/dev/architecture.md) · [构建与发布](docs/dev/build.md)

<br>

<a id="stats"></a>

## ✦ 数据一览

| **38** | **5+** | **6** | **0** |
|:---:|:---:|:---:|:---:|
| 内置工具 | 数字员工 | 核心界面 | 字节上云 |

<br>

<a id="roadmap"></a>

## ✦ 路线图

- [x] 集群指挥室(员工对话 / 群聊 / 指定老板)
- [x] 子代理并行池(并发 3)
- [x] 可编辑 diff(主对话 + 代码模式)
- [x] 手机远程(配对码 + 子代理 + 截图)
- [x] LY HARNESS 插件中心
- [x] screenshot 工具(多模态回喂)
- [ ] MCP SSE / streamable-http
- [ ] MCP 服务级权限开关
- [ ] 定时任务 × 集群编排
- [ ] 会话模板 / 导出 PDF

<br>

<a id="faq"></a>

## ✦ 常见问题

**首次打开提示"无法验证开发者"?**
应用未做付费签名。右键 → 打开,或 xattr -cr /Applications/巨天agent.app

**模型服务怎么配置?**
设置 → 推理,填入任意 OpenAI 兼容服务。不内置任何服务与密钥。详细步骤见 [模型接入](docs/guide/models.md)。

**数据存在哪里,卸载会留痕迹吗?**
全部在 `~/.lyclaw/` 一个目录里。删除它 = 彻底清除。详见 [数据与隐私](docs/guide/privacy.md)。

**手机远程安全吗?**
局域网信任模型 + 配对码,陌生人连页面都看不到。前提是你信任同一网络。详见 [手机远程](docs/guide/remote.md)。

**可以商用吗?**
可以。MIT 许可证允许任意使用(含商用),仅需保留版权声明。

**和网页版 AI 有什么区别?**
网页版 AI 要你迁就它。桌面版直接住进你的文件、终端和工作流。

<br>

<a id="contributing"></a>

## ✦ 参与贡献

欢迎 Issue 与 PR:贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md),安全漏洞走 [SECURITY.md](./SECURITY.md) 的私密渠道,更新历史见 [CHANGELOG.md](./CHANGELOG.md)。提交前请阅读 [COPYRIGHT.md](./COPYRIGHT.md) 中的第三方组件说明。

想给项目加一个新工具?十一行起步:[新增一个工具](docs/dev/add-tool.md)。

<br>

---

<div align="center">

**巨天agent**

桌面,是 AI 最好的位置。

[![License: MIT](https://img.shields.io/badge/License-MIT-10a37f?style=flat-square)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/deepseekv5/jutian-agent?style=flat-square&color=10a37f)](https://github.com/deepseekv5/jutian-agent/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20·%20Windows-3b82f6?style=flat-square)]()

**巨天工作室** · 本地优先 · 数据归你

</div>
