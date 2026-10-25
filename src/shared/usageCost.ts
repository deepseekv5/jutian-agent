/**
 * 用量与成本统计（v12 新功能）
 *
 * 目标：让用户看清"这个月花了多少钱、哪个模型最贵、哪天花得最多"。
 * 纯函数聚合 + 定价表；金额只做估算（不同供应商价格会变），UI 需标注"估算"。
 */

export interface UsageRecord {
  ts: number
  model: string
  provider?: string
  promptTokens: number
  completionTokens: number
  /** 可选：供应商直接返回的金额（优先于本地估算） */
  costUSD?: number
  /** 本轮是否成功（v12.5：统计真实成功率用） */
  ok?: boolean
}

export interface ModelPrice {
  /** 每百万 token 的美元单价 */
  inputPerM: number
  outputPerM: number
}

/**
 * 常见模型定价（美元/百万 token，2026 年公开牌价，仅作估算）。
 * 未收录的模型返回 undefined → 统计里标记"未定价"，不编价格。
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4.1': { inputPerM: 2, outputPerM: 8 },
  'gpt-4.1-mini': { inputPerM: 0.4, outputPerM: 1.6 },
  'o3': { inputPerM: 2, outputPerM: 8 },
  'o4-mini': { inputPerM: 1.1, outputPerM: 4.4 },
  'claude-sonnet-4': { inputPerM: 3, outputPerM: 15 },
  'claude-opus-4': { inputPerM: 15, outputPerM: 75 },
  'claude-3-5-haiku': { inputPerM: 0.8, outputPerM: 4 },
  'deepseek-chat': { inputPerM: 0.27, outputPerM: 1.1 },
  'deepseek-reasoner': { inputPerM: 0.55, outputPerM: 2.19 },
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
}

/** 宽松匹配：带日期后缀/前缀的模型名归到基名 */
export function resolvePrice(model: string): ModelPrice | undefined {
  const m = String(model || '').toLowerCase().trim()
  if (!m) return undefined
  if (MODEL_PRICES[m]) return MODEL_PRICES[m]
  // 去日期后缀：gpt-4o-2024-08-06 → gpt-4o
  const stripped = m.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  if (MODEL_PRICES[stripped]) return MODEL_PRICES[stripped]
  // 最长前缀匹配：claude-sonnet-4-5 → claude-sonnet-4
  const keys = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length)
  const hit = keys.find((k) => m.startsWith(k))
  return hit ? MODEL_PRICES[hit] : undefined
}

export function estimateCost(r: Pick<UsageRecord, 'model' | 'promptTokens' | 'completionTokens' | 'costUSD'>): number | undefined {
  if (typeof r.costUSD === 'number' && Number.isFinite(r.costUSD)) return r.costUSD
  const p = resolvePrice(r.model)
  if (!p) return undefined
  return (r.promptTokens / 1e6) * p.inputPerM + (r.completionTokens / 1e6) * p.outputPerM
}

export interface UsageSummary {
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 已知定价部分的估算金额（美元） */
  costUSD: number
  /** 有记录但缺定价的请求数（提示用户这是低估） */
  unpriced: number
  byModel: { model: string; requests: number; tokens: number; costUSD: number; priced: boolean }[]
}

export function summarize(records: UsageRecord[]): UsageSummary {
  const byModel = new Map<string, { requests: number; tokens: number; costUSD: number; priced: boolean }>()
  let promptTokens = 0, completionTokens = 0, costUSD = 0, unpriced = 0
  for (const r of records) {
    const pt = Math.max(0, Number(r.promptTokens) || 0)
    const ct = Math.max(0, Number(r.completionTokens) || 0)
    promptTokens += pt
    completionTokens += ct
    const cost = estimateCost(r)
    if (cost === undefined) unpriced++
    else costUSD += cost
    const cur = byModel.get(r.model) || { requests: 0, tokens: 0, costUSD: 0, priced: true }
    cur.requests++
    cur.tokens += pt + ct
    if (cost === undefined) cur.priced = false
    else cur.costUSD += cost
    byModel.set(r.model, cur)
  }
  return {
    requests: records.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUSD,
    unpriced,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.tokens - a.tokens),
  }
}

/** 按天聚合（本地时区），返回连续日期序列便于画柱状图 */
export function dailySeries(records: UsageRecord[], days: number, now = Date.now()): { date: string; tokens: number; costUSD: number }[] {
  const buckets = new Map<string, { tokens: number; costUSD: number }>()
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  for (const r of records) {
    const d = new Date(r.ts)
    const k = key(d)
    const cur = buckets.get(k) || { tokens: 0, costUSD: 0 }
    cur.tokens += (r.promptTokens || 0) + (r.completionTokens || 0)
    cur.costUSD += estimateCost(r) || 0
    buckets.set(k, cur)
  }
  const out: { date: string; tokens: number; costUSD: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const k = key(d)
    const v = buckets.get(k) || { tokens: 0, costUSD: 0 }
    out.push({ date: k, ...v })
  }
  return out
}

/** 按模型统计真实成功率（v12.5）——推荐不再靠名字猜 */
export interface ModelSuccessRate {
  model: string
  total: number
  ok: number
  /** 0-100；total < 3 时返回 null（样本太少，别当结论） */
  rate: number | null
  /** 平均耗时（毫秒；无数据 0）——通过 ts 差值算不了，由调用方带 */
}

export function successRates(records: UsageRecord[]): ModelSuccessRate[] {
  const map = new Map<string, { total: number; ok: number }>()
  for (const r of records) {
    const cur = map.get(r.model) || { total: 0, ok: 0 }
    cur.total++
    if (r.ok !== false) cur.ok++
    map.set(r.model, cur)
  }
  return [...map.entries()]
    .map(([model, v]) => ({
      model, total: v.total, ok: v.ok,
      rate: v.total >= 3 ? Math.round((v.ok / v.total) * 100) : null,
    }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.total - a.total)
}

/** 预算判断：返回是否超限与剩余比例 */
export function budgetState(usedUSD: number, budgetUSD: number): { over: boolean; pct: number; remaining: number } {
  if (!(budgetUSD > 0)) return { over: false, pct: 0, remaining: Infinity }
  const pct = Math.round((usedUSD / budgetUSD) * 100)
  return { over: usedUSD >= budgetUSD, pct, remaining: Math.max(0, budgetUSD - usedUSD) }
}

export function formatUSD(v: number): string {
  if (!Number.isFinite(v)) return '$0.00'
  if (v === 0) return '$0.00'
  if (v < 0.01) return `$${v.toFixed(4)}`
  if (v < 1) return `$${v.toFixed(3)}`
  return `$${v.toFixed(2)}`
}

export function formatTokens(n: number): string {
  const v = Number(n) || 0
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}
