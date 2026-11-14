/**
 * 应用公告解析（GitHub 仓库 docs/notice.md → 进应用自动读取显示）
 *
 * 约定格式（尽量宽松，写公告的人不用记规则）：
 *   # 标题行                      ← 第一个一级标题 = 公告标题
 *   正文任意多行                   ← 原样保留（前端轻量渲染）
 *   <!-- id: 2026-10-18-win -->    ← 可选元信息行，id 变了才会重新弹出
 *   <!-- level: warn -->           ← info | warn | critical（横幅配色）
 *
 * 为什么要有 id：横幅"关闭后不再打扰"靠本地记住已读的 id；
 * 换新公告（id 不同）才会再次显示。id 缺省时用标题+正文哈希，
 * 内容一改就会重新推送——这正是发公告时想要的效果。
 *
 * 空文件 / 全是注释 / 没有正文 → 返回 null（视为"没有公告"，不弹横幅）。
 */

export interface Announcement {
  id: string
  title: string
  body: string
  level: 'info' | 'warn' | 'critical'
  date?: string
}

const META_RE = /^\s*<!--\s*(id|level|date)\s*:\s*(.+?)\s*-->\s*$/i

/** FNV-1a：小、快、无依赖，够做内容指纹 */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function parseNoticeMd(raw: string): Announcement | null {
  const text = String(raw ?? '').replace(/\r\n/g, '\n')
  const meta: Record<string, string> = {}
  const lines = text.split('\n').filter((l) => {
    const m = l.match(META_RE)
    if (m) { meta[m[1].toLowerCase()] = m[2]; return false }
    return true
  })
  const stripped = lines.map((l) => l.trim())

  let title = ''
  let titleIdx = -1
  for (let i = 0; i < stripped.length; i++) {
    // 第一个一级标题；顺手认掉 "## "（写公告的人常记不清层级）
    const m = stripped[i].match(/^#{1,2}\s+(.+)$/)
    if (m) { title = m[1]; titleIdx = i; break }
    // 首个非空行不是标题也无所谓，继续找正文起点
  }
  const bodyStart = titleIdx >= 0 ? titleIdx + 1 : stripped.findIndex((l) => l.length > 0)
  const body = bodyStart >= 0 ? lines.slice(bodyStart).join('\n').trim() : ''

  if (!title && !body) return null

  const levelRaw = (meta.level || 'info').toLowerCase()
  const level = (['info', 'warn', 'critical'] as const).includes(levelRaw as Announcement['level'])
    ? (levelRaw as Announcement['level']) : 'info'

  return {
    id: meta.id || hash(`${title}\n${body}`),
    title: title || '公告',
    body,
    level,
    date: meta.date,
  }
}
