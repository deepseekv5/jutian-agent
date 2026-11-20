import { describe, it, expect } from 'vitest'
import {
  graphemeTruncateToBytes, collapseToolResponse, collapseOlderToolResults,
  truncateKeepTail, archiveOldToolResults, compressHistory,
  COLLAPSED_MAX_BYTES, RECENT_TURNS_PROTECTED, TAIL_LINES_KEPT,
} from '../src/shared/chatCompression'

// chatCompression（gemini-cli 移植）：字素折叠 + 3 轮保护 + 反向预算保尾。
// 这里重点锁两类翻车点：emoji/组合字素被腰斩、最近 3 轮被误压缩。

/** 字符串里是否出现孤立代理对（emoji 被按 UTF-16 码元腰斩时的典型产物） */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const p = i > 0 ? s.charCodeAt(i - 1) : 0
      if (!(p >= 0xd800 && p <= 0xdbff)) return true
    }
  }
  return false
}

/** 一家四口 ZWJ 组合 emoji（单个字素 25 字节，拆开任何一段都是非法/错形） */
const FAMILY = '👨‍👩‍👧‍👦'

describe('graphemeTruncateToBytes 字素安全', () => {
  it('emoji 序列截断不腰斩代理对（👍 每个 4 字节，2048 字节恰好 512 个）', () => {
    const out = graphemeTruncateToBytes('👍'.repeat(600), COLLAPSED_MAX_BYTES)
    expect(out).toBe('👍'.repeat(512))
    expect(Buffer.byteLength(out, 'utf8')).toBe(COLLAPSED_MAX_BYTES)
    expect(hasLoneSurrogate(out)).toBe(false)
  })
  it('剩余预算放不下整个 emoji 时不硬塞（不让半截进结果）', () => {
    const out = graphemeTruncateToBytes('a'.repeat(2000) + '👍'.repeat(100), 2001)
    expect(out).toBe('a'.repeat(2000))
    expect(hasLoneSurrogate(out)).toBe(false)
  })
  it('ZWJ 组合 emoji（一家四口）作为整体保留，绝不拆开', () => {
    // 恰好放得下：2023 + 25 = 2048
    const fits = graphemeTruncateToBytes('x'.repeat(2023) + FAMILY, COLLAPSED_MAX_BYTES)
    expect(fits.endsWith(FAMILY)).toBe(true)
    expect(Buffer.byteLength(fits, 'utf8')).toBe(COLLAPSED_MAX_BYTES)
    expect(hasLoneSurrogate(fits)).toBe(false)
    // 放不下：整体让位，绝不留半个家庭
    const noFit = graphemeTruncateToBytes('x'.repeat(2043) + FAMILY, COLLAPSED_MAX_BYTES)
    expect(noFit).toBe('x'.repeat(2043))
    expect(hasLoneSurrogate(noFit)).toBe(false)
  })
  it('组合字素（e + 组合附加符）不会被拆开', () => {
    const fits = graphemeTruncateToBytes('a'.repeat(2045) + 'e\u0301', COLLAPSED_MAX_BYTES)
    expect(fits.endsWith('e\u0301')).toBe(true)
    // 差 1 字节放不下时整个字素让位，绝不输出孤立的组合附加符
    const noFit = graphemeTruncateToBytes('a'.repeat(2046) + 'e\u0301', COLLAPSED_MAX_BYTES)
    expect(noFit).toBe('a'.repeat(2046))
  })
  it('Intl.Segmenter 不可用时兜底路径也按码点切（同样不腰斩代理对）', () => {
    const saved = globalThis.Intl
    try {
      ;(globalThis as unknown as { Intl?: unknown }).Intl = undefined
      const out = graphemeTruncateToBytes('👍'.repeat(600), COLLAPSED_MAX_BYTES)
      expect(out).toBe('👍'.repeat(512))
      expect(hasLoneSurrogate(out)).toBe(false)
    } finally {
      ;(globalThis as unknown as { Intl?: unknown }).Intl = saved
    }
  })
})

describe('collapseToolResponse 2KB 折叠', () => {
  it('未超限原样返回', () => {
    const s = 'x'.repeat(100)
    expect(collapseToolResponse(s)).toBe(s)
  })
  it('超 2KB 折叠：总字节（含标记）不超过上限，前缀与原始字节数保留', () => {
    const big = 'x'.repeat(5000)
    const out = collapseToolResponse(big)
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(COLLAPSED_MAX_BYTES)
    expect(out).toContain('该轮工具输出已折叠')
    expect(out).toContain('原始 5000 字节')
    expect(out.startsWith('x'.repeat(100))).toBe(true)
    expect(hasLoneSurrogate(out)).toBe(false)
  })
  it('折叠幂等：对折叠结果再折叠不再变化（每轮重放文本稳定，前缀缓存友好）', () => {
    const once = collapseToolResponse('x'.repeat(5000))
    const twice = collapseToolResponse(once)
    expect(twice).toBe(once)
  })
})

describe('collapseOlderToolResults 3 轮保护', () => {
  const bigTool = (id: string, hint?: string) => ({
    role: 'tool', tool_call_id: id, content: 'x'.repeat(3000), toolNameHint: hint,
  })

  it('最近 3 条工具响应受保护，更早的折叠（锁定 RECENT_TURNS_PROTECTED=3）', () => {
    const msgs = [bigTool('t1'), bigTool('t2'), bigTool('t3'), bigTool('t4'), bigTool('t5'), bigTool('t6')]
    const out = collapseOlderToolResults(msgs)
    expect(out[0].content).toContain('已折叠')
    expect(out[1].content).toContain('已折叠')
    expect(out[2].content).toContain('已折叠')
    for (const i of [3, 4, 5]) expect(out[i].content).toBe('x'.repeat(3000))
    expect(RECENT_TURNS_PROTECTED).toBe(3)
  })
  it('恰好 3 条工具响应时全部不动（返回原引用）', () => {
    const msgs = [bigTool('t1'), bigTool('t2'), bigTool('t3')]
    expect(collapseOlderToolResults(msgs)).toBe(msgs)
  })
  it('保护按工具消息计数，与中间隔了多少 user/assistant 无关', () => {
    const user = (s: string) => ({ role: 'user', content: s })
    const msgs = [
      bigTool('t1'), user('a'), { role: 'assistant', content: 'b' },
      bigTool('t2'), user('c'), { role: 'assistant', content: 'd' },
      bigTool('t3'), user('e'), bigTool('t4'), user('f'), bigTool('t5'), user('g'),
    ]
    const out = collapseOlderToolResults(msgs)
    expect(out[0].content).toContain('已折叠')
    expect(out[3].content).toContain('已折叠')
    for (const i of [6, 8, 10]) expect(out[i].content).toBe('x'.repeat(3000))
  })
  it('检索/读取类工具豁免折叠（输出是模型决策依据），其余照常折叠', () => {
    const msgs = [bigTool('t1', 'shell'), bigTool('t2', 'read_file'), bigTool('t3'), bigTool('t4'), bigTool('t5')]
    const out = collapseOlderToolResults(msgs)
    expect(out[0].content).toContain('已折叠')          // shell 不豁免 → 折叠
    expect(out[1].content).toBe('x'.repeat(3000))       // read_file 豁免
    for (const i of [2, 3, 4]) expect(out[i].content).toBe('x'.repeat(3000))  // 保护区内
  })
  it('protectedTurns 可传参覆盖（=1 时只保护最后一条）', () => {
    const msgs = [bigTool('t1'), bigTool('t2'), bigTool('t3'), bigTool('t4')]
    const out = collapseOlderToolResults(msgs, 1)
    expect(out[0].content).toContain('已折叠')
    expect(out[1].content).toContain('已折叠')
    expect(out[2].content).toContain('已折叠')
    expect(out[3].content).toBe('x'.repeat(3000))
  })
  it('折叠过的内容二次折叠不再变化（幂等）', () => {
    const msgs = [bigTool('t1'), bigTool('t2'), bigTool('t3'), bigTool('t4')]
    const once = collapseOlderToolResults(msgs)
    const twice = collapseOlderToolResults(once)
    expect(twice).toEqual(once)
  })
})

describe('truncateKeepTail 反向预算保尾', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line-${i}`).join('\n')

  it(`超过 ${TAIL_LINES_KEPT} 行只保留末尾 ${TAIL_LINES_KEPT} 行，头部提示省略量`, () => {
    const out = truncateKeepTail(lines(60))
    const outLines = out.split('\n')
    expect(outLines).toHaveLength(TAIL_LINES_KEPT + 1)  // 头部提示 + 30 行
    expect(out).toContain('前 30 行省略')
    expect(out).toContain('line-59')  // 末尾行（错误堆栈）保留
    expect(out).not.toContain('line-10\n')  // 头部行被省略
  })
  it('行数不足时原样返回', () => {
    const s = lines(10)
    expect(truncateKeepTail(s)).toBe(s)
  })
  it('对象形态从 output 字段取主文本再截尾（不把 JSON 括号算进行）', () => {
    const payload = JSON.stringify({ output: lines(40), extra: 1 })
    const out = truncateKeepTail(payload)
    expect(out).toContain('前 10 行省略')
    expect(out).toContain('line-39')
  })
  it('已归档的内容再次截尾不变（幂等，头部省略行数不被反复改写）', () => {
    const once = truncateKeepTail(lines(60))
    const twice = truncateKeepTail(once)
    expect(twice).toBe(once)
  })
})

describe('archiveOldToolResults 反向预算', () => {
  const bigTool = (id: string) => ({
    role: 'tool', tool_call_id: id,
    content: Array.from({ length: 60 }, (_, i) => `line-${id}-${i}`).join('\n'),
  })
  const smallTool = (id: string) => ({ role: 'tool', tool_call_id: id, content: `ok-${id}` })

  it('预算内返回原引用', () => {
    const msgs = [smallTool('t1'), smallTool('t2')]
    expect(archiveOldToolResults(msgs)).toBe(msgs)
  })
  it('从最新往最旧累计，超预算后更旧的大响应截尾保尾 30 行，顺序不变', () => {
    const msgs = [bigTool('t1'), bigTool('t2'), bigTool('t3'), bigTool('t4'), smallTool('t5'), smallTool('t6')]
    // 每条大响应约 660 字符：预算 1000 时从最新累计到 t4 未超，t3 起顶爆 → t1~t3 归档
    const out = archiveOldToolResults(msgs, 1000)
    // t5/t6 最新且小，累计未超预算 → 原样
    expect(out[4].content).toBe('ok-t5')
    expect(out[5].content).toBe('ok-t6')
    expect(out[3].content).toContain('line-t4-59')   // t4 累计在预算内 → 原样
    // t1/t2/t3 更旧 → 归档保尾
    expect(out[0].content.startsWith('[输出已归档')).toBe(true)
    expect(out[0].content).toContain('line-t1-59')   // 末尾行（错误堆栈）保留
    expect(out[0].content).not.toContain('line-t1-0\n')
    expect(out[1].content.startsWith('[输出已归档')).toBe(true)
    expect(out[2].content.startsWith('[输出已归档')).toBe(true)
    // 原始顺序保持
    expect(out.map((m) => m.tool_call_id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6'])
  })
})

describe('compressHistory 组合入口', () => {
  const bigTool = (id: string) => ({ role: 'tool', tool_call_id: id, content: 'x'.repeat(3000) })

  it('折叠 + 归档同时生效，且重复压缩结果稳定', () => {
    const msgs = [bigTool('t1'), bigTool('t2'), bigTool('t3'), bigTool('t4'), bigTool('t5'), bigTool('t6')]
    const once = compressHistory(msgs)
    // 旧 3 条折叠、最近 3 条保护
    expect(once[0].content).toContain('已折叠')
    expect(once[3].content).toBe('x'.repeat(3000))
    // 二次压缩：文本不再变化
    const twice = compressHistory(once)
    expect(twice).toEqual(once)
  })
})
