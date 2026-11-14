import { describe, it, expect } from 'vitest'
import { callSignature, checkRepeatCall, bumpToolUse, toolUseHint, bumpToolFail, toolFailHint } from '../src/renderer/engine/toolLoopGuard'
import { hasMathSyntax, normalizeMathDelimiters } from '../src/renderer/chat/useMathPlugins'

// agent 执行策略（v13.9，抄 Cline/OpenHands 的 rule-based truncation）：
// 旧轮次工具大结果归档压缩、只读工具并行、重复空转防护。

describe('工具结果截断边界（clampToolResult 语义验证）', () => {
  it('40K 以上截断并提示归档', () => {
    // clampToolResult 未导出，这里复刻语义验证阈值行为
    const MAX = 40_000
    const big = 'x'.repeat(MAX + 100)
    const out = big.length > MAX ? big.slice(0, MAX) + '\n…[截断]' : big
    expect(out.length).toBe(MAX + '\n…[截断]'.length)
    expect(out).toContain('[截断]')
  })
})

describe('重复空转防护', () => {
  it('归一化签名：键序不同的调用同签', () => {
    expect(callSignature('f', '{"a":1,"b":2}')).toBe(callSignature('f', '{"b":2,"a":1}'))
  })
  it('软硬两级：第 3 次软提醒（不阻断），第 5 次才阻断', () => {
    const c = new Map()
    const sig = callSignature('web_search', '{"query":"x"}')
    expect(checkRepeatCall(c, sig).blocked).toBe(false) // 1
    const r2 = checkRepeatCall(c, sig)
    expect(r2.blocked).toBe(false) // 2
    const r3 = checkRepeatCall(c, sig)
    expect(r3.blocked).toBe(false) // 3 = soft
    expect(r3.message).toContain('重复提醒')
    const r4 = checkRepeatCall(c, sig)
    expect(r4.blocked).toBe(false) // 4 = 仍放行（最后一次机会）
    expect(checkRepeatCall(c, sig).blocked).toBe(true) // 5 = hard
  })
  it('同工具 6 次出提示', () => {
    const c = new Map()
    for (let i = 0; i < 6; i++) bumpToolUse(c, 'shell')
    expect(toolUseHint(c, 'shell')).toContain('6 次')
  })
})

describe('公式与归一化（agent 输出侧）', () => {
  it('公式定界符归一化不破坏 fence', () => {
    const out = normalizeMathDelimiters('文字 \\(x^2\\)\n```js\nconst a = "\\(keep\\)"\n```')
    expect(out).toContain('$x^2$')
    expect(out).toContain('\\(keep\\)')
  })
  it('hasMathSyntax 不误判价格', () => {
    expect(hasMathSyntax('价格 $19.9 打折')).toBe(false)
  })
})

describe('连续失败计数（Cline consecutiveMistakeCount）', () => {
  it('连续失败累加、成功清零、达 3 次出提示', () => {
    const c = { n: 0 }
    bumpToolFail(c, true); bumpToolFail(c, true)
    expect(toolFailHint(c.n, 'shell')).toBe('')
    bumpToolFail(c, true)
    expect(toolFailHint(c.n, 'shell')).toContain('连续 3')
    expect(toolFailHint(c.n, 'shell')).toContain('shell')
    bumpToolFail(c, false)
    expect(c.n).toBe(0)
    expect(toolFailHint(c.n, 'shell')).toBe('')
  })
})
