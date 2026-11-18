# 内核架构（v17.0 重组后）

> 面向维护者：改内核前先读本文与 `tests/agentLoopPhases.test.ts`（行为等价性清单的可执行版）。

## 总览

Agent 主循环在 `src/shared/agentLoop.ts`（662 行），v17.0 从 350 行巨型函数重组为
**五阶段函数 + 主循环骨架**。跨轮状态收敛在 `LoopContext`，不再散落于闭包局部变量。

```
runAgentLoop(messages, deps)
  ├─ buildLoopContext(deps)          跨轮状态初始化（含 resume 继承）
  ├─ resumePendingTool(...)          中断续跑：补 pendingTool 的 tool 消息
  └─ while (true)                    ── 轮次骨架 ──
      ├─ ① prepareRoundMessages      Hermes 注入 / microcompact / 预算裁剪 / wrapUp 收尾
      ├─ ② requestRound              退避重试 / 溢出裁剪重放一次 / 耗尽错误文案
      ├─ ③ streamRound               SSE 累积（思考/正文/工具调用）+ Hermes 回退
      ├─ ④ gateToolCalls             重复拦截 / needsClient(throw) / confirmTool（串行）
      └─ ⑤ executePlans              只读并行 / 副作用串行 + 结果 hint 写回 messages
```

## 各阶段职责与关键约束

### ① prepareRoundMessages
- Hermes 文本协议按需注入（`shouldInjectHermes`：mode=on 强制 / off 关闭 / auto 按模型与端点推断）
- 上下文预算：超 80% 先 microcompact 清老工具结果，再 `truncateForBudget`
- **wrapUp 收尾提示只进本次请求，不写回 messages**——落库的幽灵指令会让模型永远以为「用户要求别调工具」

### ② requestRound
- 重试只发生在「头到手、未读流」阶段；读流中的失败不重试（避免重复执行副作用）
- 上游 400 上下文溢出：`truncateForBudget` 收紧后重放，**仅一次**（`ctx.overflowRetried`）
- 耗尽错误带「已自动重试 N 次」——用户需要区分线路持续不可用与偶发抖动

### ③ streamRound
- 文本在 `ev.data`（delta.content 累积到 `ctx.fullContent`，**roundContent 另返回**——assistant 历史消息需要它）
- 工具调用增量经 `accumulateToolCallDelta`（快照型/增量型双协议，快照去重见 toolCallStream 测试）
- `finish_reason=tool_calls` 时采纳非流式完整 tool_calls
- Hermes `<tool_call>` 块回退在此收口（剥块后写回 fullContent）

### ④ gateToolCalls
- 重复调用：同签名（工具名+归一化参数）计数，软阈值 3 次注入提示、硬 5 次拦截（toolLoopGuard）
- `needsClient` 抛 `NeedsClientError`：确认弹窗/客户端工具由渲染层处理后无状态续跑
- `confirmTool` 拒绝记为 error 结果并写回 tool 消息（串行，一次一个弹窗）

### ⑤ executePlans
- **只读工具（READONLY_TOOLS）连续出现时并行**，有副作用工具单发串行
- 结果经 `clampToolResult`（40K，普通保头/shell 类保尾——错误堆栈在结尾）
- 大输出（>50K）落盘工作区，结果里附引用路径
- 护栏 hint 拼装：使用计数（每 6 次）+ 连续失败（3 次恢复提示）

## 跨轮状态（LoopContext）

| 字段 | 用途 |
|---|---|
| toolRound / wrapUp | 轮次计数与收尾标志（round-limit 两段式：先禁工具再总结） |
| clearableIds | microcompact 可清空的只读结果 id |
| overflowRetried | 溢出重放只一次 |
| callSignatures / toolUseCounts / failCounter | 循环护栏三级计数 |
| fullThinking / fullContent | 跨轮累积（否则「思考→工具→再思考」只剩最后一轮） |
| allToolCalls | 全部工具调用记录（UI 工具卡数据源） |

## 行为等价性清单（改内核必查）

1. abort 各点返回 `ctx.full*`，**不带本轮新增内容**
2. 重试只在读流前；溢出重放仅一次
3. wrapUp 提示不落库
4. Hermes 剥块后写回 fullContent
5. 分组执行顺序（只读并行保序写回）与 hint 拼装逐字一致
6. `perf.addTool(toolRound, ...)` 与事件时序（onToolStart → onToolEnd → messages.push）
7. pendingTool 必须在发请求前补 tool 消息（悬空 tool_calls 会被上游拒绝）

## 测试

- 单测：`tests/agentLoopPhases.test.ts`（阶段函数已 export，SSE mock 必须带 `data: ` 前缀）
- 集成：`tests/editReliability.test.ts` 打真服务
- 全库 1051+ 用例；改内核后 `npm test && npm run verify` 双门禁

## 引擎档位

- `vercel`（渲染层 AI SDK）/ `server`（本循环）/ `client`（旧渲染层）——serve 按 engine 字段分发
- `ultra`：`jtCoreUltra.ts` 独立实现（语义循环检测等高端护栏），未并入本循环
- ~~`grok`~~：v16.9.1 已移除（历史见 git log 与 memory/jutian-v168-grok-engine）
