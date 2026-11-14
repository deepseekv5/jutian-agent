/**
 * JT Core Ultra / toolScheduler —— 移植 gemini-cli scheduler/ 全套：
 *   types.ts + state-manager.ts + scheduler.ts + tool-executor.ts + policy.ts + confirmation-bus/
 * 七态 FSM、受控跃迁、并发校验、全就绪屏障、阻塞态让出、确认总线、策略引擎。
 * 零依赖 TypeScript 再实现（Apache-2.0）。
 */
import { canTransition, TERMINAL_STATES, type ToolState, type ScheduledCall, type ToolOutcome, type UltraToolCall } from './types'

/** ── state-manager.ts：受控状态机，守卫跃迁与附属数据校验 ── */
export class ToolCallStateMachine {
  state: ToolState = 'validating'
  data: Record<string, unknown> = {}
  private log: { from: ToolState; to: ToolState; at: number }[] = []
  transition(to: ToolState, data?: Record<string, unknown>): void {
    if (!canTransition(this.state, to)) throw new Error(`非法工具状态跃迁: ${this.state} → ${to}`)
    if (to === 'executing' && data?.liveOutput === undefined) throw new Error('executing 需要 liveOutput')
    if (to === 'success' && data?.result === undefined) throw new Error('success 需要 result')
    if (to === 'error' && data?.error === undefined) throw new Error('error 需要 error')
    this.log.push({ from: this.state, to, at: Date.now() })
    this.state = to
    if (data) this.data = { ...this.data, ...data }
  }
  get terminal(): boolean { return TERMINAL_STATES.has(this.state) }
  get history(): ReadonlyArray<{ from: ToolState; to: ToolState; at: number }> { return this.log }
}

/** ── policy.ts：工具策略判定（不引 YOLO/allowlist 全套，保留可配置判定核心） ── */
export interface PolicyConfig {
  /** 需要用户确认的工具名（对应 gemini-cli 的 confirmationRequired） */
  confirmTools?: Set<string>
  /** 直接拒绝的工具名 */
  denyTools?: Set<string>
  /** 完全信任模式：跳过一切确认 */
  yolo?: boolean
}
export function decidePolicy(name: string, cfg: PolicyConfig = {}): ScheduledCall['decision'] {
  if (cfg.denyTools?.has(name)) return 'deny'
  if (cfg.yolo) return 'allow'
  if (cfg.confirmTools?.has(name)) return 'ask'
  return 'allow'
}

/** ── confirmation-bus/：一次性确认总线，同一个 callId 只弹一次 ── */
export class ConfirmationBus {
  private pending = new Map<string, { resolve: (approved: boolean) => void; reason: string }>()
  private decided = new Set<string>()
  /** 返回 Promise；resolve(true)=批准，resolve(false)=拒绝 */
  request(callId: string, reason: string): Promise<boolean> {
    if (this.decided.has(callId)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => { this.pending.set(callId, { resolve, reason }) })
  }
  approve(callId: string): void { this.finish(callId, true) }
  deny(callId: string): void { this.finish(callId, false) }
  private finish(callId: string, approved: boolean): void {
    this.decided.add(callId)
    const p = this.pending.get(callId)
    if (p) { p.resolve(approved); this.pending.delete(callId) }
  }
  get size(): number { return this.pending.size }
  get waiting(): string[] { return [...this.pending.keys()] }
}

/** ── scheduler.ts：并发验证 + 全就绪屏障 + 阻塞态让出（10ms tick） ── */
export function allReady(calls: ScheduledCall[]): boolean {
  return calls.every(c => c.fsm.terminal || c.fsm.state === 'scheduled' || c.fsm.state === 'executing')
}
export function hasBlocking(calls: ScheduledCall[]): boolean {
  return calls.some(c => c.fsm.state === 'awaiting_approval' || c.fsm.state === 'executing')
}
/** 阻塞时让出事件循环（gemini-cli 的 10ms yield），返回是否卡死（无进展且无外部等待） */
export async function yieldIfBlocked(calls: ScheduledCall[], tickMs = 10): Promise<{ yielded: boolean; stuck: boolean }> {
  const blocking = hasBlocking(calls)
  if (blocking) { await new Promise(r => setTimeout(r, tickMs)); return { yielded: true, stuck: false } }
  const anyProgress = calls.some(c => c.fsm.state === 'validating' || c.fsm.state === 'scheduled')
  return { yielded: false, stuck: !anyProgress }
}

/** ── tool-executor.ts：实时输出聚合 + 终态归一化 ── */
export class LiveOutputBuffer {
  private chunks: string[] = []
  append(s: string): void { if (s) this.chunks.push(s) }
  get text(): string { return this.chunks.join('') }
  get size(): number { return this.text.length }
  clear(): void { this.chunks = [] }
}
export function normalizeOutcome(tc: UltraToolCall, output: string, failed: boolean, error?: string): ToolOutcome {
  const state: ToolState = failed ? 'error' : 'success'
  return { callId: tc.id, state, output, error }
}

/** 串行请求队列（scheduler.ts 的 requestQueue：同一时刻只处理一个批次） */
export class SerialRequestQueue {
  private processing = false
  private queue: (() => Promise<void>)[] = []
  async submit(job: () => Promise<void>): Promise<void> {
    this.queue.push(job)
    if (this.processing) return
    this.processing = true
    try { while (this.queue.length) { const j = this.queue.shift()!; await j() } }
    finally { this.processing = false }
  }
  get busy(): boolean { return this.processing }
  get pending(): number { return this.queue.length }
}
