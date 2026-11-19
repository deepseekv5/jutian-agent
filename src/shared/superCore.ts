/**
 * JT Core Super —— 超级内核 · 全自动路由（v18.0.0）
 *
 * 用户不再需要在 Pro+ / Ultra / Auto 之间手动选择——那是对使用者的负担。
 * 超级内核把三套内核变成「后端执行器」，自己完成：
 *   ① 信号采集  ② 复杂度评分  ③ 任务分析  ④ 执行计划  ⑤ 策略选择
 *   ⑥ 内核路由  ⑦ 模型选择  ⑧ 上下文工程  ⑨ 护栏  ⑩ 自适应学习
 *
 * 一切对用户静默（延续 v17.1.1 教训），但全程可解释：
 * 完整 trace 写入事件总线，诊断面板可展示「为什么这样路由」。
 *
 * 架构：super/ 下 5 个子模块互不 import，只依赖 super/types.ts；
 * 本文件是唯一的编排层，负责按依赖顺序串联 + 调用底层内核 + 记录反馈闭环。
 */

import { extractSignals } from './super/signals/extractor'
import { scoreComplexity } from './super/analysis/complexity'
import { analyzeTask } from './super/analysis/analyzer'
import { planTask } from './super/planning/planner'
import { buildDependencyGraph } from './super/planning/dependencyGraph'
import { pickStrategy } from './super/planning/strategies'
import { createKernelRouter } from './super/routing/router'
import { createModelSelector } from './super/routing/modelSelector'
import { createAdaptationEngine } from './super/routing/adaptation'
import { createAssembler } from './super/context/assembler'
import { createGuardrails } from './super/guardrails/chain'
import { SuperEventCollector } from './super/runtime/events'
import type {
  SuperDeps, SuperResult, RouteDecision, TaskAnalysis, ExecutionPlan,
  TaskOutcome, ModelChoice, SuperEvent,
} from './super/types'
import type { LoopMessage, LoopToolCall } from './agentLoop'

/* ─── 工厂实例（无状态模块可复用；有状态的 collector/adaptation 按 run 实例化） ─── */
const assembler = createAssembler()
const guardrails = createGuardrails()
const kernelRouter = createKernelRouter()
const modelSelector = createModelSelector()

/** 把路由 overrides 合并进底层 deps（只覆盖有值的字段，不污染原对象） */
function applyOverrides(base: Record<string, unknown>, decision: RouteDecision): Record<string, unknown> {
  const o = decision.overrides
  const out: Record<string, unknown> = { ...base }
  if (o.maxRounds != null) out.maxAutonomousRounds = o.maxRounds
  if (o.maxTokens != null) out.maxTokens = o.maxTokens
  if (o.hermesMode != null) out.hermesMode = o.hermesMode
  if (o.enableGuardrails === false) out.skipGuardrails = true
  return out
}

/** 根据 decision 选底层 runner */
function selectRunner(deps: SuperDeps, kernel: RouteDecision['kernel']): (m: LoopMessage[], d: unknown) => Promise<unknown> {
  switch (kernel) {
    case 'ultra': return deps.runUltra
    case 'auto': return deps.runAuto
    case 'super':
    case 'pro':
    default: return deps.runPro
  }
}

/** 把底层 runner 的返回归一化成 SuperResult 需要的形状 */
function normalizeResult(raw: unknown): { content: string; thinking: string; toolCalls: LoopToolCall[]; stopped?: string; error?: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    content: typeof r.content === 'string' ? r.content : '',
    thinking: typeof r.thinking === 'string' ? r.thinking : '',
    toolCalls: Array.isArray(r.toolCalls) ? r.toolCalls as LoopToolCall[] : [],
    stopped: typeof r.stopped === 'string' ? r.stopped : undefined,
    error: typeof r.error === 'string' ? r.error : undefined,
  }
}

/** 给 messages 注入上下文工程组装的增强 system（<system-reminder> 通道，不污染正文） */
function injectContext(messages: LoopMessage[], analysis: TaskAnalysis, plan: ExecutionPlan | null, decision: RouteDecision): LoopMessage[] {
  const sys = assembler.buildSystemPrompt(analysis, plan, decision)
  if (!sys) return messages
  const first = messages[0]
  return first && first.role === 'system'
    ? [{ ...first, content: String(first.content || '') + '\n\n' + sys }, ...messages.slice(1)]
    : [{ role: 'system', content: sys }, ...messages]
}

/**
 * 超级内核主入口：全自动分析 → 规划 → 路由 → 选模 → 执行 → 反馈。
 *
 * 对用户完全静默：内部 phase/analysis/route 等事件只进 sink，不进正文 onChunk。
 */
export async function runSuperLoop(messages: LoopMessage[], deps: SuperDeps): Promise<SuperResult> {
  const started = Date.now()
  const phases: string[] = []
  const collector = new SuperEventCollector()
  const emit = (e: SuperEvent) => { collector.emit(e); deps.sink?.emit(e) }
  const phase = (name: string, detail?: string) => {
    phases.push(name)
    emit({ type: 'phase', phase: name, detail })
  }

  // ── 阶段 1：信号采集 ──
  phase('signals')
  const signals = extractSignals(messages)
  emit({ type: 'metric', name: 'signals.charLength', value: signals.charLength })
  emit({ type: 'metric', name: 'signals.historyTurns', value: signals.historyTurns })

  // ── 阶段 2：复杂度评分 ──
  phase('complexity')
  const complexity = scoreComplexity(signals)
  emit({ type: 'metric', name: 'complexity.score', value: complexity.score, tags: { level: complexity.level } })

  // ── 阶段 3：任务分析 ──
  phase('analysis')
  const analysis = analyzeTask(signals)
  emit({ type: 'analysis', analysis })

  // ── 阶段 4：执行计划（仅中高复杂度才生成，trivial 省掉） ──
  let plan: ExecutionPlan | null = null
  if (complexity.score >= 20 || signals.hasMultiStep) {
    phase('planning')
    plan = planTask(analysis, signals)
    // 依赖图校验：若检测到环，记录但不阻断（规划器应已降级处理）
    const g = buildDependencyGraph(plan.steps)
    const cycle = g.detectCycle()
    if (cycle) emit({ type: 'error', error: '计划依赖图存在环，已降级为线性执行：' + cycle.join('→'), recoverable: true })
    emit({ type: 'plan', plan })
  }

  // ── 阶段 5：策略选择 ──
  phase('strategy')
  const strategy = pickStrategy(analysis, plan || { goal: signals.rawText, steps: [], levels: [], estimatedRounds: 1, criticalPath: [] })
  emit({ type: 'metric', name: 'strategy', value: 1, tags: { name: strategy.name } })

  // ── 阶段 6：内核路由 ──
  phase('routing')
  // plan 可能为 null（trivial 任务），路由需要一个占位的空计划
  const routePlan = plan || { goal: signals.rawText, steps: [], levels: [], estimatedRounds: 1, criticalPath: [] }
  let decision = kernelRouter.route(analysis, routePlan, strategy)
  // 自适应学习：若启用且历史样本充足，按历史成功率微调
  if (deps.adaptation) decision = deps.adaptation.adjust(decision, analysis)
  emit({ type: 'route', decision })

  // ── 阶段 7：模型选择 ──
  let modelChoice: ModelChoice | null = null
  if (deps.models.length) {
    phase('model-selection')
    modelChoice = modelSelector.select(analysis, deps.models, deps.preference)
    emit({ type: 'model', choice: modelChoice })
  }

  // ── 阶段 8：上下文工程 ──
  phase('context')
  const totalTokens = Number(deps.baseDeps.contextWindow) || 128000
  const budget = assembler.allocate(totalTokens, analysis, plan)
  emit({ type: 'metric', name: 'context.total', value: budget.total })
  const working = injectContext(assembler.trim(messages, budget), analysis, plan, decision)

  // ── 阶段 9：护栏包装 runTool ──
  phase('guardrails')
  const baseRunTool = deps.baseDeps.runTool
  const guardedDeps: Record<string, unknown> = { ...applyOverrides(deps.baseDeps, decision) }
  if (typeof baseRunTool === 'function') {
    const original = baseRunTool as (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
    guardedDeps.runTool = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
      const check = guardrails.checkTool(name, args)
      if (!check.allowed) {
        emit({ type: 'guardrail', result: check })
        return { success: false, error: check.reason || '工具被护栏拦截' }
      }
      const result = await original(name, args, signal)
      // 输出护栏：密钥泄露/注入检测（只告警不篡改，避免破坏工具结果契约）
      const outText = (result && typeof result === 'object' && 'output' in result) ? String((result as { output?: unknown }).output || '') : ''
      if (outText) {
        const outCheck = guardrails.checkOutput(outText)
        if (!outCheck.allowed) emit({ type: 'guardrail', result: outCheck })
      }
      return result
    }
  }

  // ── 阶段 10：调用底层内核执行 ──
  phase('execution', `kernel=${decision.kernel}`)
  const runner = selectRunner(deps, decision.kernel)
  const execError: string | undefined = undefined
  // 底层内核抛异常（含 NeedsClientError）原样上抛——serve 的 needs_client
  // 处理逻辑按 e.name duck typing 接管，无需在此包装。
  const raw = await runner(working, guardedDeps)
  const result = normalizeResult(raw)

  // 输出护栏：循环检测
  const loopCheck = guardrails.checkLoop(result.toolCalls)
  if (!loopCheck.allowed) emit({ type: 'guardrail', result: loopCheck })

  // ── 阶段 11：反馈闭环 ──
  phase('feedback')
  const durationMs = Date.now() - started
  const outcome: TaskOutcome = {
    decision, analysis,
    success: !result.stopped && !execError,
    rounds: result.toolCalls.length ? Math.max(1, Math.ceil(result.toolCalls.length / 3)) : 1,
    durationMs,
    toolErrors: result.toolCalls.filter(t => t.status === 'error').length,
    timestamp: Date.now(),
  }
  deps.adaptation?.record(outcome)
  emit({ type: 'metric', name: 'super.durationMs', value: durationMs })
  emit({ type: 'metric', name: 'super.success', value: outcome.success ? 1 : 0 })

  return {
    content: result.content,
    thinking: result.thinking,
    toolCalls: result.toolCalls,
    stopped: result.stopped as SuperResult['stopped'],
    error: result.error || execError,
    trace: { signals, analysis, plan, decision, model: modelChoice, durationMs, phases },
  }
}

/** 诊断用：把 collector 的事件导出成摘要（供诊断面板/日志） */
export function summarizeTrace(result: SuperResult): string {
  const t = result.trace
  const lines = [
    `内核: ${t.decision.kernel} / 策略: ${t.decision.strategy} (置信 ${(t.decision.confidence * 100).toFixed(0)}%)`,
    `复杂度: ${t.analysis.complexity.score}/100 (${t.analysis.complexity.level}) / 领域: ${t.analysis.domain}`,
    `计划: ${t.plan ? `${t.plan.steps.length} 步 / ${t.plan.levels.length} 层` : '无'}`,
    `模型: ${t.model?.model.name || '默认'}`,
    `耗时: ${t.durationMs}ms / 阶段: ${t.phases.join(' → ')}`,
    '路由理由: ' + t.decision.reasons.join('；'),
  ]
  return lines.join('\n')
}

/** 默认自适应引擎工厂（serve 侧不传时用） */
export { createAdaptationEngine }
