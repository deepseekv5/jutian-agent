/**
 * LLM 请求重试策略（v13.11）
 *
 * 现状痛点：免费线路与高峰期上游经常回 429（限流）/ 502 / 503 / 504，
 * 旧实现只对「网络层异常」重试一次固定 600ms，业务层的限流错误直接把
 * 对话打断——用户看到一条红色报错，得手动重发。
 *
 * 这里把「哪些错该重试、等多久」抽成纯函数：
 *   - 可重试：429 / 408 / 425 / 500 / 502 / 503 / 504 / 529（上游过载）
 *   - 不重试：400 / 401 / 403 / 404 / 422（配置或参数问题，重试无意义）
 *   - 尊重 Retry-After 头（秒数或 HTTP 日期），上限 10s
 *   - 指数退避：800ms → 1.6s → 3.2s（上限 8s）
 */

/** 最多尝试次数（含首次） */
export const MAX_ATTEMPTS = 3
/** 退避基数 */
export const BACKOFF_BASE_MS = 800
/** 退避上限 */
export const BACKOFF_CAP_MS = 8_000
/** 尊重 Retry-After 的上限（避免上游要求等几分钟把用户晾住） */
export const RETRY_AFTER_CAP_MS = 10_000

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529])

/** 指数退避：800 / 1600 / 3200，封顶 8s */
export function backoffMs(attempt: number, baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS): number {
  const n = Math.max(1, Math.floor(attempt))
  const raw = baseMs * Math.pow(2, n - 1)
  return Math.min(raw, capMs)
}

/**
 * 解析 Retry-After：支持秒数（"30"）与 HTTP 日期（"Wed, 21 Oct 2015 07:28:00 GMT"）。
 * 解析失败或非正数返回 null。
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) {
    const sec = Number(v)
    return sec > 0 ? Math.min(sec * 1000, RETRY_AFTER_CAP_MS) : null
  }
  const at = Date.parse(v)
  if (Number.isNaN(at)) return null
  const delta = at - now
  return delta > 0 ? Math.min(delta, RETRY_AFTER_CAP_MS) : null
}

export interface RetryDecision {
  retry: boolean
  /** 本次重试前应等待的毫秒数（不重试时为 0） */
  delayMs: number
  reason: string
}

/**
 * 是否应重试某个 HTTP 状态。
 * @param attempt 当前是第几次尝试（1 = 首次）
 * @param retryAfterHeader 上游 Retry-After 头原文
 */
export function shouldRetryHttp(
  status: number,
  attempt: number,
  retryAfterHeader?: string | null,
  now = Date.now(),
): RetryDecision {
  if (!RETRYABLE_STATUS.has(status)) {
    return { retry: false, delayMs: 0, reason: `${status} 不可重试（配置或参数问题）` }
  }
  if (attempt >= MAX_ATTEMPTS) {
    return { retry: false, delayMs: 0, reason: `${status} 已达最大尝试次数（${MAX_ATTEMPTS}）` }
  }
  const hinted = parseRetryAfter(retryAfterHeader, now)
  const delayMs = hinted ?? backoffMs(attempt)
  return {
    retry: true,
    delayMs,
    reason: hinted != null ? `${status}，按 Retry-After 等待 ${delayMs}ms` : `${status}，退避 ${delayMs}ms 后重试`,
  }
}

/** 重试过程给用户看的短说明（界面状态条用，不暴露技术细节过多） */
export function retryNotice(attempt: number, reason: string): string {
  return `第 ${attempt}/${MAX_ATTEMPTS} 次尝试：${reason}`
}

/** 可中止的等待 */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/**
 * 带重试的 fetch（v13.11）：网络异常与 429/5xx 按退避重试，
 * 重试耗尽时返回**最后一次响应**（不抛错），让调用方沿用原有错误处理与文案。
 * 只重试「响应头已到、还没读 body」的阶段，已开始的流不会被重发。
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  opts?: { signal?: AbortSignal | null; maxAttempts?: number },
): Promise<Response> {
  const max = Math.max(1, opts?.maxAttempts ?? MAX_ATTEMPTS)
  let lastRes: Response | null = null
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const res = await fetch(input, init)
      if (res.ok) return res
      const decision = shouldRetryHttp(res.status, attempt, res.headers.get('retry-after'))
      if (!decision.retry) return res
      lastRes = res
      // 丢弃本次响应体，避免连接悬挂
      try { await res.body?.cancel() } catch { /* 忽略 */ }
      await sleep(decision.delayMs, opts?.signal)
    } catch (e) {
      if (opts?.signal?.aborted) throw e
      lastErr = e
      if (attempt >= max) throw e
      await sleep(backoffMs(attempt), opts?.signal)
    }
  }
  if (lastRes) return lastRes
  throw lastErr ?? new Error('请求失败：未知原因')
}
