/**
 * 模块 C - 自适应学习引擎（AdaptationEngine）
 *
 * 职责：记录每次任务的真实结果（TaskOutcome），基于历史成功率对路由决策做
 * 数据驱动的调整，并对外导出可持久化的统计快照。
 *
 * 设计要点：
 *  1. 环形缓冲：只保留最近 N 条结果（默认 512），超限时覆盖最旧的，避免内存
 *     无界增长。同时维护聚合计数，使 stats/adjust 不必每次扫描全量。
 *  2. 衰减因子：近期样本权重高，远期样本按指数衰减（默认半衰期 100 条）。
 *     调整决策时用的是「加权成功率」而非朴素的 成功数/总数。
 *  3. 最小样本阈值：(strategy, domain) 组合样本数不足时不调整，防止小样本噪声
 *     把路由带偏。阈值可按配置调整，默认 5。
 *  4. adjust 的三种动作：
 *     - 若首选策略在该领域表现差，而有替代策略显著更好 -> 替换策略（并同步内核、
 *       调整置信度、写入理由）。
 *     - 若整体表现好但置信度偏低 -> 上调置信度。
 *     - 若历史上有失败且带工具错误 -> 加强护栏/验证覆盖。
 *  5. 序列化：提供 serialize()/deserialize() 与 PersistenceHook 接口，可挂
 *     localStorage / 文件系统等，但本模块不直接依赖 DOM 或 Node API。
 *  6. 统计聚合：按策略成功率、平均轮次、按领域分布、最近失败原因等。
 *
 * 本文件只依赖 ../types，不 import 其它 super 模块。
 */

import type {
  AdaptationEngine,
  RouteDecision,
  RouteStrategy,
  TaskAnalysis,
  TaskDomain,
  TaskOutcome,
  RiskLevel,
} from '../types'

/* ─────────────────────────────────────────────────────────────────────────────
 * 配置与持久化接口
 * ───────────────────────────────────────────────────────────────────────────── */

/** 自适应引擎配置。 */
export interface AdaptationOptions {
  /** 环形缓冲上限（保留最近多少条结果），默认 512 */
  capacity?: number
  /** 最小样本阈值：组合样本少于该值时不调整，默认 5 */
  minSamples?: number
  /** 衰减系数 0-1：越接近 1 远期样本权重越高，默认 0.99（半衰期约 69 条） */
  decay?: number
  /**
   * 策略替换的显著性阈值：替代策略加权成功率需高出当前
   * 至少这么多才触发替换，默认 0.12。
   */
  switchThreshold?: number
  /** 调整置信度时的最大增量，默认 0.15 */
  maxConfidenceDelta?: number
}

/** 持久化钩子：由外部注入存储实现，本模块不依赖 localStorage / fs。 */
export interface PersistenceHook {
  /** 读取序列化字符串；不存在时返回 null */
  load(): string | null | Promise<string | null>
  /** 写入序列化字符串 */
  save(data: string): void | Promise<void>
}

/** 单条记录的轻量快照（用于序列化，去除运行时的分析对象细节以保持紧凑）。 */
interface OutcomeSnapshot {
  strategy: RouteStrategy
  kernel: RouteDecision['kernel']
  domain: TaskDomain
  risk: RiskLevel
  success: boolean
  rounds: number
  durationMs: number
  toolErrors: number
  userSatisfied?: boolean
  timestamp: number
  confidence: number
}

/** 序列化格式版本，便于未来兼容升级。 */
const SERIALIZE_VERSION = 1

/* ─────────────────────────────────────────────────────────────────────────────
 * 聚合计数结构
 * ───────────────────────────────────────────────────────────────────────────── */

interface AggregateBucket {
  count: number
  successes: number
  /** 用户满意度计数（有 userSatisfied 字段的样本才累加） */
  satisfiedCount: number
  satisfiedTotal: number
  roundsSum: number
  durationSum: number
  toolErrorsSum: number
  /** 衰减加权成功和 */
  weightedSuccess: number
  /** 衰减加权样本数 */
  weightedTotal: number
}

function newBucket(): AggregateBucket {
  return {
    count: 0,
    successes: 0,
    satisfiedCount: 0,
    satisfiedTotal: 0,
    roundsSum: 0,
    durationSum: 0,
    toolErrorsSum: 0,
    weightedSuccess: 0,
    weightedTotal: 0,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 辅助函数
 * ───────────────────────────────────────────────────────────────────────────── */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function keyFor(strategy: RouteStrategy, domain: TaskDomain): string {
  return `${strategy}::${domain}`
}

// 反序列化历史统计时按 key 还原（当前由 deserialize 内联处理，保留工具函数备用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseKey(key: string): { strategy: RouteStrategy; domain: TaskDomain } | null {
  const idx = key.indexOf('::')
  if (idx < 0) return null
  return {
    strategy: key.slice(0, idx) as RouteStrategy,
    domain: key.slice(idx + 2) as TaskDomain,
  }
}

/** 各策略 -> 对应内核（adjust 替换策略时同步更新内核）。 */
const STRATEGY_KERNEL: Record<RouteStrategy, RouteDecision['kernel']> = {
  direct: 'pro',
  single_tool: 'pro',
  iterative: 'super',
  autonomous: 'auto',
  deep: 'ultra',
}

/** 所有策略的列表，便于遍历找最佳替代。 */
const ALL_STRATEGIES: RouteStrategy[] = [
  'direct', 'single_tool', 'iterative', 'autonomous', 'deep',
]

/* ─────────────────────────────────────────────────────────────────────────────
 * 主体实现
 * ───────────────────────────────────────────────────────────────────────────── */

export class AdaptationEngineImpl implements AdaptationEngine {
  /** 配置 */
  private readonly capacity: number
  private readonly minSamples: number
  private readonly decay: number
  private readonly switchThreshold: number
  private readonly maxConfidenceDelta: number

  /** 环形缓冲 */
  private buffer: OutcomeSnapshot[]
  /** 环形缓冲写指针（下一个写入位置） */
  private writeIndex = 0
  /** 已写入总数（可能大于 capacity） */
  private totalWritten = 0

  /** 聚合桶：按 (strategy, domain) 组合 */
  private byPair = new Map<string, AggregateBucket>()
  /** 聚合桶：按 strategy */
  private byStrategy = new Map<RouteStrategy, AggregateBucket>()
  /** 聚合桶：按 domain */
  private byDomain = new Map<TaskDomain, AggregateBucket>()
  /** 全局聚合桶 */
  private globalBucket = newBucket()

  /** 最近失败原因（保留最近 20 条） */
  private recentFailures: Array<{
    strategy: RouteStrategy
    domain: TaskDomain
    reason: string
    timestamp: number
  }> = []

  /** 持久化钩子（可选） */
  private persistenceHook: PersistenceHook | null = null
  /** 是否启用自动持久化（record 后自动 save） */
  private autoSave = false

  constructor(options: AdaptationOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? 512))
    this.minSamples = Math.max(1, Math.floor(options.minSamples ?? 5))
    this.decay = clamp(options.decay ?? 0.99, 0.5, 1)
    this.switchThreshold = clamp(options.switchThreshold ?? 0.12, 0, 1)
    this.maxConfidenceDelta = clamp(options.maxConfidenceDelta ?? 0.15, 0, 1)
    this.buffer = new Array<OutcomeSnapshot>(this.capacity)
  }

  /* ── 持久化钩子 ── */

  /** 挂载持久化钩子；若 loadImmediately 为真则立即尝试加载历史数据。 */
  attachPersistence(hook: PersistenceHook, loadImmediately = true): void {
    this.persistenceHook = hook
    if (loadImmediately) {
      // load 可能是异步的，这里用 Promise.resolve 统一处理，调用方不必 await。
      void Promise.resolve(hook.load())
        .then(data => {
          if (typeof data === 'string') this.deserialize(data)
        })
        .catch(() => {
          // 存储不可用不影响核心功能，静默忽略。
        })
    }
  }

  /** 设置是否在每次 record 后自动持久化。 */
  setAutoSave(enabled: boolean): void {
    this.autoSave = enabled
  }

  /* ── 记录 ── */

  /**
   * 记录一次任务结果。契约接口方法。
   */
  record(outcome: TaskOutcome): void {
    const snapshot = this.toSnapshot(outcome)

    // 环形缓冲写入。
    this.buffer[this.writeIndex] = snapshot
    this.writeIndex = (this.writeIndex + 1) % this.capacity
    this.totalWritten += 1

    // 聚合更新（增量维护，无需扫描全量）。
    this.updateAggregates(snapshot)

    // 失败原因提取。
    if (!outcome.success || (outcome.toolErrors ?? 0) > 0) {
      this.recordFailure(snapshot)
    }

    // 自动持久化。
    if (this.autoSave && this.persistenceHook) {
      void Promise.resolve(this.persistenceHook.save(this.serialize())).catch(() => {})
    }
  }

  /** 把 TaskOutcome 压缩成轻量快照。 */
  private toSnapshot(outcome: TaskOutcome): OutcomeSnapshot {
    return {
      strategy: outcome.decision.strategy,
      kernel: outcome.decision.kernel,
      domain: outcome.analysis.domain,
      risk: outcome.analysis.risk,
      success: outcome.success === true,
      rounds: Math.max(0, outcome.rounds ?? 0),
      durationMs: Math.max(0, outcome.durationMs ?? 0),
      toolErrors: Math.max(0, outcome.toolErrors ?? 0),
      userSatisfied: outcome.userSatisfied,
      timestamp: Number.isFinite(outcome.timestamp) ? outcome.timestamp : Date.now(),
      confidence: clamp(outcome.decision.confidence ?? 0, 0, 1),
    }
  }

  /** 增量更新所有聚合桶。 */
  private updateAggregates(s: OutcomeSnapshot): void {
    const successValue = s.success ? 1 : 0

    // 衰减：每来一条新样本，先把所有桶的历史加权值老化一次。
    // 这样老样本的权重会随后续样本数指数下降，而最新样本权重恒为 1，
    // 等价于 weight_i = decay^(N-1-i)，近期样本自然获得更高权重。
    const age = (bucket: AggregateBucket): void => {
      bucket.weightedSuccess *= this.decay
      bucket.weightedTotal *= this.decay
    }
    for (const bucket of this.byPair.values()) age(bucket)
    for (const bucket of this.byStrategy.values()) age(bucket)
    for (const bucket of this.byDomain.values()) age(bucket)
    age(this.globalBucket)

    const apply = (bucket: AggregateBucket): void => {
      bucket.count += 1
      bucket.successes += successValue
      bucket.roundsSum += s.rounds
      bucket.durationSum += s.durationMs
      bucket.toolErrorsSum += s.toolErrors
      // 新样本权重为 1。
      bucket.weightedSuccess += successValue
      bucket.weightedTotal += 1
      if (s.userSatisfied !== undefined) {
        bucket.satisfiedTotal += 1
        if (s.userSatisfied) bucket.satisfiedCount += 1
      }
    }

    const pk = keyFor(s.strategy, s.domain)
    let pairBucket = this.byPair.get(pk)
    if (!pairBucket) {
      pairBucket = newBucket()
      this.byPair.set(pk, pairBucket)
    }
    apply(pairBucket)

    let strategyBucket = this.byStrategy.get(s.strategy)
    if (!strategyBucket) {
      strategyBucket = newBucket()
      this.byStrategy.set(s.strategy, strategyBucket)
    }
    apply(strategyBucket)

    let domainBucket = this.byDomain.get(s.domain)
    if (!domainBucket) {
      domainBucket = newBucket()
      this.byDomain.set(s.domain, domainBucket)
    }
    apply(domainBucket)

    apply(this.globalBucket)
  }

  /** 记录失败原因（用于 stats 的 recentFailureReasons）。 */
  private recordFailure(s: OutcomeSnapshot): void {
    let reason: string
    if (!s.success && s.toolErrors > 0) {
      reason = `工具调用出错 ${s.toolErrors} 次，任务失败`
    } else if (!s.success) {
      reason = '任务执行失败（未达成目标）'
    } else {
      reason = `任务成功但出现 ${s.toolErrors} 次工具错误`
    }
    this.recentFailures.push({
      strategy: s.strategy,
      domain: s.domain,
      reason,
      timestamp: s.timestamp,
    })
    if (this.recentFailures.length > 20) {
      this.recentFailures = this.recentFailures.slice(-20)
    }
  }

  /* ── 调整决策 ── */

  /**
   * 基于历史成功率调整路由决策。契约接口方法。
   *
   * 调整依据优先级：
   *  1. (strategy, domain) 组合的加权成功率与其他策略在同领域的表现对比。
   *  2. 样本不足（< minSamples）时不调整，原样返回。
   *  3. 表现差时尝试替换策略；表现好时适度上调置信度。
   *  4. 历史工具错误多时加强护栏/验证。
   */
  adjust(base: RouteDecision, analysis: TaskAnalysis): RouteDecision {
    const domain = analysis.domain
    const current = base.strategy

    const currentBucket = this.byPair.get(keyFor(current, domain))
    // 最小样本阈值：当前组合样本不足，不动。
    if (!currentBucket || currentBucket.count < this.minSamples) {
      return { ...base }
    }

    const currentRate = this.weightedRate(currentBucket)

    // 在当前领域寻找样本充足、且显著优于当前策略的替代策略。
    let bestStrategy: RouteStrategy | null = null
    let bestRate = currentRate + this.switchThreshold
    for (const candidate of ALL_STRATEGIES) {
      if (candidate === current) continue
      const bucket = this.byPair.get(keyFor(candidate, domain))
      if (!bucket || bucket.count < this.minSamples) continue
      const rate = this.weightedRate(bucket)
      if (rate > bestRate) {
        bestRate = rate
        bestStrategy = candidate
      }
    }

    const reasons = [...base.reasons]
    let strategy = current
    let kernel = base.kernel
    let confidence = base.confidence
    const overrides = { ...base.overrides }

    if (bestStrategy !== null) {
      strategy = bestStrategy
      kernel = STRATEGY_KERNEL[bestStrategy]
      reasons.push(
        `自适应调整：策略「${current}」在领域「${domain}」的加权成功率为 ` +
        `${round(currentRate)}（${currentBucket.count} 样本），` +
        `而「${bestStrategy}」达 ${round(bestRate)}，` +
        `超过显著性阈值 ${this.switchThreshold}，故替换策略`,
      )
      // 替换后置信度反而要谨慎：这说明原决策有问题，下调而非上调。
      confidence = clamp(confidence - this.maxConfidenceDelta * 0.5, 0.05, 1)
    } else {
      // 无需替换：根据当前策略的成功率小幅调整置信度。
      const delta = this.confidenceDelta(currentRate)
      confidence = clamp(confidence + delta, 0.05, 1)
      if (Math.abs(delta) > 0.01) {
        reasons.push(
          `自适应调整：策略「${current}」在领域「${domain}」的加权成功率 ` +
          `${round(currentRate)}（${currentBucket.count} 样本），` +
          `置信度${delta > 0 ? '上调' : '下调'} ${round(Math.abs(delta))}`,
        )
      }
    }

    // 历史工具错误率高 -> 加强护栏/验证（不动策略）。
    const errorRate = currentBucket.toolErrorsSum / Math.max(1, currentBucket.count)
    if (errorRate >= 0.5) {
      overrides.enableGuardrails = true
      overrides.enableVerification = true
      reasons.push(
        `自适应调整：策略「${current}」在领域「${domain}」的历史平均工具错误数 ` +
        `${round(errorRate, 2)} 偏高，强制开启护栏与验证`,
      )
    }

    // 高风险任务：自适应不得关闭护栏。
    if (analysis.risk === 'critical' || analysis.risk === 'high') {
      overrides.enableGuardrails = true
    }

    return {
      strategy,
      kernel,
      confidence: round(clamp(confidence, 0.05, 1), 3),
      reasons,
      overrides,
    }
  }

  /** 计算加权成功率。 */
  private weightedRate(bucket: AggregateBucket): number {
    if (bucket.weightedTotal <= 0) return 0
    return bucket.weightedSuccess / bucket.weightedTotal
  }

  /** 计算置信度调整量：成功率越偏离 0.5，调整幅度越大。 */
  private confidenceDelta(rate: number): number {
    // rate=0.5 不调整；rate 越高越上调，越低越下调。
    const normalized = (rate - 0.5) * 2 // -1 ~ 1
    return round(clamp(normalized, -1, 1) * this.maxConfidenceDelta, 4)
  }

  /* ── 统计聚合 ── */

  /**
   * 导出学到的统计。契约接口方法。
   * 返回结构：
   * {
   *   totalOutcomes, windowSize, minSamples, decay,
   *   overall: { successRate, avgRounds, avgDurationMs, avgToolErrors },
   *   byStrategy: Record<strategy, { count, successRate, avgRounds, ... }>,
   *   byDomain: Record<domain, { count, successRate, ... }>,
   *   byPair: Record<'strategy::domain', { count, successRate, weightedSuccessRate }>,
   *   domainDistribution: Record<domain, number>,
   *   recentFailureReasons: string[],
   *   recentOutcomes: OutcomeSnapshot[]
   * }
   */
  stats(): Record<string, unknown> {
    const overall = this.describeBucket(this.globalBucket)

    const byStrategy: Record<string, unknown> = {}
    for (const [strategy, bucket] of this.byStrategy) {
      byStrategy[strategy] = this.describeBucket(bucket)
    }

    const byDomain: Record<string, unknown> = {}
    const domainDistribution: Record<string, number> = {}
    for (const [domain, bucket] of this.byDomain) {
      byDomain[domain] = this.describeBucket(bucket)
      domainDistribution[domain] = bucket.count
    }

    const byPair: Record<string, unknown> = {}
    for (const [key, bucket] of this.byPair) {
      byPair[key] = {
        ...this.describeBucket(bucket),
        weightedSuccessRate: round(this.weightedRate(bucket), 4),
      }
    }

    return {
      totalOutcomes: this.totalWritten,
      windowSize: this.activeCount(),
      minSamples: this.minSamples,
      decay: this.decay,
      switchThreshold: this.switchThreshold,
      overall,
      byStrategy,
      byDomain,
      byPair,
      domainDistribution,
      recentFailureReasons: this.recentFailures
        .slice(-10)
        .reverse()
        .map(f => `[${f.strategy}/${f.domain}] ${f.reason}`),
      recentOutcomes: this.activeSnapshots().slice(-20),
    }
  }

  /** 把聚合桶转成可读统计对象。 */
  private describeBucket(bucket: AggregateBucket): Record<string, unknown> {
    const count = Math.max(1, bucket.count)
    return {
      count: bucket.count,
      successRate: round(bucket.successes / count, 4),
      weightedSuccessRate: round(this.weightedRate(bucket), 4),
      avgRounds: round(bucket.roundsSum / count, 2),
      avgDurationMs: round(bucket.durationSum / count, 1),
      avgToolErrors: round(bucket.toolErrorsSum / count, 2),
      satisfactionRate: bucket.satisfiedTotal > 0
        ? round(bucket.satisfiedCount / bucket.satisfiedTotal, 4)
        : null,
    }
  }

  /** 当前环形缓冲中的有效记录数。 */
  private activeCount(): number {
    return Math.min(this.totalWritten, this.capacity)
  }

  /** 按时间顺序返回环形缓冲中的有效快照。 */
  private activeSnapshots(): OutcomeSnapshot[] {
    const n = this.activeCount()
    const result: OutcomeSnapshot[] = []
    // 最旧记录的起始位置。
    const start = this.totalWritten <= this.capacity
      ? 0
      : this.writeIndex
    for (let i = 0; i < n; i++) {
      const snap = this.buffer[(start + i) % this.capacity]
      if (snap) result.push(snap)
    }
    return result
  }

  /* ── 序列化 / 反序列化 ── */

  /**
   * 序列化为 JSON 字符串（可存入 localStorage / 文件）。
   * 只保存环形缓冲中的有效快照，加载时重放即可重建聚合。
   */
  serialize(): string {
    const payload = {
      version: SERIALIZE_VERSION,
      config: {
        capacity: this.capacity,
        minSamples: this.minSamples,
        decay: this.decay,
        switchThreshold: this.switchThreshold,
        maxConfidenceDelta: this.maxConfidenceDelta,
      },
      outcomes: this.activeSnapshots(),
    }
    return JSON.stringify(payload)
  }

  /**
   * 从 JSON 字符串恢复。配置沿用当前实例（payload 中的 config 仅作参考），
   * 数据通过重放 record 的等价逻辑重建。
   */
  deserialize(data: string): void {
    let payload: {
      version?: number
      outcomes?: OutcomeSnapshot[]
    }
    try {
      payload = JSON.parse(data)
    } catch {
      return // 数据损坏，保持现状。
    }
    if (!payload || payload.version !== SERIALIZE_VERSION) return
    if (!Array.isArray(payload.outcomes)) return

    // 清空当前状态。
    this.buffer = new Array<OutcomeSnapshot>(this.capacity)
    this.writeIndex = 0
    this.totalWritten = 0
    this.byPair.clear()
    this.byStrategy.clear()
    this.byDomain.clear()
    this.globalBucket = newBucket()
    this.recentFailures = []

    for (const snap of payload.outcomes) {
      if (!snap || typeof snap.strategy !== 'string' || typeof snap.domain !== 'string') continue
      // 直接写入并提供必要默认值。
      const normalized: OutcomeSnapshot = {
        strategy: snap.strategy,
        kernel: snap.kernel ?? STRATEGY_KERNEL[snap.strategy] ?? 'pro',
        domain: snap.domain,
        risk: snap.risk ?? 'low',
        success: snap.success === true,
        rounds: snap.rounds ?? 0,
        durationMs: snap.durationMs ?? 0,
        toolErrors: snap.toolErrors ?? 0,
        userSatisfied: snap.userSatisfied,
        timestamp: snap.timestamp ?? Date.now(),
        confidence: snap.confidence ?? 0,
      }
      this.buffer[this.writeIndex] = normalized
      this.writeIndex = (this.writeIndex + 1) % this.capacity
      this.totalWritten += 1
      this.updateAggregates(normalized)
      if (!normalized.success || normalized.toolErrors > 0) {
        this.recordFailure(normalized)
      }
    }
  }

  /** 重置所有学习状态。 */
  reset(): void {
    this.buffer = new Array<OutcomeSnapshot>(this.capacity)
    this.writeIndex = 0
    this.totalWritten = 0
    this.byPair.clear()
    this.byStrategy.clear()
    this.byDomain.clear()
    this.globalBucket = newBucket()
    this.recentFailures = []
  }
}

/** 工厂函数：创建一个自适应学习引擎。 */
export function createAdaptationEngine(options?: AdaptationOptions): AdaptationEngineImpl {
  return new AdaptationEngineImpl(options)
}

/** 默认导出的类。 */
export default AdaptationEngineImpl
