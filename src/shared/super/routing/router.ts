/**
 * 模块 C - 路由决策内核（KernelRouter）
 *
 * 职责：把「任务分析 + 执行计划 + 候选执行策略」翻译成一个可解释、可覆盖的
 * RouteDecision。整个决策过程刻意做成规则驱动 + 投票聚合，而不是一段 if/else
 * 黑盒，原因是路由一旦出错会直接把任务丢进错误的内核（例如把 critical 风险
 * 的任务送进 direct 单次答复），所以每一条命中规则都必须能讲清楚「为什么」。
 *
 * 设计要点：
 *  1. 五类内核视角：direct / pro / super / auto / ultra。
 *     - direct 在类型层属于 RouteStrategy（单次无工具答复），kernel 字段只有
 *       pro | ultra | auto | super 四档，因此 direct 策略落到最轻的 pro 内核。
 *  2. 规则投票：复杂度、风险、领域、工具、自主性、计划规模、输入策略各自投票，
 *     得票最高的策略/内核胜出；第一、第二名票差越小置信度越低（冲突即低置信）。
 *  3. 硬约束兜底：critical 风险必须开护栏、expert 复杂度必须走 deep、
 *     trivial 且不需要工具必须走 direct。硬约束优先级永远高于投票结果。
 *  4. 运行时覆盖：maxRounds / maxTokens / temperature / 护栏 / 验证 / hermes
 *     均按任务特征动态给出，且集中在 computeOverrides 一处计算，便于审计。
 *
 * 本文件只依赖 ../types，不 import 其它 super 模块，保证可并行开发/独立测试。
 */

import type {
  ExecutionPlan,
  ExecutionStrategy,
  KernelRouter,
  RiskLevel,
  RouteDecision,
  RouteStrategy,
  TaskAnalysis,
  TaskComplexity,
  TaskDomain,
} from '../types'

/* ─────────────────────────────────────────────────────────────────────────────
 * 内部类型
 * ───────────────────────────────────────────────────────────────────────────── */

/** kernel 字段的四种取值（direct 是 strategy，不是 kernel）。 */
export type KernelName = RouteDecision['kernel']

/**
 * 单条规则投出的一票。
 *
 * 一条规则可以同时影响策略和内核，也可以只贡献一条可解释理由
 * （strategy/kernel 都为 undefined 时表示「仅提供信息，不参与投票」）。
 */
interface Vote {
  /** 投给的执行策略 */
  strategy?: RouteStrategy
  /** 投给的内核 */
  kernel?: KernelName
  /** 票重：越大代表这条规则越权威 */
  weight: number
  /** 人类可读的命中理由（进入 RouteDecision.reasons） */
  reason: string
  /** 这条规则附带的局部覆盖，聚合时按来源优先级合并 */
  patch?: OverridePatch
  /** 规则标签，便于冲突检测与调试 */
  tag: RuleTag
}

/** 规则来源标签，用于判断冲突（不同维度的冲突才真正降低置信度）。 */
type RuleTag =
  | 'risk'
  | 'complexity'
  | 'domain'
  | 'tool'
  | 'autonomy'
  | 'plan'
  | 'strategy'
  | 'history'
  | 'constraint'

/** 可被规则局部覆盖的运行时参数片段。 */
interface OverridePatch {
  maxRounds?: number
  maxTokens?: number
  temperature?: number
  enableGuardrails?: boolean
  enableVerification?: boolean
  hermesMode?: RouteDecision['overrides']['hermesMode']
}

/** 规则计算的共享上下文，避免在每条规则里重复解构参数。 */
interface RuleContext {
  analysis: TaskAnalysis
  plan: ExecutionPlan
  strategy: ExecutionStrategy
  /** 计划步骤数 */
  stepCount: number
  /** 计划里的工具去重集合 */
  planTools: string[]
  /** 平均步骤难度 0-100 */
  avgDifficulty: number
  /** 复杂度分 0-100 */
  complexityScore: number
  /** 最长依赖链长度 */
  criticalLength: number
}

/** 一条可评估的路由规则。 */
interface RoutingRule {
  tag: RuleTag
  /** 规则名，便于诊断 */
  name: string
  evaluate(ctx: RuleContext): Vote[]
}

/** 策略得票聚合结果。 */
interface Tally<T> {
  /** 键 -> 累计票重 */
  scores: Map<T, number>
  /** 投给各键的规则标签集合，用于判断跨维度一致性 */
  voters: Map<T, Set<RuleTag>>
  /** 第一名键 */
  best: T
  /** 第二名键（可能不存在） */
  runnerUp: T | undefined
  /** 第一名票重 */
  bestScore: number
  /** 第二名票重 */
  runnerScore: number
  /** 总票重 */
  total: number
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 常量表
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 各投票维度的基础票重。风险与复杂度是硬信号，权重最高；输入策略本身只是
 * 建议，权重最低——这样即使外部 StrategyPicker 选错，规则也能纠正它。
 */
const VOTE_WEIGHT = {
  risk: 3.2,
  complexity: 3.0,
  tool: 2.2,
  autonomy: 4.5, // 自主闭环是强信号：用户明确要求「直到完成/全部」时不应被轻策略拦截
  domain: 1.6,
  plan: 1.4,
  strategy: 0.8,
  constraint: 100, // 硬约束：数值大到必然压过任何投票
} as const

/** 复杂度等级到「建议轮次增量」的映射。 */
const COMPLEXITY_ROUND_DELTA: Record<TaskComplexity, number> = {
  trivial: -2,
  simple: 0,
  moderate: 2,
  complex: 5,
  expert: 9,
}

/** 复杂度等级到「建议 token 预算基数」的映射。 */
const COMPLEXITY_TOKEN_BASE: Record<TaskComplexity, number> = {
  trivial: 4096,
  simple: 8192,
  moderate: 16384,
  complex: 32768,
  expert: 65536,
}

/** 领域到「建议温度」的映射：创作类高，代码/数据/QA 类低。 */
const DOMAIN_TEMPERATURE: Record<TaskDomain, number> = {
  creative: 1.0,
  writing: 0.85,
  conversation: 0.75,
  planning: 0.55,
  research: 0.45,
  qa: 0.15,
  code: 0.2,
  file: 0.2,
  shell: 0.1,
  data: 0.25,
}

/** 领域族：用于判断两个领域是否「相近」（相近领域的票不完全算冲突）。 */
const DOMAIN_FAMILY: Record<TaskDomain, '工程' | '信息' | '表达' | '推理'> = {
  code: '工程',
  file: '工程',
  shell: '工程',
  qa: '工程',
  research: '信息',
  data: '信息',
  creative: '表达',
  writing: '表达',
  conversation: '表达',
  planning: '推理',
}

/** 需要工具才能落地的领域。 */
const TOOL_ORIENTED_DOMAINS: ReadonlySet<TaskDomain> = new Set<TaskDomain>([
  'code', 'file', 'shell', 'data', 'qa',
])

/** 高验证需求的领域。 */
const VERIFICATION_DOMAINS: ReadonlySet<TaskDomain> = new Set<TaskDomain>([
  'code', 'shell', 'qa', 'data',
])

/** 高风险的等级集合。 */
const ELEVATED_RISK: ReadonlySet<RiskLevel> = new Set<RiskLevel>(['high', 'critical'])

/** 策略 -> 内核的默认映射（direct 落到最轻的 pro）。 */
const STRATEGY_KERNEL: Record<RouteStrategy, KernelName> = {
  direct: 'pro',
  single_tool: 'pro',
  iterative: 'super',
  autonomous: 'auto',
  deep: 'ultra',
}

/** 策略 -> 基础轮次（当输入策略没有给出有效值时使用）。 */
const STRATEGY_BASE_ROUNDS: Record<RouteStrategy, number> = {
  direct: 1,
  single_tool: 2,
  iterative: 8,
  autonomous: 14,
  deep: 20,
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 通用小工具
 * ───────────────────────────────────────────────────────────────────────────── */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items))
}

// 领域族判定（规则扩展用，当前规则集未直接调用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sameFamily(a: TaskDomain, b: TaskDomain): boolean {
  return DOMAIN_FAMILY[a] === DOMAIN_FAMILY[b]
}

/** 把任意分数规整到 0-1，避免外部传入越界值污染置信度。 */
function unit(value: number): number {
  return clamp(value, 0, 1)
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 规则构建器：每一类信号生成一组票
 * ───────────────────────────────────────────────────────────────────────────── */

/** 构造规则计算上下文。 */
function buildContext(
  analysis: TaskAnalysis,
  plan: ExecutionPlan,
  strategy: ExecutionStrategy,
): RuleContext {
  const stepCount = Math.max(0, plan.steps?.length ?? 0)
  const planTools = unique(plan.steps.flatMap(step => step.tools ?? []))
  const difficulties = (plan.steps ?? [])
    .map(step => clamp(step.estimatedDifficulty ?? 0, 0, 100))
  const avgDifficulty = difficulties.length > 0
    ? difficulties.reduce((sum, d) => sum + d, 0) / difficulties.length
    : analysis.complexity.score
  const criticalLength = Math.max(0, plan.criticalPath?.length ?? 0)

  return {
    analysis,
    plan,
    strategy,
    stepCount,
    planTools,
    avgDifficulty,
    complexityScore: clamp(analysis.complexity.score, 0, 100),
    criticalLength,
  }
}

/**
 * 风险规则。
 * - critical：强制 deep + ultra，且必须开护栏/验证。
 * - high：倾向 deep/iterative，开护栏。
 * - medium：略微抬高验证意愿。
 * - low：不干预（不投「直接答复」票，因为低风险不代表简单）。
 */
function riskRules(ctx: RuleContext): RoutingRule[] {
  const { risk } = ctx.analysis
  const rules: RoutingRule[] = []

  if (risk === 'critical') {
    rules.push({
      tag: 'risk',
      name: 'critical-risk-forces-deep',
      evaluate: () => [{
        tag: 'risk',
        strategy: 'deep' as RouteStrategy,
        kernel: 'ultra' as KernelName,
        weight: VOTE_WEIGHT.risk * 1.6,
        reason: '风险等级为 critical：必须使用 deep 策略 + ultra 内核，并强制开启护栏与验证',
        patch: { enableGuardrails: true, enableVerification: true },
      }],
    })
    return rules
  }

  if (risk === 'high') {
    rules.push({
      tag: 'risk',
      name: 'high-risk-prefers-deep',
      evaluate: () => [
        {
          tag: 'risk',
          strategy: 'deep' as RouteStrategy,
          kernel: 'ultra' as KernelName,
          weight: VOTE_WEIGHT.risk,
          reason: '风险等级为 high：倾向 deep 策略与 ultra 内核以获得完整护栏',
          patch: { enableGuardrails: true },
        },
        {
          tag: 'risk',
          strategy: 'iterative' as RouteStrategy,
          weight: VOTE_WEIGHT.risk * 0.45,
          reason: '风险等级为 high：即便不做深度工程也应保留多轮迭代以便逐步校验',
        },
      ],
    })
    return rules
  }

  if (risk === 'medium') {
    rules.push({
      tag: 'risk',
      name: 'medium-risk-needs-verification',
      evaluate: () => [{
        tag: 'risk',
        strategy: 'iterative' as RouteStrategy,
        weight: VOTE_WEIGHT.risk * 0.3,
        reason: '风险等级为 medium：建议开启每步验证，倾向多轮迭代',
        patch: { enableVerification: true },
      }],
    })
    return rules
  }

  // low：记录一条「无风险加成」的理由，但不参与投票。
  rules.push({
    tag: 'risk',
    name: 'low-risk-neutral',
    evaluate: () => [{
      tag: 'risk',
      weight: 0,
      reason: '风险等级为 low：不施加额外约束，路由主要由复杂度与领域决定',
    }],
  })
  return rules
}

/**
 * 复杂度规则。复杂度是路由的主信号之一。
 * - expert：deep + ultra（硬约束在 applyHardConstraints 里再兜底一次）。
 * - complex：deep/iterative 混合投票。
 * - moderate：iterative。
 * - simple：single_tool 或 direct（取决于是否需要工具）。
 * - trivial：direct。
 */
function complexityRules(ctx: RuleContext): RoutingRule[] {
  const level = ctx.analysis.complexity.level
  const score = ctx.complexityScore
  const rules: RoutingRule[] = []

  switch (level) {
    case 'expert':
      rules.push({
        tag: 'complexity',
        name: 'expert-complexity-deep',
        evaluate: () => [
          {
            tag: 'complexity',
            strategy: 'deep' as RouteStrategy,
            kernel: 'ultra' as KernelName,
            weight: VOTE_WEIGHT.complexity * 1.5,
            reason: `复杂度为 expert（${score} 分）：使用 deep 策略 + ultra 内核，放宽轮次与 token 预算`,
            patch: { maxRounds: 24, maxTokens: 65536, enableVerification: true },
          },
          {
            tag: 'complexity',
            strategy: 'autonomous' as RouteStrategy,
            weight: VOTE_WEIGHT.complexity * 0.3,
            reason: '复杂度为 expert：可能需要自主拆解子目标，autonomous 作为次优候选',
          },
        ],
      })
      break
    case 'complex':
      rules.push({
        tag: 'complexity',
        name: 'complex-complexity-deep-iterative',
        evaluate: () => [
          {
            tag: 'complexity',
            strategy: 'deep' as RouteStrategy,
            weight: VOTE_WEIGHT.complexity,
            reason: `复杂度为 complex（${score} 分）：优先 deep 策略以获得完整验证闭环`,
          },
          {
            tag: 'complexity',
            strategy: 'iterative' as RouteStrategy,
            weight: VOTE_WEIGHT.complexity * 0.7,
            reason: '复杂度为 complex：iterative 作为可接受的折中方案',
          },
        ],
      })
      break
    case 'moderate':
      rules.push({
        tag: 'complexity',
        name: 'moderate-complexity-iterative',
        evaluate: () => [{
          tag: 'complexity',
          strategy: 'iterative' as RouteStrategy,
          kernel: 'super' as KernelName,
          weight: VOTE_WEIGHT.complexity,
          reason: `复杂度为 moderate（${score} 分）：使用 iterative 策略 + super 内核`,
        }],
      })
      break
    case 'simple':
      rules.push({
        tag: 'complexity',
        name: 'simple-complexity-light',
        evaluate: () => [
          {
            tag: 'complexity',
            strategy: 'single_tool' as RouteStrategy,
            weight: VOTE_WEIGHT.complexity * 0.8,
            reason: `复杂度为 simple（${score} 分）：单工具调用即可，倾向 single_tool`,
          },
          {
            tag: 'complexity',
            strategy: 'direct' as RouteStrategy,
            weight: VOTE_WEIGHT.complexity * 0.35,
            reason: '复杂度为 simple：若无需工具可直接答复，direct 作为备选',
          },
        ],
      })
      break
    case 'trivial':
      rules.push({
        tag: 'complexity',
        name: 'trivial-complexity-direct',
        evaluate: () => [{
          tag: 'complexity',
          strategy: 'direct' as RouteStrategy,
          kernel: 'pro' as KernelName,
          weight: VOTE_WEIGHT.complexity * 1.2,
          reason: `复杂度为 trivial（${score} 分）：直接答复，无需工具与多轮循环`,
        }],
      })
      break
  }

  return rules
}

/**
 * 领域规则。不同领域对「工具 / 验证 / 自主性」的倾向不同。
 * 这里只投策略票，具体覆盖参数在 computeOverrides 里统一算。
 */
function domainRules(ctx: RuleContext): RoutingRule[] {
  const domain = ctx.analysis.domain
  const rules: RoutingRule[] = []

  switch (domain) {
    case 'code':
    case 'shell':
      rules.push({
        tag: 'domain',
        name: 'engineering-domain-iterative',
        evaluate: () => [
          {
            tag: 'domain',
            strategy: 'iterative' as RouteStrategy,
            weight: VOTE_WEIGHT.domain,
            reason: `领域为 ${domain}：需要边执行边修正，倾向 iterative 策略`,
          },
          {
            tag: 'domain',
            strategy: 'deep' as RouteStrategy,
            weight: VOTE_WEIGHT.domain * 0.5,
            reason: `领域为 ${domain}：涉及变更时 deep 策略可保证验证闭环`,
            patch: { enableVerification: true },
          },
        ],
      })
      break
    case 'file':
      rules.push({
        tag: 'domain',
        name: 'file-domain-tool',
        evaluate: () => [{
          tag: 'domain',
          strategy: 'single_tool' as RouteStrategy,
          weight: VOTE_WEIGHT.domain,
          reason: '领域为 file：通常是明确的读写操作，single_tool 足够',
        }],
      })
      break
    case 'research':
      rules.push({
        tag: 'domain',
        name: 'research-domain-iterative',
        evaluate: () => [{
          tag: 'domain',
          strategy: 'iterative' as RouteStrategy,
          weight: VOTE_WEIGHT.domain * 1.2,
          reason: '领域为 research：需要多轮检索与汇总，倾向 iterative 策略',
        }],
      })
      break
    case 'data':
      rules.push({
        tag: 'domain',
        name: 'data-domain-iterative',
        evaluate: () => [{
          tag: 'domain',
          strategy: 'iterative' as RouteStrategy,
          weight: VOTE_WEIGHT.domain,
          reason: '领域为 data：需要取数-分析-校验的循环，倾向 iterative 策略',
          patch: { enableVerification: true },
        }],
      })
      break
    case 'qa':
      rules.push({
        tag: 'domain',
        name: 'qa-domain-deep',
        evaluate: () => [{
          tag: 'domain',
          strategy: 'deep' as RouteStrategy,
          weight: VOTE_WEIGHT.domain,
          reason: '领域为 qa：测试/检查类任务验证是核心，倾向 deep 策略',
          patch: { enableVerification: true },
        }],
      })
      break
    case 'planning':
      rules.push({
        tag: 'domain',
        name: 'planning-domain-autonomous',
        evaluate: () => [
          {
            tag: 'domain',
            strategy: 'autonomous' as RouteStrategy,
            weight: VOTE_WEIGHT.domain * 0.8,
            reason: '领域为 planning：规划类任务适合自主拆解，倾向 autonomous',
          },
          {
            tag: 'domain',
            strategy: 'iterative' as RouteStrategy,
            weight: VOTE_WEIGHT.domain * 0.4,
            reason: '领域为 planning：若只需产出方案文本，iterative 亦可',
          },
        ],
      })
      break
    case 'creative':
    case 'writing':
    case 'conversation':
      rules.push({
        tag: 'domain',
        name: 'expression-domain-direct',
        evaluate: () => [{
          tag: 'domain',
          strategy: 'direct' as RouteStrategy,
          weight: VOTE_WEIGHT.domain * 0.7,
          reason: `领域为 ${domain}：表达类任务通常一次成文，倾向 direct 策略`,
        }],
      })
      break
  }

  return rules
}

/**
 * 工具规则。needsTools 是「是否必须离开纯文本答复」的关键分水岭。
 * suggestedTools 数量 > 1 时升级为 iterative。
 */
function toolRules(ctx: RuleContext): RoutingRule[] {
  const { needsTools, suggestedTools } = ctx.analysis
  const rules: RoutingRule[] = []

  if (!needsTools) {
    rules.push({
      tag: 'tool',
      name: 'no-tools-direct',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'direct' as RouteStrategy,
        kernel: 'pro' as KernelName,
        weight: VOTE_WEIGHT.tool,
        reason: '任务不需要工具：无需进入工具循环，倾向 direct 策略 + pro 内核',
        patch: { hermesMode: 'off' },
      }],
    })
    return rules
  }

  const toolCount = (suggestedTools ?? []).length
  if (toolCount >= 3) {
    rules.push({
      tag: 'tool',
      name: 'many-tools-iterative',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'iterative' as RouteStrategy,
        weight: VOTE_WEIGHT.tool * 1.1,
        reason: `需要 ${toolCount} 类工具协同：倾向 iterative 策略以编排多次工具调用`,
        patch: { hermesMode: 'auto' },
      }],
    })
  } else if (toolCount >= 1) {
    rules.push({
      tag: 'tool',
      name: 'few-tools-single-or-iterative',
      evaluate: () => [
        {
          tag: 'tool',
          strategy: 'single_tool' as RouteStrategy,
          weight: VOTE_WEIGHT.tool * 0.9,
          reason: `需要 ${toolCount} 类工具：single_tool 策略足以覆盖`,
        },
        {
          tag: 'tool',
          strategy: 'iterative' as RouteStrategy,
          weight: VOTE_WEIGHT.tool * 0.5,
          reason: '工具调用后可能需要根据结果继续决策，iterative 作为备选',
        },
      ],
    })
  } else {
    // needsTools 为真但没有给出建议工具：保守地走 iterative，让运行时自行发现工具。
    rules.push({
      tag: 'tool',
      name: 'needs-tools-unspecified',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'iterative' as RouteStrategy,
        weight: VOTE_WEIGHT.tool,
        reason: '任务需要工具但未给出建议工具集：使用 iterative 策略在运行时按需发现工具',
        patch: { hermesMode: 'auto' },
      }],
    })
  }

  return rules
}

/** 自主性规则：benefitsFromAutonomy 为真时推 autonomous + auto 内核。 */
function autonomyRules(ctx: RuleContext): RoutingRule[] {
  if (!ctx.analysis.benefitsFromAutonomy) return []

  const domain = ctx.analysis.domain
  // 工程类领域自主执行通常伴随变更风险，额外加一条 deep 票做平衡。
  const engineering = TOOL_ORIENTED_DOMAINS.has(domain)
  return [{
    tag: 'autonomy',
    name: 'autonomy-beneficial',
    evaluate: () => {
      const votes: Vote[] = [{
        tag: 'autonomy',
        strategy: 'autonomous' as RouteStrategy,
        kernel: 'auto' as KernelName,
        weight: VOTE_WEIGHT.autonomy * 1.1,
        reason: '任务适合自主闭环（完成/直到/全部等目标信号）：使用 autonomous 策略 + auto 内核',
        patch: { hermesMode: 'auto' },
      }]
      if (engineering) {
        votes.push({
          tag: 'autonomy',
          strategy: 'deep' as RouteStrategy,
          weight: VOTE_WEIGHT.autonomy * 0.4,
          reason: '自主任务涉及工程变更：deep 策略作为带护栏的保守备选',
        })
      }
      return votes
    },
  }]
}

/**
 * 计划规模规则。步骤多、关键路径长、难度高都推高策略等级。
 * 这组规则的价值在于：即便 analysis 判定为 simple，一个 20 步的计划也不该走 direct。
 */
function planRules(ctx: RuleContext): RoutingRule[] {
  const rules: RoutingRule[] = []
  const { stepCount, avgDifficulty, criticalLength } = ctx

  if (stepCount === 0) {
    rules.push({
      tag: 'plan',
      name: 'plan-empty',
      evaluate: () => [{
        tag: 'plan',
        strategy: 'direct' as RouteStrategy,
        weight: VOTE_WEIGHT.plan * 0.5,
        reason: '执行计划为空：任务无需编排，倾向 direct/single_tool',
      }],
    })
    return rules
  }

  if (stepCount >= 8 || ctx.plan.estimatedRounds >= 12) {
    rules.push({
      tag: 'plan',
      name: 'plan-large',
      evaluate: () => [{
        tag: 'plan',
        strategy: 'deep' as RouteStrategy,
        // 大计划是强信号：票重要足够高，压过「工具数/复杂度」投出的 iterative 票。
        weight: VOTE_WEIGHT.plan * 3,
        reason: `计划规模较大（${stepCount} 步 / 预计 ${ctx.plan.estimatedRounds} 轮）：使用 deep 策略`,
        patch: { maxRounds: Math.max(ctx.plan.estimatedRounds + 4, 16) },
      }],
    })
  } else if (stepCount >= 4) {
    rules.push({
      tag: 'plan',
      name: 'plan-medium',
      evaluate: () => [{
        tag: 'plan',
        strategy: 'iterative' as RouteStrategy,
        weight: VOTE_WEIGHT.plan,
        reason: `计划含 ${stepCount} 个步骤：使用 iterative 策略逐步推进`,
      }],
    })
  } else {
    rules.push({
      tag: 'plan',
      name: 'plan-small',
      evaluate: () => [{
        tag: 'plan',
        strategy: 'single_tool' as RouteStrategy,
        weight: VOTE_WEIGHT.plan * 0.7,
        reason: `计划仅 ${stepCount} 步：single_tool 即可完成`,
      }],
    })
  }

  if (criticalLength >= 3) {
    rules.push({
      tag: 'plan',
      name: 'plan-deep-chain',
      evaluate: () => [{
        tag: 'plan',
        strategy: 'iterative' as RouteStrategy,
        weight: VOTE_WEIGHT.plan * 0.5,
        reason: `关键依赖链较长（${criticalLength} 层）：需要多轮迭代按依赖顺序执行`,
      }],
    })
  }

  if (avgDifficulty >= 75) {
    rules.push({
      tag: 'plan',
      name: 'plan-hard-steps',
      evaluate: () => [{
        tag: 'plan',
        strategy: 'deep' as RouteStrategy,
        weight: VOTE_WEIGHT.plan * 0.6,
        reason: `步骤平均难度高（${Math.round(avgDifficulty)} 分）：倾向 deep 策略并开启验证`,
        patch: { enableVerification: true },
      }],
    })
  }

  return rules
}

/**
 * 输入策略规则。StrategyPicker 给出的策略是「建议」，只在其它信号不明确时
 * 起决定作用，因此票重最低。若输入策略声明了 fallbackOnFailure，则偏向更稳健
 * 的一档；若 verifyEachStep 为真，则偏向带验证的策略。
 */
function strategyRules(ctx: RuleContext): RoutingRule[] {
  const s = ctx.strategy
  const rules: RoutingRule[] = []

  rules.push({
    tag: 'strategy',
    name: 'input-strategy-hint',
    evaluate: () => [{
      tag: 'strategy',
      strategy: s.name === 'autonomous' ? 'autonomous' : (s.name as RouteStrategy),
      weight: VOTE_WEIGHT.strategy,
      reason: `输入策略建议为 ${s.name}（${s.description || '无描述'}）`,
    }],
  })

  if (s.verifyEachStep) {
    rules.push({
      tag: 'strategy',
      name: 'input-verify-each-step',
      evaluate: () => [{
        tag: 'strategy',
        strategy: 'deep' as RouteStrategy,
        weight: VOTE_WEIGHT.strategy * 0.6,
        reason: '输入策略要求每步验证：偏向 deep 策略',
        patch: { enableVerification: true },
      }],
    })
  }

  if (s.fallbackOnFailure && s.maxRounds > 10) {
    rules.push({
      tag: 'strategy',
      name: 'input-fallback-long-rounds',
      evaluate: () => [{
        tag: 'strategy',
        strategy: 'iterative' as RouteStrategy,
        weight: VOTE_WEIGHT.strategy * 0.5,
        reason: `输入策略允许失败回退（${s.fallbackOnFailure}）且轮次上限较高：倾向 iterative`,
      }],
    })
  }

  return rules
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 聚合 / 冲突检测 / 置信度
 * ───────────────────────────────────────────────────────────────────────────── */

/** 把一组票按策略或内核聚合成计分表。 */
function tallyVotes<T extends string>(votes: Vote[], key: 'strategy' | 'kernel'): Tally<T> {
  const scores = new Map<T, number>()
  const voters = new Map<T, Set<RuleTag>>()

  for (const vote of votes) {
    const k = vote[key] as T | undefined
    if (k === undefined || vote.weight <= 0) continue
    scores.set(k, (scores.get(k) ?? 0) + vote.weight)
    if (!voters.has(k)) voters.set(k, new Set<RuleTag>())
    voters.get(k)!.add(vote.tag)
  }

  // 保证至少有一个键，避免后续取 best 时崩溃。
  if (scores.size === 0) {
    const fallback = 'direct' as T
    scores.set(fallback, 0)
    voters.set(fallback, new Set<RuleTag>())
  }

  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((sum, [, v]) => sum + v, 0)
  return {
    scores,
    voters,
    best: sorted[0][0],
    runnerUp: sorted.length > 1 ? sorted[1][0] : undefined,
    bestScore: sorted[0][1],
    runnerScore: sorted.length > 1 ? sorted[1][1] : 0,
    total,
  }
}

/**
 * 统计跨维度冲突度：若第一名和第二名由完全不同维度投票产生，冲突更强；
 * 若两者共享同一维度（例如 risk 同时投了 deep 和 iterative），冲突较弱。
 */
function conflictPenalty(tally: Tally<string>): number {
  if (tally.runnerUp === undefined || tally.total === 0) return 0
  const bestVoters = tally.voters.get(tally.best) ?? new Set<RuleTag>()
  const runnerVoters = tally.voters.get(tally.runnerUp) ?? new Set<RuleTag>()
  let shared = 0
  for (const tag of bestVoters) {
    if (runnerVoters.has(tag)) shared += 1
  }
  const unionSize = new Set([...bestVoters, ...runnerVoters]).size || 1
  const overlap = shared / unionSize

  // 票势均力敌时才产生显著冲突；一边倒时即使维度不同也不算冲突。
  const closeness = tally.bestScore === 0
    ? 0
    : clamp(tally.runnerScore / tally.bestScore, 0, 1)
  return closeness * (1 - overlap) * 0.35
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 运行时覆盖计算
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 合并所有规则产生的局部覆盖补丁。
 * 布尔值采用「保守优先」：任意一个规则要求开启护栏/验证就开启。
 * 数值取最大值（轮次/token 宁可多给，避免被预算卡死）。
 */
function mergePatches(votes: Vote[]): OverridePatch {
  const patch: OverridePatch = {}
  for (const vote of votes) {
    const p = vote.patch
    if (!p) continue
    if (p.maxRounds !== undefined) {
      patch.maxRounds = Math.max(patch.maxRounds ?? 0, p.maxRounds)
    }
    if (p.maxTokens !== undefined) {
      patch.maxTokens = Math.max(patch.maxTokens ?? 0, p.maxTokens)
    }
    if (p.temperature !== undefined) {
      // 温度取最后一次明确指定（创作类规则优先级更高，规则顺序保证）。
      patch.temperature = p.temperature
    }
    if (p.enableGuardrails !== undefined) {
      patch.enableGuardrails = (patch.enableGuardrails ?? false) || p.enableGuardrails
    }
    if (p.enableVerification !== undefined) {
      patch.enableVerification = (patch.enableVerification ?? false) || p.enableVerification
    }
    if (p.hermesMode !== undefined) {
      // auto 是最宽松的档位，一旦有规则要求 auto 就不再降级为 on/off。
      const rank = { off: 0, on: 1, auto: 2 } as const
      const current = patch.hermesMode ?? 'off'
      patch.hermesMode = rank[p.hermesMode] >= rank[current] ? p.hermesMode : current
    }
  }
  return patch
}

/**
 * 计算最终覆盖参数。
 * 优先级：硬约束 > 规则补丁 > 基于任务特征的公式推导 > 输入策略默认值。
 */
function computeOverrides(
  ctx: RuleContextWithHints,
  chosenStrategy: RouteStrategy,
  patch: OverridePatch,
): Required<RouteDecision['overrides']> {
  const { analysis, strategy, plan } = ctx
  const level = analysis.complexity.level
  const domain = analysis.domain

  // ── maxRounds ──
  const inputRounds = Number.isFinite(strategy.maxRounds) && strategy.maxRounds > 0
    ? strategy.maxRounds
    : STRATEGY_BASE_ROUNDS[chosenStrategy]
  const planRounds = Number.isFinite(plan.estimatedRounds) ? plan.estimatedRounds : 0
  const roundDelta = COMPLEXITY_ROUND_DELTA[level]
  const strategyRounds = STRATEGY_BASE_ROUNDS[chosenStrategy]
  let maxRounds = Math.max(
    inputRounds,
    strategyRounds + roundDelta,
    planRounds > 0 ? planRounds + 2 : 0,
  )
  if (patch.maxRounds !== undefined) maxRounds = Math.max(maxRounds, patch.maxRounds)
  // direct 永远压回 1 轮，单工具最多 3 轮。
  if (chosenStrategy === 'direct') maxRounds = 1
  if (chosenStrategy === 'single_tool') maxRounds = clamp(maxRounds, 1, 3)
  maxRounds = clamp(Math.round(maxRounds), 1, 64)

  // ── maxTokens ──
  let maxTokens = COMPLEXITY_TOKEN_BASE[level]
  // 计划步骤越多，产物越大，预算随之增长。
  maxTokens += ctx.stepCount * 1024
  if (patch.maxTokens !== undefined) maxTokens = Math.max(maxTokens, patch.maxTokens)
  if (chosenStrategy === 'direct') maxTokens = Math.min(maxTokens, 8192)
  maxTokens = clamp(Math.round(maxTokens / 1024) * 1024, 2048, 131072)

  // ── temperature ──
  let temperature = patch.temperature ?? DOMAIN_TEMPERATURE[domain]
  // 复杂度越高越需要确定性输出，适度降温；创作类例外。
  if (domain !== 'creative' && domain !== 'writing') {
    if (level === 'complex' || level === 'expert') temperature -= 0.1
  }
  temperature = round(clamp(temperature, 0, 1.2), 2)

  // ── enableGuardrails ──
  let enableGuardrails = patch.enableGuardrails ?? false
  if (ELEVATED_RISK.has(analysis.risk)) enableGuardrails = true
  if (chosenStrategy === 'deep') enableGuardrails = true
  if (TOOL_ORIENTED_DOMAINS.has(domain) && analysis.needsTools) enableGuardrails = true

  // ── enableVerification ──
  let enableVerification = patch.enableVerification ?? false
  if (VERIFICATION_DOMAINS.has(domain)) enableVerification = true
  if (level === 'complex' || level === 'expert') enableVerification = true
  if (chosenStrategy === 'deep') enableVerification = true
  if (ctx.verifyEachStepHint) enableVerification = true
  // 简单.transform 任务不必强制验证（除非风险/领域已经要求）。
  if (chosenStrategy === 'direct' && analysis.risk === 'low' && !VERIFICATION_DOMAINS.has(domain)) {
    enableVerification = false
  }

  // ── hermesMode ──
  let hermesMode: NonNullable<RouteDecision['overrides']['hermesMode']> =
    patch.hermesMode ?? 'off'
  if (!analysis.needsTools) hermesMode = 'off'
  else if (ctx.planTools.length >= 3 || analysis.benefitsFromAutonomy) hermesMode = 'auto'
  else if (hermesMode === 'off') hermesMode = 'on'
  if (chosenStrategy === 'direct') hermesMode = 'off'

  return {
    maxRounds,
    maxTokens,
    temperature,
    enableGuardrails,
    enableVerification,
    hermesMode,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 规则装配
 * ───────────────────────────────────────────────────────────────────────────── */

/** 给 RuleContext 附加一个「输入策略要求每步验证」的提示位（不污染类型契约）。 */
interface RuleContextWithHints extends RuleContext {
  verifyEachStepHint: boolean
}

function buildAllRules(ctx: RuleContextWithHints): RoutingRule[] {
  return [
    ...riskRules(ctx),
    ...complexityRules(ctx),
    ...domainRules(ctx),
    ...toolRules(ctx),
    ...autonomyRules(ctx),
    ...planRules(ctx),
    ...strategyRules(ctx),
  ]
}

/** 收集所有票，并过滤掉纯信息票（weight=0 且无策略/内核）。 */
function collectVotes(rules: RoutingRule[], ctx: RuleContextWithHints): Vote[] {
  const votes: Vote[] = []
  for (const rule of rules) {
    let evaluated: Vote[]
    try {
      evaluated = rule.evaluate(ctx)
    } catch (err) {
      // 单条规则异常不能拖垮整个路由，记录一条理由后跳过。
      evaluated = [{
        tag: 'constraint',
        weight: 0,
        reason: `规则 ${rule.name} 评估失败，已跳过：${err instanceof Error ? err.message : String(err)}`,
      }]
    }
    for (const vote of evaluated) {
      if (vote.weight === 0 && vote.strategy === undefined && vote.kernel === undefined) {
        // 纯信息票仍然保留理由，但不计入 tally。
        votes.push(vote)
        continue
      }
      votes.push(vote)
    }
  }
  return votes
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 硬约束
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 硬约束是路由的最后一道闸门，永远覆盖投票结果。
 * 返回被强制修改的字段说明（写入 reasons）。
 */
function applyHardConstraints(
  decision: {
    strategy: RouteStrategy
    kernel: KernelName
    overrides: Required<RouteDecision['overrides']>
  },
  ctx: RuleContextWithHints,
): string[] {
  const notes: string[] = []
  const { analysis } = ctx
  const level = analysis.complexity.level
  const risk = analysis.risk

  // 约束 1：critical 风险无条件强制 deep + ultra，并开护栏 + 验证。
  // 这是最高优先级的安全闸门：任何投票结果都不能让 critical 任务绕过完整流程。
  if (risk === 'critical') {
    decision.overrides.enableGuardrails = true
    decision.overrides.enableVerification = true
    if (decision.strategy !== 'deep') {
      decision.strategy = 'deep'
      notes.push('硬约束：critical 风险强制升级为 deep 策略')
    }
    decision.kernel = 'ultra'
  }

  // 约束 2：expert 复杂度必须走 deep + ultra。
  if (level === 'expert') {
    decision.strategy = 'deep'
    decision.kernel = 'ultra'
    decision.overrides.enableVerification = true
    notes.push('硬约束：expert 复杂度强制 deep 策略 + ultra 内核')
  }

  // 约束 3：trivial 且不需要工具必须 direct。
  if (level === 'trivial' && !analysis.needsTools) {
    const wasForced = decision.strategy !== 'direct'
    decision.strategy = 'direct'
    decision.kernel = 'pro'
    decision.overrides.maxRounds = 1
    decision.overrides.hermesMode = 'off'
    if (wasForced) notes.push('硬约束：trivial 且无需工具，强制回落到 direct 策略')
  }

  // 约束 4：需要工具但选了 direct —— 升级为 single_tool 或 iterative。
  if (analysis.needsTools && decision.strategy === 'direct') {
    decision.strategy = (analysis.suggestedTools?.length ?? 0) >= 2 ? 'iterative' : 'single_tool'
    notes.push('硬约束：任务需要工具，direct 策略不可用，已升级为带工具的策略')
  }

  // 约束 5：high 风险必须有护栏。
  if (risk === 'high') {
    decision.overrides.enableGuardrails = true
  }

  // 约束 6：策略与内核保持一致（防止投票选出 iterative + ultra 这种错配）。
  const expectedKernel = STRATEGY_KERNEL[decision.strategy]
  if (decision.kernel !== expectedKernel && level !== 'expert' && risk !== 'critical') {
    // expert/critical 已经由上面锁定内核，其余情况按策略对齐。
    decision.kernel = expectedKernel
  }

  return notes
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 主体实现
 * ───────────────────────────────────────────────────────────────────────────── */

export class KernelRouterImpl implements KernelRouter {
  /** 可选：为规则票重做全局缩放（用于 A/B 实验），1 表示默认。 */
  private readonly weightScale: number

  constructor(options: { weightScale?: number } = {}) {
    this.weightScale = options.weightScale && options.weightScale > 0
      ? options.weightScale
      : 1
  }

  /**
   * 主入口：需求中称 routeTask，契约接口名为 route。
   * 两者行为完全一致，route 在下方直接委托给本方法。
   */
  routeTask(
    analysis: TaskAnalysis,
    plan: ExecutionPlan,
    strategy: ExecutionStrategy,
  ): RouteDecision {
    // 1. 构造上下文（含计划派生指标）。
    const baseCtx = buildContext(analysis, plan, strategy)
    const ctx: RuleContextWithHints = {
      ...baseCtx,
      verifyEachStepHint: strategy.verifyEachStep === true,
    }

    // 2. 装配规则并收集票。
    const rules = buildAllRules(ctx)
    const votes = collectVotes(rules, ctx).map(v => ({
      ...v,
      weight: v.weight * this.weightScale,
    }))

    // 3. 分别对策略和内核计分。
    const strategyTally = tallyVotes<RouteStrategy>(votes, 'strategy')
    const kernelTally = tallyVotes<KernelName>(votes, 'kernel')

    // 4. 选出策略；内核优先用内核得票，但若该内核与策略严重错配则以策略映射为准。
    const chosenStrategy = strategyTally.best
    let chosenKernel = kernelTally.best

    // 当内核票非常弱（几乎没有内核规则命中）时，直接采用策略映射。
    if (kernelTally.total < 0.5) {
      chosenKernel = STRATEGY_KERNEL[chosenStrategy]
    }

    // 5. 合并规则补丁并计算覆盖参数。
    const patch = mergePatches(votes)
    const overrides = computeOverrides(ctx, chosenStrategy, patch)

    // 6. 应用硬约束（可能改写策略/内核/覆盖）。
    const decision = { strategy: chosenStrategy, kernel: chosenKernel, overrides }
    const constraintNotes = applyHardConstraints(decision, ctx)

    // 7. 置信度：票势 + 一致性 - 冲突。
    const confidence = this.computeConfidence(
      strategyTally,
      kernelTally,
      analysis,
      votes,
      decision,
    )

    // 8. 汇总可解释理由（按票重降序，硬约束说明置顶）。
    const reasons = this.buildReasons(votes, constraintNotes, strategyTally, decision)

    return {
      strategy: decision.strategy,
      kernel: decision.kernel,
      confidence: round(confidence, 3),
      reasons,
      overrides: decision.overrides,
    }
  }

  /** 契约接口方法：委托给 routeTask。 */
  route(
    analysis: TaskAnalysis,
    plan: ExecutionPlan,
    strategy: ExecutionStrategy,
  ): RouteDecision {
    return this.routeTask(analysis, plan, strategy)
  }

  /* ── 置信度计算 ── */

  private computeConfidence(
    strategyTally: Tally<RouteStrategy>,
    kernelTally: Tally<KernelName>,
    analysis: TaskAnalysis,
    votes: Vote[],
    decision: { strategy: RouteStrategy; kernel: KernelName },
  ): number {
    // 基础分：第一名得票占总票的比例（一边倒接近 1，势均力敌接近 0.5）。
    const dominance = strategyTally.total > 0
      ? strategyTally.bestScore / strategyTally.total
      : 0.5

    // 共识加成：第一名由多个不同维度共同支持时，说明信号一致。
    const bestVoters = strategyTally.voters.get(strategyTally.best) ?? new Set<RuleTag>()
    const consensus = clamp(0.6 + bestVoters.size * 0.1, 0.6, 1)

    // 冲突惩罚：策略与内核维度冲突 + 策略内部一二名冲突。
    const strategyConflict = conflictPenalty(strategyTally)
    const kernelConflict = conflictPenalty(kernelTally)
    const kernelMismatch = decision.kernel === STRATEGY_KERNEL[decision.strategy] ? 0 : 0.12

    // 分析本身置信度也纳入考量（领域识别越确定，路由越可信）。
    const analysisConfidence = unit(analysis.confidence)

    let confidence = dominance * consensus
      - strategyConflict
      - kernelConflict
      - kernelMismatch
    confidence = confidence * 0.75 + analysisConfidence * 0.25

    // 硬约束被触发时，虽然决策本身确定，但要诚实反映「这是兜底而非自然共识」。
    const constraintVotes = votes.filter(v => v.tag === 'constraint' && v.weight > 0)
    if (constraintVotes.length > 0) confidence -= 0.08

    // 高风险任务我们更保守，置信度略微下调（承认不确定性）。
    if (analysis.risk === 'critical') confidence -= 0.05

    return clamp(confidence, 0.05, 1)
  }

  /* ── 理由汇总 ── */

  private buildReasons(
    votes: Vote[],
    constraintNotes: string[],
    tally: Tally<RouteStrategy>,
    decision: { strategy: RouteStrategy; kernel: KernelName },
  ): string[] {
    const reasons: string[] = []

    // 硬约束说明置顶。
    for (const note of constraintNotes) reasons.push(note)

    // 决策结论摘要。
    reasons.push(
      `最终决策：strategy=${decision.strategy}，kernel=${decision.kernel}` +
      `（策略得票 ${round(tally.bestScore, 1)}，共 ${round(tally.total, 1)}）`,
    )

    // 其余理由按票重降序，去重。
    const seen = new Set<string>()
    const informative = votes
      .filter(v => v.reason.length > 0)
      .sort((a, b) => b.weight - a.weight)
    for (const vote of informative) {
      if (seen.has(vote.reason)) continue
      seen.add(vote.reason)
      reasons.push(vote.reason)
    }

    return reasons
  }
}

/** 工厂函数：创建一个默认路由器。 */
export function createKernelRouter(options?: { weightScale?: number }): KernelRouterImpl {
  return new KernelRouterImpl(options)
}

/** 默认导出的类，方便 `import KernelRouterImpl from ...`。 */
export default KernelRouterImpl
