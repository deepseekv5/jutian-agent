/**
 * JT Core Ultra / nextSpeaker —— gemini-cli utils/nextSpeakerChecker.ts 全量移植
 * 快速路径（工具结果/空模型填充 → model）、结构化 LLM 判定（user|model）、
 * 有序决策规则（有下一步动作→model；直接提问/完整表述→user）、跳过与配额错误守卫。
 * 零依赖（Apache-2.0）。
 */
export type NextSpeaker = 'user' | 'model' | null
export const CONTINUE_PROMPT = 'Please continue.'
export const NEXT_SPEAKER_SCHEMA = {
  type: 'object',
  properties: { next_speaker: { type: 'string', enum: ['user', 'model'] }, reasoning: { type: 'string' } },
  required: ['next_speaker'],
} as const
export const NEXT_SPEAKER_DECISION_RULES = [
  '若模型还有立即要做的下一步动作、或回复明显被截断 → next_speaker=model',
  '若模型向用户提出了直接问题、或已完整表达一个想法 → next_speaker=user',
  '不确定时倾向 user（把控制权交还用户，避免自说自话）',
] as const

export interface SpeakerContext {
  pendingTools: number
  quotaError: boolean
  skip: boolean
  lastMessageRole?: string
  lastMessageContent?: string
}
/** 快速路径：无需 LLM 即可判定的场景 */
export function fastNextSpeaker(ctx: SpeakerContext): NextSpeaker {
  if (ctx.skip || ctx.quotaError || ctx.pendingTools > 0) return null
  if (ctx.lastMessageRole === 'tool') return 'model'
  if (ctx.lastMessageRole === 'assistant' && (!ctx.lastMessageContent || !String(ctx.lastMessageContent).trim())) return 'model'
  return null
}
/** 解析结构化 LLM 响应（容忍纯文本 "model"/"user"） */
export function parseNextSpeaker(text: string): NextSpeaker {
  const t = String(text || '').trim()
  try {
    const d = JSON.parse(t)
    const v = String(d?.next_speaker ?? d?.speaker ?? '').toLowerCase()
    if (v === 'user' || v === 'model') return v
  } catch { /* 非 JSON 走文本兜底 */ }
  const m = t.match(/\b(user|model)\b/i)
  return m ? (m[1].toLowerCase() as NextSpeaker) : null
}
/** 综合判定：快速路径优先，否则由调用方决定是否发 LLM 请求 */
export function resolveNextSpeaker(ctx: SpeakerContext, llmText?: string): NextSpeaker {
  const fast = fastNextSpeaker(ctx)
  if (fast) return fast
  if (llmText !== undefined) return parseNextSpeaker(llmText)
  return 'user' // 保守：没有判定依据时交还用户
}
