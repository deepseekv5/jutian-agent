import { describe, it, expect } from 'vitest'
import {
  shouldRetryHttp, backoffMs, parseRetryAfter, MAX_ATTEMPTS, BACKOFF_CAP_MS, RETRY_AFTER_CAP_MS,
} from '../src/renderer/engine/retry'

// LLM 瞬时错误重试（v13.11）：免费线路高峰 429/502/503 很常见，
// 旧实现直接报错打断对话。判据必须是纯函数，边界要钉死。

describe('backoffMs', () => {
  it('指数退避：800 / 1600 / 3200', () => {
    expect(backoffMs(1)).toBe(800)
    expect(backoffMs(2)).toBe(1600)
    expect(backoffMs(3)).toBe(3200)
  })
  it('封顶 8s，非法入参按 1 处理', () => {
    expect(backoffMs(10)).toBe(BACKOFF_CAP_MS)
    expect(backoffMs(0)).toBe(800)
    expect(backoffMs(-5)).toBe(800)
  })
})

describe('parseRetryAfter', () => {
  it('秒数解析并封顶', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('999')).toBe(RETRY_AFTER_CAP_MS)
  })
  it('HTTP 日期解析为剩余毫秒', () => {
    const now = Date.parse('2026-10-31T10:00:00Z')
    expect(parseRetryAfter('Sat, 31 Oct 2026 10:00:05 GMT', now)).toBe(5000)
  })
  it('过去时间/空值/垃圾值返回 null', () => {
    const now = Date.parse('2026-10-31T10:00:00Z')
    expect(parseRetryAfter('Sat, 31 Oct 2026 09:59:00 GMT', now)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
    expect(parseRetryAfter('0')).toBeNull()
  })
})

describe('shouldRetryHttp', () => {
  it('限流与上游过载可重试', () => {
    for (const status of [429, 500, 502, 503, 504, 529, 408, 425]) {
      expect(shouldRetryHttp(status, 1).retry, String(status)).toBe(true)
    }
  })
  it('配置类错误不重试（重试无意义，直接给可操作提示）', () => {
    for (const status of [400, 401, 403, 404, 422, 402]) {
      const d = shouldRetryHttp(status, 1)
      expect(d.retry, String(status)).toBe(false)
      expect(d.delayMs).toBe(0)
    }
  })
  it('达到最大尝试次数后不再重试', () => {
    expect(shouldRetryHttp(503, MAX_ATTEMPTS - 1).retry).toBe(true)
    expect(shouldRetryHttp(503, MAX_ATTEMPTS).retry).toBe(false)
    expect(shouldRetryHttp(503, MAX_ATTEMPTS + 3).retry).toBe(false)
  })
  it('优先采用 Retry-After，缺失时用退避', () => {
    expect(shouldRetryHttp(429, 1, '3').delayMs).toBe(3000)
    expect(shouldRetryHttp(429, 1, null).delayMs).toBe(800)
    expect(shouldRetryHttp(429, 2).delayMs).toBe(1600)
  })
})
