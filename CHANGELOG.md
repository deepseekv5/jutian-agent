# 更新日志

所有显著变更记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [7.0.0] - 2026-10-04

### 新增
- 子代理集群:`dispatch_subagents` 并行工作池(并发 3),侧栏实时进度追踪,@援军接力
- Computer Use:截屏 → 决策 → 执行 → 验证循环,支持逐步确认模式
- MCP 客户端:stdio JSON-RPC 2.0,initialize 握手 / tools/list 缓存 / schema 预校验
- 手机远程:局域网扫码配对,消息/工具/截图/子代理进度全量同步到手机
- LY HARNESS 插件中心:38 个内置工具逐个开关,MCP 服务管理
- 通知中心:集群完成 / 子代理批次 / 定时任务 / 手机接入统一聚合
- 可编辑 diff:主对话与代码模式共享,支持逐块编辑应用与撤销
- 一键启动脚本 `run.sh` / `run.bat`(缺依赖自动安装)

### 变更
- 数据目录统一到 `~/.lyclaw`,旧 `~/.laoyou-agent` 启动时自动迁移
- 后端源码化:`src/server/serve.ts` 为唯一源码,`serve.cjs` 改为构建产物
- MIT 开源:LICENSE / COPYRIGHT / 更新日志与社区文件齐全

### 安全
- 移除 `Access-Control-Allow-Origin: *`,跨站请求一律 403
- DNS-rebinding 防护(回环来源 + Host 校验,不符 421)
- 所有 GET 回包密钥自动掩码;掩码值禁止写回存储;复合键(qq_secret 等)包含匹配
- 备份导出携带真实密钥以支持还原(端点受同宿主门卫保护),导入跳过掩码值
- 修复 esbuild 变量遮蔽导致 `GET /` 恒 404 的静默缺陷

## [5.0.0] - 2026-09(概要)

- 渲染层架构化重组:app / chat / code / agents / computer / panels / settings / engine 分域
- Computer Use 与 MCP 客户端首发;手机远程雏形;窗口状态持久化

## [4.0.0] - 2026-09(概要)

- 双对话模式(主对话 / 代码模式)、模型列表自动拉取
- 导出 / 粘贴图 / 自动朗读 / 主题跟随 / 内容搜索 / 本地备份
- 30+ 体验增强:消息分支、命令面板、截图标注、托盘等

## [1.0.0 - 3.x] - 2026-08~09(概要)

- 桌面 AI 工作台成型:对话 / 代码 / 终端三视图,工具调用链路,知识库
