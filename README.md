<div align="center">

# 巨天agent — 桌面 AI 工作台

**桌面 AI 工作台 · Desktop AI Workbench**

一句话，它把活干完。

[功能](#核心能力) · [插件](#一切皆插件) · [手机远程](#手机远程) · [许可](#版权)

</div>

---

> **⚠️ 版权声明** — 本项目为巨天工作室的版权作品，**不是开源软件**。
> 阅读、克隆即视为接受 [LICENSE](./LICENSE) 与 [COPYRIGHT](./COPYRIGHT.md) 之全部条款。
> 未经书面授权，禁止商用、再分发、衍生开发与 AI 训练。详见文末完整声明。

---

## 简介

巨天agent 把对话、代码、终端和一支数字员工团队收进同一个桌面窗口：

- **说人话，它动手** — 38 个内置工具直连真实终端与文件系统，不是建议，是执行
- **代码模式** — 文件树、多标签编辑、内置终端、Git 检查点、可编辑 diff（逐改动撤销/编辑应用）
- **集群指挥室** — 自定义数字员工，@ 接力、群聊、指定老板，自动汇总交付
- **子代理** — 主对话 AI 可自行派出并行子代理，侧栏实时进度
- **Computer Use** — 说目标，它操作这台电脑（截屏观察 → 决策 → 执行 → 验证）
- **手机远程** — 局域网扫码配对，手机发指令、电脑干活，进度实时可见
- **知识库 / 长期记忆 / 日记 / 定时任务 / 语音通话 / PPT 生成 / QQ 机器人**

**本地优先**：会话、记忆、文件全部留在你的电脑上，不内置任何模型服务或密钥——在设置里配置任意 OpenAI 兼容服务即可。

## 一切皆插件

状态栏 **LY HARNESS** 面板：38 个内置工具逐个开关（关闭即不发给模型）、MCP 服务启停、Skills 管理。
工具 schema 单一来源：[`src/shared/builtin-tools.json`](./src/shared/builtin-tools.json)。

## 手机远程

设置 → 手机远程：扫码配对（配对码门卫保护全部接口），局域网内即可使用完整代理能力——含子代理派发、截图工具与图片多模态回喂。

## 快速开始

```bash
git clone https://github.com/<owner>/jutian-agent.git
cd jutian-agent
npm install
npm run patch    # 构建并写入本机应用
npm start        # 开发模式运行（构建 → http://localhost:3211）
```

首次使用：**设置 → 推理** 填入任意 OpenAI 兼容服务的地址、密钥与模型名。

## 目录结构

```
├── index.html            入口页面
├── serve.cjs             后端服务（Electron 主进程内运行，端口 3211）
├── electron/             主进程（窗口/托盘/Computer Use/截图）
├── src/renderer/         界面与应用逻辑（app/chat/code/agents/computer/panels/media/settings）
├── src/shared/           跨端共享（工具 schema/MCP 客户端/员工模型/CLI）
├── src/renderer/engine/  流式引擎/工具执行/子代理运行器/Computer Use 代理
├── scripts/              构建与补丁脚本
├── docs/                 产品官网(GitHub Pages 发布)
├── docs/notes/           文档与持续学习日志
└── archive/              历史归档
```

## 版权

**Copyright © 2026 巨天工作室. All Rights Reserved.**

本项目为专有软件，提供的是**受限的个人使用许可**，不是开源授权。完整条款（许可范围、七类禁止行为、第三方组件、免责与责任限制、终止条款、准据法）见：

- [LICENSE](./LICENSE) — 版权与许可声明（中英双语全文）
- [COPYRIGHT.md](./COPYRIGHT.md) — 版权声明细则

商业授权与合作：巨天工作室（见项目官方渠道）。

---

<div align="center">

**巨天agent** · 桌面，是 AI 最好的位置。

© 2026 巨天工作室 · 本地优先 · 数据归你

</div>
