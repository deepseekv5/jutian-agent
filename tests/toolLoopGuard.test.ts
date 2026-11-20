/**
 * 工具循环护栏测试
 *
 * 这两道判据防的是「模型空转把额度跑光」：没有轮次上限时 while(true)
 * 会一直转下去；没有重复检测时模型会拿同一参数反复调同一工具。
 * 边界值（恰好到上限、恰好第几次重复）必须精确。
 * v14.4：签名归一化升级为递归键排序（嵌套键序/数组语义）、计数窗口跨轮
 * 持续语义锁定、失败恢复提示两类具体下一步、软硬阈值常量化入口。
 */
import { describe, it, expect } from 'vitest'
import {
  checkRoundLimit, checkRepeatCall, callSignature,
  bumpToolFail, toolFailHint,
  MAX_TOOL_ROUNDS, HARD_REPEAT_THRESHOLD, SOFT_REPEAT_THRESHOLD,
  REPEAT_SOFT_LIMIT, REPEAT_HARD_LIMIT,
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

  it(`前 ${HARD_REPEAT_THRESHOLD - 1} 次放行（软区间只提醒），第 ${HARD_REPEAT_THRESHOLD} 次阻断`, () => {
    const c = counter()
    for (let i = 1; i < HARD_REPEAT_THRESHOLD; i++) {
      const r = checkRepeatCall(c, sig)
      expect(r.blocked, `第 ${i} 次应放行`).toBe(false)
      if (i >= 3) expect(r.message).toContain('重复提醒')
    }
    expect(checkRepeatCall(c, sig).blocked, '第 5 次应阻断').toBe(true)
  })

  it('超过硬阈值后拦截（软阈值只提醒不拦）', () => {
    const c = counter()
    for (let i = 1; i < HARD_REPEAT_THRESHOLD; i++) {
      const r = checkRepeatCall(c, sig)
      expect(r.blocked, `第 ${i} 次应放行`).toBe(false)
    }
    expect(checkRepeatCall(c, sig).blocked, '第 5 次应阻断').toBe(true)
  })

  it('拦截信息里带工具名与已调用次数，便于模型理解', () => {
    const c = counter()
    for (let i = 1; i <= HARD_REPEAT_THRESHOLD + 2; i++) checkRepeatCall(c, sig)
    const r = checkRepeatCall(c, sig)
    expect(r.blocked).toBe(true)
    expect(r.message).toContain('read_file')
    expect(r.message).toMatch(/重复调用/)
    // 必须是合法 JSON——它要作为 tool result 回传给模型
    expect(() => JSON.parse(r.message)).not.toThrow()
  })

  it('参数不同视为不同调用，不误判为空转', () => {
    const c = counter()
    for (let i = 0; i < HARD_REPEAT_THRESHOLD + 2; i++) {
      const other = callSignature('read_file', `{"path":"file${i}.txt"}`)
      expect(checkRepeatCall(c, other).blocked).toBe(false)
    }
  })

  it('工具名不同视为不同调用', () => {
    const c = counter()
    const a = callSignature('read_file', '{}')
    const b = callSignature('list_dir', '{}')
    for (let i = 0; i <= HARD_REPEAT_THRESHOLD; i++) checkRepeatCall(c, a)
    expect(checkRepeatCall(c, b).blocked).toBe(false)
  })

  it('计数独立：拦下 A 不影响 B', () => {
    const c = counter()
    const a = callSignature('shell', '{"command":"ls"}')
    const b = callSignature('shell', '{"command":"pwd"}')
    for (let i = 0; i <= HARD_REPEAT_THRESHOLD + 1; i++) checkRepeatCall(c, a)
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


// v13.8.1：签名归一化（键序/空白不再绕过检测）+ 同工具累计提示
import { callSignature as sig, bumpToolUse, toolUseHint, SAME_TOOL_HINT_EVERY } from '../src/renderer/engine/toolLoopGuard'

describe('callSignature 归一化（v13.8.1）', () => {
  it('JSON 键顺序不同 → 同一签名', () => {
    expect(sig('read_file', '{"path":"a.txt","limit":5}'))
      .toBe(sig('read_file', '{"limit":5,"path":"a.txt"}'))
  })
  it('空白差异 → 同一签名', () => {
    expect(sig('shell', '{ "command": "ls  -la" }'))
      .toBe(sig('shell', '{"command":"ls -la"}'))
  })
  it('参数值不同 → 不同签名（放行模型尝试别的路子）', () => {
    expect(sig('read_file', '{"path":"a.txt"}'))
      .not.toBe(sig('read_file', '{"path":"b.txt"}'))
  })
  it('非 JSON 参数：空白折叠后比较', () => {
    expect(sig('run', 'ls   -la')).toBe(sig('run', 'ls -la'))
  })
  it('工具名不同 → 不同签名', () => {
    expect(sig('a', '{"x":1}')).not.toBe(sig('b', '{"x":1}'))
  })
})

describe('同工具累计提示（v13.8.1）', () => {
  it('未达阈值不提示', () => {
    const c = new Map()
    for (let i = 0; i < SAME_TOOL_HINT_EVERY - 1; i++) bumpToolUse(c, 'web_search')
    expect(toolUseHint(c, 'web_search')).toBe('')
  })
  it('达到 6 的倍数时提示换策略', () => {
    const c = new Map()
    for (let i = 0; i < SAME_TOOL_HINT_EVERY; i++) bumpToolUse(c, 'web_search')
    const hint = toolUseHint(c, 'web_search')
    expect(hint).toContain('6 次')
    expect(hint).toContain('换一种方法')
  })
  it('12 次（第二个倍数）再提示一次', () => {
    const c = new Map()
    for (let i = 0; i < SAME_TOOL_HINT_EVERY * 2; i++) bumpToolUse(c, 'shell')
    expect(toolUseHint(c, 'shell')).toContain('12 次')
  })
})

// v14.4：签名归一化升级为递归键排序——嵌套对象键序不再绕过检测，数组顺序保留
describe('签名归一化 · 嵌套键序与数组（v14.4）', () => {
  it('嵌套对象键顺序不同 → 同一签名（递归排序，不只是顶层）', () => {
    expect(callSignature('write_file', '{"path":"a.txt","opts":{"mode":644,"encoding":"utf8"}}'))
      .toBe(callSignature('write_file', '{"opts":{"encoding":"utf8","mode":644},"path":"a.txt"}'))
  })

  it('数组元素顺序敏感 → 不同签名（顺序是语义的一部分，不能归一化掉）', () => {
    expect(callSignature('shell', '{"cmds":["ls","pwd"]}'))
      .not.toBe(callSignature('shell', '{"cmds":["pwd","ls"]}'))
  })

  it('数组内对象的键序归一化，但数组整体顺序保留', () => {
    expect(callSignature('batch', '{"steps":[{"b":1,"a":2},{"d":3,"c":4}]}'))
      .toBe(callSignature('batch', '{"steps":[{"a":2,"b":1},{"c":4,"d":3}]}'))
    expect(callSignature('batch', '{"steps":[{"a":2,"b":1},{"c":4,"d":3}]}'))
      .not.toBe(callSignature('batch', '{"steps":[{"c":4,"d":3},{"a":2,"b":1}]}'))
  })

  it('同参异序等价真实影响拦截：键序换着写同样累计到硬阈值，无法绕过', () => {
    const c = new Map<string, number>()
    let blocked = false
    for (let i = 0; i < REPEAT_HARD_LIMIT; i++) {
      const args = i % 2 === 0 ? '{"path":"a.txt","limit":5}' : '{"limit":5,"path":"a.txt"}'
      blocked = checkRepeatCall(c, callSignature('read_file', args)).blocked
    }
    expect(blocked, '第 5 次调用（键序交替）应拦截').toBe(true)
  })
})

// v14.4：锁定计数窗口语义——agentLoop 整个请求周期持有同一个 Map，跨轮持续累计
describe('重复计数窗口（跨轮持续，v14.4 锁定）', () => {
  it('同一计数 Map 跨轮持续累计：每轮各调一次，第 5 轮（硬阈值）拦截', () => {
    const ctx = new Map<string, number>() // 模拟 LoopContext.callSignatures：整个请求周期同一个 Map
    for (let round = 1; round < REPEAT_HARD_LIMIT; round++) {
      expect(checkRepeatCall(ctx, callSignature('read_file', '{"path":"a.txt"}')).blocked,
        `第 ${round} 轮应放行`).toBe(false)
    }
    expect(checkRepeatCall(ctx, callSignature('read_file', '{"path":"a.txt"}')).blocked,
      '第 5 轮应拦截：计数不因换轮清零，同会话内重复即拦').toBe(true)
  })

  it('新请求换新 Map：计数从零开始，窗口不跨请求泄漏', () => {
    const prev = new Map<string, number>()
    for (let i = 0; i < REPEAT_HARD_LIMIT + 1; i++) checkRepeatCall(prev, callSignature('read_file', '{"path":"a.txt"}'))
    const next = new Map<string, number>()
    expect(checkRepeatCall(next, callSignature('read_file', '{"path":"a.txt"}')).blocked, '新请求第 1 次放行').toBe(false)
    expect(checkRepeatCall(next, callSignature('read_file', '{"path":"a.txt"}')).blocked, '新请求第 2 次放行').toBe(false)
  })

  it('中间穿插其它调用不稀释同一签名的计数', () => {
    const c = new Map<string, number>()
    for (let i = 0; i < REPEAT_HARD_LIMIT - 1; i++) {
      checkRepeatCall(c, callSignature('read_file', '{"path":"a.txt"}'))
      checkRepeatCall(c, callSignature('read_file', `{"path":"other${i}.txt"}`))
    }
    expect(checkRepeatCall(c, callSignature('read_file', '{"path":"a.txt"}')).blocked,
      '第 5 次重复仍拦：计数按签名独立累计').toBe(true)
  })
})

// v14.4：失败恢复提示给出两类可操作的具体下一步
describe('连续失败恢复提示（v14.4 增强）', () => {
  it('未达失败阈值（3 次）不提示', () => {
    expect(toolFailHint(0, 'read_file')).toBe('')
    expect(toolFailHint(2, 'read_file')).toBe('')
  })

  it('达到失败阈值起提示：保留「检查错误原因」，并给出权限/路径类「改用对应工具」的具体下一步', () => {
    const hint = toolFailHint(3, 'read_file')
    expect(hint).toContain('连续 3 个工具调用失败')
    expect(hint).toContain('错误原因是否相同')
    expect(hint).toContain('权限')
    expect(hint).toContain('路径')
    expect(hint).toContain('对应工具')
  })

  it('收尾建议与硬阈值衔接：4 次不提示收尾，5 次起建议总结已有成果（衔接 wrapUp）', () => {
    expect(toolFailHint(4, 'shell')).not.toContain('收尾')
    const hint = toolFailHint(REPEAT_HARD_LIMIT, 'shell')
    expect(hint).toContain('收尾')
    expect(hint).toContain('总结')
    expect(hint).toContain('剩余步骤')
  })
})

describe('连续失败计数（成功清零）', () => {
  it('失败累加、成功一次即清零、清零后重新起算', () => {
    const c = { n: 0 }
    expect(bumpToolFail(c, true)).toBe(1)
    expect(bumpToolFail(c, true)).toBe(2)
    expect(bumpToolFail(c, true)).toBe(3)
    expect(toolFailHint(bumpToolFail(c, true), 'x'), '第 4 次仍连续，继续提示').not.toBe('')
    expect(bumpToolFail(c, false), '成功一次清零').toBe(0)
    expect(bumpToolFail(c, true), '清零后重新起算').toBe(1)
    expect(toolFailHint(1, 'x'), '重新起算未达阈值不提示').toBe('')
  })
})

// v14.4：软硬阈值常量化（REPEAT_* 为配置化规范名，旧名保留为兼容别名）
describe('软硬阈值常量（v14.4 配置化入口）', () => {
  it('REPEAT_SOFT_LIMIT=3 / REPEAT_HARD_LIMIT=5，与兼容别名同值，行为随常量联动', () => {
    expect(REPEAT_SOFT_LIMIT).toBe(3)
    expect(REPEAT_HARD_LIMIT).toBe(5)
    expect(SOFT_REPEAT_THRESHOLD).toBe(REPEAT_SOFT_LIMIT)
    expect(HARD_REPEAT_THRESHOLD).toBe(REPEAT_HARD_LIMIT)
    const c = new Map<string, number>()
    const s = callSignature('shell', '{"command":"ls"}')
    for (let i = 1; i < REPEAT_SOFT_LIMIT; i++) {
      expect(checkRepeatCall(c, s).message, `第 ${i} 次无提示`).toBe('')
    }
    expect(checkRepeatCall(c, s).message, '第 3 次（soft）注入重复提醒但不拦截').toContain('重复提醒')
    expect(checkRepeatCall(c, s).blocked, '第 4 次仍放行').toBe(false)
    expect(checkRepeatCall(c, s).blocked, '第 5 次（hard）阻断').toBe(true)
  })
})
