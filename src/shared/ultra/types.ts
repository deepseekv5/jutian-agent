/**
 * JT Core Ultra / types —— gemini-cli packages/core/src/scheduler/types.ts 的零依赖再实现
 * Apache-2.0 算法移植，见 docs/THIRD_PARTY_NOTICES.md
 */
export type ToolState = 'validating' | 'awaiting_approval' | 'scheduled' | 'executing' | 'success' | 'error' | 'cancelled'
export const TERMINAL_STATES = new Set<ToolState>(['success', 'error', 'cancelled'])
const ALLOWED: Record<ToolState, ToolState[]> = {
  validating: ['awaiting_approval', 'scheduled', 'error', 'cancelled'],
  awaiting_approval: ['scheduled', 'cancelled', 'error'],
  scheduled: ['executing', 'cancelled', 'error'],
  executing: ['success', 'error', 'cancelled'],
  success: [], error: [], cancelled: [],
}
export function canTransition(from: ToolState, to: ToolState): boolean {
  return (ALLOWED[from] || []).includes(to)
}
export interface UltraTool { name: string; description: string; parameters: unknown }
export interface UltraToolCall {
  id: string
  name: string
  arguments: string
  status?: 'running' | 'done' | 'error' | 'pending'
  result?: string
  changeId?: string
  started_at?: string
  finished_at?: string
}
export interface ScheduledCall {
  tc: UltraToolCall
  fsm: import('./toolScheduler').ToolCallStateMachine
  /** 策略判定结果（gemini-cli policy.ts） */
  decision: 'allow' | 'ask' | 'deny'
}
export interface ToolOutcome {
  callId: string
  state: ToolState
  output: string
  error?: string
}
export interface UltraMessage {
  role: string
  // v16.3.6：content 支持多模态数组（截图等工具产出图片）
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string }; index?: number }[]
  tool_call_id?: string
  [key: string]: unknown
}
