/**
 * JT Core Ultra / turn —— gemini-cli core/turn.ts + core/client.ts + nonInteractiveCli.ts 移植
 * Turn 事件枚举、有界 turn 预算（MAX_TURNS=100）、四类退出条件、
 * 会话 turn 计数、CompressionStatus / GeminiEventType。零依赖（Apache-2.0）。
 */
export const MAX_TURNS = 100
export const DEFAULT_MAX_SESSION_TURNS = 100

export const GeminiEventType = {
  Content: 'content',
  ToolCallRequest: 'tool_call_request',
  ToolCallResponse: 'tool_call_response',
  ToolCallConfirmation: 'tool_call_confirmation',
  UserCancelled: 'user_cancelled',
  Error: 'error',
  ChatCompressed: 'chat_compressed',
  ContextWindowWillOverflow: 'context_window_will_overflow',
  LoopDetected: 'loop_detected',
  MaxSessionTurns: 'max_session_turns',
  Finished: 'finished',
} as const
export type GeminiEventType = typeof GeminiEventType[keyof typeof GeminiEventType]

export type StopReason = 'natural' | 'max-turns' | 'max-session-turns' | 'loop-detected' | 'context-overflow' | 'aborted' | 'error'

/** 有界 turn：min(turns, MAX_TURNS)，每次递归递减 */
export function boundedTurns(turns: number): number { return Math.max(0, Math.min(turns, MAX_TURNS)) }

export class TurnBudget {
  private sessionCount = 0
  constructor(private maxSessionTurns = DEFAULT_MAX_SESSION_TURNS) {}
  /** 返回本轮允许的最大 turn；超出会话上限返回 0（触发 MaxSessionTurns） */
  next(requested = MAX_TURNS): number {
    if (this.sessionCount >= this.maxSessionTurns) return 0
    return boundedTurns(requested)
  }
  consume(): void { this.sessionCount++ }
  get used(): number { return this.sessionCount }
  get exhausted(): boolean { return this.sessionCount >= this.maxSessionTurns }
  reset(): void { this.sessionCount = 0 }
}

/** 退出判定：把四类事件映射到 StopReason */
export function stopReasonOf(event: string | undefined): StopReason {
  switch (event) {
    case GeminiEventType.MaxSessionTurns: return 'max-session-turns'
    case GeminiEventType.LoopDetected: return 'loop-detected'
    case GeminiEventType.ContextWindowWillOverflow: return 'context-overflow'
    case GeminiEventType.UserCancelled: return 'aborted'
    case GeminiEventType.Error: return 'error'
    case GeminiEventType.Finished: return 'natural'
    default: return 'natural'
  }
}

/** 结构化 Turn 事件（对应 GeminiEventType 的载荷） */
export interface TurnEvent { type: GeminiEventType; value?: unknown; at: number }
export function turnEvent(type: GeminiEventType, value?: unknown): TurnEvent { return { type, value, at: Date.now() } }
