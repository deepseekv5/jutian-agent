/**
 * 代码片段库（v12 新功能）
 *
 * 用户存常用片段（带占位符），输入框用 /snippet 或命令面板一键插入。
 * 与"提示词模板"分开：模板面向任务，片段面向代码/命令。
 */

export interface Snippet {
  id: string
  name: string
  /** 触发前缀，如 log / tryc；留空则只在面板里可见 */
  trigger?: string
  language?: string
  body: string
  description?: string
  /** 使用次数，用于排序（最近常用在上） */
  uses?: number
  createdAt?: number
  updatedAt?: number
}

/** 取片段里的 {{var}} 变量名（去重保序） */
export function snippetVars(body: string): string[] {
  const out: string[] = []
  const re = /\{\{(\w+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(body || '')))) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

export function fillSnippet(body: string, values: Record<string, string>): string {
  return String(body).replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const v = values[key]
    return typeof v === 'string' ? v : whole
  })
}

/**
 * 按触发前缀匹配（用于输入框即时展开）。
 * 规则：以 trigger + 空格 开头才触发，避免误伤普通输入。
 */
export function matchTrigger(input: string, snippets: Snippet[]): { snippet: Snippet; rest: string } | null {
  const s = String(input || '')
  for (const sn of snippets) {
    const t = String(sn.trigger || '').trim()
    if (!t) continue
    if (s === t) return { snippet: sn, rest: '' }
    if (s.startsWith(t + ' ')) return { snippet: sn, rest: s.slice(t.length + 1) }
  }
  return null
}

export function searchSnippets(list: Snippet[], query: string): Snippet[] {
  const q = String(query || '').trim().toLowerCase()
  const sorted = [...list].sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.updatedAt || 0) - (a.updatedAt || 0))
  if (!q) return sorted
  return sorted.filter((s) =>
    [s.name, s.trigger || '', s.description || '', s.body, s.language || ''].some((f) => f.toLowerCase().includes(q))
  )
}

export function makeSnippet(name: string, body: string, opts: Partial<Snippet> = {}): Snippet {
  const now = Date.now()
  return {
    id: `sn_${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: String(name || '未命名片段').slice(0, 40),
    trigger: opts.trigger ? String(opts.trigger).slice(0, 20) : undefined,
    language: opts.language,
    body: String(body || ''),
    description: opts.description,
    uses: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** 校验触发器：只允许字母数字，避免和自然语言冲突 */
export function validateTrigger(trigger: string, others: Snippet[], selfId?: string): string | null {
  const t = String(trigger || '').trim()
  if (!t) return null
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,19}$/.test(t)) return '触发器只能用字母数字、- 和 _，且以字母开头'
  const dup = others.find((s) => s.id !== selfId && String(s.trigger || '').toLowerCase() === t.toLowerCase())
  if (dup) return `触发器「${t}」已被「${dup.name}」占用`
  return null
}
