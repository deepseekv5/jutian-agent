/**
 * 工具循环护栏测试
 *
 * 这两道判据防的是「模型空转把额度跑光」：没有轮次上限时 while(true)
 * 会一直转下去；没有重复检测时模型会拿同一参数反复调同一工具。
 * 边界值（恰好到上限、恰好第几次重复）必须精确。
 */
import { describe, it, expect } from 'vitest'
import {
  checkRoundLimit, checkRepeatCall, callSignature,
  MAX_TOOL_ROUNDS, MAX_REPEAT_CALLS,
} from '../src/renderer/engine/toolLoopGuard'

describe('轮次上限', () => {
  it('上限内放行', () => {
    for (let r = 1; r <= MAX_TOOL_ROUNDS; r++) {
      expect(checkRoundLimit(r).exceeded, `第 ${r} 轮应放行`).toBe(false)
    }
  })

  it('恰好超出时拦截', () => {
    expect(checkRoundLimit(MAX_TOOL_ROUNDS + 1).exceeded).toBe(true)
  })

  it('拦截时给出可操作提示（含上限数字与下一步建议）', () => {
    const { message } = checkRoundLimit(MAX_TOOL_ROUNDS + 1)
    expect(message).toContain(String(MAX_TOOL_ROUNDS))
    expect(message).toMatch(/拆|重试/)
  })

  it('放行时不产生多余文案', () => {
    expect(checkRoundLimit(1).message).toBe('')
  })
})

describe('重复调用检测', () => {
  const counter = () => new Map<string, number>()
  const sig = callSignature('read_file', '{"path":"a.txt"}')

  it('首次调用放行', () => {
    expect(checkRepeatCall(counter(), sig).blocked).toBe(false)
  })

  it(`前 ${MAX_REPEAT_CALLS} 次放行（模型重试一次是合理的）`, () => {
    const c = counter()
    for (let i = 1; i <= MAX_REPEAT_CALLS; i++) {
      expect(checkRepeatCall(c, sig).blocked, `第 ${i} 次应放行`).toBe(false)
    }
  })

  it('超过阈值后拦截', () => {
    const c = counter()
    for (let i = 1; i <= MAX_REPEAT_CALLS; i++) checkRepeatCall(c, sig)
    expect(checkRepeatCall(c, sig).blocked).toBe(true)
  })

  it('拦截信息里带工具名与已调用次数，便于模型理解', () => {
    const c = counter()
    for (let i = 1; i <= MAX_REPEAT_CALLS + 1; i++) checkRepeatCall(c, sig)
    const r = checkRepeatCall(c, sig)
    expect(r.message).toContain('read_file')
    expect(r.message).toMatch(/重复调用/)
    // 必须是合法 JSON——它要作为 tool result 回传给模型
    expect(() => JSON.parse(r.message)).not.toThrow()
  })

  it('参数不同视为不同调用，不误判为空转', () => {
    const c = counter()
    for (let i = 0; i < MAX_REPEAT_CALLS + 2; i++) {
      const other = callSignature('read_file', `{"path":"file${i}.txt"}`)
      expect(checkRepeatCall(c, other).blocked).toBe(false)
    }
  })

  it('工具名不同视为不同调用', () => {
    const c = counter()
    const a = callSignature('read_file', '{}')
    const b = callSignature('list_dir', '{}')
    for (let i = 0; i <= MAX_REPEAT_CALLS; i++) checkRepeatCall(c, a)
    expect(checkRepeatCall(c, b).blocked).toBe(false)
  })

  it('计数独立：拦下 A 不影响 B', () => {
    const c = counter()
    const a = callSignature('shell', '{"command":"ls"}')
    const b = callSignature('shell', '{"command":"pwd"}')
    for (let i = 0; i <= MAX_REPEAT_CALLS + 1; i++) checkRepeatCall(c, a)
    expect(checkRepeatCall(c, b).blocked).toBe(false)
  })
})

describe('callSignature', () => {
  it('组合工具名与参数', () => {
    expect(callSignature('read_file', '{"a":1}')).toBe('read_file::{"a":1}')
  })

  it('参数缺失时用空串占位（不能产生 undefined 字符串）', () => {
    expect(callSignature('shell', undefined)).toBe('shell::')
    expect(callSignature('shell', undefined)).not.toContain('undefined')
  })
})
