/**
 * 事件可观测性（Observability）——超级内核 D 模块之一。
 *
 * 提供三样东西：
 *   1. SuperEventSinkImpl —— 实现 SuperEventSink.emit，做事件分发：
 *        - 按 type 精确订阅（on(type, handler)）
 *        - 全局订阅（onAny）
 *        - 一次性订阅（once）
 *        - 历史事件环形缓冲（容量上限，超出覆盖最旧）
 *        - 计数统计（每种 type 发过多少）
 *        - 异常隔离：某个 handler 抛错不影响其它 handler 与后续 emit
 *   2. SuperEventCollector —— 便捷收集器：内部持有一个 sink，汇总事件并提供
 *        byType / first / last / find / clear / summary 等诊断接口；也可直接当 sink 用。
 *   3. formatEvent(event) —— 把结构化事件转成人可读的一行/多行文本，
 *        exportSummary(events) 导出阶段时间线摘要。
 *
 * 设计约束：
 *   - 事件类型全部来自 types.ts 的 SuperEvent 联合，零模块间 import。
 *   - 同步分发（emit 立即调用 handler），保证调度器等模块的进度事件时序可预测。
 *   - 环形缓冲用固定数组 + 写指针实现，O(1) 写入、不扩容，适合长时间运行的内核。
 */

import type { SuperEvent, SuperEventSink, GuardrailResult } from '../types'

/* ════════════════════════════════════════════════════════════════════════════
 * 第 0 节：事件类型工具
 * ════════════════════════════════════════════════════════════════════════════ */

/** 从 SuperEvent 联合中提取 type 字面量集合的类型。 */
export type SuperEventType = SuperEvent['type']

/** 所有合法事件类型（运行期校验/诊断用）。 */
export const SUPER_EVENT_TYPES: SuperEventType[] = [
  'phase', 'analysis', 'plan', 'route', 'model', 'metric', 'guardrail', 'error',
]

/** 事件 handler 签名。第二个参数携带序号，便于诊断事件顺序。 */
export type SuperEventHandler = (event: SuperEvent, index: number) => void

/** 取消订阅函数。 */
export type Unsubscriber = () => void

/** 判断一个值是否是合法的 SuperEvent（轻量结构校验，不深度检查嵌套对象）。 */
export function isSuperEvent(value: unknown): value is SuperEvent {
  if (!value || typeof value !== 'object') return false
  const type = (value as Record<string, unknown>).type
  return typeof type === 'string' && (SUPER_EVENT_TYPES as string[]).includes(type)
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 1 节：环形缓冲（RingBuffer）
 *
 * 固定容量数组，head 指向下一个写入位置，size 为当前元素数。
 * toArray() 按写入顺序（最旧→最新）返回快照，不暴露内部数组。
 * ════════════════════════════════════════════════════════════════════════════ */

export class RingBuffer<T> {
  private readonly buf: Array<T | undefined>
  private head = 0
  private size = 0

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('RingBuffer capacity 必须是正整数')
    }
    this.buf = new Array<T | undefined>(capacity)
  }

  push(item: T): void {
    this.buf[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) this.size += 1
  }

  get length(): number {
    return this.size
  }

  /** 按写入顺序返回快照。 */
  toArray(): T[] {
    const out: T[] = []
    for (let k = 0; k < this.size; k++) {
      const idx = (this.head - this.size + k + this.capacity) % this.capacity
      const v = this.buf[idx]
      if (v !== undefined) out.push(v)
    }
    return out
  }

  /** 最后一个元素（最新）。 */
  last(): T | undefined {
    if (this.size === 0) return undefined
    const idx = (this.head - 1 + this.capacity) % this.capacity
    return this.buf[idx]
  }

  clear(): void {
    this.buf.fill(undefined)
    this.head = 0
    this.size = 0
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 2 节：SuperEventSinkImpl
 * ════════════════════════════════════════════════════════════════════════════ */

export interface EventSinkOptions {
  /** 历史事件环形缓冲容量，默认 200。 */
  historyCapacity?: number
  /** handler 抛错时是否打印到 console.warn，默认 false（静默隔离）。 */
  logHandlerErrors?: boolean
  /** 自定义错误回调（handler 抛错时调用）。 */
  onHandlerError?: (err: unknown, event: SuperEvent) => void
  /** 前置拦截器：返回 false 可丢弃事件（如采样/过滤）。 */
  filter?: (event: SuperEvent) => boolean
  /** 事件预处理钩子：可在分发前改写事件（如打时间戳）。 */
  transform?: (event: SuperEvent) => SuperEvent
}

/**
 * SuperEventSink 的实现。
 *
 * 订阅模型：
 *   on(type, handler)  —— 订阅某类事件（type 为 'any' 表示全部）
 *   onAny(handler)     —— 等价于 on('any', handler)
 *   once(type, handler)—— 命中一次后自动取消
 *   均返回取消订阅函数。
 *
 * emit 流程：filter → transform → 写入环形缓冲 → 计数 → 同步分发（type 订阅 + any 订阅）。
 * 任何 handler 抛错都被隔离，不影响其它订阅者。
 */
export class SuperEventSinkImpl implements SuperEventSink {
  private readonly typed = new Map<SuperEventType | 'any', Set<SuperEventHandler>>()
  private readonly counts = new Map<SuperEventType, number>()
  private readonly history: RingBuffer<SuperEvent>
  private readonly opts: EventSinkOptions
  private totalEmitted = 0

  constructor(opts: EventSinkOptions = {}) {
    this.opts = opts
    this.history = new RingBuffer<SuperEvent>(Math.max(1, Math.floor(opts.historyCapacity ?? 200)))
  }

  /** 分发一个事件。 */
  emit(event: SuperEvent): void {
    if (!isSuperEvent(event)) {
      // 结构不合法：仍尝试分发给 any 订阅者，便于诊断异常事件。
      if (this.opts.logHandlerErrors) console.warn('[SuperEventSink] 收到非法事件：', event)
    }
    let finalEvent = event
    if (this.opts.filter && !this.opts.filter(finalEvent)) return
    if (this.opts.transform) finalEvent = this.opts.transform(finalEvent)

    const index = this.totalEmitted++
    this.history.push(finalEvent)
    if (isSuperEvent(finalEvent)) {
      this.counts.set(finalEvent.type, (this.counts.get(finalEvent.type) || 0) + 1)
    }

    // 分发：先 type 订阅，再 any 订阅（者保证两类订阅者都收到）。
    const dispatch = (handlers: Set<SuperEventHandler> | undefined) => {
      if (!handlers) return
      // 复制一份，避免 handler 在回调里增删订阅导致迭代异常。
      for (const h of Array.from(handlers)) {
        try {
          h(finalEvent, index)
        } catch (err) {
          if (this.opts.onHandlerError) this.opts.onHandlerError(err, finalEvent)
          else if (this.opts.logHandlerErrors) console.warn('[SuperEventSink] handler 抛错：', err)
        }
      }
    }

    if (isSuperEvent(finalEvent)) dispatch(this.typed.get(finalEvent.type))
    dispatch(this.typed.get('any'))
  }

  /** 订阅某类事件；type 传 'any' 表示订阅全部。返回取消订阅函数。 */
  on(type: SuperEventType | 'any', handler: SuperEventHandler): Unsubscriber {
    let set = this.typed.get(type)
    if (!set) { set = new Set(); this.typed.set(type, set) }
    set.add(handler)
    return () => { set!.delete(handler) }
  }

  /** 订阅全部事件（语法糖）。 */
  onAny(handler: SuperEventHandler): Unsubscriber {
    return this.on('any', handler)
  }

  /** 一次性订阅：命中一次后自动取消。 */
  once(type: SuperEventType | 'any', handler: SuperEventHandler): Unsubscriber {
    let unsub: Unsubscriber = () => {}
    const wrapped: SuperEventHandler = (event, index) => {
      unsub()
      handler(event, index)
    }
    unsub = this.on(type, wrapped)
    return unsub
  }

  /** 清空所有订阅。 */
  clearHandlers(): void {
    this.typed.clear()
  }

  /** 历史事件快照（最旧→最新）。 */
  getHistory(): SuperEvent[] {
    return this.history.toArray()
  }

  /** 最近 n 条事件（默认全部历史）。 */
  getRecent(n: number): SuperEvent[] {
    const all = this.history.toArray()
    if (n <= 0) return []
    return all.slice(-Math.min(n, all.length))
  }

  /** 某类事件已分发次数。 */
  countOf(type: SuperEventType): number {
    return this.counts.get(type) || 0
  }

  /** 累计分发总数（含非法事件）。 */
  get total(): number {
    return this.totalEmitted
  }

  /** 清空历史与计数（不影响订阅）。 */
  reset(): void {
    this.history.clear()
    this.counts.clear()
    this.totalEmitted = 0
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 3 节：SuperEventCollector
 *
 * 一个"自带 sink 的诊断收集器"：既能直接当 SuperEventSink 传给编排器，
 * 又能像数组一样查询事件。内部复用 SuperEventSinkImpl 的订阅/缓冲能力。
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * 事件收集器。典型用法：
 *   const collector = new SuperEventCollector()
 *   await runSuperCore({ sink: collector, ... })
 *   console.log(collector.summary())
 */
export class SuperEventCollector implements SuperEventSink {
  private readonly sink: SuperEventSinkImpl

  constructor(opts: EventSinkOptions = {}) {
    this.sink = new SuperEventSinkImpl(opts)
  }

  /** 作为 sink 使用。 */
  emit(event: SuperEvent): void {
    this.sink.emit(event)
  }

  /** 暴露内部 sink（需要 on/once 等高级订阅时）。 */
  get inner(): SuperEventSinkImpl {
    return this.sink
  }

  /** 订阅某类事件（代理到内部 sink）。 */
  on(type: SuperEventType | 'any', handler: SuperEventHandler): Unsubscriber {
    return this.sink.on(type, handler)
  }

  /** 全部事件（最旧→最新）。 */
  all(): SuperEvent[] {
    return this.sink.getHistory()
  }

  /** 按类型筛选。 */
  byType<T extends SuperEventType>(type: T): Extract<SuperEvent, { type: T }>[] {
    return this.sink.getHistory().filter((e): e is Extract<SuperEvent, { type: T }> => e.type === type)
  }

  /** 首个/最后一个事件。 */
  first(): SuperEvent | undefined {
    const a = this.all()
    return a.length > 0 ? a[0] : undefined
  }

  last(): SuperEvent | undefined {
    return this.sink.getRecent(1)[0]
  }

  /** 按谓词查找第一个匹配事件。 */
  find(predicate: (event: SuperEvent) => boolean): SuperEvent | undefined {
    return this.all().find(predicate)
  }

  /** 事件数量。 */
  get size(): number {
    return this.sink.getHistory().length
  }

  /** 清空收集的事件。 */
  clear(): void {
    this.sink.reset()
  }

  /** 统计摘要：各类型数量。 */
  counts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const t of SUPER_EVENT_TYPES) {
      const n = this.sink.countOf(t)
      if (n > 0) out[t] = n
    }
    return out
  }

  /** 人类可读摘要（阶段序列 + 计数 + 错误数）。 */
  summary(): string {
    const lines: string[] = []
    const events = this.all()
    lines.push(`事件总数：${events.length}`)
    const phases = events.filter((e) => e.type === 'phase')
    if (phases.length > 0) {
      lines.push('阶段时间线：' + phases.map((e) => (e as Extract<SuperEvent, { type: 'phase' }>).phase).join(' → '))
    }
    const counts = this.counts()
    const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`)
    lines.push('分类计数：' + (parts.length ? parts.join('，') : '无'))
    const errors = events.filter((e) => e.type === 'error') as Array<Extract<SuperEvent, { type: 'error' }>>
    lines.push(`错误数：${errors.length}${errors.length ? '（' + errors.map((e) => e.error).join('；') + '）' : ''}`)
    return lines.join('\n')
  }

  /** 阶段名序列（按发生顺序）。 */
  phases(): string[] {
    return this.byType('phase').map((e) => e.phase)
  }

  /** 聚合同名 metric：返回 name → {count, sum, min, max, last}。 */
  metrics(): Record<string, { count: number; sum: number; min: number; max: number; last: number }> {
    const out: Record<string, { count: number; sum: number; min: number; max: number; last: number }> = {}
    for (const e of this.byType('metric')) {
      const cur = out[e.name] || { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, last: 0 }
      cur.count += 1
      cur.sum += e.value
      cur.min = Math.min(cur.min, e.value)
      cur.max = Math.max(cur.max, e.value)
      cur.last = e.value
      out[e.name] = cur
    }
    return out
  }

  /** 是否发生过某阶段。 */
  hasPhase(phase: string): boolean {
    return this.byType('phase').some((e) => e.phase === phase)
  }

  /** 所有可恢复/致命错误。 */
  errors(recoverable?: boolean): Array<Extract<SuperEvent, { type: 'error' }>> {
    const all = this.byType('error')
    return recoverable === undefined ? all : all.filter((e) => e.recoverable === recoverable)
  }

  /** 按谓词统计匹配数量。 */
  countWhere(predicate: (event: SuperEvent) => boolean): number {
    return this.all().filter(predicate).length
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 4 节：事件格式化
 *
 * formatEvent —— 单事件转可读文本
 * formatEvents —— 多事件逐行（带序号）
 * exportSummary —— 导出人可读的时间线摘要（给诊断面板/日志）
 * ════════════════════════════════════════════════════════════════════════════ */

/** 把 GuardrailResult 转简短文本。 */
function formatGuardrail(r: GuardrailResult): string {
  const sev = r.severity ? `[${r.severity}]` : ''
  return `${sev}${r.allowed ? '放行' : '拒绝'}${r.reason ? '：' + r.reason : ''}`
}

/** 截断长文本，避免单行过长。 */
function short(s: unknown, max = 80): string {
  const t = String(s ?? '')
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** 把 JSON 对象压成单行（用于 tags 等）。 */
function inlineJson(obj: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(obj)
    return s.length > 160 ? s.slice(0, 160) + '…' : s
  } catch {
    return String(obj)
  }
}

/** 单个事件转人可读文本。 */
export function formatEvent(event: SuperEvent): string {
  switch (event.type) {
    case 'phase':
      return `[phase] ${event.phase}${event.detail ? ' — ' + short(event.detail) : ''}`
    case 'analysis': {
      const a = event.analysis
      return `[analysis] 领域=${a.domain} 复杂度=${a.complexity.level}(${a.complexity.score}) 风险=${a.risk} 意图=${short(a.intent, 40)}`
    }
    case 'plan': {
      const p = event.plan
      return `[plan] ${short(p.goal, 50)} — ${p.steps.length} 步 / ${p.levels.length} 层 / 关键路径 ${p.criticalPath.length} 步`
    }
    case 'route': {
      const d = event.decision
      return `[route] ${d.strategy}/${d.kernel} 置信度=${Math.round(d.confidence * 100)}%${d.reasons.length ? ' — ' + short(d.reasons.join('；'), 80) : ''}`
    }
    case 'model': {
      const c = event.choice
      return `[model] ${c.model.name}(${c.model.id}) 评分=${c.score.toFixed(1)} 成本档=${c.model.costTier}`
    }
    case 'metric':
      return `[metric] ${event.name}=${event.value}${event.tags ? ' ' + inlineJson(event.tags) : ''}`
    case 'guardrail':
      return `[guardrail] ${formatGuardrail(event.result)}`
    case 'error':
      return `[error] ${event.recoverable ? '可恢复' : '致命'} — ${short(event.error, 120)}`
    default:
      // 理论上到不了这里（联合类型穷尽），留兜底保证未来扩展不崩。
      return `[event] ${inlineJson(event as unknown as Record<string, unknown>)}`
  }
}

/** 多个事件逐行格式化（带 1-based 序号）。 */
export function formatEvents(events: SuperEvent[]): string {
  return events.map((e, i) => `${String(i + 1).padStart(3, ' ')}. ${formatEvent(e)}`).join('\n')
}

/** 导出摘要：总览 + 阶段时间线 + 完整事件行。 */
export function exportSummary(events: SuperEvent[]): string {
  if (events.length === 0) return '（无事件）'
  const lines: string[] = []
  lines.push(`Super Core 事件摘要（共 ${events.length} 条）`)
  const phases = events.filter((e) => e.type === 'phase') as Array<Extract<SuperEvent, { type: 'phase' }>>
  if (phases.length > 0) {
    lines.push('阶段：' + phases.map((p) => p.phase).join(' → '))
  }
  const errors = events.filter((e) => e.type === 'error') as Array<Extract<SuperEvent, { type: 'error' }>>
  if (errors.length > 0) {
    lines.push('错误：' + errors.map((e) => e.error).join('；'))
  }
  lines.push('────────────────────────────')
  lines.push(formatEvents(events))
  return lines.join('\n')
}
