/**
 * 模块 A / 复杂度评分器（Super Core v18.0.0）
 *
 * 职责：把 `TaskSignals` 快照映射成一个 0-100 的 `ComplexityScore`，
 * 供路由模块决定走 direct / single_tool / iterative / autonomous / deep。
 *
 * 五维度加权模型：
 *   ┌──────────┬────────┬──────────────────────────────────────────┐
 *   │ 维度      │ 权重   │ 核心信号                                 │
 *   ├──────────┼────────┼──────────────────────────────────────────┤
 *   │ length   │ 0.18   │ tokenEstimate / charLength               │
 *   │ domain   │ 0.25   │ hasCode/Data/Shell/FileOp + techStacks   │
 *   │ steps    │ 0.22   │ hasMultiStep/GoalLoop/Planning + 步骤标记│
 *   │ risk     │ 0.20   │ 高风险词加权 + 跨类别非线性叠加          │
 *   │ context  │ 0.15   │ historyTurns / attachment / 时间敏感/refs│
 *   └──────────┴────────┴──────────────────────────────────────────┘
 *   权重合计 = 1.00
 *
 * 设计要点：
 *   1. 每个维度都产出 0-100 的子分，再加权求和——保证可解释（reasons 数组
 *      会指出到底是哪几个维度把分数抬高了）。
 *   2. 非线性映射：
 *      - length 用对数曲线（token 翻倍带来的边际复杂度递减）；
 *      - steps 用指数饱和 1-e^(-k·x)（步骤越多越接近满分但永不溢出）；
 *      - risk 用「跨类别乘数」（删除+付费+系统级 远危险于三个删除）。
 *   3. 纯函数、无副作用，便于诊断面板复现。
 *
 * 依赖：类型只来自 `../types`；风险/步骤统计复用同模块 A 的 extractor
 *      （signals 与 analysis 同属本模块，extractor 不反向依赖 analysis，无环）。
 */

import type { TaskSignals, ComplexityScore, TaskComplexity, ComplexityScorer } from '../types'
import { analyzeRisk, countStepMarkers, type RiskAnalysis } from '../signals/extractor'

/* ═══════════════════════════════════════════════════════════════════════════
 * 一、评分配置（集中可调）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ScoringWeights {
  length: number
  domain: number
  steps: number
  risk: number
  context: number
}

/** 五维权重（合计 1.0）。导出便于测试断言与上层调参。 */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  length: 0.18,
  domain: 0.25,
  steps: 0.22,
  risk: 0.20,
  context: 0.15,
}

/** 等级阈值（下界，含）。从低到高排列。 */
export const LEVEL_THRESHOLDS: ReadonlyArray<{ min: number; level: TaskComplexity }> = [
  { min: 82, level: 'expert' },
  { min: 60, level: 'complex' },
  { min: 35, level: 'moderate' },
  { min: 15, level: 'simple' },
  { min: 0, level: 'trivial' },
]

/** 数值钳制到 [0, 100]。 */
function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** 四舍五入到整数。 */
function round(value: number): number {
  return Math.round(value)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 二、维度一：length（长度）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 长度子分：对数曲线 + 字符数微调。
 *
 * 公式：
 *   tokenPart = 100 * ln(1 + tokens) / ln(1 + 3000)     // 3000 token 视为满分
 *   charPart  = clamp(100 * chars / 12000)              // 12000 字符封顶
 *   score     = 0.85 * tokenPart + 0.15 * charPart
 *
 * 为什么是对数：从 50→100 token 的认知负担增长，远大于 2950→3000 token。
 * 用对数能避免长文本维度一家独大。
 */
export function scoreLength(signals: TaskSignals): number {
  const tokens = Math.max(0, signals.tokenEstimate || 0)
  const chars = Math.max(0, signals.charLength || 0)
  const tokenPart = (100 * Math.log(1 + tokens)) / Math.log(1 + 3000)
  const charPart = Math.min(100, (100 * chars) / 12000)
  return clamp100(0.85 * tokenPart + 0.15 * charPart)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 三、维度二：domain（领域广度 / 硬信号密度）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DomainDimensionResult {
  score: number
  /** 命中的硬信号名称（用于 reasons） */
  hits: string[]
}

/**
 * 领域子分：统计「硬信号」维度（代码/数据/shell/文件操作/研究）的活跃个数，
 * 再叠加技术栈数量。每个硬信号本质不同，同时出现意味着跨域协作，复杂度陡增。
 *
 * 打分：
 *   base = 每个硬信号 18 分（5 个全中 = 90）
 *   tech = min(techStacks.length, 5) * 4 分（最高 20）
 *   score = clamp(base + tech)
 */
export function scoreDomainDetailed(signals: TaskSignals): DomainDimensionResult {
  const hits: string[] = []
  if (signals.hasCode) hits.push('代码')
  if (signals.hasData) hits.push('数据')
  if (signals.hasShell) hits.push('命令行')
  if (signals.hasFileOp) hits.push('文件操作')
  if (signals.hasResearch) hits.push('调研')
  if (signals.hasCreative) hits.push('创作')

  const base = hits.length * 18
  const techCount = Array.isArray(signals.techStacks) ? signals.techStacks.length : 0
  const tech = Math.min(techCount, 5) * 4
  return { score: clamp100(base + tech), hits }
}

/** 领域子分（简洁版）。 */
export function scoreDomain(signals: TaskSignals): number {
  return scoreDomainDetailed(signals).score
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 四、维度三：steps（步骤 / 规划 / 自主闭环）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface StepsDimensionResult {
  score: number
  /** 估算的步骤标记数 */
  stepMarkers: number
  /** 命中的结构性标记（用于 reasons） */
  flags: string[]
}

/**
 * 步骤子分：指数饱和映射。
 *
 * 先算「结构强度」 x（无量纲）：
 *   x = 1.6·hasMultiStep + 1.4·hasGoalLoop + 1.2·hasPlanning + 0.8·hasVerification
 *       + 0.25·min(stepMarkers, 8)
 * 再映射到 0-100：
 *   score = 100 · (1 - e^(-0.42·x)) / (1 - e^(-0.42·6.6))
 *
 * 指数饱和保证：步骤数的边际贡献递减（第 1 个步骤最「值钱」，
 * 第 10 个步骤几乎不再涨分），符合人类对复杂度的感知。
 * 归一化分母取 x 的理论上限（1.6+1.4+1.2+0.8+0.25·8 = 10，但常见上限约 6.6），
 * 用 6.6 让强多步任务更容易逼近满分。
 */
export function scoreStepsDetailed(signals: TaskSignals): StepsDimensionResult {
  const stepMarkers = countStepMarkers(signals.rawText || '')
  const flags: string[] = []
  let x = 0
  if (signals.hasMultiStep) { x += 1.6; flags.push('多步骤') }
  if (signals.hasGoalLoop) { x += 1.4; flags.push('目标闭环') }
  if (signals.hasPlanning) { x += 1.2; flags.push('规划') }
  if (signals.hasVerification) { x += 0.8; flags.push('验证') }
  x += 0.25 * Math.min(stepMarkers, 8)
  if (stepMarkers > 0 && !signals.hasMultiStep) flags.push(`${stepMarkers} 个步骤标记`)

  const k = 0.42
  const normalize = 1 - Math.exp(-k * 6.6)
  const score = normalize > 0 ? (100 * (1 - Math.exp(-k * x))) / normalize : 0
  return { score: clamp100(score), stepMarkers, flags }
}

/** 步骤子分（简洁版）。 */
export function scoreSteps(signals: TaskSignals): number {
  return scoreStepsDetailed(signals).score
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 五、维度四：risk（风险，非线性加权）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface RiskDimensionResult {
  score: number
  analysis: RiskAnalysis
  /** 描述风险来源的短语（用于 reasons） */
  detail: string
}

/**
 * 风险子分：非线性 + 跨类别叠加。
 *
 * 关键：风险不是「几个高风险词相加」这么简单——
 *   删除（破坏性）+ 转账（资金）+ 生产环境（系统级）三者叠加，
 *   危险程度远大于「删除 + 删除 + 删除」。
 *
 * 公式：
 *   base = min(weighted, 12) * 6                  // 单类别强度封顶 72
 *   cross = (categories - 1) * 12                 // 每多一个类别额外 +12
 *   boolBoost = hasHighRisk ? 6 : 0
 *   score = clamp(base + cross + boolBoost)
 *
 * 其中 weighted 来自 extractor.analyzeRisk（已内置单类别权重与重复词上限）。
 */
export function scoreRiskDetailed(signals: TaskSignals, rawText?: string): RiskDimensionResult {
  const text = rawText ?? signals.rawText ?? ''
  const analysis = analyzeRisk(text)
  const base = Math.min(analysis.weighted, 12) * 6
  const cross = Math.max(0, analysis.categories.size - 1) * 12
  const boolBoost = signals.hasHighRisk ? 6 : 0
  const score = clamp100(base + cross + boolBoost)

  const categoryNames: Record<string, string> = {
    destructive: '破坏性',
    financial: '资金',
    external: '对外发送',
    system: '系统级',
    permission: '权限',
  }
  const names = [...analysis.categories].map((c) => categoryNames[c] || c)
  const detail = names.length > 0
    ? `高风险类别：${names.join('、')}（加权 ${analysis.weighted.toFixed(1)}）`
    : '无高风险操作'

  return { score, analysis, detail }
}

/** 风险子分（简洁版）。 */
export function scoreRisk(signals: TaskSignals, rawText?: string): number {
  return scoreRiskDetailed(signals, rawText).score
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 六、维度五：context（上下文负担）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ContextDimensionResult {
  score: number
  flags: string[]
}

/**
 * 上下文子分：历史轮次 + 附件 + 时间敏感 + 文件引用。
 *
 * 公式：
 *   history = min(turns, 20) * 2.2           // 20 轮封顶 44 分
 *   attach  = hasAttachment ? 12 : 0
 *   time    = isTimeSensitive ? 10 : 0
 *   refs    = min(fileRefs.length, 8) * 3    // 8 个引用封顶 24
 *   score = clamp(history + attach + time + refs)
 */
export function scoreContextDetailed(signals: TaskSignals): ContextDimensionResult {
  const flags: string[] = []
  const turns = Math.max(0, signals.historyTurns || 0)
  const history = Math.min(turns, 20) * 2.2
  if (turns > 3) flags.push(`${turns} 轮历史`)
  const attach = signals.hasAttachment ? 12 : 0
  if (signals.hasAttachment) flags.push('含附件')
  const time = signals.isTimeSensitive ? 10 : 0
  if (signals.isTimeSensitive) flags.push('时间敏感')
  const refs = Math.min(Array.isArray(signals.fileRefs) ? signals.fileRefs.length : 0, 8) * 3
  if (refs > 0) flags.push(`${signals.fileRefs.length} 个文件引用`)
  return { score: clamp100(history + attach + time + refs), flags }
}

/** 上下文子分（简洁版）。 */
export function scoreContext(signals: TaskSignals): number {
  return scoreContextDetailed(signals).score
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 七、等级判定
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 由 0-100 分数映射到等级。 */
export function levelFromScore(score: number): TaskComplexity {
  const safe = clamp100(score)
  for (const { min, level } of LEVEL_THRESHOLDS) {
    if (safe >= min) return level
  }
  return 'trivial'
}

/** 各等级的中文标签（供解释文本使用）。 */
export const LEVEL_LABELS: Record<TaskComplexity, string> = {
  trivial: '极简',
  simple: '简单',
  moderate: '中等',
  complex: '复杂',
  expert: '专家级',
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 八、理由生成
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DetailedDimensions {
  length: number
  domain: DomainDimensionResult
  steps: StepsDimensionResult
  risk: RiskDimensionResult
  context: ContextDimensionResult
}

/** 计算全部详细维度（score() 与 explainScore() 复用同一份数据，避免重复计算）。 */
export function computeDetailedDimensions(signals: TaskSignals, weights: ScoringWeights = DEFAULT_WEIGHTS): {
  dimensions: { length: number; domain: number; steps: number; risk: number; context: number }
  detailed: DetailedDimensions
  weighted: { length: number; domain: number; steps: number; risk: number; context: number }
  total: number
} {
  const length = scoreLength(signals)
  const domain = scoreDomainDetailed(signals)
  const steps = scoreStepsDetailed(signals)
  const risk = scoreRiskDetailed(signals)
  const context = scoreContextDetailed(signals)

  const weighted = {
    length: length * weights.length,
    domain: domain.score * weights.domain,
    steps: steps.score * weights.steps,
    risk: risk.score * weights.risk,
    context: context.score * weights.context,
  }
  const total = weighted.length + weighted.domain + weighted.steps + weighted.risk + weighted.context

  return {
    dimensions: { length: round(length), domain: round(domain.score), steps: round(steps.score), risk: round(risk.score), context: round(context.score) },
    detailed: { length, domain, steps, risk, context },
    weighted,
    total: clamp100(total),
  }
}

/**
 * 依据详细维度生成可解释理由数组（中文）。
 * 只列出真正「抬高分数」的维度（子分 >= 35 或权重贡献显著），
 * 让诊断面板一眼看出复杂度来自哪里。
 */
export function buildReasons(detailed: DetailedDimensions, weighted: ReturnType<typeof computeDetailedDimensions>['weighted']): string[] {
  const reasons: string[] = []

  if (detailed.length >= 40) {
    reasons.push(`文本较长：约 ${Math.round(detailed.length)}/100（长度权重贡献 ${weighted.length.toFixed(1)}）`)
  }
  if (detailed.domain.hits.length > 0) {
    reasons.push(`跨域硬信号 ${detailed.domain.hits.length} 项：${detailed.domain.hits.join('、')}`)
  }
  if (detailed.steps.flags.length > 0) {
    reasons.push(`结构化步骤：${detailed.steps.flags.join('、')}`)
  }
  if (detailed.risk.analysis.hits > 0) {
    reasons.push(detailed.risk.detail)
  }
  if (detailed.context.flags.length > 0) {
    reasons.push(`上下文负担：${detailed.context.flags.join('、')}`)
  }
  if (reasons.length === 0) {
    reasons.push('各维度信号均较弱，属直接答复型任务')
  }
  return reasons
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 九、ComplexityScorerImpl
 * ═══════════════════════════════════════════════════════════════════════════ */

export class ComplexityScorerImpl implements ComplexityScorer {
  constructor(private readonly weights: ScoringWeights = DEFAULT_WEIGHTS) {}

  score(signals: TaskSignals): ComplexityScore {
    const computed = computeDetailedDimensions(signals, this.weights)
    const score = round(computed.total)
    return {
      score,
      level: levelFromScore(score),
      dimensions: computed.dimensions,
      reasons: buildReasons(computed.detailed, computed.weighted),
    }
  }
}

/** 默认单例（无状态，可安全共享；偏好默认权重）。 */
export const DEFAULT_COMPLEXITY_SCORER = new ComplexityScorerImpl()

/** 便捷函数。 */
export function scoreComplexity(signals: TaskSignals): ComplexityScore {
  return DEFAULT_COMPLEXITY_SCORER.score(signals)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十、explainScore（人类可读解释）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 把一个 ComplexityScore 展开成一段人类可读的中文解释。
 * 输出形如：
 *   「综合复杂度 72/100（复杂）。各维度：长度 55、领域 90、步骤 78、风险 60、上下文 30。
 *    主要来源：跨域硬信号 3 项：代码、数据、命令行；结构化步骤：多步骤、目标闭环。」
 */
export function explainScore(score: ComplexityScore): string {
  const d = score.dimensions
  const label = LEVEL_LABELS[score.level] || score.level
  const header = `综合复杂度 ${score.score}/100（${label}）。`
  const dims = `各维度：长度 ${d.length}、领域 ${d.domain}、步骤 ${d.steps}、风险 ${d.risk}、上下文 ${d.context}。`
  const reasons = score.reasons.length > 0
    ? `主要来源：${score.reasons.join('；')}。`
    : '主要来源：无明显抬升项。'
  return `${header}${dims}${reasons}`
}

/** 仅由分数生成简短一句话（不依赖完整 score 对象，便于日志打印）。 */
export function explainScoreBrief(score: number): string {
  const level = levelFromScore(score)
  return `复杂度 ${round(clamp100(score))}/100 → ${LEVEL_LABELS[level]}（${level}）`
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十一、贡献度分解（可解释性的量化层）
 *
 * buildReasons 给出定性理由，本节给出定量贡献：每个维度对最终分数的
 * 「绝对贡献」与「相对占比」。这对路由阈值调参非常有用——如果某类任务
 * 总是被判 expert，可以看是不是 risk 维度贡献过大。
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DimensionContribution {
  dimension: keyof ScoringWeights
  /** 子分 0-100 */
  raw: number
  /** 权重 */
  weight: number
  /** 加权贡献（raw * weight） */
  contribution: number
  /** 占总分的百分比 0-100（总分为 0 时为 0） */
  percentage: number
}

export interface ContributionReport {
  total: number
  contributions: DimensionContribution[]
  /** 贡献最大的维度（主导因素） */
  dominant: keyof ScoringWeights
  /** 贡献最小的维度 */
  weakest: keyof ScoringWeights
}

/** 计算每个维度的贡献度分解。 */
export function analyzeContributions(
  signals: TaskSignals,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ContributionReport {
  const computed = computeDetailedDimensions(signals, weights)
  const total = computed.total
  const entries: DimensionContribution[] = (Object.keys(weights) as Array<keyof ScoringWeights>).map((key) => {
    const raw = computed.detailed[key] as number
    const weight = weights[key]
    const contribution = computed.weighted[key]
    return {
      dimension: key,
      raw,
      weight,
      contribution,
      percentage: total > 0 ? (contribution / total) * 100 : 0,
    }
  })
  const sortedByContribution = [...entries].sort((a, b) => b.contribution - a.contribution)
  return {
    total,
    contributions: entries,
    dominant: sortedByContribution[0].dimension,
    weakest: sortedByContribution[sortedByContribution.length - 1].dimension,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十二、灵敏度分析（阈值诊断）
 *
 * 回答「如果某个信号翻转，分数会变化多少」——用来发现「一票否决」式的
 * 脆弱规则。例如把 hasHighRisk 从 true 翻到 false，看 risk 维度掉多少分。
 * ═══════════════════════════════════════════════════════════════════════════ */

export type BooleanSignalField =
  | 'hasCode' | 'hasFileOp' | 'hasShell' | 'hasResearch' | 'hasCreative'
  | 'hasData' | 'hasMultiStep' | 'hasGoalLoop' | 'hasPlanning'
  | 'hasVerification' | 'hasAttachment' | 'isTimeSensitive' | 'hasHighRisk'

export interface SensitivityEntry {
  field: BooleanSignalField
  /** 翻转前的总分 */
  before: number
  /** 翻转后的总分 */
  after: number
  /** 变化量（after - before） */
  delta: number
}

/** 逐个翻转布尔信号，观察总分变化（按 |delta| 降序）。 */
export function analyzeSensitivity(
  signals: TaskSignals,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  fields: readonly BooleanSignalField[] = [
    'hasCode', 'hasFileOp', 'hasShell', 'hasResearch', 'hasData',
    'hasMultiStep', 'hasGoalLoop', 'hasPlanning', 'hasVerification',
    'isTimeSensitive', 'hasHighRisk',
  ],
): SensitivityEntry[] {
  const before = scoreWithWeights(signals, weights)
  const entries: SensitivityEntry[] = []
  for (const field of fields) {
    const flipped: TaskSignals = { ...signals, [field]: !signals[field] }
    const after = scoreWithWeights(flipped, weights)
    entries.push({ field, before, after, delta: after - before })
  }
  return entries.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

/** 用给定权重算总分（不构造完整 ComplexityScore，供灵敏度分析复用）。 */
export function scoreWithWeights(signals: TaskSignals, weights: ScoringWeights): number {
  return computeDetailedDimensions(signals, weights).total
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十三、分数稳定性检查（数值健壮性）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 校验一组信号产出的分数是否「数值健全」：
 *   - 所有维度在 0-100
 *   - 总分在 0-100
 *   - 各加权分项非负
 *   - 等级与分数一致
 * 返回问题列表（空数组表示健全）。可用于 CI 里对评分器做属性测试。
 */
export function validateScoreSanity(score: ComplexityScore): string[] {
  const problems: string[] = []
  const dims = score.dimensions
  for (const key of ['length', 'domain', 'steps', 'risk', 'context'] as const) {
    if (!Number.isFinite(dims[key]) || dims[key] < 0 || dims[key] > 100) {
      problems.push(`维度 ${key} 越界：${dims[key]}`)
    }
  }
  if (!Number.isFinite(score.score) || score.score < 0 || score.score > 100) {
    problems.push(`总分越界：${score.score}`)
  }
  if (score.level !== levelFromScore(score.score)) {
    problems.push(`等级与分数不一致：${score.score} → ${score.level}`)
  }
  if (score.reasons.length === 0) {
    problems.push('理由数组为空')
  }
  return problems
}

/** 批量校验（属性测试辅助）：对多组信号逐一检查健全性。 */
export function validateManySignals(signalsList: TaskSignals[]): string[] {
  const problems: string[] = []
  signalsList.forEach((signals, index) => {
    const score = scoreComplexity(signals)
    for (const problem of validateScoreSanity(score)) {
      problems.push(`#${index}: ${problem}`)
    }
  })
  return problems
}
