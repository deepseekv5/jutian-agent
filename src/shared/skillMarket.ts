/**
 * 技能真实市场共享逻辑（v13）
 *
 * 市场来源全部是真实存在的公开仓库（不是自建假数据）：
 *  - anthropics/skills   Anthropic 官方 Agent Skills（SKILL.md 规范的源头）
 *  - obra/superpowers    社区最大的方法论技能集
 *
 * 职责切分：
 *  - 这里只放纯函数：frontmatter 解析、id 白名单、文件扩展名白名单、
 *    安装限额、条目归一化 —— tests 直接对齐测试，不碰网络不碰盘
 *  - serve.ts 负责枚举目录、下载文件、缓存与端点
 */

export interface RemoteSkillSource {
  id: string
  repo: string
  dir: string
  label: string
  source: 'official' | 'community'
}

export const SKILL_SOURCES: RemoteSkillSource[] = [
  { id: 'anthropic-official', repo: 'anthropics/skills', dir: 'skills', label: 'Anthropic 官方', source: 'official' },
  { id: 'superpowers', repo: 'obra/superpowers', dir: 'skills', label: 'Superpowers 社区', source: 'community' },
]

export interface RemoteSkill {
  id: string
  name: string
  description: string
  author: string
  version: string
  source: 'official' | 'community'
  sourceLabel: string
  repo: string
  path: string
}

/** 解析 SKILL.md 的 frontmatter。只取标量键 + 缩进续行（YAML 折叠块 `>`/`|`），够用且不引 YAML 依赖。 */
export function parseFrontmatter(md: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof md !== 'string') return out
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return out
  let lastKey = ''
  for (const rawLine of m[1].split(/\r?\n/)) {
    // 缩进续行：归并到上一个键（官方仓库大量用 `description: >` 折叠多行）
    const cont = rawLine.match(/^\s+(.*)$/)
    if (cont && lastKey) {
      const v = cont[1].trim()
      if (v) out[lastKey] = (out[lastKey] + ' ' + v).trim()
      continue
    }
    const kv = rawLine.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (v === '>' || v === '|' || v === '>-' || v === '|-') v = '' // 块标量指示符：正文在缩进行
    if (v) out[kv[1]] = v
    else if (!(kv[1] in out)) out[kv[1]] = ''
    lastKey = kv[1]
  }
  return out
}

/** 安装目录名白名单：防路径逃逸，只留安全字符。返回 null 表示拒绝。 */
export function sanitizeSkillId(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-')
  if (!s || s.length > 64) return null
  if (s.includes('..') || s.startsWith('.')) return null
  return s
}

/** 技能是文本资产：二进制扩展名一律不装（防恶意仓库塞可执行载荷） */
export const SKILL_FILE_EXT = new Set([
  '.md', '.txt', '.py', '.sh', '.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml',
  '.toml', '.csv', '.html', '.css', '.xml', '.svg', '.rb', '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.hpp', '.sql', '.ps1', '.lua', '.swift', '.kt',
])

export function isAllowedSkillFile(name: string): boolean {
  if (typeof name !== 'string') return false
  const base = name.split('/').pop() || ''
  if (base.startsWith('.') || base.includes('..')) return false
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return SKILL_FILE_EXT.has(base.slice(dot).toLowerCase())
}

/** 安装限额：防恶意仓库把磁盘塞爆或拖死下载 */
export const SKILL_INSTALL_LIMITS = {
  maxFileBytes: 512 * 1024,
  maxFiles: 80,
  maxTotalBytes: 4 * 1024 * 1024,
  maxDepth: 3,
} as const

/** 把仓库目录项归一化为市场条目；mdText 可选（列表页不拉 SKILL.md 时用目录名） */
export function normalizeRemoteSkill(
  entry: { name: string; path: string },
  src: RemoteSkillSource,
  mdText?: string,
): RemoteSkill | null {
  const id = sanitizeSkillId(entry.name)
  if (!id) return null
  const fm = mdText ? parseFrontmatter(mdText) : {}
  const description = (fm.description || '').trim()
  if (!description) return null // 无描述的目录不是技能（如模板、.github）
  const author = src.repo.split('/')[0]
  return {
    id,
    name: (fm.name || entry.name).trim(),
    description,
    author,
    version: (fm.version || '1.0.0').trim(),
    source: src.source,
    sourceLabel: src.label,
    repo: src.repo,
    path: entry.path,
  }
}

/** 市场缓存文件结构（serve 落盘用，带上时间做 TTL 与陈旧回退） */
export interface RemoteMarketCache {
  cached_at: number
  items: RemoteSkill[]
}
