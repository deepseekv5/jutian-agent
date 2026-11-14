/**
 * JT Core Ultra / retry —— gemini-cli utils/retry.ts 全量移植
 * 10 次尝试、5s→30s 抖动退避、429/499/5xx 可重试、Retry-After 截止期、
 * shouldRetryOnContent 重触发、静默容量/校验次数上限、有界模型回落。
 * 零依赖（Apache-2.0）。
 */
export const DEFAULT_MAX_ATTEMPTS = 10
export const INITIAL_DELAY_MS = 5000
export const MAX_DELAY_MS = 30000
export const JITTER_FACTOR = 0.3
export const QUOTA_JITTER = 0.2
export const MAX_SILENT_CAPACITY_ATTEMPTS = 3
export const MAX_VALIDATION_ATTEMPTS = 3
const RETRYABLE_STATUS = new Set([429, 499, 500, 502, 503, 504, 529])
/** SSL / 网络层错误码（gemini-cli 一并重试） */
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_SSL_WRONG_VERSION_NUMBER'])

export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  /** 内容级重触发：模型回了空内容/坏 JSON 也可重试 */
  shouldRetryOnContent?: (content: string) => boolean
  /** 静默容量错误（无响应体 429）计数上限 */
  onSilentCapacity?: () => boolean
  rng?: () => number
}
export interface RetryDecision { retry: boolean; delayMs: number; reason: string }

export function isRetryableStatus(status: number): boolean { return RETRYABLE_STATUS.has(status) }
export function isRetryableCode(code: string): boolean { return RETRYABLE_CODES.has(String(code || '')) }

/** 普通退避：×2 + ±30% 抖动，封顶 30s */
export function delayWithJitter(attempt: number, opts: RetryOptions = {}): number {
  const init = opts.initialDelayMs ?? INITIAL_DELAY_MS
  const cap = opts.maxDelayMs ?? MAX_DELAY_MS
  const rng = opts.rng ?? Math.random
  const raw = init * Math.pow(2, Math.max(0, attempt - 1))
  const capped = Math.min(raw, cap)
  return Math.max(0, Math.round(capped + capped * JITTER_FACTOR * (rng() * 2 - 1)))
}
/** 配额错误：尊重服务端 retryDelayMs 下限，向上 +20% 抖动 */
export function quotaDelay(serverDelayMs: number | null, opts: RetryOptions = {}): number {
  const init = opts.initialDelayMs ?? INITIAL_DELAY_MS
  const rng = opts.rng ?? Math.random
  const floor = Math.max(init, serverDelayMs || 0)
  return Math.round(floor * (1 + QUOTA_JITTER * rng()))
}
/** Retry-After 解析：秒数或 HTTP 日期 → 相对毫秒（绝对截止期语义由调用方持有） */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const v = value.trim()
  const secs = Number(v)
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) && t > now ? t - now : null
}

/** 单次决策：综合状态 / 内容 / 容量 / 次数上限 */
export function decideRetry(status: number, attempt: number, opts: RetryOptions = {}, extras: { content?: string; serverDelayMs?: number | null; silentCapacity?: number; validationFailures?: number } = {}): RetryDecision {
  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (attempt >= max) return { retry: false, delayMs: 0, reason: `已达最大尝试次数 ${max}` }
  if (!isRetryableStatus(status)) {
    if (status === 0 && opts.shouldRetryOnContent && extras.content !== undefined && opts.shouldRetryOnContent(extras.content)) {
      return { retry: true, delayMs: delayWithJitter(attempt, opts), reason: '内容级重触发' }
    }
    return { retry: false, delayMs: 0, reason: `${status} 不可重试（配置或参数问题，永不重试 400 类）` }
  }
  if ((extras.silentCapacity || 0) >= MAX_SILENT_CAPACITY_ATTEMPTS) return { retry: false, delayMs: 0, reason: '静默容量错误次数超限' }
  if ((extras.validationFailures || 0) >= MAX_VALIDATION_ATTEMPTS) return { retry: false, delayMs: 0, reason: '响应校验失败次数超限' }
  const delay = status === 429 ? quotaDelay(extras.serverDelayMs ?? null, opts) : delayWithJitter(attempt, opts)
  return { retry: true, delayMs: delay, reason: `上游 ${status}，第 ${attempt + 1} 次重试` }
}

/** 有界模型回落：失败达到阈值时切下一个模型，且回落次数封顶 */
export class ModelFallback {
  private idx = 0
  private resets = 0
  constructor(private models: string[], private maxResets = 2) {}
  get current(): string { return this.models[this.idx] || '' }
  /** 返回是否还能回落 */
  fallback(): boolean {
    if (this.idx + 1 >= this.models.length) return false
    this.idx++; this.resets++
    return this.resets <= this.maxResets
  }
  reset(): void { this.idx = 0 }
  get exhausted(): boolean { return this.resets > this.maxResets }
}
