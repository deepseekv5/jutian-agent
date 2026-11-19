# JT Core Super —— 超级内核架构（v18.0.0）

## 为什么需要它

在它之前，巨天有三套内核：Pro+（五阶段工具循环）、Ultra（gemini-cli 全套护栏）、Auto（自主目标闭环）。三套都很强，但**要用户自己选**——这对使用者是负担：普通用户不知道该选哪个，选错了体验还变差。

超级内核的目标：**用户不再选内核**。它自己分析任务，自动决定用哪套执行器、什么策略、什么模型、要不要护栏、要不要自主续跑。

## 十一阶段全自动流水线

```
用户输入
  → ① 信号采集 (signals/extractor)
  → ② 复杂度评分 (analysis/complexity)
  → ③ 任务分析 (analysis/analyzer)
  → ④ 执行计划 (planning/planner + dependencyGraph)
  → ⑤ 策略选择 (planning/strategies)
  → ⑥ 内核路由 (routing/router)
  → ⑦ 模型选择 (routing/modelSelector)
  → ⑧ 上下文工程 (context/assembler)
  → ⑨ 护栏包装 (guardrails/chain)
  → ⑩ 底层内核执行 (Pro+/Ultra/Auto 三选一)
  → ⑪ 反馈闭环 (routing/adaptation)
  → 输出（静默，不塞内部标记）
```

## 模块布局

`src/shared/super/` 下五个子目录，模块之间**互不 import**，只依赖 `super/types.ts` 的类型契约：

| 模块 | 目录 | 职责 |
|---|---|---|
| A | signals/ + analysis/ | 信号采集、复杂度评分、任务分析 |
| B | planning/ | 依赖图、执行计划、策略选择 |
| C | routing/ | 内核路由、模型选择、自适应学习 |
| D | context/ + guardrails/ + runtime/ | 上下文工程、护栏、事件、调度器 |
| 编排 | （superCore.ts，在 super/ 外） | 串联全部模块 + 调底层内核 + trace |

这种布局的意义：每个模块可独立开发、独立测试，契约变更是显式动作（改 types.ts），不是隐式耦合。

## 关键设计决策

### 可解释路由
每一步决策都产出理由（reasons 数组）和置信度。完整 trace 通过事件总线流出，诊断面板可展示"为什么这样路由"——黑盒自动化的体验是可怕的，可解释是底线。

### 静默执行
延续 v17.1.1 教训：内核的内部状态（正在评估、正在路由）**不进正文**，只走事件总线。高端体验是安静把活干完。

### 三态评估护栏
自主闭环里，评估器不可用（ok=false）绝不当作"目标未完成"去续跑——拿"评估失败"当"未完成"会空转烧额度（渲染层 goal-mode 踩过的坑）。

### 自适应学习
按（策略 × 领域）组合统计历史成功率，样本充足时才微调路由权重，带指数衰减（近期样本权重高）。失败经验会强化对应场景的护栏。

### 底层内核复用
Super 不重复实现工具循环——它把 Pro+/Ultra/Auto 当执行器注入（`runPro`/`runUltra`/`runAuto`），自己只做"决策层"。这样三套内核的既有验证成果全部继承。

## 前端

引擎枚举 `agentEngine='super'`，设置里作为最高端档位（Super 超级内核），状态条红色高亮。请求透传 engine 字段到后端分叉。

## 验证

- 每模块独立单测（vitest）
- 主编排单测 `tests/superCore.test.ts`（静默性、可解释 trace、底层内核调用、护栏拦截、needs_client 透传）
- 真服务端到端（engine=super 请求 → 路由决策事件 → 正文输出）
