/**
 * 思考内容提取测试（API 分支）
 *
 * 回归背景：接了 OpenCode Zen 后思考过程不显示，排查发现
 * stream.ts 的 **本地模型分支** 有 reasoning 处理，而 **API 分支**
 * 只读 delta.content —— 两处各写各的，改一处漏一处。
 *
 * 这里把"从 SSE delta 里取思考"这件事独立测，覆盖上游实际用过的
 * 所有字段名，避免再出现"某个分支忘了读"。
 */
import { describe, it, expect } from 'vitest'
import { extractReasoning } from '../src/shared/reasoning'

/** 模拟 stream.ts 两个分支共同的取值逻辑 */
const takeThinking = (delta: unknown): string => extractReasoning(delta)

describe('API 分支的思考提取', () => {
  // OpenCode Zen 实际推的形态（OpenRouter 风格）
  it('delta.reasoning → 能取到（Zen 的真实形态）', () => {
    const deltas = [
      { content: '', role: 'assistant', reasoning: 'The' },
      { content: '', reasoning: ' user' },
      { content: '', reasoning: ' is' },
    ]
    const got = deltas.map(takeThinking).join('')
    expect(got).toBe('The user is')
  })

  it('delta.reasoning_content → 能取到（DeepSeek / step）', () => {
    expect(takeThinking({ reasoning_content: '先算乘法' })).toBe('先算乘法')
  })

  it('delta.reasoning_details → 能取到（OpenRouter 结构化）', () => {
    expect(takeThinking({ reasoning_details: [{ text: 'A' }, { text: 'B' }] })).toBe('AB')
  })

  it('只有 content 时不误取思考', () => {
    expect(takeThinking({ content: '正文内容' })).toBe('')
  })

  it('同时有 content 与 reasoning 时互不干扰', () => {
    const d = { content: '答案', reasoning: '思考' }
    expect(takeThinking(d)).toBe('思考')
  })

  it('reasoning 为空串 → 不产生空回调', () => {
    expect(takeThinking({ reasoning: '' })).toBe('')
  })

  it('delta 为 undefined / null 不抛错', () => {
    expect(takeThinking(undefined)).toBe('')
    expect(takeThinking(null)).toBe('')
  })
})

describe('累积行为', () => {
  it('多分片拼接成完整思考', () => {
    const chunks = ['让', '我', '想', '想']
    let acc = ''
    for (const c of chunks) acc += takeThinking({ reasoning: c })
    expect(acc).toBe('让我想想')
  })

  // 回归：fullThinking 曾声明在工具循环内，导致跨轮思考丢失
  it('跨轮累积不丢（工具调用前后的思考都要留）', () => {
    let acc = ''
    acc += takeThinking({ reasoning: '第一轮思考' })
    // 中间发生工具调用，然后第二轮继续思考
    acc += takeThinking({ reasoning: '第二轮思考' })
    expect(acc).toBe('第一轮思考第二轮思考')
  })
})
