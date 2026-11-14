/**
 * 全局搜索索引（v12 新功能）
 *
 * 现有搜索是"直接查 DB/LIKE"，没有排序也没有高亮。这里做一层纯函数：
 *   - 分词（中英混合：中文按字，英文按词）
 *   - 打分（标题命中 > 正文命中；连续命中 > 分散命中；越靠前越高）
 *   - 生成高亮片段（返回 [{text, hit}]，渲染层不接触正则）
 */

export interface SearchDoc {
  id: string
  title: string
  body: string
  /** 额外权重（如最近访问过的会话加权） */
  boost?: number
  meta?: Record<string, unknown>
}

export interface ScoredDoc<T extends SearchDoc = SearchDoc> {
  doc: T
  score: number
  /** 标题高亮片段 */
  titleParts: HighlightPart[]
  /** 正文命中片段（命中词前后各留若干字） */
  excerptParts: HighlightPart[]
}

export interface HighlightPart {
  text: string
  hit: boolean
}

/** 中文按单字切，英文/数字按词切（长度 >=2 才当词，避免噪音） */
export function tokenize(query: string): string[] {
  const s = String(query || '').trim().toLowerCase()
  if (!s) return []
  const tokens: string[] = []
  // 先按空白与标点切成块
  for (const chunk of s.split(/[\s,，。、;；:：!！?？()（）[\]【】"'“”]+/)) {
    if (!chunk) continue
    if (/[\u4e00-\u9fa5]/.test(chunk)) {
      // 中文块：整块 + 单字都算（整块命中权重更高）
      if (chunk.length > 1) tokens.push(chunk)
      for (const ch of chunk) tokens.push(ch)
    } else if (chunk.length >= 2) {
      tokens.push(chunk)
    } else if (chunk.length === 1 && /[a-z0-9]/.test(chunk)) {
      tokens.push(chunk)
    }
  }
  // 去重保序
  return [...new Set(tokens)]
}

/** 关键词命中次数 */
function countHits(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0, from = 0
  for (;;) {
    const i = haystack.indexOf(needle, from)
    if (i < 0) break
    n++
    from = i + needle.length
  }
  return n
}

/**
 * 打分：所有 token 都必须命中（AND 语义），否则不计。
 * 标题权重 3 倍，连续命中（整块 token）额外加权。
 */
export function scoreDoc(doc: SearchDoc, tokens: string[]): number {
  if (!tokens.length) return 0
  const title = String(doc.title || '').toLowerCase()
  const body = String(doc.body || '').toLowerCase()
  let score = 0
  for (const t of tokens) {
    const inTitle = countHits(title, t)
    const inBody = countHits(body, t)
    if (!inTitle && !inBody) return 0 // AND
    score += inTitle * 10 + Math.min(inBody, 20)
    // 整块（非单字）权重更高
    if (t.length > 1) score += (inTitle ? 15 : 0) + (inBody ? 5 : 0)
    // 出现在开头再加分
    if (title.startsWith(t)) score += 20
  }
  // 标题短通常更精确
  score += Math.max(0, 10 - Math.floor(title.length / 20))
  return score + (doc.boost || 0)
}

/** 生成高亮片段 */
export function highlight(text: string, tokens: string[]): HighlightPart[] {
  const s = String(text || '')
  if (!tokens.length || !s) return [{ text: s, hit: false }]
  const lower = s.toLowerCase()
  // 收集所有命中区间，合并重叠
  const ranges: [number, number][] = []
  for (const t of tokens) {
    if (!t) continue
    let from = 0
    for (;;) {
      const i = lower.indexOf(t, from)
      if (i < 0) break
      ranges.push([i, i + t.length])
      from = i + Math.max(1, t.length)
    }
  }
  if (!ranges.length) return [{ text: s, hit: false }]
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const out: HighlightPart[] = []
  let cursor = 0
  for (const [a, b] of merged) {
    if (a > cursor) out.push({ text: s.slice(cursor, a), hit: false })
    out.push({ text: s.slice(a, b), hit: true })
    cursor = b
  }
  if (cursor < s.length) out.push({ text: s.slice(cursor), hit: false })
  return out
}

/** 摘要：取第一个命中位置前后各 40 字 */
export function excerpt(text: string, tokens: string[], radius = 40): HighlightPart[] {
  const s = String(text || '').replace(/\s+/g, ' ')
  const lower = s.toLowerCase()
  let at = -1
  for (const t of tokens) {
    const i = lower.indexOf(t)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) {
    const head = s.slice(0, radius * 2)
    return [{ text: s.length > head.length ? head + '…' : head, hit: false }]
  }
  const start = Math.max(0, at - radius)
  const end = Math.min(s.length, at + radius)
  const parts = highlight(s.slice(start, end), tokens)
  if (start > 0) parts.unshift({ text: '…', hit: false })
  if (end < s.length) parts.push({ text: '…', hit: false })
  return parts
}

export function searchDocs<T extends SearchDoc>(docs: T[], query: string, limit = 30): ScoredDoc<T>[] {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const scored: ScoredDoc<T>[] = []
  for (const doc of docs) {
    const score = scoreDoc(doc, tokens)
    if (score <= 0) continue
    scored.push({
      doc,
      score,
      titleParts: highlight(doc.title, tokens),
      excerptParts: excerpt(doc.body, tokens),
    })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(0, limit))
}

/** 查询补全建议：从历史查询里挑相似度高的（用于搜索框下拉） */
export function suggestQueries(history: string[], input: string, limit = 5): string[] {
  const q = String(input || '').trim().toLowerCase()
  if (!q) return history.slice(0, limit)
  return [...new Set(history)]
    .filter((h) => h && h.toLowerCase().includes(q) && h.toLowerCase() !== q)
    .slice(0, limit)
}
