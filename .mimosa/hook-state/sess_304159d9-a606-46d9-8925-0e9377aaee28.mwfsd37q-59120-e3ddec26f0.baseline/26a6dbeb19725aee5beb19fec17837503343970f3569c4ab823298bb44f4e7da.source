/**
 * 输入统计与草稿管理（v12.1 新功能）
 *
 * 1. 草稿自动保存：切会话/关窗口不丢正在打的内容
 * 2. 输入统计：字数、token 估算、预计花费
 *
 * 草稿按 sessionId 分桶，只保留最近 N 个，避免无限增长。
 */

export interface Draft {
  sessionId: string
  text: string
  updatedAt: number
}

export const DRAFT_LIMIT = 30
/** 短草稿不存：几个字的临时输入不值得占存储 */
export const DRAFT_MIN_LEN = 8

export function shouldPersistDraft(text: string): boolean {
  return String(text || '').trim().length >= DRAFT_MIN_LEN
}

/** 写入/更新草稿；空文本表示删除 */
export function upsertDraft(list: Draft[], sessionId: string, text: string, now = Date.now()): Draft[] {
  const rest = list.filter((d) => d.sessionId !== sessionId)
  if (!shouldPersistDraft(text)) return rest
  const next = [...rest, { sessionId, text, updatedAt: now }]
  // 超限时丢最旧的
  next.sort((a, b) => b.updatedAt - a.updatedAt)
  return next.slice(0, DRAFT_LIMIT)
}

export function getDraft(list: Draft[], sessionId: string): string {
  return list.find((d) => d.sessionId === sessionId)?.text || ''
}

export function removeDraft(list: Draft[], sessionId: string): Draft[] {
  return list.filter((d) => d.sessionId !== sessionId)
}

/** 清理过期草稿（默认 14 天） */
export function pruneDrafts(list: Draft[], now = Date.now(), maxAgeMs = 14 * 86400_000): Draft[] {
  return list.filter((d) => now - d.updatedAt < maxAgeMs)
}

export interface InputStats {
  chars: number
  /** 粗估 token：中文约 1 字 = 1 token，英文约 4 字符 = 1 token */
  tokens: number
  /** 按给定单价估算的输入成本（美元），无定价返回 undefined */
  estimatedCostUSD?: number
}

/** 中英混合的 token 粗估（与 tokens.ts 口径保持一致方向） */
export function estimateInputTokens(text: string): number {
  const s = String(text || '')
  if (!s) return 0
  let cjk = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) || 0
    if (code >= 0x4e00 && code <= 0x9fff) cjk++
  }
  const rest = s.length - cjk
  return Math.ceil(cjk + rest / 4)
}

export function inputStats(text: string, pricePerMillion?: number): InputStats {
  const tokens = estimateInputTokens(text)
  return {
    chars: String(text || '').length,
    tokens,
    estimatedCostUSD: typeof pricePerMillion === 'number'
      ? (tokens / 1e6) * pricePerMillion
      : undefined,
  }
}
