/**
 * JT Core Ultra / stuckDetector —— OpenHands software-agent-sdk stuck_detector.py 全量移植
 * 五场景：动作-观察重复 / 动作-错误重复 / 独白 / 交替 / 上下文溢出；
 * 20 事件扫描窗口、_event_eq 结构相等、last_nudged 去重、冻结链不重复提醒。
 * 零依赖 TS 再实现（MIT）。
 */
export const MAX_EVENTS_TO_SCAN = 20
export const THRESHOLDS = {
  ACTION_OBSERVATION: 4,
  ACTION_ERROR: 3,
  MONOLOGUE: 3,
  ALTERNATING: 6,
  CONTEXT_ERROR: 10,
} as const
export interface StuckEvent { kind: 'action' | 'observation' | 'error' | 'message'; sig: string; ok: boolean }
/** 结构相等（对应 Python _event_eq） */
export function eventEquals(a: StuckEvent, b: StuckEvent): boolean {
  return a.kind === b.kind && a.sig === b.sig && a.ok === b.ok
}

export class StuckDetector {
  private events: StuckEvent[] = []
  private lastNudgedErrorId = ''
  /** 返回注入提醒文案；null = 正常 */
  check(): string | null {
    const win = this.events.slice(-MAX_EVENTS_TO_SCAN)
    if (!win.length) return null
    // 场景 5：上下文溢出（最严重）
    const ctx = win.filter(e => /context|overflow|too long|token/i.test(e.sig)).length
    if (ctx >= THRESHOLDS.CONTEXT_ERROR) return '上下文反复溢出，已停止继续消耗额度。'
    // 场景 2：同类错误连续（含 nudge 去重）
    const errs = win.filter(e => e.kind === 'error')
    if (errs.length >= THRESHOLDS.ACTION_ERROR && errs.every(e => eventEquals(e, errs[0]))) {
      const id = errs[0].sig
      if (this.lastNudgedErrorId === id) return null
      this.lastNudgedErrorId = id
      return '连续多次同类工具报错，请先阅读错误信息并修正参数，不要用相同参数反复重试。'
    }
    // 场景 4：action/observation 交替
    let alt = 0
    for (let i = 1; i < win.length; i++) {
      const a = win[i - 1].kind, b = win[i].kind
      alt = (a === 'action' && b === 'observation') || (a === 'observation' && b === 'action') ? alt + 1 : 0
    }
    if (alt >= THRESHOLDS.ALTERNATING) return '工具调用与结果长时间交替但无进展，请总结现状并给出结论。'
    // 场景 1：完全相同 action-observation 对
    const pairs = win.filter(e => e.kind === 'action' && e.ok)
    if (pairs.length >= THRESHOLDS.ACTION_OBSERVATION && pairs.every(e => eventEquals(e, pairs[0]))) {
      return '检测到重复执行同一操作且结果相同，请换思路或向用户确认，不要原样重试。'
    }
    // 场景 3：独白（连续 assistant 消息）
    let mono = 0
    for (const e of win) { if (e.kind === 'message') mono++; else mono = 0 }
    if (mono >= THRESHOLDS.MONOLOGUE) return '已连续多轮只输出文字未调用工具，请确认是否应动手执行。'
    return null
  }
  push(e: StuckEvent): void {
    this.events.push(e)
    if (this.events.length > MAX_EVENTS_TO_SCAN * 2) this.events.shift()
  }
  reset(): void { this.events = []; this.lastNudgedErrorId = '' }
  get window(): StuckEvent[] { return this.events.slice(-MAX_EVENTS_TO_SCAN) }
  get lastNudge(): string { return this.lastNudgedErrorId }
}
