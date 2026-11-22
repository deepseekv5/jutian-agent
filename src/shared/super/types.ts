/**
 * Super Core 公共类型契约（v18.0.0）
 *
 * 所有超级内核模块只依赖本文件的类型，模块之间不互相 import——
 * 这样 5 个模块可并行开发、独立测试，由 superCore.ts 主编排串联。
 * 改动本文件需同步所有实现模块（契约变更是显式动作，不是隐式耦合）。
 */

import type { LoopMessage, LoopToolCall } from '../agentLoop'

/* ─── 通用 ─── */

export type TaskDomain =
  | 'code' | 'file' | 'shell' | 'research' | 'writing'
  | 'data' | 'creative' | 'planning' | 'qa' | 'conversation'

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert'

export type RouteStrategy =
  | 'direct'        // 单次答复，无工具
  | 'single_tool'   // 单工具调用
  | 'iterative'     // 多轮工具循环（Pro+ 五阶段）
  | 'autonomous'    // 自主目标闭环（Auto）
  | 'deep'          // 深度工程（Ultra 全套护栏）

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/* ─── 信号采集（模块 A: signals） ─── */

export interface TaskSignals {
  /** 原始用户文本（最近一条 user） */
  rawText: string
  /** 归一化小写文本（去空白/标点） */
  normalized: string
  /** 文本长度（字符） */
  charLength: number
  /** 词/token 粗估数量 */
  tokenEstimate: number
  /** 是否含代码迹象（代码块/函数名/import/文件扩展名） */
  hasCode: boolean
  /** 是否含文件操作动词（读/写/改/删/创建） */
  hasFileOp: boolean
  /** 是否含 shell/命令迹象 */
  hasShell: boolean
  /** 是否含搜索/调研迹象 */
  hasResearch: boolean
  /** 是否含创作迹象（写文章/诗/故事/画） */
  hasCreative: boolean
  /** 是否含数据分析迹象 */
  hasData: boolean
  /** 是否含多步骤结构（编号列表/步骤词/先…再…） */
  hasMultiStep: boolean
  /** 是否含目标闭环词（完成/做完/直到/自动/全部） */
  hasGoalLoop: boolean
  /** 是否含规划词（计划/方案/设计/架构） */
  hasPlanning: boolean
  /** 是否含验证词（测试/验证/检查/运行） */
  hasVerification: boolean
  /** 提及的文件路径数量 */
  fileRefs: string[]
  /** 提及的语言/技术栈 */
  techStacks: string[]
  /** 历史轮次（含本轮） */
  historyTurns: number
  /** 是否有附件/图片 */
  hasAttachment: boolean
  /** 时间敏感词（今天/实时/最新） */
  isTimeSensitive: boolean
  /** 涉及高风险操作（删除/付费/发送/系统级） */
  hasHighRisk: boolean
}

export interface SignalExtractor {
  extract(messages: LoopMessage[]): TaskSignals
}

/* ─── 复杂度评分（模块 A: analysis） ─── */

export interface ComplexityScore {
  /** 0-100 综合分 */
  score: number
  level: TaskComplexity
  /** 各维度子分（可解释性） */
  dimensions: {
    length: number
    domain: number
    steps: number
    risk: number
    context: number
  }
  /** 评分理由（可解释路由） */
  reasons: string[]
}

export interface ComplexityScorer {
  score(signals: TaskSignals): ComplexityScore
}

/* ─── 任务分析（模块 A: analysis） ─── */

export interface TaskAnalysis {
  domain: TaskDomain
  confidence: number
  domains: Array<{ domain: TaskDomain; weight: number }>
  complexity: ComplexityScore
  risk: RiskLevel
  intent: string
  /** 是否需要工具才能完成 */
  needsTools: boolean
  /** 建议的最小工具集 */
  suggestedTools: string[]
  /** 是否适合自主闭环 */
  benefitsFromAutonomy: boolean
}

export interface TaskAnalyzer {
  analyze(signals: TaskSignals): TaskAnalysis
}

/* ─── 任务规划（模块 B: planning） ─── */

export interface PlanStep {
  id: string
  title: string
  description: string
  /** 依赖的步骤 id */
  dependsOn: string[]
  /** 该步建议用的工具 */
  tools: string[]
  /** 预期产物 */
  expectedOutput: string
  /** 是否可并行 */
  parallelizable: boolean
  /** 估计难度 0-100 */
  estimatedDifficulty: number
}

export interface ExecutionPlan {
  goal: string
  steps: PlanStep[]
  /** 拓扑排序后的执行层级（每层可并行） */
  levels: string[][]
  estimatedRounds: number
  criticalPath: string[]
}

export interface TaskPlanner {
  plan(analysis: TaskAnalysis, signals: TaskSignals): ExecutionPlan
}

/* ─── 依赖图（模块 B: planning） ─── */

export interface DependencyGraph {
  nodes: Map<string, PlanStep>
  edges: Map<string, string[]>       // id -> 依赖的 id
  reverse: Map<string, string[]>     // id -> 依赖它的 id
  topologicalLevels(): string[][]
  criticalPath(): string[]
  detectCycle(): string[] | null
}

/* ─── 执行策略（模块 B: planning） ─── */

export interface ExecutionStrategy {
  name: string
  description: string
  parallelTools: boolean
  maxRounds: number
  verifyEachStep: boolean
  allowAutonomy: boolean
  fallbackOnFailure: RouteStrategy | null
}

export interface StrategyPicker {
  pick(analysis: TaskAnalysis, plan: ExecutionPlan): ExecutionStrategy
}

/* ─── 路由决策（模块 C: routing） ─── */

export interface RouteDecision {
  strategy: RouteStrategy
  /** 选择的内核名（供 serve 分叉） */
  kernel: 'pro' | 'ultra' | 'auto' | 'super'
  /** 置信度 0-1 */
  confidence: number
  /** 路由理由（可解释） */
  reasons: string[]
  /** 覆盖的运行时参数 */
  overrides: {
    maxRounds?: number
    maxTokens?: number
    temperature?: number
    enableGuardrails?: boolean
    enableVerification?: boolean
    hermesMode?: 'auto' | 'on' | 'off'
  }
}

export interface KernelRouter {
  route(analysis: TaskAnalysis, plan: ExecutionPlan, strategy: ExecutionStrategy): RouteDecision
}

/* ─── 模型选择（模块 C: routing） ─── */

export interface ModelProfile {
  id: string
  name: string
  contextWindow: number
  strength: TaskDomain[]
  costTier: number          // 0 免费 - 3 昂贵
  speedTier: number         // 0 快 - 3 慢
  reasoning: boolean
  supportsTools: boolean
  supportsVision: boolean
}

export interface ModelChoice {
  model: ModelProfile
  score: number
  reasons: string[]
  alternatives: ModelProfile[]
}

export interface ModelSelector {
  select(analysis: TaskAnalysis, available: ModelProfile[], preference?: 'quality' | 'speed' | 'cost'): ModelChoice
}

/* ─── 自适应学习（模块 C: routing） ─── */

export interface TaskOutcome {
  decision: RouteDecision
  analysis: TaskAnalysis
  success: boolean
  rounds: number
  durationMs: number
  toolErrors: number
  userSatisfied?: boolean
  timestamp: number
}

export interface AdaptationEngine {
  record(outcome: TaskOutcome): void
  /** 基于历史调整路由权重 */
  adjust(base: RouteDecision, analysis: TaskAnalysis): RouteDecision
  /** 导出学到的统计（持久化/诊断） */
  stats(): Record<string, unknown>
}

/* ─── 上下文工程（模块 D: context） ─── */

export interface ContextBudgetAllocation {
  system: number
  history: number
  tools: number
  plan: number
  reserved: number
  total: number
}

export interface ContextAssembler {
  allocate(totalTokens: number, analysis: TaskAnalysis, plan: ExecutionPlan | null): ContextBudgetAllocation
  /** 按预算裁剪历史消息 */
  trim(messages: LoopMessage[], budget: ContextBudgetAllocation): LoopMessage[]
  /** 组装增强 system（含计划/策略提示，不污染正文） */
  buildSystemPrompt(analysis: TaskAnalysis, plan: ExecutionPlan | null, decision: RouteDecision): string
}

/* ─── 护栏（模块 D: guardrails） ─── */

export interface GuardrailResult {
  allowed: boolean
  reason?: string
  severity?: 'warn' | 'block'
}

export interface GuardrailChain {
  checkTool(name: string, args: Record<string, unknown>): GuardrailResult
  checkOutput(text: string): GuardrailResult
  checkLoop(recentCalls: LoopToolCall[]): GuardrailResult
  checkBudget(currentTokens: number, limit: number): GuardrailResult
}

/* ─── 事件/可观测性（模块 D: runtime） ─── */

export type SuperEvent =
  | { type: 'phase'; phase: string; detail?: string }
  | { type: 'analysis'; analysis: TaskAnalysis }
  | { type: 'plan'; plan: ExecutionPlan }
  | { type: 'route'; decision: RouteDecision }
  | { type: 'model'; choice: ModelChoice }
  | { type: 'metric'; name: string; value: number; tags?: Record<string, string> }
  | { type: 'guardrail'; result: GuardrailResult }
  | { type: 'error'; error: string; recoverable: boolean }

export interface SuperEventSink {
  emit(event: SuperEvent): void
}

/* ─── 顶层输入输出 ─── */

export interface SuperDeps {
  /** 底层三内核执行器（由 superCore 编排时注入） */
  runPro: (messages: LoopMessage[], deps: unknown) => Promise<unknown>
  runUltra: (messages: LoopMessage[], deps: unknown) => Promise<unknown>
  runAuto: (messages: LoopMessage[], deps: unknown) => Promise<unknown>
  /** 底层共享 deps（tools/callLLM/runTool/events 等） */
  baseDeps: Record<string, unknown>
  /** 可用模型列表 */
  models: ModelProfile[]
  /** 事件接收器（可选，用于诊断面板） */
  sink?: SuperEventSink
  /** 用户偏好 */
  preference?: 'quality' | 'speed' | 'cost'
  /** 适配器（可选，启用学习） */
  adaptation?: AdaptationEngine
  signal?: AbortSignal
  /** 计划执行（v18.3.0）：多步骤复杂任务按 ExecutionPlan 分层调度执行，默认 false（行为等价优先） */
  enablePlanExecution?: boolean
  /** 计划执行单步最大轮次提示（注入模型消息），默认 2 */
  planStepRounds?: number
  /** 长任务（v18.4.0）：当前任务的进度摘要，注入 system 让模型知道跨会话目标 */
  missionSummary?: string
  /** 长任务续跑指令（上一步评估未完成时注入，让模型接着推进） */
  missionDirective?: string
}

export interface SuperResult {
  content: string
  thinking: string
  toolCalls: LoopToolCall[]
  stopped?: 'round-limit' | 'aborted' | 'error'
  error?: string
  /** 可解释路由报告（诊断面板可展示） */
  trace: {
    signals: TaskSignals
    analysis: TaskAnalysis
    plan: ExecutionPlan | null
    decision: RouteDecision
    model: ModelChoice | null
    durationMs: number
    phases: string[]
    /** 计划执行（v18.3.0）：分层调度每步的完成情况，未启用计划执行时为空 */
    planExecution?: {
      enabled: boolean
      steps: number
      completed: number
      failed: string[]
      degraded: string[]
      aborted: string[]
      durationMs: number
    }
  }
}
