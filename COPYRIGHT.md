# 版权与第三方组件说明 / NOTICE

**Copyright (c) 2026 巨天工作室 (Jutian Studio)**

本项目基于 [MIT 许可证](./LICENSE) 开源——可自由使用、修改、分发（含商用），仅需保留版权声明。欢迎 Issue 与 PR。

## 本项目中的原创代码

以下部分由巨天工作室编写，受 MIT 许可证约束：

- `src/` — 应用全部源代码（对话/代码模式/集群/子代理/Computer Use/手机远程/插件中心）
- `electron/` — 主进程（窗口/托盘/截屏/安全门卫）
- `serve.cjs` — 后端服务（38 个内置工具实现/llm-proxy/MCP 客户端/通知桥）
- `public/remote.html` — 手机端单页应用
- `docs/` — 产品官网
- `.github/banner.svg` — 品牌横幅

## 第三方开源组件

本软件运行依赖以下主要组件，版权归各自作者所有：

| 组件 | 许可证 | 用途 |
|---|---|---|
| Electron | MIT | 桌面容器 |
| React / React DOM | MIT | 界面框架 |
| CodeMirror | MIT | 代码编辑器 |
| better-sqlite3 | MIT | 本地数据库 |
| react-markdown / remark-gfm / rehype-highlight | MIT | Markdown 渲染 |
| marked | MIT | 远程端 Markdown 解析 |
| zustand / immer | MIT | 状态管理 |
| Vite / esbuild / Tailwind CSS | MIT | 构建工具 |
| qrcode | MIT | 配对二维码 |
| pptxgenjs | MIT | PPT 导出 |
| archiver | MIT | 打包工具 |

## 模型服务

本项目不内置任何 AI 模型服务、API 密钥或服务商标签。用户自行配置任意 OpenAI 兼容服务，密钥仅存储于用户本机。
