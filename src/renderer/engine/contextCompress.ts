/**
 * 上下文压缩策略
 *
 * 长对话超过阈值时把早期历史折叠成摘要。这里抽成纯函数是因为
 * 策略里有几个容易出错的边界：
 *
 *  - **保留区不能只看条数**：固定保留最近 N 条，若这 N 条里有超长文件内容，
 *    压缩后仍会超窗。保留区要按 token 反推起点。
 *  - **摘要不能无限累积**：每次都把新摘要追加到旧摘要后面，长对话下
 *    摘要自身会膨胀到超过阈值——压缩反而制造了新的超长上下文。
 *  - **压缩后要验证**：折叠完仍超阈值时应继续折叠（或至少如实告知），
 *    而不是假装成功直接发送。
 */

/** 触发压缩的估算 token 阈值 */
export const COMPRESS_TOKEN_THRESHOLD = 40_000

/** 触发压缩的消息条数阈值（防止大量短消息堆积） */
export const COMPRESS_MSG_THRESHOLD = 60

/** 保留区的最小消息条数（即使 token 已够，也至少留这么多条近期上下文） */
export const KEEP_RECENT_MIN = 6

/** 保留区的 token 预算：从末尾往前累加，超出即停止 */
export const KEEP_RECENT_TOKEN_BUDGET = 12_000

/** 摘要自身的长度上限（字符），超出则截断，防止摘要累积膨胀 */
export const SUMMARY_MAX_CHARS = 2400

export interface ApiMsgLike {
  role: string
  content?: unknown
  tool_calls?: unknown
}

/** 单条消息的估算 token（含 tool_calls 的 JSON 体积） */
export function estimateMsgTokens(m: ApiMsgLike, estimate: (s: string) => number): number {
  const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
  const tc = m.tool_calls ? JSON.stringify(m.tool_calls) : ''
  return estimate(c) + estimate(tc)
}

/** 整段消息的估算 token 总量 */
export function estimateMessagesTokens(msgs: ApiMsgLike[], estimate: (s: string) => number): number {
  return msgs.reduce((s, m) => s + estimateMsgTokens(m, estimate), 0)
}

export interface CompressPlan {
  /** 是否需要压缩 */
  shouldCompress: boolean
  /** 需要折叠的早期消息（不含系统提示与保留区） */
  oldChunk: ApiMsgLike[]
  /** 保留原文的近期消息 */
  recent: ApiMsgLike[]
}

/**
 * 制定压缩计划。
 * 首条（系统提示）永远不参与折叠；保留区按 token 预算从末尾反推，
 * 但不少于 KEEP_RECENT_MIN 条。
 */
export function planCompression(
  messages: ApiMsgLike[],
  estimate: (s: string) => number,
): CompressPlan {
  // messages[0] 是系统提示，始终保留
  const body = messages.slice(1)
  const total = estimateMessagesTokens(messages, estimate)
  const shouldCompress = total > COMPRESS_TOKEN_THRESHOLD || body.length > COMPRESS_MSG_THRESHOLD
  if (!shouldCompress) return { shouldCompress: false, oldChunk: [], recent: body }

  // 从末尾往前累加，直到超出 token 预算（但至少保留 KEEP_RECENT_MIN 条）
  let acc = 0
  let keep = 0
  for (let i = body.length - 1; i >= 0; i--) {
    const t = estimateMsgTokens(body[i], estimate)
    if (keep >= KEEP_RECENT_MIN && acc + t > KEEP_RECENT_TOKEN_BUDGET) break
    acc += t
    keep++
  }
  const splitAt = body.length - keep
  return {
    shouldCompress: true,
    oldChunk: body.slice(0, splitAt),
    recent: body.slice(splitAt),
  }
}

/**
 * 合并新旧摘要。
 *
 * 关键约束：摘要不能无限增长。每次都追加会让长对话的摘要本身变成
 * 新的超长上下文。超过 SUMMARY_MAX_CHARS 时保留最新的部分——
 * 越近的历史对当前任务越相关。
 */
export function mergeSummary(prev: string, next: string): string {
  const n = (next || '').trim()
  if (!n) return prev || ''
  const p = (prev || '').trim()
  if (!p) return n.slice(-SUMMARY_MAX_CHARS)
  const merged = `${p}\n${n}`
  if (merged.length <= SUMMARY_MAX_CHARS) return merged
  // 超限时丢弃最旧的部分，保留最近的内容
  return `（早期摘要已省略）\n${merged.slice(-SUMMARY_MAX_CHARS)}`
}

/**
 * 组装压缩后的消息数组。
 * 摘要为空时返回 null，表示"压缩不可用，调用方应照常发送原消息"——
 * 绝不因为摘要生成失败就丢掉历史。
 */
export function buildCompressedMessages(
  systemPrompt: string,
  summary: string,
  recent: ApiMsgLike[],
  compressedCount: number,
): ApiMsgLike[] | null {
  if (!summary.trim()) return null
  return [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: `【历史对话摘要 — 早前 ${compressedCount} 条消息已压缩】\n${summary}` },
    ...recent,
  ]
}
