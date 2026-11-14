import { describe, it, expect } from 'vitest'
import {
  estimateTokens, totalTokens, microcompact, truncateForBudget,
  isContextOverflowError, isQuotaError, CLEARED_PLACEHOLDER,
} from '../src/shared/contextBudget'

// 上下文预算（v14.5）：长任务跑到后面必然撑爆上下文。
// 两条路径：清空老工具结果（信息损失可预期）、按 token 裁剪（切点必须合法）。

describe('estimateTokens', () => {
  it('中文 ≈ 1 token/字，英文 ≈ 4 字符/token', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })
  it('空值返回 0', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
  })
})

describe('microcompact', () => {
  const mk = (n: number, size = 1000) => Array.from({ length: n }, (_, i) => ({
    role: 'tool' as const, tool_call_id: 't' + i, content: 'x'.repeat(size),
  }))

  it('保留最近 N 条，更早的清空', () => {
    const { messages, cleared } = microcompact(mk(10), { keepRecent: 6 })
    expect(cleared).toBe(4)
    expect(messages[0].content).toBe(CLEARED_PLACEHOLDER)
    expect(messages[9].content).not.toBe(CLEARED_PLACEHOLDER)
  })
  it('条数不足时不动', () => {
    const src = mk(3)
    const { messages, cleared } = microcompact(src, { keepRecent: 6 })
    expect(cleared).toBe(0)
    expect(messages).toBe(src)
  })
  it('短结果不清（阈值以下）', () => {
    const { cleared } = microcompact(mk(10, 100), { keepRecent: 2 })
    expect(cleared).toBe(0)
  })
  it('非 tool 消息不受影响', () => {
    const msgs: any[] = [{ role: 'user', content: 'x'.repeat(5000) }, ...mk(8)]
    const { messages } = microcompact(msgs, { keepRecent: 2 })
    expect(messages[0].content).toBe('x'.repeat(5000))
  })
})

describe('truncateForBudget', () => {
  const sys = { role: 'system', content: 'SYS' }
  const user = (s: string) => ({ role: 'user', content: s })
  const assistantTool = (id: string) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'x', arguments: '{}' } }] })
  const toolMsg = (id: string) => ({ role: 'tool', tool_call_id: id, content: 'r'.repeat(400) })

  it('预算内原样返回', () => {
    const msgs = [sys, user('hi')]
    const r = truncateForBudget(msgs, 10000)
    expect(r.dropped).toBe(0)
    expect(r.messages).toBe(msgs)
  })
  it('超预算时保留 system 与最近消息', () => {
    const msgs: any[] = [sys]
    for (let i = 0; i < 40; i++) msgs.push(user('长文本'.repeat(200)))
    const r = truncateForBudget(msgs, 2000)
    expect(r.dropped).toBeGreaterThan(0)
    expect(r.messages[0]).toEqual(sys)
    expect(r.messages[r.messages.length - 1]).toEqual(msgs[msgs.length - 1])
  })
  it('切点不以 tool 开头', () => {
    const msgs: any[] = [sys]
    for (let i = 0; i < 12; i++) { msgs.push(assistantTool('c' + i)); msgs.push(toolMsg('c' + i)) }
    const r = truncateForBudget(msgs, 600)
    expect(r.messages[1]?.role).not.toBe('tool')
  })
  it('不留悬空 assistant(tool_calls)：切到 assistant 时必须带其 tool 响应', () => {
    const msgs: any[] = [sys]
    for (let i = 0; i < 12; i++) { msgs.push(assistantTool('c' + i)); msgs.push(toolMsg('c' + i)) }
    const r = truncateForBudget(msgs, 600)
    const first = r.messages[1]
    if (first && first.role === 'assistant' && first.tool_calls) {
      expect(r.messages[2]?.role).toBe('tool')
      expect(r.messages[2]?.tool_call_id).toBe((first.tool_calls as any[])[0].id)
    }
  })
  it('预算为 0 时不动（关闭裁剪）', () => {
    const msgs = [sys, user('x'.repeat(9999))]
    expect(truncateForBudget(msgs, 0).messages).toBe(msgs)
  })
})

describe('错误分类', () => {
  it('识别上下文溢出（含中英文表述）', () => {
    expect(isContextOverflowError('This model\'s maximum context length is 8192 tokens')).toBe(true)
    expect(isContextOverflowError('context_length_exceeded')).toBe(true)
    expect(isContextOverflowError('输入过长')).toBe(true)
    expect(isContextOverflowError('invalid api key')).toBe(false)
  })
  it('识别配额/计费错误', () => {
    expect(isQuotaError('insufficient_quota')).toBe(true)
    expect(isQuotaError('insufficient balance')).toBe(true)
    expect(isQuotaError('rate limit')).toBe(false)
  })
})
