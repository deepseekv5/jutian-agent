/**
 * 会话元信息（v12 新功能）：置顶 / 标签 / 书签 / 备注
 *
 * 不改数据库结构：元信息按会话 id 存在一个 JSON 索引里。
 * 这样老版本数据无缝兼容，未来要迁进 SQLite 也只是搬 key。
 *
 * 纯函数实现，存储由调用方注入（便于测试与降级）。
 */

export interface SessionMeta {
  id: string
  /** 置顶时间戳（0/undefined = 未置顶） */
  pinnedAt?: number
  /** 标签（小写、去重、限长） */
  tags: string[]
  /** 一句话备注 */
  note?: string
  /** 归档：不出现在默认列表 */
  archived?: boolean
}

export interface Bookmark {
  id: string
  sessionId: string
  messageId: string
  /** 摘录片段，避免列表里要回查消息 */
  excerpt: string
  createdAt: number
  tags?: string[]
}

export const TAG_MAX_LEN = 16
export const TAG_LIMIT_PER_SESSION = 8

/** 规范化标签：去空白、小写、去 # 前缀、限长；非法返回空串 */
export function normalizeTag(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, ' ')
  if (!s) return ''
  // 统一小写：英文标签 "Work" 与 "work" 应是同一个，
  // 否则筛选时用户点一个标签却漏掉另一种写法
  return s.slice(0, TAG_MAX_LEN).toLowerCase()
}

export function addTag(meta: SessionMeta, tag: string): SessionMeta {
  const t = normalizeTag(tag)
  if (!t) return meta
  if (meta.tags.includes(t)) return meta
  if (meta.tags.length >= TAG_LIMIT_PER_SESSION) return meta
  return { ...meta, tags: [...meta.tags, t] }
}

export function removeTag(meta: SessionMeta, tag: string): SessionMeta {
  const t = normalizeTag(tag)
  return { ...meta, tags: meta.tags.filter((x) => x !== t) }
}

export function togglePin(meta: SessionMeta, now = Date.now()): SessionMeta {
  return meta.pinnedAt ? { ...meta, pinnedAt: undefined } : { ...meta, pinnedAt: now }
}

export function emptyMeta(id: string): SessionMeta {
  return { id, tags: [] }
}

/**
 * 会话排序：置顶优先（按置顶时间倒序），其内按更新时间倒序。
 * 归档项：included=false 时直接剔除。
 */
export function sortSessions<T extends { id: string; updated_at?: string | number; created_at?: string | number }>(
  sessions: T[],
  metaOf: (id: string) => SessionMeta | undefined,
  opts: { includeArchived?: boolean } = {},
): T[] {
  const ts = (v?: string | number) => {
    if (v == null) return 0
    const n = typeof v === 'number' ? v : new Date(v).getTime()
    return Number.isFinite(n) ? n : 0
  }
  const list = sessions.filter((s) => opts.includeArchived || !metaOf(s.id)?.archived)
  return [...list].sort((a, b) => {
    const pa = metaOf(a.id)?.pinnedAt || 0
    const pb = metaOf(b.id)?.pinnedAt || 0
    if (pa !== pb) return pb - pa
    return ts(b.updated_at ?? b.created_at) - ts(a.updated_at ?? a.created_at)
  })
}

/** 按标签筛选；空标签数组 = 不筛选 */
export function filterByTags<T extends { id: string }>(
  sessions: T[],
  metaOf: (id: string) => SessionMeta | undefined,
  tags: string[],
): T[] {
  const want = tags.map(normalizeTag).filter(Boolean)
  if (!want.length) return sessions
  return sessions.filter((s) => {
    const have = metaOf(s.id)?.tags || []
    return want.every((t) => have.includes(t))
  })
}

export interface TagCount { tag: string; count: number }

/** 全量标签统计，按出现次数降序 */
export function tagCloud(metas: SessionMeta[]): TagCount[] {
  const map = new Map<string, number>()
  for (const m of metas) for (const t of m.tags) map.set(t, (map.get(t) || 0) + 1)
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** 从消息生成书签（摘录截断，保留可读性） */
export function makeBookmark(sessionId: string, messageId: string, content: string, now = Date.now()): Bookmark {
  const text = String(content || '').replace(/```[\s\S]*?```/g, ' [代码] ').replace(/\s+/g, ' ').trim()
  return {
    id: `bm_${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    sessionId,
    messageId,
    excerpt: text.length > 120 ? text.slice(0, 120) + '…' : text,
    createdAt: now,
  }
}

export function searchBookmarks(list: Bookmark[], query: string): Bookmark[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return list
  return list.filter((b) => b.excerpt.toLowerCase().includes(q) || (b.tags || []).some((t) => t.includes(q)))
}
