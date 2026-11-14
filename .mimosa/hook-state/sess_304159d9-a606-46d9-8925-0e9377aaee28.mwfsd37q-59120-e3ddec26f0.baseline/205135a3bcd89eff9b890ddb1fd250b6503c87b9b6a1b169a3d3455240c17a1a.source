import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { backoffDelay, isIdempotentMethod, apiFetch, apiJson, ApiError, fetchOnce } from '../src/shared/apiClient'

describe('apiClient · 基础判定', () => {
  it('幂等方法只认 GET/HEAD/OPTIONS', () => {
    expect(isIdempotentMethod('get')).toBe(true)
    expect(isIdempotentMethod('HEAD')).toBe(true)
    expect(isIdempotentMethod('POST')).toBe(false)
    expect(isIdempotentMethod('DELETE')).toBe(false)
  })

  it('退避延迟递增且有抖动区间', () => {
    const d0 = Array.from({ length: 40 }, () => backoffDelay(0, 400))
    const d3 = Array.from({ length: 40 }, () => backoffDelay(3, 400))
    // 第 0 次：400 * [0.5, 1] = 200~400
    expect(Math.min(...d0)).toBeGreaterThanOrEqual(200)
    expect(Math.max(...d0)).toBeLessThanOrEqual(400)
    // 第 3 次：3200 * [0.5, 1] = 1600~3200
    expect(Math.min(...d3)).toBeGreaterThanOrEqual(1600)
    expect(Math.max(...d3)).toBeLessThanOrEqual(3200)
    // 抖动：多次采样不该全都相等
    expect(new Set(d0).size).toBeGreaterThan(1)
  })

  it('退避有上限，不会无限增长', () => {
    expect(backoffDelay(50, 400, 8000)).toBeLessThanOrEqual(8000)
  })
})

describe('apiClient · 错误归一（用假 fetch）', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('非 2xx 抛 http 错误并带状态码', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any
    await expect(fetchOnce('/x')).rejects.toMatchObject({ kind: 'http', status: 500 })
  })

  it('4xx 不可重试，5xx 可重试', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 404 })) as any
    await expect(fetchOnce('/x')).rejects.toMatchObject({ retryable: false })
    globalThis.fetch = vi.fn(async () => new Response('err', { status: 503 })) as any
    await expect(fetchOnce('/x')).rejects.toMatchObject({ retryable: true })
  })

  it('网络异常归一为 network', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as any
    await expect(fetchOnce('/x')).rejects.toMatchObject({ kind: 'network', retryable: true })
  })

  it('超时归一为 timeout（即使底层抛 AbortError）', async () => {
    globalThis.fetch = vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => {
        const e: any = new Error('aborted'); e.name = 'AbortError'; rej(e)
      })
    })) as any
    await expect(fetchOnce('/x', { timeoutMs: 10 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('调用方取消归一为 abort（不当作超时）', async () => {
    const ctl = new AbortController()
    globalThis.fetch = vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
      const fire = () => { const e: any = new Error('aborted'); e.name = 'AbortError'; rej(e) }
      if (init.signal.aborted) fire()
      else init.signal.addEventListener('abort', fire)
    })) as any
    const p = fetchOnce('/x', { signal: ctl.signal, timeoutMs: 0 })
    ctl.abort()
    await expect(p).rejects.toMatchObject({ kind: 'abort' })
  })

  it('JSON 解析失败抛 parse，而不是返回 undefined', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>oops</html>', { status: 200 })) as any
    await expect(apiJson('/x')).rejects.toMatchObject({ kind: 'parse' })
  })

  it('POST 默认不重试（避免重复写入）', async () => {
    const spy = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    globalThis.fetch = spy as any
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('GET 默认重试 2 次后抛错', async () => {
    const spy = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    globalThis.fetch = spy as any
    await expect(apiFetch('/x', { retries: 2 })).rejects.toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalledTimes(3) // 首次 + 2 次重试
    expect(spy).toHaveBeenCalled()
  }, 20000)

  it('成功响应不重试', async () => {
    const spy = vi.fn(async () => new Response('{"ok":1}', { status: 200 }))
    globalThis.fetch = spy as any
    const j = await apiJson<{ ok: number }>('/x')
    expect(j.ok).toBe(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
