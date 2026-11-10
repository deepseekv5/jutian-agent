/**
 * JT Core Ultra / loopDetection —— gemini-cli services/loopDetectionService.ts 全量移植
 * 三层：工具调用周期（SHA 环缓冲）/ 内容复读（50字分块）/ LLM 语义兜底。
 * 外加一次性「step back」自救与双层硬停。零依赖（Apache-2.0）。
 */
export const TOOL_CALL_LOOP_THRESHOLD = 5
export const CONTENT_LOOP_THRESHOLD = 10
export const CONTENT_CHUNK_SIZE = 50
export const MAX_HISTORY_LENGTH = 5000
export const LLM_CHECK_AFTER_TURNS = 30
export const LLM_CHECK_INTERVAL = 10
export const LLM_CHECK_MIN = 5
export const LLM_CHECK_MAX = 15
export const LLM_HISTORY_TURNS = 20
export const LLM_CONFIDENCE_THRESHOLD = 0.9

/** djb2 稳定指纹（替代 SHA-256，零 crypto 依赖；同模式同值） */
export function toolFingerprint(name: string, args: string): string {
  let h = 5381
  const s = name + '|' + String(args || '')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 第 1 层：工具调用周期检测（k=1..5 的循环，环缓冲 5×threshold） */
export class ToolLoopDetector {
  private history: string[] = []
  readonly threshold = TOOL_CALL_LOOP_THRESHOLD
  readonly ring = TOOL_CALL_LOOP_THRESHOLD * 5
  add(fp: string): boolean {
    this.history.push(fp)
    if (this.history.length > this.ring) this.history.shift()
    const tail = this.history.slice(-this.threshold)
    if (tail.length < this.threshold) return false
    const counts = new Map<string, number>()
    for (const x of tail) counts.set(x, (counts.get(x) || 0) + 1)
    for (const n of counts.values()) if (n >= this.threshold) return true
    for (let k = 2; k <= 5; k++) {
      let cyclic = true
      for (let i = k; i < tail.length; i++) { if (tail[i] !== tail[i - k]) { cyclic = false; break } }
      if (cyclic && tail.length >= 2 * k) return true
    }
    return false
  }
  reset(): void { this.history = [] }
  get samples(): string[] { return [...this.history] }
}

/** 第 2 层：内容复读（同 50 字块重复 10 次，平均间距 ≤ 5×chunk，周期数 ≤ threshold/2） */
export class ContentLoopDetector {
  private chunks: { key: string; at: number }[] = []
  readonly threshold = CONTENT_LOOP_THRESHOLD
  readonly chunkSize = CONTENT_CHUNK_SIZE
  readonly maxDistance = CONTENT_CHUNK_SIZE * 5
  add(text: string): boolean {
    if (!text) return false
    for (let i = 0; i + this.chunkSize <= text.length; i += this.chunkSize) {
      this.chunks.push({ key: text.slice(i, i + this.chunkSize), at: i })
    }
    const byKey = new Map<string, number[]>()
    for (const c of this.chunks) { const a = byKey.get(c.key) || []; a.push(c.at); byKey.set(c.key, a) }
    for (const [, positions] of byKey) {
      if (positions.length < this.threshold) continue
      const last = positions.slice(-this.threshold)
      let sum = 0
      for (let i = 1; i < last.length; i++) sum += last[i] - last[i - 1]
      const avg = sum / (last.length - 1)
      const periods = new Set<number>()
      for (let i = 1; i < last.length; i++) periods.add(last[i] - last[i - 1])
      if (avg <= this.maxDistance && periods.size <= Math.floor(this.threshold / 2)) return true
    }
    return false
  }
  reset(): void { this.chunks = [] }
}

/** 第 3 层：LLM 语义检查的调度（激活后间隔动态钳制 5..15） */
export function semanticInterval(confidence = 0.5): number {
  const base = LLM_CHECK_INTERVAL
  const scaled = Math.round(base * (1 + (1 - confidence)))
  return Math.max(LLM_CHECK_MIN, Math.min(LLM_CHECK_MAX, scaled))
}
export function shouldSemanticCheck(turn: number, lastCheck: number, confidence = 0.5): boolean {
  if (turn < LLM_CHECK_AFTER_TURNS) return false
  return turn - lastCheck >= semanticInterval(confidence)
}

/** 循环自救控制器：count=1 注入提醒，count>1 硬停（gemini-cli _recoverFromLoop） */
export class LoopRecovery {
  private count = 0
  /** 返回 'nudge' | 'stop' | null */
  signal(loopHit: boolean): 'nudge' | 'stop' | null {
    if (!loopHit) return null
    this.count++
    return this.count === 1 ? 'nudge' : 'stop'
  }
  get nudges(): number { return Math.min(this.count, 1) }
  reset(): void { this.count = 0 }
}
export const STEP_BACK_MESSAGE = '【循环自救】检测到重复行为，请停下重新审视：换一种方法、换参数，或基于已有信息直接给出最终结论，不要重复原动作。'
