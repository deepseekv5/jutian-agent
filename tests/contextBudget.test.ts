import { describe, it, expect } from 'vitest'
import {
  estimateTokens, totalTokens, microcompact, truncateForBudget,
  isContextOverflowError, isQuotaError, CLEARED_PLACEHOLDER,
} from '../src/shared/contextBudget'
import { estimateTokens as rendererEstimateTokens } from '../src/renderer/utils/tokens'
import { estimateTokens as ultraEstimateTokens } from '../src/shared/ultra/chatCompression'
import { estimateTokens as superEstimateTokens } from '../src/shared/super/signals/extractor'
import { estimateTextTokens, estimateMessagesTokens } from '../src/shared/super/context/assembler'

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

describe('isContextOverflowError 上游形态覆盖', () => {
  it('OpenAI：maximum context length 提示与 context_length_exceeded 错误码', () => {
    expect(isContextOverflowError(
      "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens. Please reduce the length of the messages.",
    )).toBe(true)
    expect(isContextOverflowError(
      "Error code: context_length_exceeded - This model's maximum context length is 4097 tokens",
    )).toBe(true)
  })
  it('Anthropic：prompt is too long 与 exceed context limit 两种形态', () => {
    expect(isContextOverflowError('Your prompt is too long: 250000 tokens > 200000 maximum')).toBe(true)
    expect(isContextOverflowError('input length and max_tokens exceed context limit: 210000 tokens > 200000 maximum')).toBe(true)
  })
  it('本地网关：context_length_exceeded 错误码（嵌在 JSON 错误体里也能识别）', () => {
    expect(isContextOverflowError('{"error":{"code":"context_length_exceeded","message":"request too large"}}')).toBe(true)
  })
  it('中文：上下文过长 / 超出上下文 / 上下文太长', () => {
    expect(isContextOverflowError('请求失败：上下文过长，请精简后重试')).toBe(true)
    expect(isContextOverflowError('已超出上下文窗口限制')).toBe(true)
    expect(isContextOverflowError('对话上下文太长，无法继续')).toBe(true)
    expect(isContextOverflowError('上下文超出模型限制')).toBe(true)
  })
  it('不误伤其它错误', () => {
    expect(isContextOverflowError('rate limit exceeded, retry after 30s')).toBe(false)
    expect(isContextOverflowError('connection reset by peer')).toBe(false)
    expect(isContextOverflowError('')).toBe(false)
    expect(isContextOverflowError(undefined as unknown as string)).toBe(false)
  })
})

describe('truncateForBudget 工具配对完整性', () => {
  const sys = { role: 'system', content: 'SYS' }

  /** 历史合法性：保留区不以 tool 开头；每个 tool_calls 的 id 都有响应；每条 tool 都能找到声明该 id 的 assistant */
  function expectLegalHistory(msgs: any[]) {
    const body = [...msgs]
    while (body.length && body[0].role === 'system') body.shift()
    expect(body[0]?.role).not.toBe('tool')
    for (let i = 0; i < body.length; i++) {
      const m = body[i]
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const answered = new Set<string>()
        for (let j = i + 1; j < body.length && body[j].role === 'tool'; j++) answered.add(String(body[j].tool_call_id))
        for (const tc of m.tool_calls) expect(answered.has(String(tc.id))).toBe(true)
      }
      if (m.role === 'tool') {
        const owner = body.slice(0, i).some(
          (p) => p.role === 'assistant' && Array.isArray(p.tool_calls)
            && p.tool_calls.some((tc: any) => String(tc.id) === String(m.tool_call_id)),
        )
        expect(owner).toBe(true)
      }
    }
  }

  /** 并行 tool_calls 组：assistant 声明 a/b 两个调用，响应大小不等（制造中间切点） */
  const parallelPair = (i: number, sizeA: number) => [
    { role: 'assistant', content: '', tool_calls: [
      { id: 'a' + i, type: 'function', function: { name: 'x', arguments: '{}' } },
      { id: 'b' + i, type: 'function', function: { name: 'y', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'a' + i, content: 'A'.repeat(sizeA) },
    { role: 'tool', tool_call_id: 'b' + i, content: 'B'.repeat(120) },
  ]

  it('并行 tool_calls：预算切进组内时整组同进退，任何预算下历史都合法', () => {
    const msgs: any[] = [sys]
    for (let i = 0; i < 8; i++) msgs.push(...parallelPair(i, 250 * (i + 1)))
    msgs.push({ role: 'user', content: 'end' })
    for (let budget = 100; budget <= 2600; budget += 50) {
      expectLegalHistory(truncateForBudget(msgs, budget).messages)
    }
  })
  it('组放得下时整组保留（不白白多丢上下文），组放不下时整组丢弃', () => {
    // 大块旧 user 顶爆预算，切点落在 assistant 上：组放得下 → 整组保留，只丢大块 user
    const msgs: any[] = [
      sys,
      { role: 'user', content: 'x'.repeat(4000) },
      ...parallelPair(0, 2000),
      { role: 'user', content: 'mid' },
      { role: 'user', content: 'end' },
    ]
    const r = truncateForBudget(msgs, 900)
    expect(r.dropped).toBe(1)
    const body = r.messages.filter((m) => m.role !== 'system')
    expect(body[0].role).toBe('assistant')
    expect(body.some((m) => m.role === 'tool' && m.tool_call_id === 'a0')).toBe(true)
    expect(body.some((m) => m.role === 'tool' && m.tool_call_id === 'b0')).toBe(true)
    expectLegalHistory(r.messages)
    // 组放不下（预算顶到组内大响应）→ 整组丢弃，绝不留半个组
    const r2 = truncateForBudget(msgs, 300)
    expectLegalHistory(r2.messages)
    const body2 = r2.messages.filter((m) => m.role !== 'system')
    const hasAssistant = body2.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
    expect(hasAssistant).toBe(body2.some((m) => m.role === 'tool' && m.tool_call_id === 'a0'))
    expect(hasAssistant).toBe(body2.some((m) => m.role === 'tool' && m.tool_call_id === 'b0'))
  })
  it('孤儿 tool（tool_call_id 对不上）不会成为保留区开头（上游 400 翻车点）', () => {
    const msgs: any[] = [
      sys,
      { role: 'user', content: 'x'.repeat(4000) },   // 大块旧输入，逼出裁剪切点
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'bad-id', content: 'r'.repeat(8) },
      { role: 'user', content: 'u1' }, { role: 'user', content: 'u2' },
      { role: 'user', content: 'u3' }, { role: 'user', content: 'u4' },
    ]
    const r = truncateForBudget(msgs, 50)
    expect(r.messages[1]?.role).not.toBe('tool')
    expectLegalHistory(r.messages)
  })
  it('整段历史少于 4 条且超预算时保住全部，绝不丢当前用户输入', () => {
    const msgs: any[] = [sys, { role: 'user', content: 'x'.repeat(9999) }]
    const r = truncateForBudget(msgs, 100)
    expect(r.messages[0]).toEqual(sys)
    expect(r.messages[r.messages.length - 1]).toEqual({ role: 'user', content: 'x'.repeat(9999) })
    expect(r.dropped).toBe(0)
  })
  it('多预算档位扫描：悬空 tool 与悬空 tool_calls 都不出现', () => {
    const msgs: any[] = [sys]
    for (let i = 0; i < 10; i++) msgs.push(...parallelPair(i, 300))
    msgs.push({ role: 'user', content: 'end' })
    for (const budget of [200, 400, 800, 1600, 3200]) {
      expectLegalHistory(truncateForBudget(msgs, budget).messages)
    }
  })
})

describe('totalTokens 估算交叉验证', () => {
  // 只做口径交叉验证（同文本各估算器应在同一数量级），不强行统一实现：
  // renderer/utils/tokens 与 contextBudget 同源；ultra/chatCompression 同源；
  // super/signals/extractor 按词计；super/context/assembler 按 profile 计（含结构开销）。
  const samples = [
    '这是一段纯中文的技术讨论，涉及上下文预算与压缩策略的取舍，以及对长任务跑崩上游窗口的防御。',
    'The context budget engine truncates old tool results and repairs the cut point so tool calls stay paired with their responses.',
    '混合文本：truncateForBudget 会修复切点并保留 system 提示词；token 估算按中英混合口径，误差可接受。',
    '错误码 context_length_exceeded 出现于 2026-11-20，重试 3 次均失败（exit=1, cost=$0.02）。',
  ]

  it('四个估算器对同一段文本的输出在同一数量级（max/min ≤ 10）', () => {
    for (const s of samples) {
      const vals = [
        estimateTokens(s),           // shared/contextBudget
        rendererEstimateTokens(s),   // renderer/utils/tokens
        ultraEstimateTokens(s),      // shared/ultra/chatCompression
        superEstimateTokens(s),      // shared/super/signals/extractor（按词计）
        estimateTextTokens(s),       // shared/super/context/assembler（profile 计）
      ].filter((v) => v > 0)
      const ratio = Math.max(...vals) / Math.min(...vals)
      expect(ratio).toBeLessThanOrEqual(10)
    }
  })

  it('消息级估算：totalTokens 与 assembler.estimateMessagesTokens 同数量级', () => {
    const msgs = [
      { role: 'system', content: '你是本地助手，遵守上下文预算策略。' },
      { role: 'user', content: '帮我总结 src/shared 目录的改动，用中文回复。' },
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"src/shared"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'contextBudget.ts\nchatCompression.ts\nagentLoop.ts' },
      { role: 'assistant', content: '这三个文件分别负责预算裁剪、对话压缩与循环调度。' },
      { role: 'user', content: '继续，把风险点也列出来。' },
    ]
    const a = totalTokens(msgs)
    const b = estimateMessagesTokens(msgs as any)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(0)
    const ratio = Math.max(a, b) / Math.min(a, b)
    expect(ratio).toBeLessThanOrEqual(10)
  })

  it('中英混合文本下估算单调：更长的文本估算值不减小', () => {
    const s = '混合文本 mixed text：token 估算 tokens estimate。'
    const longer = s + s + s
    expect(totalTokens([{ role: 'user', content: longer }]))
      .toBeGreaterThanOrEqual(totalTokens([{ role: 'user', content: s }]))
  })
})
