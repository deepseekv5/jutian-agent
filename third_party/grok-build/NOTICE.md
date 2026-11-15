# third_party/grok-build

本目录记录对 [xai-org/grok-build](https://github.com/xai-org/grok-build)（xAI 官方开源的终端 AI 编码代理，Apache-2.0）的**接入兼容**情况。

## 使用方式

巨天agent **不复制、不修改 grok-build 的任何源代码**。接入方式是：

- 运行 grok 官方预编译二进制（`grok`，Apache-2.0 允许再分发）作为 sidecar 子进程；
- 通过其 headless 协议（`grok -p <prompt> --output-format streaming-json`）通信；
- 工具系统、权限、安全策略、会话管理全部由 grok 自身提供——即「完全使用它的代码，我们只是接入兼容」。

桥接实现见 `src/shared/grokBridge.ts`（巨天自有代码，MIT）。

## 许可证

grok-build 采用 [Apache License 2.0](./LICENSE)（Copyright 2023-2026 SpaceXAI）。
再分发其二进制时必须随附该许可证全文与本声明；巨天对 grok-build 代码的修改为零。

## 用户须知

- 使用 Grok 内核需要 xAI 账号：API Key（console.x.ai）或已在终端 `grok login`。
- 对话内容将发送给 xAI 的模型服务，受 xAI 条款与隐私政策约束。
- 该内核仅在桌面端（macOS / Windows / Linux）可用；安卓端不包含。
