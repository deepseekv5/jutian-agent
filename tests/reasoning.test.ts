/**
 * 思考内容字段归一化测试
 *
 * 回归背景：接了 OpenCode Zen 后思考过程完全不显示——上游推的是
 * `delta.reasoning`（OpenRouter 风格），而代码只认 `reasoning_content`。
 * 模型明明在思考，界面看起来像"不推理"。
 */
import { describe, it, expect } from 'vitest'
import { extractReasoning, hasReasoning } from '../src/shared/reasoning'

describe('extractReasoning', () => {
  it('reasoning_content（DeepSeek / step 系列）', () => {
    expect(extractReasoning({ reasoning_content: '先算乘法' })).toBe('先算乘法')
  })

  // 这条就是本次修的 bug
  it('reasoning（OpenCode Zen / OpenRouter 风格）', () => {
    expect(extractReasoning({ reasoning: 'The user' })).toBe('The user')
  })

  it('thinking（部分网关）', () => {
    expect(extractReasoning({ thinking: '让我想想' })).toBe('让我想想')
  })

  it('reasoning_details（OpenRouter 结构化形式）', () => {
    const d = { reasoning_details: [{ type: 'reasoning.text', text: '第一段' }, { text: '第二段' }] }
    expect(extractReasoning(d)).toBe('第一段第二段')
  })

  it('优先级：reasoning_content 先于 reasoning', () => {
    expect(extractReasoning({ reasoning_content: 'A', reasoning: 'B' })).toBe('A')
  })

  it('空字符串不算有内容', () => {
    expect(extractReasoning({ reasoning: '' })).toBe('')
    expect(extractReasoning({ reasoning_content: '' })).toBe('')
  })

  it('没有思考字段 → 空串', () => {
    expect(extractReasoning({ content: '正文' })).toBe('')
  })

  it('非法输入不抛错', () => {
    expect(extractReasoning(null)).toBe('')
    expect(extractReasoning(undefined)).toBe('')
    expect(extractReasoning('str')).toBe('')
    expect(extractReasoning(123)).toBe('')
  })

  it('reasoning_details 里非对象项被跳过', () => {
    expect(extractReasoning({ reasoning_details: [null, 'x', { text: 'ok' }] })).toBe('ok')
  })
})

describe('hasReasoning', () => {
  it('有内容 → true', () => {
    expect(hasReasoning({ reasoning: 'x' })).toBe(true)
  })

  it('无内容 → false', () => {
    expect(hasReasoning({ content: 'x' })).toBe(false)
    expect(hasReasoning({})).toBe(false)
  })
})
