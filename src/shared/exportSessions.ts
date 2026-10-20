/**
 * 会话导出增强（v12 新功能）
 *
 * 在已有一对一导出（exportChat.ts）之上补三种：
 *   1. 多条会话合并导出为一份 Markdown（按会话分节，带目录）
 *   2. 导出筛选：只导用户消息 / 只导含代码的 / 按关键词过滤
 *   3. 统计摘要（消息数、工具调用数、时间范围）
 *
 * 纯函数，便于测试；格式化本身交给调用方写文件。
 */

export interface ExportMessage {
  role: string
  content: string
  created_at?: string | number
  tool_calls?: { name?: string; status?: string }[]
  thinking?: string
}

export interface ExportSession {
  id: string
  title: string
  messages: ExportMessage[]
  project?: string
  created_at?: string | number
}

export interface ExportFilter {
  /** 只保留指定角色；空=全部 */
  roles?: string[]
  /** 关键词（大小写不敏感），命中 content 才保留 */
  keyword?: string
  /** 只保留含代码块的消息 */
  onlyCode?: boolean
  /** 是否包含工具调用记录 */
  includeTools?: boolean
  /** 是否包含思考过程 */
  includeThinking?: boolean
}

const ROLE_LABEL: Record<string, string> = { user: '用户', assistant: '助手', system: '系统', tool: '工具' }

export function filterMessages(msgs: ExportMessage[], f: ExportFilter = {}): ExportMessage[] {
  const kw = String(f.keyword || '').trim().toLowerCase()
  return msgs.filter((m) => {
    if (f.roles?.length && !f.roles.includes(m.role)) return false
    const c = String(m.content || '')
    if (f.onlyCode && !/```/.test(c)) return false
    if (kw && !c.toLowerCase().includes(kw)) return false
    return true
  })
}

/** 单条消息 → Markdown 片段 */
export function messageToMarkdown(m: ExportMessage, f: ExportFilter = {}): string {
  const label = ROLE_LABEL[m.role] || m.role
  const time = m.created_at ? ` · ${formatStamp(m.created_at)}` : ''
  const parts: string[] = [`### ${label}${time}`, '']
  if (f.includeThinking && m.thinking?.trim()) {
    parts.push('<details><summary>思考过程</summary>', '', m.thinking.trim(), '', '</details>', '')
  }
  if (f.includeTools && m.tool_calls?.length) {
    parts.push('> 工具调用：' + m.tool_calls.map((t) => `${t.name || 'tool'}${t.status === 'error' ? '(失败)' : ''}`).join('、'), '')
  }
  parts.push(String(m.content || '').trim() || '_（空消息）_', '')
  return parts.join('\n')
}

function formatStamp(v: string | number): string {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface ExportStats {
  sessions: number
  messages: number
  toolCalls: number
  failedToolCalls: number
  from?: string
  to?: string
}

export function collectStats(sessions: ExportSession[]): ExportStats {
  let messages = 0, toolCalls = 0, failed = 0
  let minTs = Infinity, maxTs = -Infinity
  for (const s of sessions) {
    for (const m of s.messages || []) {
      messages++
      for (const t of m.tool_calls || []) {
        toolCalls++
        if (t.status === 'error') failed++
      }
      const ts = m.created_at ? new Date(m.created_at).getTime() : NaN
      if (Number.isFinite(ts)) { minTs = Math.min(minTs, ts); maxTs = Math.max(maxTs, ts) }
    }
  }
  return {
    sessions: sessions.length,
    messages,
    toolCalls,
    failedToolCalls: failed,
    from: Number.isFinite(minTs) ? formatStamp(minTs) : undefined,
    to: Number.isFinite(maxTs) ? formatStamp(maxTs) : undefined,
  }
}

/**
 * 多会话合并导出。
 * 单会话且无筛选时退化为普通文档（避免多余的一级标题层级）。
 */
export function buildMultiExport(sessions: ExportSession[], f: ExportFilter = {}, opts: { title?: string } = {}): string {
  const stats = collectStats(sessions)
  const title = opts.title || '巨天agent 会话导出'
  const out: string[] = [`# ${title}`, '']

  out.push(`> 导出时间：${formatStamp(Date.now())} ｜ 会话 ${stats.sessions} 个 ｜ 消息 ${stats.messages} 条`)
  if (stats.toolCalls) out.push(`> 工具调用 ${stats.toolCalls} 次（失败 ${stats.failedToolCalls} 次）`)
  out.push('')

  if (sessions.length > 1) {
    out.push('## 目录', '')
    sessions.forEach((s, i) => {
      out.push(`${i + 1}. ${s.title || '未命名会话'}${s.project ? `（${s.project}）` : ''}`)
    })
    out.push('')
  }

  for (const s of sessions) {
    if (sessions.length > 1) out.push(`## ${s.title || '未命名会话'}`, '')
    if (s.project) out.push(`_项目：${s.project}_`, '')
    const kept = filterMessages(s.messages || [], f)
    if (!kept.length) {
      out.push('_（本次筛选后无内容）_', '')
      continue
    }
    for (const m of kept) out.push(messageToMarkdown(m, f))
  }
  return out.join('\n')
}

/** 生成安全文件名（跨平台） */
export function exportFileName(base: string, ext: string, stamp = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}`
  const safe = String(base || 'export')
    .replace(/[\\/:*?"<>|]+/g, '_')      // Windows 非法字符（含 mac 的 :）
    // 控制字符逐个剔除：写成 \x00-\x1f 正则会被 no-control-regex 拦下，
    // 而且文件名里本来就不该出现它们
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 31)
    .join('')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 60) || 'export'
  return `${safe}-${date}.${ext.replace(/^\./, '')}`
}
