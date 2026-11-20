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
 *     得票最高的策略/内核胜出。
 *  3. 冲突消解（v18.1 优化）：投票冲突不再直接等于「低置信、显犹豫」。信号维度有
 *     明确的优先级阶梯：硬约束 > 自主目标(用户显式意志) > 工具需求 > 风险 >
 *     领域专家 > 复杂度 > 计划规模 > 输入策略。当低优先级维度（复杂度/计划/输入策略）
 *     与高优先级维度结论冲突时，按阶梯果断裁决（例如「复杂度说 trivial 该直接答复，
 *     但任务明确需要工具」→ 工具需求胜出，果断升级策略），被否决方的票从置信度
 *     占比中剔除，不再把置信度拉到 15% 这种不可用区间。
 *  4. 专家规则：一组高权重领域规则（代码+验证闭环、目标闭环自主、工程工具循环等），
 *     把「任务明确要求写代码/跑命令就是需要工具循环」这类确定性判断编码为一票定音。
 *  5. 硬约束兜底：critical 风险必须开护栏、expert 复杂度必须走 deep、
 *     trivial 且不需要工具必须走 direct。硬约束优先级永远高于投票与消解结果。
 *  6. 置信度公式：主决策有效票占比 × 维度共识 − 冲突惩罚（衰减函数、封顶 0.3）
 *     + 消解加成，下限 0.35——冲突可以反映不确定性，但不能让路由显得比随机猜还犹豫。
 *  7. 运行时覆盖：maxRounds / maxTokens / temperature / 护栏 / 验证 / hermes
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

/**
 * 冲突消解结果。
 *
 * 消解的意义：投票冲突不等于决策不确定——当冲突双方分属优先级阶梯的不同层级时，
 * 胜负由阶梯规则确定性裁决，路由应当「果断」而不是「犹豫」。被否决方的落选票
 * 从置信度占比与冲突惩罚中剔除（overruled），并按裁决方式给予果断加成。
 */
interface ConflictResolution {
  /** 最终采纳的策略（可能与投票第一名不同） */
  strategy: RouteStrategy
  /** 是否发生了「低优先级结论被推翻」的策略切换 */
  flipped: boolean
  /** 被推翻前的策略（flipped 时有效） */
  from: RouteStrategy
  /** 消解说明（写入 reasons 前排；未发生任何消解时为 null） */
  reason: string | null
  /** 被压制（不参与置信度占比与冲突惩罚）的票集合 */
  overruled: Set<Vote>
  /** 置信度果断加成：消解本身是确定性规则，应当体现确定性 */
  bonus: number
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

/**
 * 策略升级阶梯：数字越大策略越「重」。冲突惩罚按两个策略之间的档位距离衰减——
 * 相邻档位（如 single_tool 与 iterative）的分歧是「程度问题」，不是「方向问题」。
 */
const STRATEGY_TIER: Record<RouteStrategy, number> = {
  direct: 0,
  single_tool: 1,
  iterative: 2,
  autonomous: 3,
  deep: 3,
}

/** 冲突惩罚封顶：无论多少维度冲突，置信度扣减不超过该值（防止跌到不可用区间）。 */
const CONFLICT_PENALTY_CAP = 0.3

/** 置信度下限：多规则冲突时路由可以承认不确定，但不能跌到 15% 这种不可用区间。 */
export const MIN_ROUTE_CONFIDENCE = 0.35

/**
 * 信号维度优先级阶梯（高 -> 低）。冲突消解按此裁决：
 * 硬约束（applyHardConstraints）> 自主目标（用户显式意志）> 工具需求 > 风险 >
 * 领域专家 > 复杂度 > 计划规模 > 输入策略。
 */
const HIGH_PRIORITY_TAGS: readonly RuleTag[] = ['autonomy', 'tool', 'risk', 'domain']
const LOW_PRIORITY_TAGS: readonly RuleTag[] = ['complexity', 'plan', 'strategy']

/** 维度标签的中文展示名（冲突消解理由用）。 */
const TAG_LABEL: Record<RuleTag, string> = {
  constraint: '硬约束',
  autonomy: '自主目标',
  tool: '工具需求',
  risk: '风险',
  domain: '领域专家',
  complexity: '复杂度',
  plan: '计划规模',
  strategy: '输入策略',
  history: '历史',
}

/** 理由展示优先级：越决定性越靠前（硬约束说明由 applyHardConstraints 单独置顶）。 */
const REASON_DIM_ORDER: Record<RuleTag, number> = {
  constraint: 0,
  autonomy: 1,
  tool: 2,
  risk: 3,
  domain: 4,
  complexity: 5,
  plan: 6,
  strategy: 7,
  history: 8,
}

/** 专家规则触发的「行动意图」集合（来自 analyzer 的 intent 抽取）。 */
const ACTION_INTENTS: ReadonlySet<string> = new Set([
  '实现代码', '修复缺陷', '重构优化', '命令行执行', '测试验证',
])

/** 验证词匹配（intent / 工具名 / 计划文本三个来源）。 */
const VERIFICATION_INTENT_RE = /测试|验证|检查|校验|verify|test|check|lint/i
const VERIFICATION_TOOL_RE = /test|verify|check|lint/i
const VERIFICATION_TEXT_RE = /测试|验证|检查|校验|核对|verify|test|check|lint|assert/i

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
 * 判断任务是否带验证信号（路由只能看到 TaskAnalysis/Plan/Strategy，不接触原始文本，
 * 因此从意图标签、建议工具、计划步骤文本、输入策略四个来源综合判断）。
 */
function hasVerificationSignal(ctx: RuleContextWithHints): boolean {
  const { analysis, strategy, plan } = ctx
  if (strategy.verifyEachStep === true) return true
  if (VERIFICATION_INTENT_RE.test(analysis.intent)) return true
  if ((analysis.suggestedTools ?? []).some(tool => VERIFICATION_TOOL_RE.test(tool))) return true
  return (plan.steps ?? []).some(step =>
    VERIFICATION_TEXT_RE.test(`${step.title}${step.description}${step.expectedOutput}`))
}

/**
 * 领域专家规则（v18.1 新增，高权重一票定音）。
 *
 * 这组规则把「确定性判断」编码为高权重票，避免被低权重启发式稀释：
 *  1. code + 需要工具 + 含验证信号 -> iterative 验证闭环（小任务停留在 pro 轻内核）；
 *  2. 目标闭环信号（自动/直到/完成全部，由 analyzer 折算为 benefitsFromAutonomy）
 *     -> autonomous + auto，果断不被轻策略拦截；
 *  3. code/shell + 需要工具 -> iterative 工具循环（写代码/执行命令必须离开纯文本答复）；
 *  4. 明确行动意图（实现/修复/重构/执行/验证）+ 需要工具 -> iterative；
 *  5. 简单任务却要求 >=3 类工具协同 -> 果断升级 iterative（负载与档位不匹配）。
 *
 * 全部策略升级型规则都要求 !benefitsFromAutonomy：目标闭环信号在场时由规则 2
 * 一票定音，其余规则不再叠加 iterative 票抬高 runner（避免稀释自主决策的占比）。
 */
function expertRules(ctx: RuleContextWithHints): RoutingRule[] {
  const { analysis } = ctx
  const level = analysis.complexity.level
  const smallTask = level === 'trivial' || level === 'simple'
  const escalated = level === 'trivial' || level === 'simple' || level === 'moderate'
  const lightKernel: KernelName = smallTask ? 'pro' : 'super'
  const rules: RoutingRule[] = []
  const autonomy = analysis.benefitsFromAutonomy
  // 真实分析器对工程任务给出的建议工具集 >= 2（如 code_search + read_file）；
  // 单工具场景保持轻策略（single_tool 足够），专家规则不越俎代庖。
  const multiTool = (analysis.suggestedTools ?? []).length >= 2

  // 专家规则 1：代码任务 + 需要工具 + 验证信号 -> iterative 验证闭环。
  if (analysis.domain === 'code' && analysis.needsTools && !autonomy && escalated && multiTool
      && hasVerificationSignal(ctx)) {
    rules.push({
      tag: 'tool',
      name: 'expert-code-verify-loop',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'iterative' as RouteStrategy,
        kernel: lightKernel,
        weight: 4.2,
        reason: '专家规则：代码任务需要工具且包含验证要求——使用 iterative 验证闭环'
          + (smallTask ? '（小型任务停留在 pro 轻内核）' : ''),
        patch: { enableVerification: true },
      }],
    })
  }

  // 专家规则 2：目标闭环（自动/直到/完成全部）-> autonomous + auto，一票定音。
  if (autonomy) {
    rules.push({
      tag: 'autonomy',
      name: 'expert-goal-loop-autonomous',
      evaluate: () => [{
        tag: 'autonomy',
        strategy: 'autonomous' as RouteStrategy,
        kernel: 'auto' as KernelName,
        weight: 5.5,
        reason: '专家规则：用户表达了自主闭环目标（自动/直到/完成全部）——果断使用 autonomous 策略 + auto 内核',
        patch: { hermesMode: 'auto', enableVerification: true },
      }],
    })
  }

  // 专家规则 3：工程领域（code/shell）+ 需要工具 -> iterative 工具循环。
  if ((analysis.domain === 'code' || analysis.domain === 'shell') && analysis.needsTools
      && !autonomy && escalated && multiTool) {
    rules.push({
      tag: 'tool',
      name: 'expert-engineering-tool-loop',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'iterative' as RouteStrategy,
        kernel: lightKernel,
        weight: 3.0,
        reason: `专家规则：${analysis.domain} 任务明确需要工具——写代码/执行命令必须经过工具循环，果断升级为 iterative`
          + (smallTask ? '（小型任务用 pro 内核轻量执行）' : ''),
        patch: { enableVerification: analysis.domain === 'code' },
      }],
    })
  }

  // 专家规则 4：明确行动意图 + 需要工具 -> iterative。
  if (ACTION_INTENTS.has(analysis.intent) && analysis.needsTools && !autonomy
      && escalated && multiTool) {
    rules.push({
      tag: 'tool',
      name: 'expert-action-intent-loop',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'iterative' as RouteStrategy,
        kernel: lightKernel,
        weight: 3.2,
        reason: `专家规则：意图「${analysis.intent}」是明确的执行型任务且需要工具——使用 iterative 策略推进`,
      }],
    })
  }

  // 专家规则 5：简单任务却要求多类工具协同 -> 果断升级 iterative。
  if (analysis.needsTools && !autonomy && smallTask
      && (analysis.suggestedTools ?? []).length >= 3) {
    rules.push({
      tag: 'tool',
      name: 'expert-multi-tool-mismatch',
      evaluate: () => [{
        tag: 'tool',
        strategy: 'iterative' as RouteStrategy,
        kernel: 'pro' as KernelName,
        weight: 3.4,
        reason: `专家规则：简单任务却需要 ${analysis.suggestedTools.length} 类工具协同——负载与档位不匹配，果断升级为 iterative`,
      }],
    })
  }

  return rules
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
 * 统计跨维度冲突度（只对「未被消解」的真实分歧计惩罚）：
 * - 若第一名和第二名由完全不同维度投票产生，冲突更强；
 * - 若两者共享同一维度（例如 risk 同时投了 deep 和 iterative），冲突较弱；
 * - 档位距离衰减：相邻策略档位之间的分歧是「程度问题」，惩罚按 0.25 倍计；
 *   隔一档按 0.6 倍；跨三档以上才是全额冲突。
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

  const bestTier = STRATEGY_TIER[tally.best as RouteStrategy] ?? 0
  const runnerTier = STRATEGY_TIER[tally.runnerUp as RouteStrategy] ?? 0
  const distance = Math.abs(bestTier - runnerTier)
  const distanceFactor = distance <= 1 ? 0.25 : distance === 2 ? 0.6 : 1
  return closeness * (1 - overlap) * 0.35 * distanceFactor
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 冲突消解（v18.1）
 *
 * 优先级阶梯：硬约束 > 自主目标 > 工具需求 > 风险 > 领域专家 > 复杂度 > 计划 > 输入策略。
 * 典型场景：「帮我写快速排序」——复杂度判 trivial 建议直接答复，但任务明确需要工具，
 * 旧逻辑让两派票数接近、置信度跌到 15%；新逻辑按「工具需求 > 复杂度」果断升级策略，
 * 被否决方的票从置信度占比中剔除，置信度回到可用区间。
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 冲突消解主入口：返回最终策略 + 被压制的票。
 *
 * flip 规则（低优先级结论被高优先级推翻，切换策略）：
 *   C. 自主目标 > 其它：benefitsFromAutonomy（自动/直到/完成全部）在场且投票未选 autonomous。
 *   A. 工具需求 > 复杂度/计划/输入策略：needsTools 为真时 direct 永远不可用，
 *      升级目标取非 direct 策略中票重最高者（与工具/领域维度自身倾向保持一致）。
 *   B. 风险 > 复杂度：high/critical 风险在场且投票落在 direct/single_tool。
 *
 * 压制规则 D（不切换策略，只剔除拉低置信度的落选票）：
 *   低优先级维度（复杂度/计划/输入策略）投给了最终赢家以外的策略，且赢家有
 *   高优先级维度支持——按阶梯压制其落选票。高优先级维度之间的分歧保持诚实，
 *   不做压制（那是真正需要反映的不确定性）。
 */
function resolveConflicts(
  votes: Vote[],
  tally: Tally<RouteStrategy>,
  ctx: RuleContextWithHints,
): ConflictResolution {
  const winner = tally.best
  const overruled = new Set<Vote>()
  let flipped = false
  let from = winner
  let strategy = winner
  let reason: string | null = null

  /** 某维度是否给某策略投过有效票。 */
  const supports = (s: RouteStrategy, tag: RuleTag): boolean =>
    votes.some(v => v.strategy === s && v.tag === tag && v.weight > 0)

  // 消解规则 C：用户显式自主目标（自动/直到/完成全部）> 其它信号。
  if (ctx.analysis.benefitsFromAutonomy && winner !== 'autonomous'
      && supports('autonomous', 'autonomy')) {
    flipped = true
    from = winner
    strategy = 'autonomous'
    reason = '冲突消解：检测到自主闭环目标信号，按「自主目标 > 复杂度/计划」果断升级为 autonomous'
  }

  // 消解规则 A：工具需求 > 复杂度/计划/输入策略。
  if (!flipped && ctx.analysis.needsTools && winner === 'direct') {
    const scores = new Map<RouteStrategy, number>()
    for (const v of votes) {
      if (v.strategy !== undefined && v.strategy !== 'direct' && v.weight > 0) {
        scores.set(v.strategy, (scores.get(v.strategy) ?? 0) + v.weight)
      }
    }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
    if (ranked.length > 0) {
      flipped = true
      from = 'direct'
      strategy = ranked[0][0]
      reason = '冲突消解：复杂度/计划建议直接答复，但任务明确需要工具——按「工具需求 > 复杂度」果断升级为 '
        + strategy
    }
  }

  // 消解规则 B：风险 > 复杂度。高风险任务即便复杂度不高，也要走带护栏的策略。
  if (!flipped && (ctx.analysis.risk === 'high' || ctx.analysis.risk === 'critical')
      && (winner === 'direct' || winner === 'single_tool') && supports('deep', 'risk')) {
    flipped = true
    from = winner
    strategy = 'deep'
    reason = `冲突消解：风险等级 ${ctx.analysis.risk} 高于复杂度判断，按「风险 > 复杂度」升级为 deep`
  }

  if (flipped) {
    // 被推翻策略的所有票一律压制（包括投给它的领域票——它站在了落选一边）。
    for (const v of votes) {
      if (v.strategy === from) overruled.add(v)
    }
  }

  // 压制规则 D：低优先级维度的落选票不参与置信度占比与冲突惩罚。
  const winnerVoters = tally.voters.get(strategy) ?? new Set<RuleTag>()
  const hasHighSupport = HIGH_PRIORITY_TAGS.some(tag => winnerVoters.has(tag))
  let suppressed = false
  if (hasHighSupport) {
    for (const v of votes) {
      if (!overruled.has(v) && LOW_PRIORITY_TAGS.includes(v.tag)
          && v.strategy !== undefined && v.strategy !== strategy) {
        overruled.add(v)
        suppressed = true
      }
    }
  }

  if (reason === null && suppressed) {
    const losingTags = [...new Set(
      votes.filter(v => overruled.has(v)).map(v => v.tag),
    )]
    const supportTags = [...winnerVoters].filter(tag => HIGH_PRIORITY_TAGS.includes(tag))
    reason = `冲突消解：${losingTags.map(tag => TAG_LABEL[tag]).join('、')}`
      + `与更高优先级的${supportTags.map(tag => TAG_LABEL[tag]).join('、')}信号结论不一致，已按优先级采纳 ${strategy}`
  }

  const bonus = flipped ? 0.08 : suppressed ? 0.04 : 0
  return { strategy, flipped, from, reason, overruled, bonus }
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
    ...expertRules(ctx),
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
  // 例外：小型任务（trivial/simple）的 iterative 若由专家规则/冲突消解明确落在
  // pro 轻内核，保持轻量路由不被重对齐（pro 与 super 在执行层同源）。
  const expectedKernel = STRATEGY_KERNEL[decision.strategy]
  const lightIterativeOnPro = decision.strategy === 'iterative'
    && (level === 'trivial' || level === 'simple')
    && decision.kernel === 'pro'
  if (decision.kernel !== expectedKernel && !lightIterativeOnPro && level !== 'expert' && risk !== 'critical') {
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

    // 3. 策略投票计分。
    const strategyTally = tallyVotes<RouteStrategy>(votes, 'strategy')

    // 4. 冲突消解：按「硬约束 > 自主目标 > 工具需求 > 风险 > 复杂度 > ...」阶梯
    //    果断裁决投票冲突，并压制低优先级维度的落选票（不拉低置信度）。
    const resolution = resolveConflicts(votes, strategyTally, ctx)
    const chosenStrategy = resolution.strategy

    // 5. 有效票计分：剔除被压制的落选票后，对策略与内核重新计分，
    //    让「主决策票占比」反映真正起作用的信号。
    const effVotes = resolution.overruled.size > 0
      ? votes.filter(v => !resolution.overruled.has(v))
      : votes
    const effTally = tallyVotes<RouteStrategy>(effVotes, 'strategy')
    const kernelTally = tallyVotes<KernelName>(effVotes, 'kernel')

    // 当内核票非常弱（几乎没有内核规则命中）时，直接采用策略映射。
    let chosenKernel = kernelTally.best
    if (kernelTally.total < 0.5) {
      chosenKernel = STRATEGY_KERNEL[chosenStrategy]
    }

    // 6. 合并规则补丁（含被压制票的补丁：预算宁多勿少，护栏宁开勿关）并计算覆盖参数。
    const patch = mergePatches(votes)
    const overrides = computeOverrides(ctx, chosenStrategy, patch)

    // 7. 应用硬约束（可能改写策略/内核/覆盖）。
    const decision = { strategy: chosenStrategy, kernel: chosenKernel, overrides }
    const constraintNotes = applyHardConstraints(decision, ctx)

    // 8. 置信度：主决策有效票占比 × 共识 − 冲突惩罚（衰减、封顶）+ 消解加成。
    const confidence = this.computeConfidence({
      effTally,
      analysis,
      decision,
      resolution,
      constraintCount: constraintNotes.length,
    })

    // 9. 汇总可解释理由（硬约束置顶 -> 消解说明 -> 结论摘要 -> 按决定性排序的支持理由）。
    const reasons = this.buildReasons(votes, constraintNotes, resolution, decision, effTally)

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

  /**
   * 置信度公式（v18.1）：
   *
   *   置信度 = 0.8 × 票面置信度 + 0.2 × 任务分析置信度
   *   票面置信度 = 主决策有效票占比 × 维度共识 − 冲突惩罚（衰减函数） + 消解加成 − 兜底修正
   *
   * 与旧版的关键差异：
   *  - 占比只统计「有效票」：被冲突消解压制的落选票不再稀释主决策占比；
   *  - 冲突惩罚经过衰减函数且封顶 0.3：多规则冲突时置信度不会跌到 15% 这种不可用值；
   *  - 消解加成：冲突由明确的优先级阶梯裁决，决策程序本身是确定的，应当体现果断；
   *  - 下限 0.35：路由可以承认不确定，但不能显得比随机猜还犹豫。
   */
  private computeConfidence(input: {
    effTally: Tally<RouteStrategy>
    analysis: TaskAnalysis
    decision: { strategy: RouteStrategy; kernel: KernelName }
    resolution: ConflictResolution
    constraintCount: number
  }): number {
    const { effTally, analysis, decision, resolution, constraintCount } = input

    // 主决策票权重占比：与最强对手的成对占比（被压制的票已剔除，全票支持时为 1）。
    const best = effTally.bestScore
    const runner = effTally.runnerScore
    const dominance = best + runner > 0 ? best / (best + runner) : 0.5

    // 共识加成：支持主决策的独立维度越多越可信。
    const bestVoters = effTally.voters.get(effTally.best) ?? new Set<RuleTag>()
    const consensus = clamp(0.68 + bestVoters.size * 0.08, 0.68, 1)

    let voteConfidence = dominance * consensus

    // 冲突惩罚（衰减函数）：只惩罚未被消解的真实分歧。指数衰减让惩罚随冲突增长
    // 快速饱和，封顶 CONFLICT_PENALTY_CAP——冲突多时也不会跌穿可用区间。
    const expectedKernel = STRATEGY_KERNEL[decision.strategy]
    // 小型任务（trivial/simple）的 iterative 停在 pro 轻内核是专家规则/消解的明确设计，
    // 不算策略-内核错配（pro 与 super 在执行层同源，见 superCore.selectRunner）。
    const lightIterativeOnPro = decision.strategy === 'iterative'
      && (analysis.complexity.level === 'trivial' || analysis.complexity.level === 'simple')
      && decision.kernel === 'pro'
    const kernelMismatch = decision.kernel === expectedKernel || lightIterativeOnPro
      ? 0
      : 0.12
    const rawPenalty = conflictPenalty(effTally) + kernelMismatch
    voteConfidence -= CONFLICT_PENALTY_CAP * (1 - Math.exp(-rawPenalty / CONFLICT_PENALTY_CAP))

    // 消解加成：flip 裁决 +0.08，压制落选票 +0.04。
    voteConfidence += resolution.bonus

    // 硬约束兜底与极高风险：诚实反映「这是兜底而非自然共识」。
    if (constraintCount > 0) voteConfidence -= 0.05
    if (analysis.risk === 'critical') voteConfidence -= 0.04

    // 分析本身置信度（领域识别越确定，路由越可信），权重低于票面信号。
    const analysisConfidence = unit(analysis.confidence)
    const confidence = voteConfidence * 0.8 + analysisConfidence * 0.2

    return clamp(confidence, MIN_ROUTE_CONFIDENCE, 1)
  }

  /* ── 理由汇总 ── */

  /**
   * 理由汇总（v18.1）：
   *  1. 硬约束说明置顶（最高决定性）；
   *  2. 冲突消解说明（确定性裁决）；
   *  3. 决策结论摘要；
   *  4. 支持理由：只保留支持最终决策的票，每个维度只留票重最高的一条
   *     （同类合并——修复 e2e 中出现两条「领域为 code」的问题），
   *     按决定性优先级排序（自主目标/工具需求 > 风险 > 领域 > 复杂度 > ...）；
   *  5. 总条数 ≤6，保证理由列表一眼能读完。
   */
  private buildReasons(
    votes: Vote[],
    constraintNotes: string[],
    resolution: ConflictResolution,
    decision: { strategy: RouteStrategy; kernel: KernelName },
    effTally: Tally<RouteStrategy>,
  ): string[] {
    const reasons: string[] = []

    // 1. 硬约束说明置顶。
    for (const note of constraintNotes) reasons.push(note)

    // 2. 冲突消解说明。
    if (resolution.reason) reasons.push(resolution.reason)

    // 3. 决策结论摘要。
    const dominancePct = effTally.bestScore + effTally.runnerScore > 0
      ? Math.round((effTally.bestScore / (effTally.bestScore + effTally.runnerScore)) * 100)
      : 100
    reasons.push(
      `最终决策：strategy=${decision.strategy}，kernel=${decision.kernel}`
      + `（主决策有效票占比 ${dominancePct}%）`,
    )

    // 4. 支持理由：按维度合并 + 决定性排序。
    const bestByTag = new Map<RuleTag, Vote>()
    for (const vote of votes) {
      if (resolution.overruled.has(vote)) continue
      if (vote.weight <= 0 || vote.reason.length === 0) continue
      if (vote.strategy !== undefined && vote.strategy !== decision.strategy) continue
      const current = bestByTag.get(vote.tag)
      if (!current || vote.weight > current.weight) bestByTag.set(vote.tag, vote)
    }
    const ordered = [...bestByTag.values()].sort((a, b) =>
      REASON_DIM_ORDER[a.tag] - REASON_DIM_ORDER[b.tag] || b.weight - a.weight)
    const seen = new Set<string>(reasons)
    for (const vote of ordered) {
      if (seen.has(vote.reason)) continue
      seen.add(vote.reason)
      reasons.push(vote.reason)
    }

    // 5. 总条数上限。
    return reasons.slice(0, 6)
  }
}

/** 工厂函数：创建一个默认路由器。 */
export function createKernelRouter(options?: { weightScale?: number }): KernelRouterImpl {
  return new KernelRouterImpl(options)
}

/** 默认导出的类，方便 `import KernelRouterImpl from ...`。 */
export default KernelRouterImpl
