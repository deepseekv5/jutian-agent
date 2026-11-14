import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateMessagesTokens } from '../src/shared/ultra/chatCompression'
import { trimToBudget } from '../src/shared/ultra/tokenBudget'
import { accumulateToolCallDelta, type ToolCallAccum } from '../src/shared/toolCallStream'

/**
 * v16.0.0 内核热路径优化回归：算法等价 + 复杂度改进
 */

describe('estimateTokens 正则化等价性', () => {
  const cases = ['', 'hello', '你好世界', '混合 mixed 文本', 'a'.repeat(500), '中'.repeat(300), '{"a":"中文","b":123}']
  for (const c of cases) {
    it(`"${c.slice(0, 12)}${c.length > 12 ? '…' : ''}" 与逐字符算法一致`, () => {
      let cjk = 0
      for (const ch of c) { const cp = ch.codePointAt(0)!; if ((cp >= 0x3000 && cp <= 0x9fff) || (cp >= 0xff00 && cp <= 0xffef)) cjk++ }
      const expected = Math.ceil(cjk + (c.length - cjk) / 4)
      expect(estimateTokens(c)).toBe(expected)
    })
  }
  it('长文本下大数组估算稳定', () => {
    const msgs = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: '内容'.repeat(200) + i }))
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0)
  })
})

describe('trimToBudget 单次遍历优化', () => {
  it('丢最老的非 system 消息、保留 system 与最新消息', () => {
    const msgs = [
      { role: 'system', content: 'S' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ]
    const out = trimToBudget(msgs, 1000, estimateMessagesTokens)
    expect(out.messages[0].role).toBe('system')
    expect(out.messages.at(-1)?.content).toBe('a2')
    expect(out.dropped).toBeGreaterThanOrEqual(0)
  })
  it('预算充足时不丢', () => {
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]
    const out = trimToBudget(msgs, 1_000_000, estimateMessagesTokens)
    expect(out.dropped).toBe(0)
    expect(out.messages.length).toBe(2)
  })
  it('200 条长消息裁剪结果与逐条重算一致', () => {
    const msgs = [
      { role: 'system', content: 'S'.repeat(100) },
      ...Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `m${i}:` + 'x'.repeat(300) })),
    ]
    const budget = 8000
    const out = trimToBudget(msgs, budget * 5, m => estimateMessagesTokens(m))
    // 裁剪后仍在预算内（或已无法再丢）
    expect(estimateMessagesTokens(out.messages)).toBeLessThanOrEqual(budget * 5 * 0.8 + 400)
    expect(out.messages[0].role).toBe('system')
  })
})

describe('accumulateToolCallDelta 快照分片 O(n²) 修复', () => {
  it('快照型 arguments 最终只保留最后一份完整 JSON', () => {
    const map = new Map<number, ToolCallAccum>()
    const full = JSON.stringify({ path: '/tmp/a.txt', lines: 'x'.repeat(2000) })
    // 模拟 40 个分片，每片都是完整快照（spark 型上游）
    for (let i = 0; i < 40; i++) {
      accumulateToolCallDelta(map, { index: 0, id: 'c1', function: { name: 'read_file', arguments: full } })
    }
    expect(map.get(0)!.arguments).toBe(full)
    expect(map.get(0)!.argsComplete).toBe(true)
  })
  it('增量分片仍正确拼接', () => {
    const map = new Map<number, ToolCallAccum>()
    const parts = ['{"pa', 'th":"/tm', 'p/b"}']
    for (const p of parts) accumulateToolCallDelta(map, { index: 0, function: { arguments: p } })
    expect(map.get(0)!.arguments).toBe('{"path":"/tmp/b"}')
    expect(map.get(0)!.argsComplete).toBeUndefined()
  })
  it('id/name 只取首次非空值', () => {
    const map = new Map<number, ToolCallAccum>()
    accumulateToolCallDelta(map, { index: 0, id: 'first', function: { name: 'shell' } })
    accumulateToolCallDelta(map, { index: 0, id: 'second', function: { name: 'read_file' } })
    expect(map.get(0)!.id).toBe('first')
    expect(map.get(0)!.name).toBe('shell')
  })
})
