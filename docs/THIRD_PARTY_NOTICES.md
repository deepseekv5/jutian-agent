# 第三方组件许可声明

## JT Core Ultra（v15.0.0）

JT Core Ultra 的循环护栏算法为 **源码级再实现**（非复制粘贴、零新增 npm 依赖），移植自以下开源项目：

| 项目 | 许可 | 移植内容 | 上游 |
|---|---|---|---|
| Google gemini-cli | Apache-2.0 | 七态工具调用 FSM / 批处理调度器 / 三层循环检测 / 抖动退避重试 / 上下文压缩 / Next-speaker 判定 / Turn 事件与预算 / 策略与确认总线 / IDE 上下文 / token 预算 / **系统提示词整族**（prompts/snippets.ts 现代+legacy：Core Mandates、Operational Guidelines、Primary Workflows、Plan Mode、上下文优先级、记忆分层、三个 utility LLM 提示词、step-back / Please continue. 字面量）/ **工具定义整族**（base-declarations.ts、tool-names.ts、default-legacy.ts、dynamic-declaration-helpers.ts、coreTools.ts：21 个工具名与完整 JSON Schema） | https://github.com/google-gemini/gemini-cli |
| OpenHands software-agent-sdk | MIT | 五场景卡死检测（动作-观察 / 动作-报错 / 独白 / 交替 / 上下文溢出） | https://github.com/OpenHands/software-agent-sdk |
| OpenAI Codex CLI | Apache-2.0 | 沙箱首次尝试 + 拒绝升级重试（概念） | https://github.com/openai/codex |
| Block goose | Apache-2.0 | 有序可重入操作管线（概念） | https://github.com/block/goose |
| opencode | MIT | 递归流式循环 / 非法 JSON 参数回灌（概念） | https://github.com/anomalyco/opencode |

上述项目均为宽松许可（Apache-2.0 / MIT），允许再实现与再分发；本文件保留归属说明并记录「算法已按巨天 AgentLoopDeps 契约重写」。Apache-2.0 项目完整许可文本见其仓库 LICENSE / NOTICE，MIT 项目版权声明见其仓库 LICENSE。

JT Core Pro+（原 Vercel / 服务端 / 兼容三循环）为巨天自有实现，一行未改，与 Ultra 并存、可随时切回。
