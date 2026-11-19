/**
 * 执行调度运行时（Execution Scheduler）——超级内核 D 模块之一。
 *
 * 职责：把 ExecutionPlan 的 levels 变成真正的执行时序——
 *   - 同一 level 内的步骤并行（可选并发上限）
 *   - 不同 level 之间串行（下一层等上一层全部完成）
 *   - 每步独立超时、全局总超时
 *   - 失败指数退避重试
 *   - 失败传播（fail-fast）或降级（degrade，填占位结果继续）
 *   - AbortSignal 中止（步骤间、重试等待中都能响应）
 *   - 通过 sink 发射进度事件（phase / metric / error）
 *   - 返回每步结果 Map + 成功标志
 *
 * 本模块是纯调度逻辑：executor 回调由调用方注入，不依赖任何真实工具/网络/DOM，
 * 因此完全可测试。所有时间相关能力都可注入 sleep 以加速测试。
 */

import type { ExecutionPlan, PlanStep, SuperEventSink } from '../types'

/* ════════════════════════════════════════════════════════════════════════════
 * 第 0 节：对外类型
 * ════════════════════════════════════════════════════════════════════════════ */

/** 步骤执行器：接收一个 PlanStep，返回该步骤的产物字符串。 */
export type StepExecutor = (step: PlanStep) => Promise<string>

/** 失败策略：propagate = 失败即停；degrade = 失败填占位结果并继续。 */
export type FailurePolicy = 'propagate' | 'degrade'

export interface SchedulerOptions {
  /** 单步超时（毫秒）。0 或省略表示不限制。 */
  stepTimeoutMs?: number
  /** 整次调度总超时（毫秒）。0 或省略表示不限制。 */
  globalTimeoutMs?: number
  /** 最大重试次数（不含首次），默认 0。 */
  maxRetries?: number
  /** 退避基数（毫秒），默认 50。 */
  retryBaseMs?: number
  /** 退避倍率，默认 2。 */
  retryMultiplier?: number
  /** 退避上限（毫秒），默认 2000。 */
  retryMaxDelayMs?: number
  /** 失败策略，默认 propagate。 */
  onFailure?: FailurePolicy
  /** 事件接收器（进度事件）。 */
  sink?: SuperEventSink
  /** 中止信号。 */
  signal?: AbortSignal
  /** 并发上限（同一 level 内），默认不限制。 */
  maxConcurrency?: number
  /** 降级时的占位结果生成器；默认返回空串。 */
  degradeResult?: (step: PlanStep, err: Error) => string
  /** 可注入的休眠函数（测试加速用）。默认 setTimeout。 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 是否发射进度事件（默认 true）。 */
  emitProgress?: boolean
}

/** 单步执行记录（诊断用）。 */
export interface StepRecord {
  stepId: string
  attempts: number
  durationMs: number
  ok: boolean
  degraded: boolean
  aborted: boolean
  timedOut: boolean
  error?: string
}

/** 调度结果。 */
export interface SchedulerResult {
  /** 步骤 id → 产物字符串（含降级占位结果）。 */
  results: Map<string, string>
  /** 是否整体成功：无失败、无中止、无超时、无降级。 */
  success: boolean
  /** 失败（且未降级）的步骤 id。 */
  failed: string[]
  /** 降级处理的步骤 id。 */
  degraded: string[]
  /** 因中止/超时而未能完成的步骤 id。 */
  skipped: string[]
  /** 是否中止。 */
  aborted: boolean
  /** 是否全局超时。 */
  timedOut: boolean
  /** 每步尝试次数。 */
  attempts: Map<string, number>
  /** 每步执行记录。 */
  records: Map<string, StepRecord>
  /** 总耗时毫秒。 */
  durationMs: number
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 1 节：底层工具（超时 / 中止 / 休眠 / 指数退避）
 * ════════════════════════════════════════════════════════════════════════════ */

/** 构造一个带名字的 AbortError（便于测试断言）。 */
function makeAbortError(): Error {
  const e = new Error('调度已中止')
  e.name = 'AbortError'
  return e
}

/** 给 Promise 加超时；ms<=0 时直接返回原 Promise。 */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return p
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * 让 Promise 可被 AbortSignal 打断：signal 触发时立即 reject，
 * 并清理监听（避免长时间运行时的监听器泄漏）。
 */
function raceWithAbort<T>(p: Promise<T>, signal: AbortSignal, reason: () => Error): Promise<T> {
  if (signal.aborted) return Promise.reject(reason())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reason())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

/** 默认休眠（可被 AbortSignal 打断）。 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(makeAbortError()); return }
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(makeAbortError()) }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 指数退避延迟：base * multiplier^(attempt-1)，封顶 maxDelay。导出供测试。 */
export function backoffDelay(
  attempt: number,
  base: number,
  multiplier: number,
  maxDelay: number,
): number {
  const raw = base * Math.pow(Math.max(1, multiplier), Math.max(0, attempt - 1))
  return Math.min(maxDelay, Math.max(0, Math.floor(raw)))
}

/**
 * 有限并发 map：按 chunk 分批执行，保证最多 limit 个 Promise 同时存在。
 * 保持结果与输入同序。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length
  if (n === 0) return []
  const cap = Math.max(1, Math.floor(limit > 0 ? limit : n))
  const out = new Array<R>(n)
  let next = 0
  // 启动 min(cap, n) 个 worker，各自从共享游标取任务。
  const workers = Array.from({ length: Math.min(cap, n) }, async () => {
    while (true) {
      const i = next++
      if (i >= n) break
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 2 节：计划规范化
 *
 * levels 是调度依据，但为了鲁棒性做三件事：
 *   1. 去重、过滤空串
 *   2. steps 里出现但 levels 里没出现的步骤，追加到最后一层（不丢步骤）
 *   3. 若某步的依赖与 plan.levels 不一致，则把它的"有效层级"下移到
 *      max(所在层, 所有依赖的最大层 + 1)，保证依赖一定先于自己执行。
 * 这样既尊重规划器给出的 levels，又不会因不一致的计划造成依赖倒挂。
 * ════════════════════════════════════════════════════════════════════════════ */

interface NormalizedPlan {
  /** 每一层的步骤对象（已过滤无效 id）。 */
  groups: PlanStep[][]
  /** 计划里引用了但 steps 中不存在的 id（记为错误步骤）。 */
  missing: string[]
}

function normalizePlan(plan: ExecutionPlan): NormalizedPlan {
  const byId = new Map<string, PlanStep>()
  for (const s of plan.steps || []) {
    if (s && typeof s.id === 'string' && s.id && !byId.has(s.id)) byId.set(s.id, s)
  }

  // 规范化 levels：去重、去空、去未知 id。
  const seen = new Set<string>()
  const rawLevels: string[][] = []
  const missing: string[] = []
  for (const level of plan.levels || []) {
    const clean: string[] = []
    for (const id of level || []) {
      if (typeof id !== 'string' || !id || seen.has(id)) continue
      if (!byId.has(id)) { if (!missing.includes(id)) missing.push(id); continue }
      seen.add(id)
      clean.push(id)
    }
    if (clean.length > 0) rawLevels.push(clean)
  }

  // 未出现在 levels 里的 steps，追加到最后一层。
  const orphans = (plan.steps || []).filter((s) => s && s.id && !seen.has(s.id)).map((s) => s.id)
  if (orphans.length > 0) {
    if (rawLevels.length === 0) rawLevels.push([])
    rawLevels[rawLevels.length - 1].push(...orphans)
    for (const id of orphans) seen.add(id)
  }

  // 计算每步所在层，再按依赖下移，得到有效层。
  const baseLevel = new Map<string, number>()
  rawLevels.forEach((ids, li) => ids.forEach((id) => baseLevel.set(id, li)))

  const effectiveLevel = new Map<string, number>()
  // 依赖图可能有环，做有限次松弛（最多 steps.length 轮）即可稳定或发现环。
  const maxRounds = Math.max(1, byId.size)
  for (let round = 0; round < maxRounds; round++) {
    let changed = false
    for (const s of byId.values()) {
      const own = baseLevel.get(s.id) ?? 0
      let eff = Math.max(effectiveLevel.get(s.id) ?? own, own)
      for (const dep of s.dependsOn || []) {
        if (!byId.has(dep)) continue
        const depEff = effectiveLevel.get(dep) ?? (baseLevel.get(dep) ?? 0)
        if (depEff >= eff) eff = depEff + 1
      }
      if (eff !== effectiveLevel.get(s.id)) { effectiveLevel.set(s.id, eff); changed = true }
    }
    if (!changed) break
  }

  // 按有效层重新分组（可能出现空层，过滤掉）。
  const levelCount = Math.max(0, ...Array.from(effectiveLevel.values()).map((v) => v + 1))
  const groups: PlanStep[][] = []
  for (let li = 0; li < levelCount; li++) {
    const g = Array.from(byId.values())
      .filter((s) => (effectiveLevel.get(s.id) ?? 0) === li)
    if (g.length > 0) groups.push(g)
  }

  return { groups, missing }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 3 节：ExecutionScheduler
 * ════════════════════════════════════════════════════════════════════════════ */

export class ExecutionScheduler {
  private readonly stepTimeoutMs: number
  private readonly globalTimeoutMs: number
  private readonly maxRetries: number
  private readonly retryBaseMs: number
  private readonly retryMultiplier: number
  private readonly retryMaxDelayMs: number
  private readonly policy: FailurePolicy
  private readonly sink?: SuperEventSink
  private readonly externalSignal?: AbortSignal
  private readonly maxConcurrency: number
  private readonly degradeResult: (step: PlanStep, err: Error) => string
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly emitProgress: boolean

  constructor(private readonly executor: StepExecutor, opts: SchedulerOptions = {}) {
    this.stepTimeoutMs = Math.max(0, opts.stepTimeoutMs ?? 0)
    this.globalTimeoutMs = Math.max(0, opts.globalTimeoutMs ?? 0)
    this.maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 0))
    this.retryBaseMs = Math.max(0, opts.retryBaseMs ?? 50)
    this.retryMultiplier = Math.max(1, opts.retryMultiplier ?? 2)
    this.retryMaxDelayMs = Math.max(0, opts.retryMaxDelayMs ?? 2000)
    this.policy = opts.onFailure || 'propagate'
    this.sink = opts.sink
    this.externalSignal = opts.signal
    // 未指定并发上限时不限制（同层全并行）；指定 0 也视为不限制。
    const requested = opts.maxConcurrency ?? 0
    this.maxConcurrency = requested > 0 ? Math.max(1, Math.floor(requested)) : Number.POSITIVE_INFINITY
    this.degradeResult = opts.degradeResult || (() => '')
    this.sleep = opts.sleep || defaultSleep
    this.emitProgress = opts.emitProgress !== false
  }

  /** 发射进度事件（phase / metric / error），失败静默不影响调度。 */
  private emitPhase(phase: string, detail?: string): void {
    if (!this.sink || !this.emitProgress) return
    try { this.sink.emit({ type: 'phase', phase, detail }) } catch { /* 观测失败不影响执行 */ }
  }

  private emitMetric(name: string, value: number, tags?: Record<string, string>): void {
    if (!this.sink || !this.emitProgress) return
    try { this.sink.emit({ type: 'metric', name, value, tags }) } catch { /* 忽略 */ }
  }

  private emitError(error: string, recoverable: boolean): void {
    if (!this.sink || !this.emitProgress) return
    try { this.sink.emit({ type: 'error', error, recoverable }) } catch { /* 忽略 */ }
  }

  /**
   * 执行主入口。
   */
  async run(plan: ExecutionPlan): Promise<SchedulerResult> {
    const startedAt = Date.now()
    const results = new Map<string, string>()
    const attempts = new Map<string, number>()
    const records = new Map<string, StepRecord>()
    const failed: string[] = []
    const degraded: string[] = []
    const skipped: string[] = []

    // ── 内部中止控制器：合并外部 signal 与全局超时。
    const controller = new AbortController()
    let aborted = false
    let timedOut = false
    const onExternalAbort = () => { aborted = true; controller.abort() }
    if (this.externalSignal) {
      if (this.externalSignal.aborted) { aborted = true; controller.abort() }
      else this.externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
    let globalTimer: ReturnType<typeof setTimeout> | undefined
    if (this.globalTimeoutMs > 0) {
      globalTimer = setTimeout(() => {
        timedOut = true
        aborted = true
        controller.abort()
      }, this.globalTimeoutMs)
    }

    const isStopped = () => aborted || controller.signal.aborted
    const stopError = (): Error => timedOut
      ? new Error(`全局超时（${this.globalTimeoutMs}ms）`)
      : makeAbortError()

    this.emitPhase('scheduler.start', `${plan.steps?.length || 0} 步 / ${plan.levels?.length || 0} 层`)

    try {
      const norm = normalizePlan(plan)
      // 引用了不存在的步骤 id：直接记为失败（不需要执行器）。
      for (const id of norm.missing) {
        const err = new Error(`步骤 ${id} 在执行计划中出现但缺少定义`)
        if (this.policy === 'degrade') {
          const placeholder = this.degradeResult({ id, title: id, description: '', dependsOn: [], tools: [], expectedOutput: '', parallelizable: false, estimatedDifficulty: 0 } as PlanStep, err)
          results.set(id, placeholder)
          degraded.push(id)
          this.emitPhase('step.degrade', `${id}: ${err.message}`)
        } else {
          failed.push(id)
          this.emitError(err.message, false)
        }
        attempts.set(id, 0)
      }
      if (norm.missing.length > 0 && this.policy === 'propagate') {
        // fail-fast：直接结束。
        skipped.push(...norm.groups.flat().map((s) => s.id))
        return this.finish({ results, attempts, records, failed, degraded, skipped, aborted, timedOut, startedAt, plan })
      }

      let stopScheduling = false

      for (let li = 0; li < norm.groups.length; li++) {
        if (isStopped() || stopScheduling) {
          for (const s of norm.groups.slice(li).flat()) skipped.push(s.id)
          break
        }
        const group = norm.groups[li]
        this.emitPhase('level.start', `第 ${li + 1} 层（${group.length} 步）`)
        const levelStart = Date.now()

        // 同层并行（受并发上限约束）。每步返回一条 StepOutcome。
        const outcomes = await mapWithConcurrency(group, this.maxConcurrency, async (step) => {
          if (isStopped() || stopScheduling) {
            return { step, ok: false, value: '', error: stopError(), aborted: true, timedOut, degraded: false, attempts: 0, durationMs: 0 }
          }
          return this.runStep(step, controller.signal, isStopped, stopError)
        })

        for (const o of outcomes) {
          attempts.set(o.step.id, o.attempts)
          records.set(o.step.id, {
            stepId: o.step.id,
            attempts: o.attempts,
            durationMs: o.durationMs,
            ok: o.ok,
            degraded: o.degraded,
            aborted: o.aborted,
            timedOut: o.timedOut,
            error: o.error?.message,
          })
          if (o.ok) {
            results.set(o.step.id, o.value)
            this.emitPhase('step.done', `${o.step.id}（${o.attempts} 次尝试）`)
          } else if (o.degraded) {
            results.set(o.step.id, o.value)
            degraded.push(o.step.id)
            this.emitPhase('step.degrade', `${o.step.id}: ${o.error?.message || '失败'}`)
          } else if (o.aborted) {
            skipped.push(o.step.id)
            this.emitPhase('step.skipped', `${o.step.id}: ${o.error?.message || '中止'}`)
          } else {
            failed.push(o.step.id)
            this.emitError(`步骤 ${o.step.id} 失败：${o.error?.message || '未知错误'}`, true)
          }
        }

        this.emitMetric('scheduler.level', Date.now() - levelStart, { level: String(li + 1) })
        this.emitPhase('level.end', `第 ${li + 1} 层完成`)

        // 失败传播：本层出现未降级失败/中止，则不再启动后续层。
        const hardFailure = outcomes.some((o) => !o.ok && !o.degraded)
        if (hardFailure && this.policy === 'propagate') {
          stopScheduling = true
        }
      }

      // 还有未涉及的步骤（理论上 normalizePlan 已覆盖）也记入 skipped。
      const allIds = new Set(plan.steps?.map((s) => s.id) || [])
      for (const id of allIds) {
        if (!results.has(id) && !failed.includes(id) && !degraded.includes(id) && !skipped.includes(id)) {
          skipped.push(id)
        }
      }

      return this.finish({ results, attempts, records, failed, degraded, skipped, aborted, timedOut, startedAt, plan })
    } finally {
      // 清理全局定时器与外部监听，避免测试/长进程悬挂。
      if (globalTimer) clearTimeout(globalTimer)
      if (this.externalSignal) this.externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  /** 统一收尾：计算 success、发射完成事件、组装结果。 */
  private finish(args: {
    results: Map<string, string>
    attempts: Map<string, number>
    records: Map<string, StepRecord>
    failed: string[]
    degraded: string[]
    skipped: string[]
    aborted: boolean
    timedOut: boolean
    startedAt: number
    plan: ExecutionPlan
  }): SchedulerResult {
    const { results, attempts, records, failed, degraded, skipped, aborted, timedOut, startedAt, plan } = args
    const success = !aborted && !timedOut && failed.length === 0 && degraded.length === 0 && skipped.length === 0
    const durationMs = Date.now() - startedAt
    this.emitMetric('scheduler.success', success ? 1 : 0)
    this.emitMetric('scheduler.duration', durationMs)
    this.emitPhase('scheduler.done', `成功=${success} 失败=${failed.length} 降级=${degraded.length} 跳过=${skipped.length} 中止=${aborted} 超时=${timedOut}`)
    void plan
    return { results, success, failed, degraded, skipped, aborted, timedOut, attempts, records, durationMs }
  }

  /** 执行单步（含重试、单步超时、中止响应），返回结构化结果。 */
  private async runStep(
    step: PlanStep,
    signal: AbortSignal,
    isStopped: () => boolean,
    stopError: () => Error,
  ): Promise<{
    step: PlanStep
    ok: boolean
    value: string
    error?: Error
    aborted: boolean
    timedOut: boolean
    degraded: boolean
    attempts: number
    durationMs: number
  }> {
    const t0 = Date.now()
    let attempt = 0
    const maxAttempts = this.maxRetries + 1

    while (attempt < maxAttempts) {
      if (isStopped()) {
        return { step, ok: false, value: '', error: stopError(), aborted: true, timedOut: false, degraded: false, attempts: attempt, durationMs: Date.now() - t0 }
      }
      attempt++
      this.emitPhase(attempt === 1 ? 'step.start' : 'step.retry', `${step.id}#${attempt}`)

      try {
        // 单步 Promise：注入的 executor + 单步超时 + 中止打断（三重保护）。
        const p = Promise.resolve().then(() => this.executor(step))
        const timed = withTimeout(p, this.stepTimeoutMs, `步骤 ${step.id} 执行超时（${this.stepTimeoutMs}ms）`)
        const value = await raceWithAbort<string>(timed, signal, stopError)
        return { step, ok: true, value, aborted: false, timedOut: false, degraded: false, attempts: attempt, durationMs: Date.now() - t0 }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        // 识别单步超时：withTimeout 抛出的错误消息带"执行超时"标记。
        const stepTimedOut = error.message.includes('执行超时')
        // 中止/全局超时：立即结束，不重试。
        if (isStopped()) {
          const timedOutFlag = stepTimedOut || error.message.includes('全局超时')
          return { step, ok: false, value: '', error, aborted: true, timedOut: timedOutFlag, degraded: false, attempts: attempt, durationMs: Date.now() - t0 }
        }
        // 还有重试机会：退避后继续。
        if (attempt < maxAttempts) {
          const delay = backoffDelay(attempt, this.retryBaseMs, this.retryMultiplier, this.retryMaxDelayMs)
          this.emitPhase('step.backoff', `${step.id} 第 ${attempt} 次失败，${delay}ms 后重试`)
          try {
            await raceWithAbort(this.sleep(delay, signal), signal, stopError)
          } catch (sleepErr) {
            const e = sleepErr instanceof Error ? sleepErr : new Error(String(sleepErr))
            return { step, ok: false, value: '', error: e, aborted: true, timedOut: false, degraded: false, attempts: attempt, durationMs: Date.now() - t0 }
          }
          continue
        }

        // 重试耗尽：按失败策略处理。
        if (this.policy === 'degrade') {
          const placeholder = this.degradeResult(step, error)
          return { step, ok: false, value: placeholder, error, aborted: false, timedOut: stepTimedOut, degraded: true, attempts: attempt, durationMs: Date.now() - t0 }
        }
        return { step, ok: false, value: '', error, aborted: false, timedOut: stepTimedOut, degraded: false, attempts: attempt, durationMs: Date.now() - t0 }
      }
    }
    // 理论上不可达（循环条件保证），兜底。
    return { step, ok: false, value: '', error: new Error('步骤执行未产生结果'), aborted: false, timedOut: false, degraded: false, attempts: attempt, durationMs: Date.now() - t0 }
  }

  /**
   * 执行前对计划做静态校验：缺失定义、自依赖、未知依赖、层级缺口、重复 id。
   * 不抛错，返回问题清单（供调用方决定是否拒绝执行计划）。
   */
  validatePlan(plan: ExecutionPlan): string[] {
    const issues: string[] = []
    const byId = new Map<string, PlanStep>()
    for (const s of plan.steps || []) {
      if (!s || typeof s.id !== 'string' || !s.id) { issues.push('存在无 id 或 id 非字符串的计划步骤'); continue }
      if (byId.has(s.id)) issues.push(`步骤 id 重复：${s.id}`)
      else byId.set(s.id, s)
    }
    for (const s of byId.values()) {
      if ((s.dependsOn || []).includes(s.id)) issues.push(`步骤 ${s.id} 自我依赖`)
      for (const dep of s.dependsOn || []) {
        if (!byId.has(dep)) issues.push(`步骤 ${s.id} 依赖未定义步骤 ${dep}`)
      }
    }
    const levelIds = new Set<string>()
    for (const level of plan.levels || []) {
      for (const id of level || []) {
        if (!byId.has(id)) issues.push(`层级引用了未定义步骤 ${id}`)
        if (levelIds.has(id)) issues.push(`步骤 ${id} 在 levels 中重复出现`)
        levelIds.add(id)
      }
    }
    for (const id of byId.keys()) {
      if (!levelIds.has(id)) issues.push(`步骤 ${id} 未分配到任何层级（调度器会追加到最后一层）`)
    }
    return issues
  }

  /**
   * 干跑（dry-run）：只做校验与层级规范化，不调用 executor，返回将要执行的分层顺序。
   * 便于 UI 预览"哪些步骤会并行"。
   */
  dryRun(plan: ExecutionPlan): { levels: string[][]; issues: string[]; totalSteps: number } {
    const norm = normalizePlan(plan)
    return {
      levels: norm.groups.map((g) => g.map((s) => s.id)),
      issues: this.validatePlan(plan),
      totalSteps: (plan.steps || []).length,
    }
  }
}

/** 从调度结果生成人可读的进度摘要（诊断面板/日志）。 */
export function formatSchedulerResult(result: SchedulerResult): string {
  const lines: string[] = []
  lines.push(
    `调度${result.success ? '成功' : '未完成'}：${result.results.size} 步完成，`
    + `${result.failed.length} 失败，${result.degraded.length} 降级，${result.skipped.length} 跳过，`
    + `耗时 ${result.durationMs}ms${result.aborted ? '（已中止）' : ''}${result.timedOut ? '（全局超时）' : ''}`,
  )
  if (result.failed.length) lines.push('失败步骤：' + result.failed.join('，'))
  if (result.degraded.length) lines.push('降级步骤：' + result.degraded.join('，'))
  if (result.skipped.length) lines.push('跳过步骤：' + result.skipped.join('，'))
  const retried = Array.from(result.attempts.entries()).filter(([, n]) => n > 1)
  if (retried.length) {
    lines.push('发生重试：' + retried.map(([id, n]) => `${id}(${n}次)`).join('，'))
  }
  return lines.join('\n')
}

/** 工厂函数。 */
export function createScheduler(executor: StepExecutor, opts?: SchedulerOptions): ExecutionScheduler {
  return new ExecutionScheduler(executor, opts)
}
