import { describe, it, expect } from 'vitest'
import { planBranch, messagesAfter, type BranchableMessage } from '../src/shared/branch'
import { analyzeHealth, type HealthInput } from '../src/shared/chatHealth'
import { shouldPersistDraft, upsertDraft, getDraft, removeDraft, pruneDrafts, estimateInputTokens, inputStats, DRAFT_LIMIT, DRAFT_MIN_LEN, type Draft } from '../src/shared/drafts'

const msgs: BranchableMessage[] = [
  { id: 'm1', role: 'user', content: '帮我写个登录页' },
  { id: 'm2', role: 'assistant', content: '好的，方案A…' },
  { id: 'm3', role: 'user', content: '换成方案B试试' },
  { id: 'm4', role: 'assistant', content: '方案B…' },
]

describe('branch 分支', () => {
  it('从指定消息分叉，包含该条消息', () => {
    const p = planBranch(msgs, 'm2', '登录页')
    expect(p!.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('标题取分支点前最近的用户消息', () => {
    expect(planBranch(msgs, 'm2', '原会话')!.title).toContain('帮我写个登录页')
  })

  it('没有用户消息时退回原标题', () => {
    const p = planBranch([{ id: 'a', role: 'assistant', content: 'x' }], 'a', '原会话')
    expect(p!.title).toContain('原会话')
  })

  it('找不到消息返回 null（不制造空分支）', () => {
    expect(planBranch(msgs, 'nope')).toBeNull()
  })

  it('messagesAfter 返回分叉点之后的消息', () => {
    expect(messagesAfter(msgs, 'm2').map((m) => m.id)).toEqual(['m3', 'm4'])
  })

  it('在最后一条分叉时后面为空', () => {
    expect(messagesAfter(msgs, 'm4')).toEqual([])
  })

  it('备注里写明来源与位置', () => {
    const p = planBranch(msgs, 'm2', '登录页')!
    expect(p.note).toContain('登录页')
    expect(p.note).toContain('2')
  })
})

describe('chatHealth 对话健康度', () => {
  const base: HealthInput = { messageCount: 4, usedTokens: 1000, contextLimit: 128000, toolCalls: 0, failedToolCalls: 0 }

  it('健康对话给出 good', () => {
    const r = analyzeHealth(base)
    expect(r.level).toBe('good')
    expect(r.signals[0].level).toBe('good')
  })

  it('上下文 70% 提示压缩', () => {
    const r = analyzeHealth({ ...base, usedTokens: 128000 * 0.75 })
    expect(r.signals.some((s) => s.action === 'compact')).toBe(true)
    expect(r.level).toBe('notice')
  })

  it('上下文 90% 升级为警告', () => {
    const r = analyzeHealth({ ...base, usedTokens: 128000 * 0.95 })
    expect(r.level).toBe('warn')
  })

  it('工具失败率高时指向诊断', () => {
    const r = analyzeHealth({ ...base, toolCalls: 10, failedToolCalls: 6 })
    const sig = r.signals.find((s) => s.action === 'review-tools')!
    expect(sig.level).toBe('warn')
    expect(sig.detail).toContain('6/10')
  })

  it('失败率低只提示不报警', () => {
    const r = analyzeHealth({ ...base, toolCalls: 10, failedToolCalls: 2 })
    expect(r.signals.find((s) => s.action === 'review-tools')!.level).toBe('notice')
  })

  it('长对话建议新会话', () => {
    const r = analyzeHealth({ ...base, messageCount: 80 })
    expect(r.signals.some((s) => s.action === 'new-session')).toBe(true)
  })

  it('重复提问会被指出', () => {
    const r = analyzeHealth({ ...base, repeatedQuestions: 2 })
    expect(r.signals.some((s) => s.title.includes('重复'))).toBe(true)
  })

  it('分数在 0-100 且越糟越低', () => {
    const good = analyzeHealth(base).score
    const bad = analyzeHealth({ ...base, usedTokens: 128000 * 0.95, toolCalls: 10, failedToolCalls: 8, messageCount: 80 }).score
    expect(good).toBeGreaterThan(bad)
    expect(bad).toBeGreaterThanOrEqual(0)
    expect(good).toBeLessThanOrEqual(100)
  })

  it('contextLimit 为 0 时不除零', () => {
    expect(() => analyzeHealth({ ...base, contextLimit: 0 })).not.toThrow()
  })
})

describe('drafts 草稿', () => {
  it('短草稿不落盘', () => {
    expect(shouldPersistDraft('hi')).toBe(false)
    expect(shouldPersistDraft('x'.repeat(DRAFT_MIN_LEN))).toBe(true)
  })

  it('写入后可读回', () => {
    const l = upsertDraft([], 's1', '一段足够长的草稿内容，测试用', 1000)
    expect(getDraft(l, 's1')).toBe('一段足够长的草稿内容，测试用')
  })

  it('同一会话覆盖而不是追加', () => {
    let l = upsertDraft([], 's1', '第一版内容足够长，测试用文本', 1000)
    l = upsertDraft(l, 's1', '第二版内容足够长，测试用文本', 2000)
    expect(l.length).toBe(1)
    expect(getDraft(l, 's1')).toBe('第二版内容足够长，测试用文本')
  })

  it('清空文本会删除草稿', () => {
    let l = upsertDraft([], 's1', '内容足够长的一段草稿，测试用', 1000)
    l = upsertDraft(l, 's1', '', 2000)
    expect(l.length).toBe(0)
  })

  it('数量上限：丢最旧的', () => {
    let l: Draft[] = []
    for (let i = 0; i < DRAFT_LIMIT + 5; i++) l = upsertDraft(l, `s${i}`, '足够长的草稿内容，测试用文本', 1000 + i)
    expect(l.length).toBe(DRAFT_LIMIT)
    expect(l.some((d) => d.sessionId === 's0')).toBe(false)
  })

  it('删除指定草稿', () => {
    const l = removeDraft(upsertDraft([], 's1', '足够长的内容草稿，测试用文本', 1), 's1')
    expect(l.length).toBe(0)
  })

  it('过期清理', () => {
    const old = upsertDraft([], 's1', '足够长的内容草稿，测试用文本', 0)
    expect(pruneDrafts(old, 20 * 86400_000).length).toBe(0)
    expect(pruneDrafts(old, 1000).length).toBe(1)
  })
})

describe('drafts 输入统计', () => {
  it('中文按字计', () => {
    expect(estimateInputTokens('你好世界')).toBe(4)
  })

  it('英文按 4 字符 1 token', () => {
    expect(estimateInputTokens('abcdefgh')).toBe(2)
  })

  it('空文本为 0', () => {
    expect(estimateInputTokens('')).toBe(0)
  })

  it('字数与 token 都给出', () => {
    const s = inputStats('你好 world')
    expect(s.chars).toBe(8)
    expect(s.tokens).toBeGreaterThan(0)
  })

  it('给了单价才估算花费', () => {
    expect(inputStats('你好').estimatedCostUSD).toBeUndefined()
    expect(inputStats('你好', 2.5)!.estimatedCostUSD!).toBeGreaterThan(0)
  })
})
