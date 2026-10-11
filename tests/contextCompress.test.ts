/**
 * 上下文压缩策略测试
 *
 * 这里防的是长对话里的两类事故：
 *  1. 压缩后仍超窗——保留区只按条数算，遇到超长消息就白压了
 *  2. 摘要自身膨胀——每次追加新摘要，长对话下摘要变成新的超长上下文
 * 另外「摘要生成失败」必须退回发送原消息，绝不能因为压缩失败丢历史。
 */
import { describe, it, expect } from 'vitest'
import {
  planCompression, mergeSummary, buildCompressedMessages, estimateMsgTokens, estimateMessagesTokens,
  COMPRESS_TOKEN_THRESHOLD, KEEP_RECENT_MIN, KEEP_RECENT_TOKEN_BUDGET, SUMMARY_MAX_CHARS,
  type ApiMsgLike,
} from '../src/renderer/engine/contextCompress'

// 用字符数近似 token（测试里可预测）
const est = (s: string) => s.length

const sys = (n = 100): ApiMsgLike => ({ role: 'system', content: 'x'.repeat(n) })
const msg = (role: string, len: number): ApiMsgLike => ({ role, content: 'y'.repeat(len) })

describe('estimateMsgTokens', () => {
  it('统计 content 长度', () => {
    expect(estimateMsgTokens({ role: 'user', content: 'abc' }, est)).toBe(3)
  })

  it('tool_calls 的 JSON 体积也计入', () => {
    const withTc = estimateMsgTokens({ role: 'assistant', content: '', tool_calls: [{ id: 'a' }] }, est)
    expect(withTc).toBeGreaterThan(0)
  })

  it('content 为对象时序列化后计算', () => {
    expect(estimateMsgTokens({ role: 'user', content: { a: 1 } }, est)).toBeGreaterThan(0)
  })

  it('缺 content 不抛错', () => {
    expect(() => estimateMsgTokens({ role: 'user' }, est)).not.toThrow()
  })
})

describe('planCompression', () => {
  it('短对话不压缩', () => {
    const msgs = [sys(), msg('user', 10), msg('assistant', 10)]
    const p = planCompression(msgs, est)
    expect(p.shouldCompress).toBe(false)
    expect(p.oldChunk).toEqual([])
  })

  it('超过 token 阈值触发压缩', () => {
    const msgs = [sys(), msg('user', COMPRESS_TOKEN_THRESHOLD + 100)]
    expect(planCompression(msgs, est).shouldCompress).toBe(true)
  })

  it('系统提示永远不进入折叠区（丢了就没有人格与规则了）', () => {
    const msgs = [sys(50), ...Array.from({ length: 40 }, () => msg('user', 3000))]
    const p = planCompression(msgs, est)
    expect(p.shouldCompress).toBe(true)
    // oldChunk 是 slice(1, ...) 的结果，不含首条
    expect(p.oldChunk[0]).not.toBe(msgs[0])
    expect(p.oldChunk.every(m => m !== msgs[0])).toBe(true)
  })

  it('保留区至少 KEEP_RECENT_MIN 条（即使每条都很长）', () => {
    const msgs = [sys(), ...Array.from({ length: 30 }, () => msg('user', 20000))]
    const p = planCompression(msgs, est)
    expect(p.recent.length).toBeGreaterThanOrEqual(KEEP_RECENT_MIN)
  })

  it('保留区按 token 预算截断（不会把超长消息全留下）', () => {
    // 末尾 3 条各 20000 字符，远超 KEEP_RECENT_TOKEN_BUDGET
    const msgs = [sys(), ...Array.from({ length: 20 }, () => msg('user', 100)), ...Array.from({ length: 3 }, () => msg('user', 20000))]
    const p = planCompression(msgs, est)
    const recentTokens = estimateMessagesTokens(p.recent, est)
    // 至少要留住 KEEP_RECENT_MIN 条，但不能把三条超长全留下
    expect(p.recent.length).toBeGreaterThanOrEqual(KEEP_RECENT_MIN)
    expect(recentTokens).toBeLessThanOrEqual(KEEP_RECENT_TOKEN_BUDGET + 20000 * KEEP_RECENT_MIN)
  })

  it('折叠区 + 保留区 = 除系统提示外的全部消息（不丢消息）', () => {
    const msgs = [sys(), ...Array.from({ length: 30 }, () => msg('user', 2000))]
    const p = planCompression(msgs, est)
    expect(p.oldChunk.length + p.recent.length).toBe(msgs.length - 1)
  })
})

describe('mergeSummary', () => {
  it('首次生成直接采用', () => {
    expect(mergeSummary('', '摘要A')).toBe('摘要A')
  })

  it('追加合并', () => {
    expect(mergeSummary('摘要A', '摘要B')).toBe('摘要A\n摘要B')
  })

  it('新摘要为空时保持原摘要不变', () => {
    expect(mergeSummary('摘要A', '')).toBe('摘要A')
    expect(mergeSummary('摘要A', '   ')).toBe('摘要A')
  })

  it('总长度封顶（防摘要自身膨胀成新的超长上下文）', () => {
    let s = ''
    for (let i = 0; i < 50; i++) s = mergeSummary(s, 'x'.repeat(500))
    expect(s.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 20)  // 含省略提示行
  })

  it('超限时保留最新内容而非最旧（近期历史更相关）', () => {
    const old = 'OLD'.repeat(1000)   // 3000 字符，已超 SUMMARY_MAX_CHARS
    const fresh = 'FRESH'
    const s = mergeSummary(old, fresh)
    expect(s).toContain(fresh)
    expect(s).toContain('省略')
  })

  it('两侧都空返回空串', () => {
    expect(mergeSummary('', '')).toBe('')
  })
})

describe('buildCompressedMessages', () => {
  it('摘要为空时返回 null（调用方应照常发送原消息，不丢历史）', () => {
    expect(buildCompressedMessages('sys', '', [msg('user', 10)], 5)).toBeNull()
    expect(buildCompressedMessages('sys', '   ', [msg('user', 10)], 5)).toBeNull()
  })

  it('结构为 [系统提示, 摘要, ...保留区]', () => {
    const recent = [msg('user', 10), msg('assistant', 20)]
    const out = buildCompressedMessages('SYS', '摘要', recent, 42)
    expect(out).toHaveLength(4)
    expect(out![0].content).toBe('SYS')
    expect(String(out![1].content)).toContain('摘要')
    expect(String(out![1].content)).toContain('42')
    expect(out!.slice(2)).toEqual(recent)
  })

  it('摘要提示里写明被压缩的消息条数（让模型知道有历史）', () => {
    const out = buildCompressedMessages('SYS', '摘要', [], 7)
    expect(String(out![1].content)).toContain('7 条')
  })
})
