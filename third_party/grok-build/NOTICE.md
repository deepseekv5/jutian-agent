# third_party/grok-build

本目录记录对 [xai-org/grok-build](https://github.com/xai-org/grok-build)（xAI 官方开源的终端 AI 编码代理，Apache-2.0）的**源码补丁与接入**情况。

## 使用方式

巨天桌面安装包内置 **经 Jutian 补丁编译的 grok 二进制**（源码编译，非官方预编译版）：

- 巨天 CI 在构建时 clone grok-build 源码、应用 `patches/jutian-compat.patch`、以 Rust 编译；
- 补丁内容（两处，均为环境变量守卫，不改变官方默认行为）：
  1. `for_config`（remote_config/resolution.rs）：`JUTIAN_COMPAT` 存在时 CatalogSource 返回 `Standard`——保留 `[model.*]` 自定义模型表（原逻辑在外部鉴权模式下会丢弃它们）；
  2. `authenticate`（pager/headless.rs）：`JUTIAN_COMPAT` 存在时鉴权优先选择 API-key 方式（跳过交互式 OAuth）。
- 运行时环境变量（由巨天注入）：`JUTIAN_COMPAT=1`、`XAI_API_KEY=<巨天当前模型密钥>`、`GROK_HOME=<巨天管理目录>`（config.toml 指定 default 模型指向巨天的模型端点）。
- 工具系统、权限、会话管理全部由 grok 自身提供——「完全使用它的代码，巨天只做接入兼容」。

桥接实现见 `src/shared/grokBridge.ts`（巨天自有代码，MIT）。

## 许可证

grok-build 采用 [Apache License 2.0](./LICENSE)（Copyright 2023-2026 SpaceXAI）。
Apache-2.0 允许修改与再分发，须保留许可证与版权声明并标注修改——本目录的
`patches/jutian-compat.patch` 即修改清单。补丁本身遵循同一许可证。

## 用户须知

- 使用 Grok 内核时，模型请求发往**巨天当前配置的模型端点**（含免费网关/本地模型），
  密钥经巨天注入；xAI 官方模型为可选（在设置里填 xAI API Key 后可用 grok-4.6 等）。
- 该内核仅在桌面端（macOS / Windows / Linux）可用；安卓端不包含。
