/**
 * 空会话清理测试
 *
 * 这条链路会真删用户数据，所以判据必须保守：
 * 查不到消息计数时绝不删（宁可漏删不可误删），当前打开的会话绝不删。
 */
import { describe, it, expect } from 'vitest'
import { isEmptySession, pickEmptySessions, shouldCleanup } from '../src/shared/sessionCleanup'

const counts = (...pairs: [string, number][]) => new Map(pairs)

describe('isEmptySession', () => {
  it('消息数为 0 → 空', () => {
    expect(isEmptySession({ id: 'a' }, counts(['a', 0]))).toBe(true)
  })

  it('有消息 → 非空', () => {
    expect(isEmptySession({ id: 'a' }, counts(['a', 1]))).toBe(false)
    expect(isEmptySession({ id: 'a' }, counts(['a', 99]))).toBe(false)
  })

  // 关键安全约束：计数缺失时不能当成"空"，否则一次查询失败就会删掉全部会话
  it('计数缺失 → 保守当非空(绝不误删)', () => {
    expect(isEmptySession({ id: 'a' }, new Map())).toBe(false)
  })
})

describe('pickEmptySessions', () => {
  const sessions = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]

  it('只挑空的，非空不动', () => {
    const r = pickEmptySessions(sessions, counts(['s1', 0], ['s2', 3], ['s3', 0], ['s4', 1]), new Set())
    expect(r.sort()).toEqual(['s1', 's3'])
  })

  it('保护的会话即使为空也不删', () => {
    const r = pickEmptySessions(sessions, counts(['s1', 0], ['s2', 0], ['s3', 0], ['s4', 0]), new Set(['s2']))
    expect(r).not.toContain('s2')
  })

  it('max 限制条数', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i }))
    const c = new Map(many.map(s => [s.id, 0]))
    expect(pickEmptySessions(many, c, new Set(), 5)).toHaveLength(5)
  })

  it('全部为空时 max 之外的不返回', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: 'x' + i }))
    const c = new Map(many.map(s => [s.id, 0]))
    expect(pickEmptySessions(many, c, new Set(), 3)).toHaveLength(3)
  })
})

describe('shouldCleanup', () => {
  it('不超过阈值不跑(省掉每次启动的全表扫描)', () => {
    expect(shouldCleanup(0)).toBe(false)
    expect(shouldCleanup(5)).toBe(false)
  })

  it('超过阈值才跑', () => {
    expect(shouldCleanup(6)).toBe(true)
    expect(shouldCleanup(27)).toBe(true)
  })
})

// 回归：db.messageCounts() 只返回"有消息"的会话，零消息的会话不在结果里。
// 若不按会话列表把缺失项补成 0，这些会话会被"缺计数不误删"规则
// 判成非空 → 清理永远删不到东西（实测症状：28 条空会话一条没清掉）。
describe('回归:零消息会话在 counts 里缺项', () => {
  it('补 0 后能被识别为空并清理', () => {
    const sessions = [{ id: 'k1' }, { id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }, { id: 'e5' }, { id: 'e6' }]
    // messageCounts() 的真实返回形状：只有 k1
    const raw: Record<string, number> = { k1: 3 }
    const counts = new Map<string, number>()
    for (const s of sessions) counts.set(s.id, Number(raw[s.id] || 0))
    const ids = pickEmptySessions(sessions, counts, new Set(), 99)
    expect(ids.sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
    expect(ids).not.toContain('k1')
  })

  it('不补 0 就一条也删不掉(说明为何必须补)', () => {
    const sessions = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }, { id: 'e5' }, { id: 'e6' }]
    const raw: Record<string, number> = {}
    const countsOnlyFromRaw = new Map(Object.entries(raw))
    expect(pickEmptySessions(sessions, countsOnlyFromRaw, new Set(), 99)).toEqual([])
  })
})