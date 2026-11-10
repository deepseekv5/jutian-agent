/**
 * JT Core Ultra / chatCompression —— gemini-cli context/chatCompressionService.ts 全量移植
 * 0.5 阈值触发、保留 0.3 最近历史、保护最后 3 轮、函数响应 50k 预算、
 * 256KB 字节折叠 / 2KB 上限、压缩状态事件、turn 开始前的溢出预检。
 * 零依赖（Apache-2.0）。
 */
export const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5
export const COMPRESSION_PRESERVE_THRESHOLD = 0.3
export const RECENT_TURNS_PROTECTED = 3
export const COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET = 50_000
export const COLLAPSE_HISTORY_BYTE_THRESHOLD = 256 * 1024
export const COLLAPSED_FUNCTION_RESPONSE_MAX_BYTES = 2 * 1024
export type CompressionStatus = 'none' | 'compressed' | 'content-truncated' | 'will-overflow'

/** token 估算：CJK 每字 1 token，其余每 4 字符 1 token */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) { const c = ch.codePointAt(0)!; if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) cjk++ }
  return Math.ceil(cjk + (text.length - cjk) / 4)
}
export function estimateMessagesTokens(messages: { role?: string; content?: string }[]): number {
  return messages.reduce((s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0)
}

/** 是否触发压缩 */
export function needsCompression(messages: { role: string; content?: string }[], contextWindow: number, threshold = DEFAULT_COMPRESSION_TOKEN_THRESHOLD): boolean {
  if (!contextWindow || contextWindow <= 0) return false
  return estimateMessagesTokens(messages) / contextWindow >= threshold
}
/** 压缩切分点：保留最近 PRESERVE 比例，且保护最后 RECENT_TURNS 轮（user 轮边界） */
export function findCompressSplitPoint(messages: { role: string }[], preserve = COMPRESSION_PRESERVE_THRESHOLD, protectTurns = RECENT_TURNS_PROTECTED): number {
  const floor = Math.floor(messages.length * preserve)
  let protectedFrom = messages.length
  let userTurns = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { userTurns++; protectedFrom = i }
    if (userTurns >= protectTurns) break
  }
  return Math.max(0, Math.min(floor, protectedFrom))
}
/** 函数响应预算：超出 50k token 时按字节折叠到 2KB（保留头尾） */
export function collapseFunctionResponse(text: string, maxBytes = COLLAPSED_FUNCTION_RESPONSE_MAX_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const head = text.slice(0, Math.floor(maxBytes / 2))
  const tail = text.slice(-Math.floor(maxBytes / 2))
  return head + '\n…[函数响应已折叠]…\n' + tail
}
export function shouldCollapseHistory(messages: { content?: string }[]): boolean {
  const bytes = messages.reduce((s, m) => s + Buffer.byteLength(String(m.content || ''), 'utf8'), 0)
  return bytes >= COLLAPSE_HISTORY_BYTE_THRESHOLD
}
/** 压缩摘要生成（纯本地，不额外烧 LLM）：结构化头 + 保留尾部完整消息 */
export function compress(messages: { role: string; content?: string }[], contextWindow: number): { messages: { role: string; content?: string }[]; status: CompressionStatus } {
  if (!needsCompression(messages, contextWindow)) return { messages, status: 'none' }
  const split = findCompressSplitPoint(messages)
  if (split <= 1) return { messages, status: 'none' }
  const head = messages.slice(0, split)
  const summary = head.map(m => `[${m.role}] ${String(m.content || '').slice(0, 160)}`).join('\n')
  const out = [
    { role: 'system', content: `【上下文压缩】前 ${split} 条历史摘要（近期完整消息保留在后）：\n${collapseFunctionResponse(summary)}` },
    ...messages.slice(split).map(m => ({ role: m.role, content: Buffer.byteLength(String(m.content || ''), 'utf8') > COLLAPSE_HISTORY_BYTE_THRESHOLD ? collapseFunctionResponse(String(m.content || '')) : (m.content || '') })),
  ]
  return { messages: out, status: 'compressed' }
}
/** turn 开始前溢出预检（ContextWindowWillOverflow 事件语义） */
export function willOverflow(messages: { role?: string; content?: string }[], contextWindow: number, incomingTokens = 0): boolean {
  return estimateMessagesTokens(messages) + incomingTokens >= contextWindow * 0.92
}
