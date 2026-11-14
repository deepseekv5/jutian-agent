/**
 * Token 估算与模型上下文推断测试
 *
 * 这组函数决定「何时提示上下文将满 / 触发压缩」，估算偏差会导致
 * 误压缩（丢上下文）或超窗（请求被上游拒）。此前零测试覆盖。
 */
import { describe, it, expect } from 'vitest'
import { estimateTokens, guessModelContext, fmtTokens, fmtPercent, CONTEXT_LIMIT } from '../src/renderer/utils/tokens'

describe('estimateTokens', () => {
  it('空输入返回 0', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
  })

  it('中文按 1 字 1 token 估算', () => {
    expect(estimateTokens('你好世界')).toBe(4)
  })

  it('英文按 4 字符 1 token 估算', () => {
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('中英混合分别计算后相加', () => {
    // 2 个中文 + 8 个英文 = 2 + 2 = 4
    expect(estimateTokens('你好abcdefgh')).toBe(4)
  })

  it('全角标点计入 CJK（中文排版里标点与汉字同量级）', () => {
    // 全角逗号与句号在 0xff00-0xffef 区间
    expect(estimateTokens('，，')).toBe(2)
  })

  it('向上取整，不低估（宁可早提示也不超窗）', () => {
    expect(estimateTokens('a')).toBe(1)      // 0.25 → 1
    expect(estimateTokens('abc')).toBe(1)    // 0.75 → 1
    expect(estimateTokens('abcde')).toBe(2)  // 1.25 → 2
  })

  it('emoji 等非 CJK 字符按英文口径，不抛错', () => {
    expect(estimateTokens('🚀')).toBeGreaterThan(0)
  })
})

describe('guessModelContext', () => {
  it('未指定模型时回落到 1M 默认窗口', () => {
    expect(guessModelContext(undefined)).toBe(CONTEXT_LIMIT)
    expect(guessModelContext('')).toBe(CONTEXT_LIMIT)
  })

  it('大小写不敏感', () => {
    expect(guessModelContext('GPT-4O')).toBe(128_000)
  })

  it('主流模型系列各自返回合理窗口', () => {
    expect(guessModelContext('gpt-4o')).toBe(128_000)
    expect(guessModelContext('claude-3-5-sonnet')).toBe(200_000)
    expect(guessModelContext('gemini-2.5-pro')).toBe(1_000_000)
    expect(guessModelContext('gpt-3.5-turbo')).toBe(16_000)
  })

  it('更具体的型号优先匹配（deepseek-v4 不能落到 deepseek 的 64K）', () => {
    expect(guessModelContext('deepseek-v4')).toBe(128_000)
    expect(guessModelContext('deepseek-unknown')).toBe(64_000)
  })

  it('未知模型名回落到默认窗口而非 0（0 会导致立即触发压缩）', () => {
    expect(guessModelContext('totally-unknown-model')).toBe(CONTEXT_LIMIT)
  })

  it('所有返回值都是正数', () => {
    for (const m of ['gpt-4o', 'claude', 'qwen', 'glm-4', 'llama', 'x']) {
      expect(guessModelContext(m)).toBeGreaterThan(0)
    }
  })
})

describe('fmtTokens', () => {
  it('千位与百万位分别用 K / M', () => {
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(1234)).toBe('1.2K')
    expect(fmtTokens(1_234_567)).toBe('1.2M')
  })

  it('边界值进位正确，不出现 1000.0K 这类退化写法', () => {
    expect(fmtTokens(999_949)).toBe('999.9K')
    expect(fmtTokens(999_999)).toBe('1.0M')
    expect(fmtTokens(1_000_000)).toBe('1.0M')
  })
})

describe('fmtPercent', () => {
  it('极小非零值显示 <0.1%', () => {
    expect(fmtPercent(0.0001)).toBe('<0.1%')
  })

  it('零显示 0.0%', () => {
    expect(fmtPercent(0)).toBe('0.0%')
  })

  it('常规值保留一位小数', () => {
    expect(fmtPercent(0.5)).toBe('50.0%')
    expect(fmtPercent(0.123)).toBe('12.3%')
  })
})
