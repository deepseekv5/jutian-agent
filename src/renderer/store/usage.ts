/**
 * 用量统计（localStorage 持久化，按 天+模型 聚合）
 * 在 useChat 每次流结束后写入；首页与设置页读取展示。
 */

export interface UsageEntry {
  date: string        // YYYY-MM-DD
  model: string
  msgs: number        // 消息轮数
  prompt: number      // 估算输入 tokens
  completion: number  // 估算输出 tokens
}

const KEY = 'lyclaw_usage'

export function addUsage(model: string, prompt: number, completion: number): void {
  try {
    const date = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD（本地时区）
    const list: UsageEntry[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    const hit = list.find(e => e.date === date && e.model === model)
    if (hit) {
      hit.msgs += 1
      hit.prompt += prompt
      hit.completion += completion
    } else {
      list.push({ date, model, msgs: 1, prompt, completion })
    }
    // 只保留最近 90 天
    const trimmed = list.slice(-180)
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

export function getUsage(): UsageEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export interface UsageSummary {
  today: { msgs: number; prompt: number; completion: number }
  total: { msgs: number; prompt: number; completion: number }
  days: UsageEntry[]   // 最近 N 天，按日期倒序
}

export function summarizeUsage(days = 7): UsageSummary {
  const list = getUsage()
  const today = new Date().toLocaleDateString('sv-SE')
  const sum = (es: UsageEntry[]) => es.reduce((s, e) => ({ msgs: s.msgs + e.msgs, prompt: s.prompt + e.prompt, completion: s.completion + e.completion }), { msgs: 0, prompt: 0, completion: 0 })
  const byDate = new Map<string, UsageEntry>()
  for (const e of list) {
    const hit = byDate.get(e.date)
    if (hit) {
      hit.msgs += e.msgs; hit.prompt += e.prompt; hit.completion += e.completion
    } else {
      byDate.set(e.date, { ...e })
    }
  }
  const recentDays = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days)
  return {
    today: sum(list.filter(e => e.date === today)),
    total: sum(list),
    days: recentDays,
  }
}
