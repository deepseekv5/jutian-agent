/**
 * 消息与会话的纯函数工具（v12 底层重构）
 *
 * 从 useChat / ChatView / Sidebar 里抽出的可测逻辑。原先这些判断散在
 * 组件内部，改动一处容易漏改另一处（例如"什么算空会话"曾有三份不同实现）。
 */

import type { Message, ToolCall } from '../types'

/** 消息是否包含可展示内容（空消息不该占位、不该算进"有历史") */
export function hasDisplayableContent(m: Pick<Message, 'content' | 'tool_calls' | 'thinking'>): boolean {
  if (typeof m.content === 'string' && m.content.trim()) return true
  if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) return true
  if (typeof m.thinking === 'string' && m.thinking.trim()) return true
  return false
}

/**
 * 会话标题回退链：AI 标题 → 首条用户消息 → 占位。
 * 统一截断规则，避免侧栏/tab/窗口标题三处各截一个长度。
 */
export function sessionTitle(title: unknown, firstUserMessage?: string, opts: { max?: number; fallback?: string } = {}): string {
  const max = opts.max ?? 20
  const fallback = opts.fallback ?? '新对话'
  const t = typeof title === 'string' ? title.trim() : ''
  if (t) return t.length > max ? t.slice(0, max) + '…' : t
  const u = String(firstUserMessage || '').replace(/\s+/g, ' ').trim()
  if (u) return u.length > max ? u.slice(0, max) + '…' : u
  return fallback
}

/**
 * 按天分组消息（本地时区），用于"今天/昨天/更早"分隔。
 * 返回分组边界下标，渲染层负责画分隔条。
 */
export function dayBoundaries(timestamps: number[]): number[] {
  const out: number[] = []
  let lastDay = ''
  timestamps.forEach((ts, i) => {
    const d = new Date(ts)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (key !== lastDay) {
      if (i > 0) out.push(i)
      lastDay = key
    }
  })
  return out
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 日期 */
export function relativeTime(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts)) return ''
  const d = now - ts
  if (d < 0) return '刚刚'
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  if (d < 172_800_000) return '昨天'
  if (d < 604_800_000) return `${Math.floor(d / 86_400_000)} 天前`
  const dt = new Date(ts)
  return `${dt.getMonth() + 1}月${dt.getDate()}日`
}

/**
 * 工具调用摘要（一行）：用于折叠态展示。
 * 例如 "read_file src/a.ts" / "shell npm test" / "web_search 关键词"
 */
export function toolCallSummary(tc: Pick<ToolCall, 'name' | 'arguments'>): string {
  const name = String(tc.name || 'tool')
  let args: Record<string, unknown> = {}
  if (typeof tc.arguments === 'string') {
    try { args = JSON.parse(tc.arguments) } catch { args = {} }
  } else if (tc.arguments && typeof tc.arguments === 'object') {
    args = tc.arguments as Record<string, unknown>
  }
  const pick = ['path', 'command', 'query', 'url', 'pattern', 'name', 'prompt', 'script']
  for (const k of pick) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) {
      const short = v.trim().replace(/\s+/g, ' ')
      return `${name} ${short.length > 48 ? short.slice(0, 48) + '…' : short}`
    }
  }
  return name
}

/** 统计一轮对话里的工具调用（成功/失败/运行中），用于顶部汇总条 */
export function toolStats(calls: Pick<ToolCall, 'status'>[]): { total: number; done: number; error: number; running: number } {
  let done = 0, error = 0, running = 0
  for (const c of calls) {
    if (c.status === 'error') error++
    else if (c.status === 'running') running++
    else done++
  }
  return { total: calls.length, done, error, running }
}

/** 把消息数组切成"可发送给模型"的形状：丢弃空消息、合并相邻同角色 */
export function normalizeForApi<T extends { role: string; content?: unknown }>(msgs: T[]): T[] {
  const out: T[] = []
  for (const m of msgs) {
    const empty = typeof m.content === 'string' && !m.content.trim()
    if (empty && m.role !== 'assistant') continue
    const prev = out[out.length - 1]
    // 相邻同角色纯文本合并：部分上游对连续同角色会报 400
    if (prev && prev.role === m.role && typeof prev.content === 'string' && typeof m.content === 'string' && m.role === 'user') {
      prev.content = `${prev.content}\n\n${m.content}`
      continue
    }
    out.push({ ...m })
  }
  return out
}

/** 估算消息的 token 占比（配合上下文仪表盘） */
export function contextUsage(usedTokens: number, limitTokens: number): { pct: number; level: 'ok' | 'warn' | 'critical' } {
  const limit = limitTokens > 0 ? limitTokens : 1
  const pct = Math.max(0, Math.min(100, Math.round((usedTokens / limit) * 100)))
  const level = pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'ok'
  return { pct, level }
}
