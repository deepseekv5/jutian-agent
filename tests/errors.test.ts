import { describe, it, expect } from 'vitest'
import { classifyError, describeError, errorLine, shouldRetry } from '../src/shared/errors'

// 这组测试锁的是"用户看到什么"：错误必须被翻译成能做行动的提示，
// 而不是把 "TypeError: Failed to fetch" 原样丢给用户。
describe('errors · 归类', () => {
  const cases: [string, unknown][] = [
    ['401 状态', { status: 401 }],
    ['403 状态', { status: 403 }],
    ['密钥无效文案', 'invalid api key'],
    ['429', { status: 429 }],
    ['限流文案', 'rate limit exceeded'],
    ['404 模型', { status: 404, message: 'model not found' }],
    ['余额不足', 'insufficient quota'],
    ['上下文超限', 'maximum context length exceeded'],
    ['内容审核', 'content filter triggered'],
    ['5xx', { status: 502 }],
    ['超时', 'request timeout'],
    ['取消', 'AbortError: aborted'],
    ['断网', 'TypeError: Failed to fetch'],
  ]

  for (const [label, input] of cases) {
    it(`识别 ${label}`, () => {
      const kind = classifyError(input)
      expect(kind).not.toBe('unknown')
    })
  }

  it('401/403 → auth 且不重试', () => {
    for (const s of [401, 403]) {
      const d = describeError({ status: s })
      expect(d.kind).toBe('auth')
      expect(d.retryable).toBe(false)
    }
  })

  it('配额与限流要分开（一个是等，一个是充钱）', () => {
    expect(classifyError('rate limit exceeded')).toBe('rate_limit')
    expect(classifyError('insufficient quota')).toBe('quota')
    expect(shouldRetry('rate limit exceeded')).toBe(true)
    expect(shouldRetry('insufficient quota')).toBe(false)
  })

  it('上下文超限给出开压缩的建议，且不重试', () => {
    const d = describeError('maximum context length is 128000 tokens')
    expect(d.kind).toBe('context')
    expect(d.hint).toMatch(/压缩|新对话/)
    expect(d.retryable).toBe(false)
  })

  it('5xx 归为 server 且可重试', () => {
    const d = describeError({ status: 503 })
    expect(d.kind).toBe('server')
    expect(d.retryable).toBe(true)
  })

  it('从 HTTP 状态文本里也能抠出状态码', () => {
    expect(classifyError('GitHub API 404')).toBe('not_found')
  })

  it('未知错误不假装知道', () => {
    expect(classifyError('something odd happened')).toBe('unknown')
    expect(describeError('something odd happened').retryable).toBe(false)
  })

  it('空输入不炸', () => {
    expect(() => classifyError(null)).not.toThrow()
    expect(() => classifyError(undefined)).not.toThrow()
    expect(classifyError(null)).toBe('unknown')
  })

  it('errorLine 永远给一句完整人话', () => {
    const line = errorLine({ status: 429 })
    expect(line).toContain('限流')
    expect(line.length).toBeGreaterThan(6)
  })

  it('keepDetail 会附原始信息且截断', () => {
    const d = describeError({ status: 500, message: 'x'.repeat(1000) }, { keepDetail: true })
    expect(d.hint.length).toBeLessThan(400)
    expect(d.hint).toContain('详情')
  })
})
