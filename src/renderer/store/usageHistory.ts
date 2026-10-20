/**
 * 逐条用量明细（v12）
 *
 * 旧的 store/usage.ts 按「天+模型」聚合，够首页显示，但算不了
 * 成本趋势、单次请求成本、预算。这里另存一份明细（环形缓冲），
 * 两者互不影响：聚合表继续给小部件用，明细给用量面板用。
 *
 * 存储刻意用 safeStorage（真持久化失败时降级内存，不炸 UI）。
 */
import { readJson, writeJson, validators } from '../utils/safeStorage'

export interface UsageLike {
  ts: number
  model: string
  provider?: string
  promptTokens: number
  completionTokens: number
  costUSD?: number
}

const KEY = 'usage-records'
/** 明细上限：约 2000 条足够覆盖 90 天重度使用，再大就只留聚合 */
const MAX_RECORDS = 2000

function isValid(v: unknown): v is UsageLike[] {
  return Array.isArray(v) && v.every((r) => r && typeof r === 'object' && typeof (r as UsageLike).ts === 'number')
}

export function loadUsageRecords(): UsageLike[] {
  return readJson<UsageLike[]>(KEY, [], isValid)
}

export function appendUsageRecord(r: UsageLike): void {
  const list = loadUsageRecords()
  list.push({
    ts: Number(r.ts) || Date.now(),
    model: String(r.model || 'unknown'),
    provider: r.provider ? String(r.provider) : undefined,
    promptTokens: Math.max(0, Number(r.promptTokens) || 0),
    completionTokens: Math.max(0, Number(r.completionTokens) || 0),
    costUSD: typeof r.costUSD === 'number' && Number.isFinite(r.costUSD) ? r.costUSD : undefined,
  })
  // 环形裁剪：保留最近 MAX_RECORDS 条
  const trimmed = list.length > MAX_RECORDS ? list.slice(list.length - MAX_RECORDS) : list
  writeJson(KEY, trimmed)
  try { window.dispatchEvent(new CustomEvent('usage-updated')) } catch { /* ignore */ }
}

export function clearUsageRecords(): void {
  writeJson(KEY, [])
  try { window.dispatchEvent(new CustomEvent('usage-updated')) } catch { /* ignore */ }
}

export const USAGE_VALIDATOR = validators.object
