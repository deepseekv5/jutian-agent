import { describe, it, expect } from 'vitest'
import {
  MissionTracker,
  createMemoryStore,
  makeId,
  DEFAULT_MAX_ROUNDS,
  MAX_HISTORY,
  type MissionStore,
  type Mission,
  type MissionEvaluation,
} from '../src/shared/missionTracker'

// 长任务编排是状态机：每个分支都要钉死"状态 + 轮次 + 历史 + 指令"四件事。
// 这里用一个可观测的 store 替身同时验证内存状态与持久化调用。

class TestStore implements MissionStore {
  data: Mission[] = []
  loadCalls = 0
  saveCalls = 0
  lastSaved: Mission[] = []
  failLoad = false
  failSave = false

  load(): Mission[] {
    this.loadCalls += 1
    if (this.failLoad) throw new Error('load failed')
    return this.data
  }

  save(missions: Mission[]): void {
    this.saveCalls += 1
    this.lastSaved = missions
    if (this.failSave) throw new Error('save failed')
    this.data = missions
  }
}

function ev(done: boolean, note = '', ok = true): MissionEvaluation {
  return { done, note, ok }
}

function setup(): { tracker: MissionTracker; store: TestStore } {
  const store = new TestStore()
  return { tracker: new MissionTracker(store), store }
}

/** 建一个带两个里程碑、且第一步已 in_progress 的任务 */
function withMilestones(tracker: MissionTracker, maxRounds = 20): Mission {
  const m = tracker.create('完成一次大型重构', { project: 'demo', maxRounds })
  tracker.addMilestone(m.id, '梳理现状')
  tracker.addMilestone(m.id, '实施改造')
  tracker.addMilestone(m.id, '回归验证')
  return m
}

describe('makeId 与常量', () => {
  it('生成带前缀的唯一 id', () => {
    const a = makeId('mission')
    const b = makeId('mission')
    expect(a.startsWith('mission_')).toBe(true)
    expect(a).not.toBe(b)
  })

  it('无前缀也生成非空 id', () => {
    expect(makeId().length).toBeGreaterThan(0)
  })

  it('导出常量符合设计值', () => {
    expect(DEFAULT_MAX_ROUNDS).toBe(20)
    expect(MAX_HISTORY).toBe(200)
  })
})

describe('create / get / list', () => {
  it('create 默认字段齐全', () => {
    const { tracker } = setup()
    const m = tracker.create('写一个长任务')
    expect(m.id).toBeTruthy()
    expect(m.goal).toBe('写一个长任务')
    expect(m.status).toBe('active')
    expect(m.project).toBe('')
    expect(m.milestones).toEqual([])
    expect(m.currentMilestoneId).toBeNull()
    expect(m.rounds).toBe(0)
    expect(m.maxRounds).toBe(20)
    expect(m.lastNote).toBe('')
    expect(m.history).toHaveLength(1)
    expect(m.history[0].kind).toBe('progress')
    expect(m.createdAt).toBeGreaterThan(0)
    expect(m.updatedAt).toBeGreaterThan(0)
  })

  it('create 接受 project 与 maxRounds', () => {
    const { tracker } = setup()
    const m = tracker.create('目标', { project: 'claw-agent', maxRounds: 7 })
    expect(m.project).toBe('claw-agent')
    expect(m.maxRounds).toBe(7)
  })

  it('create 对 maxRounds 做下限与非法值收敛', () => {
    const { tracker } = setup()
    expect(tracker.create('a', { maxRounds: 0 }).maxRounds).toBe(1)
    expect(tracker.create('b', { maxRounds: -5 }).maxRounds).toBe(1)
    expect(tracker.create('c', { maxRounds: 3.9 }).maxRounds).toBe(3)
    expect(tracker.create('d', { maxRounds: Number.NaN }).maxRounds).toBe(20)
  })

  it('get 命中与未命中', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    expect(tracker.get(m.id)).toBe(m)
    expect(tracker.get('not-exist')).toBeUndefined()
    expect(tracker.get('')).toBeUndefined()
  })

  it('list 返回全部并按 status 过滤，且结果数组与原数组隔离', () => {
    const { tracker } = setup()
    const a = tracker.create('A')
    const b = tracker.create('B')
    tracker.pause(b.id, '人工暂停')
    expect(tracker.list()).toHaveLength(2)
    const active = tracker.list('active')
    expect(active.map((x) => x.id)).toEqual([a.id])
    expect(tracker.list('paused').map((x) => x.id)).toEqual([b.id])
    expect(tracker.list('completed')).toEqual([])
    active.pop()
    expect(tracker.list('active')).toHaveLength(1)
  })
})

describe('里程碑管理', () => {
  it('addMilestone 返回 id，第一个里程碑自动成为当前并 in_progress', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    const id = tracker.addMilestone(m.id, '第一步')
    expect(id).toBeTruthy()
    expect(m.milestones).toHaveLength(1)
    expect(m.milestones[0].id).toBe(id)
    expect(m.milestones[0].status).toBe('in_progress')
    expect(m.currentMilestoneId).toBe(id)
  })

  it('后续里程碑保持 pending，不改变当前指针', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    const first = tracker.addMilestone(m.id, '第一步')
    tracker.addMilestone(m.id, '第二步')
    expect(m.milestones[1].status).toBe('pending')
    expect(m.currentMilestoneId).toBe(first)
  })

  it('addMilestone 对未知任务或空标题静默返回空串', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    expect(tracker.addMilestone('unknown', 'x')).toBe('')
    expect(tracker.addMilestone(m.id, '')).toBe('')
    expect(m.milestones).toHaveLength(0)
  })

  it('markMilestone 改状态并记 note，未知 id 静默', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    const id = tracker.addMilestone(m.id, '第一步')
    const before = m.milestones[0].updatedAt
    tracker.markMilestone(m.id, id, 'blocked', '缺少权限')
    expect(m.milestones[0].status).toBe('blocked')
    expect(m.milestones[0].notes).toContain('缺少权限')
    expect(m.milestones[0].updatedAt).toBeGreaterThanOrEqual(before)
    expect(() => tracker.markMilestone('unknown', id, 'done')).not.toThrow()
    expect(() => tracker.markMilestone(m.id, 'unknown', 'done')).not.toThrow()
    expect(m.milestones[0].status).toBe('blocked')
  })

  it('markMilestone 的 note 去重且保留上限', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    const id = tracker.addMilestone(m.id, '第一步')
    for (let i = 0; i < 80; i++) tracker.markMilestone(m.id, id, 'pending', `note-${i}`)
    tracker.markMilestone(m.id, id, 'pending', 'note-79')
    expect(m.milestones[0].notes).toHaveLength(60)
    expect(m.milestones[0].notes[0]).toBe('note-20')
    expect(m.milestones[0].notes[59]).toBe('note-79')
  })
})

describe('linkSession', () => {
  it('会话 id 去重并写入当前里程碑与 progress 历史', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.addMilestone(m.id, '第一步')
    tracker.linkSession(m.id, 'session-1')
    tracker.linkSession(m.id, 'session-1')
    tracker.linkSession(m.id, 'session-2')
    expect(m.milestones[0].sessionIds).toEqual(['session-1', 'session-2'])
    expect(m.history.filter((h) => h.kind === 'progress')).toHaveLength(3)
    expect(m.history[m.history.length - 1].sessionId).toBe('session-2')
  })

  it('未知任务静默', () => {
    const { tracker } = setup()
    expect(() => tracker.linkSession('unknown', 's')).not.toThrow()
  })

  it('没有当前里程碑时静默', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.linkSession(m.id, 's')
    expect(m.history).toHaveLength(1)
  })
})

describe('advance 核心状态机', () => {
  it('done 且无里程碑 -> completed，不续跑', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    const plan = tracker.advance(m.id, 's1', ev(true, '全部搞定'))
    expect(plan.shouldContinue).toBe(false)
    expect(plan.nextDirective).toBe('')
    expect(plan.reason).toContain('完成')
    expect(m.status).toBe('completed')
    expect(m.rounds).toBe(1)
    expect(m.lastNote).toBe('全部搞定')
  })

  it('done 且有后续里程碑 -> 切到下一个并 in_progress', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    const firstId = m.currentMilestoneId
    const plan = tracker.advance(m.id, 's1', ev(true, '现状已梳理'))
    expect(plan.shouldContinue).toBe(true)
    expect(plan.reason).toContain('下一里程碑')
    expect(m.currentMilestoneId).not.toBe(firstId)
    expect(m.milestones[0].status).toBe('done')
    expect(m.milestones[1].status).toBe('in_progress')
    expect(m.milestones[0].notes).toContain('已完成：现状已梳理')
  })

  it('done 在最后一个里程碑 -> completed', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    tracker.advance(m.id, 's1', ev(true, '1'))
    tracker.advance(m.id, 's2', ev(true, '2'))
    const plan = tracker.advance(m.id, 's3', ev(true, '3'))
    expect(plan.shouldContinue).toBe(false)
    expect(m.status).toBe('completed')
    expect(m.milestones.every((x) => x.status === 'done')).toBe(true)
    expect(m.rounds).toBe(3)
  })

  it('未完成 -> 续跑指令含目标、当前里程碑、评估反馈与轮次', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    const plan = tracker.advance(m.id, 's1', ev(false, '还差接口联调'))
    expect(plan.shouldContinue).toBe(true)
    expect(plan.reason).toContain('尚未完成')
    expect(plan.nextDirective).toContain('完成一次大型重构')
    expect(plan.nextDirective).toContain('梳理现状')
    expect(plan.nextDirective).toContain('还差接口联调')
    expect(plan.nextDirective).toContain('1/20')
    expect(plan.nextDirective).toContain('请勿重复')
  })

  it('未完成的 note 会记入当前里程碑，作为已尝试路线', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    tracker.advance(m.id, 's1', ev(false, '路线A：改配置无效'))
    tracker.advance(m.id, 's2', ev(false, '路线B：需要改源码'))
    const plan = tracker.advance(m.id, 's3', ev(false, '路线C：先补测试'))
    expect(m.milestones[0].notes).toEqual([
      '路线A：改配置无效', '路线B：需要改源码', '路线C：先补测试',
    ])
    expect(plan.nextDirective).toContain('路线A：改配置无效')
    expect(plan.nextDirective).toContain('路线B：需要改源码')
    expect(plan.nextDirective).toContain('路线C：先补测试')
  })

  it('相同的 note 不重复出现在已尝试路线', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    tracker.advance(m.id, 's1', ev(false, '同一条结论'))
    tracker.advance(m.id, 's2', ev(false, '同一条结论'))
    expect(m.milestones[0].notes).toEqual(['同一条结论'])
  })

  it('未设置里程碑时未完成仍能产出续跑指令', () => {
    const { tracker } = setup()
    const m = tracker.create('裸目标')
    const plan = tracker.advance(m.id, 's1', ev(false, '继续想想'))
    expect(plan.shouldContinue).toBe(true)
    expect(plan.nextDirective).toContain('尚未设置里程碑')
    expect(plan.nextDirective).toContain('暂无记录')
  })

  it('ok=false -> paused，不续跑，lastNote 如实记录', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    const plan = tracker.advance(m.id, 's1', ev(false, '评估服务暂不可用', false))
    expect(plan.shouldContinue).toBe(false)
    expect(plan.nextDirective).toBe('')
    expect(plan.reason).toContain('评估器不可用')
    expect(m.status).toBe('paused')
    expect(m.rounds).toBe(1)
    expect(m.lastNote).toBe('评估服务暂不可用')
    const kinds = m.history.map((h) => h.kind)
    expect(kinds).toContain('evaluate')
    expect(kinds).toContain('pause')
  })

  it('ok=false 且 done=true 时仍以评估失败为准', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    const plan = tracker.advance(m.id, 's1', ev(true, '评估解析失败', false))
    expect(plan.shouldContinue).toBe(false)
    expect(m.status).toBe('paused')
    expect(m.milestones).toHaveLength(0)
  })

  it('轮次达到上限且未完成 -> failed', () => {
    const { tracker } = setup()
    const m = tracker.create('目标', { maxRounds: 2 })
    tracker.addMilestone(m.id, '第一步')
    tracker.advance(m.id, 's1', ev(false, '第一步没做完'))
    const plan = tracker.advance(m.id, 's2', ev(false, '还是没做完'))
    expect(plan.shouldContinue).toBe(false)
    expect(plan.nextDirective).toBe('')
    expect(plan.reason).toContain('上限')
    expect(m.status).toBe('failed')
    expect(m.rounds).toBe(2)
    expect(m.history[m.history.length - 1].kind).toBe('fail')
  })

  it('done 触顶但还有里程碑 -> failed，且已完成里程碑与指针保留', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker, 1)
    const firstId = m.currentMilestoneId
    const plan = tracker.advance(m.id, 's1', ev(true, '第一步完成'))
    expect(plan.shouldContinue).toBe(false)
    expect(plan.reason).toContain('上限')
    expect(m.status).toBe('failed')
    expect(m.rounds).toBe(1)
    expect(m.milestones[0].status).toBe('done')
    expect(m.currentMilestoneId).not.toBe(firstId)
    expect(m.milestones[1].status).toBe('in_progress')
  })

  it('未完成但轮次未触顶 -> 继续，且 sessionId 记录到当前里程碑', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    tracker.advance(m.id, 'session-A', ev(false, '第一次尝试'))
    expect(m.milestones[0].sessionIds).toContain('session-A')
    expect(m.history.some((h) => h.sessionId === 'session-A')).toBe(true)
  })

  it('blocked 里程碑视为尚未完成，done 会切到它', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    tracker.markMilestone(m.id, m.milestones[1].id, 'blocked', '等待外部数据')
    tracker.advance(m.id, 's1', ev(true, '当前步完成'))
    expect(m.currentMilestoneId).toBe(m.milestones[1].id)
    expect(m.milestones[1].status).toBe('blocked')
    expect(m.milestones[1].notes).toContain('等待外部数据')
  })

  it('非 active 状态与未知 id 均返回 noPlan', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.pause(m.id)
    const paused = tracker.advance(m.id, 's', ev(false, 'note'))
    expect(paused.shouldContinue).toBe(false)
    expect(paused.nextDirective).toBe('')
    expect(paused.reason).toContain('paused')
    expect(m.rounds).toBe(0)
    const unknown = tracker.advance('unknown', 's', ev(false))
    expect(unknown.reason).toContain('不存在')
  })

  it('脏评估对象不抛异常', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    expect(() => tracker.advance(m.id, 's', undefined as unknown as MissionEvaluation)).not.toThrow()
    expect(m.status).toBe('paused')
    expect(m.rounds).toBe(1)
    expect(() => tracker.advance(m.id, 's', { done: false, note: 123, ok: true } as unknown as MissionEvaluation)).not.toThrow()
  })
})

describe('pause / resume / complete / cancel', () => {
  it('pause 仅对 active 生效，并写 pause 历史', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.pause(m.id, '等用户确认')
    expect(m.status).toBe('paused')
    expect(m.history[m.history.length - 1]).toMatchObject({ kind: 'pause', detail: '等用户确认' })
    tracker.pause(m.id, '重复暂停')
    expect(m.history.filter((h) => h.kind === 'pause')).toHaveLength(1)
  })

  it('resume 从 paused 恢复并保留累计轮次', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.advance(m.id, 's1', ev(false, 'note', false))
    expect(m.rounds).toBe(1)
    tracker.resume(m.id, '评估器已修复')
    expect(m.status).toBe('active')
    expect(m.rounds).toBe(1)
    expect(m.history[m.history.length - 1]).toMatchObject({ kind: 'resume', detail: '评估器已修复' })
  })

  it('resume 从 failed 恢复时重置轮次预算', () => {
    const { tracker } = setup()
    const m = tracker.create('目标', { maxRounds: 1 })
    tracker.advance(m.id, 's1', ev(false, '触顶'))
    expect(m.status).toBe('failed')
    tracker.resume(m.id)
    expect(m.status).toBe('active')
    expect(m.rounds).toBe(0)
    expect(m.history[m.history.length - 1].detail).toContain('预算已重置')
  })

  it('resume 对 completed / cancelled / 未知 id 静默', () => {
    const { tracker } = setup()
    const a = tracker.create('A')
    const b = tracker.create('B')
    tracker.complete(a.id)
    tracker.cancel(b.id)
    const beforeA = a.history.length
    const beforeB = b.history.length
    expect(() => tracker.resume(a.id)).not.toThrow()
    expect(() => tracker.resume(b.id)).not.toThrow()
    expect(() => tracker.resume('unknown')).not.toThrow()
    expect(a.status).toBe('completed')
    expect(b.status).toBe('cancelled')
    expect(a.history).toHaveLength(beforeA)
    expect(b.history).toHaveLength(beforeB)
  })

  it('complete 对 active / paused 生效，对 failed 静默', () => {
    const { tracker } = setup()
    const a = tracker.create('A')
    const b = tracker.create('B', { maxRounds: 1 })
    tracker.advance(b.id, 's', ev(false, 'x'))
    tracker.complete(a.id, '人工判定完成')
    tracker.complete(b.id)
    expect(a.status).toBe('completed')
    expect(b.status).toBe('failed')
    expect(a.history[a.history.length - 1]).toMatchObject({ kind: 'complete', detail: '人工判定完成' })
  })

  it('cancel 对未终结任务生效，历史 kind 为 progress', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.cancel(m.id, '需求取消')
    expect(m.status).toBe('cancelled')
    expect(m.history[m.history.length - 1]).toMatchObject({ kind: 'progress', detail: '需求取消' })
  })

  it('cancel 对已完成任务静默', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    tracker.complete(m.id)
    tracker.cancel(m.id)
    expect(m.status).toBe('completed')
  })

  it('三种状态操作的未知 id 均不抛', () => {
    const { tracker } = setup()
    expect(() => tracker.pause('x')).not.toThrow()
    expect(() => tracker.complete('x')).not.toThrow()
    expect(() => tracker.cancel('x')).not.toThrow()
  })
})

describe('历史环形缓冲', () => {
  it('超过 200 条后丢弃最旧条目', () => {
    const { tracker } = setup()
    const m = tracker.create('长跑', { maxRounds: 300 })
    for (let i = 1; i <= 250; i++) tracker.advance(m.id, `s${i}`, ev(false, `note-${i}`))
    expect(m.history).toHaveLength(MAX_HISTORY)
    expect(m.history[0].detail).toContain('第 51 轮评估')
    expect(m.history[m.history.length - 1].detail).toContain('第 250 轮评估')
  })

  it('上限按任务隔离', () => {
    const { tracker } = setup()
    const a = tracker.create('A')
    const b = tracker.create('B')
    tracker.pause(a.id)
    expect(a.history).toHaveLength(2)
    expect(b.history).toHaveLength(1)
  })
})

describe('summary', () => {
  it('未知任务返回空串', () => {
    const { tracker } = setup()
    expect(tracker.summary('unknown')).toBe('')
  })

  it('包含目标、状态、项目、轮次、里程碑状态、当前指针与最近 note', () => {
    const { tracker } = setup()
    const m = withMilestones(tracker)
    tracker.advance(m.id, 'session-9', ev(false, '还差文档'))
    const text = tracker.summary(m.id)
    expect(text).toContain(m.id)
    expect(text).toContain('完成一次大型重构')
    expect(text).toContain('状态：active | 项目：demo')
    expect(text).toContain('轮次：1/20')
    expect(text).toContain('[in_progress] 梳理现状')
    expect(text).toContain('[pending] 实施改造')
    expect(text).toContain('会话：session-9')
    expect(text).toContain('<- 当前')
    expect(text).toContain('最近评估：还差文档')
  })

  it('无里程碑时输出占位说明', () => {
    const { tracker } = setup()
    const m = tracker.create('目标')
    expect(tracker.summary(m.id)).toContain('（尚未拆分里程碑）')
  })
})

describe('stats', () => {
  it('空库统计含全部状态键', () => {
    const { tracker } = setup()
    expect(tracker.stats()).toEqual({
      total: 0,
      byStatus: { active: 0, paused: 0, completed: 0, failed: 0, cancelled: 0 },
      totalRounds: 0,
    })
  })

  it('混合状态统计正确', () => {
    const { tracker } = setup()
    const a = tracker.create('A')
    const b = tracker.create('B')
    const c = tracker.create('C', { maxRounds: 1 })
    tracker.pause(b.id)
    tracker.advance(c.id, 's', ev(false, 'x'))
    tracker.complete(a.id)
    tracker.advance(a.id, 's', ev(false, '已被忽略'))
    const s = tracker.stats()
    expect(s.total).toBe(3)
    expect(s.byStatus).toEqual({ active: 0, paused: 1, completed: 1, failed: 1, cancelled: 0 })
    expect(s.totalRounds).toBe(1)
  })
})

describe('持久化注入', () => {
  it('构造时调用 load 一次；create / advance / pause 均触发 save', () => {
    const { tracker, store } = setup()
    expect(store.loadCalls).toBe(1)
    tracker.create('A')
    const n1 = store.saveCalls
    const m = tracker.list()[0]
    tracker.advance(m.id, 's', ev(false, 'x'))
    expect(store.saveCalls).toBe(n1 + 1)
    tracker.pause(m.id)
    expect(store.saveCalls).toBe(n1 + 2)
  })

  it('新实例从 store.load 恢复任务并可继续推进', () => {
    const { tracker, store } = setup()
    const m = tracker.create('持久化目标', { project: 'p1', maxRounds: 5 })
    tracker.addMilestone(m.id, '第一步')
    tracker.advance(m.id, 's1', ev(false, '还没好'))

    const restored = new MissionTracker(store)
    const again = restored.get(m.id)
    expect(again).toBeDefined()
    expect(again!.project).toBe('p1')
    expect(again!.rounds).toBe(1)
    expect(again!.milestones[0].notes).toContain('还没好')
    const plan = restored.advance(m.id, 's2', ev(true, '好了'))
    expect(plan.shouldContinue).toBe(false)
    expect(restored.get(m.id)!.status).toBe('completed')
  })

  it('store.save 抛错不影响内存状态，并记录 persistError', () => {
    const { tracker, store } = setup()
    const m = tracker.create('目标')
    store.failSave = true
    expect(() => tracker.advance(m.id, 's', ev(false, '继续'))).not.toThrow()
    expect(tracker.get(m.id)!.rounds).toBe(1)
    expect(tracker.persistError).toBeInstanceOf(Error)
    store.failSave = false
    tracker.advance(m.id, 's2', ev(false, '再试'))
    expect(tracker.persistError).toBeNull()
  })

  it('store.load 抛错时以空库启动且不抛', () => {
    const store = new TestStore()
    store.failLoad = true
    expect(() => new MissionTracker(store)).not.toThrow()
    expect(new MissionTracker(store).list()).toEqual([])
  })

  it('脏数据被规整：非法状态、缺字段、重复 id、超长历史', () => {
    const store = new TestStore()
    store.data = [
      {
        id: 'm1', goal: '脏数据', status: 'BOGUS',
        milestones: [{ id: 'ms1', title: '步骤', status: 'BAD', notes: 'not-array' }],
        currentMilestoneId: 'missing', rounds: -3, maxRounds: 0,
        history: Array.from({ length: 300 }, (_, i) => ({ at: i, sessionId: 's', kind: '???', detail: 'x' })),
      },
      { id: '', goal: '无 id 应被丢弃' },
      { id: 'm1', goal: '重复 id 应被丢弃' },
    ] as unknown as Mission[]
    const tracker = new MissionTracker(store)
    expect(tracker.list()).toHaveLength(1)
    const m = tracker.get('m1')!
    expect(m.status).toBe('active')
    expect(m.project).toBe('')
    expect(m.milestones[0].status).toBe('pending')
    expect(m.milestones[0].notes).toEqual([])
    expect(m.currentMilestoneId).toBeNull()
    expect(m.rounds).toBe(0)
    expect(m.maxRounds).toBe(20)
    expect(m.history).toHaveLength(MAX_HISTORY)
    expect(m.history[0].kind).toBe('progress')
  })

  it('交给 store 的快照与内存状态隔离', () => {
    const { tracker, store } = setup()
    const m = tracker.create('目标')
    const oldSnapshot = store.lastSaved[0]
    const snapshotRounds = oldSnapshot.rounds
    tracker.advance(m.id, 's', ev(false, 'note'))
    // 旧快照不应被后续内存修改"隔空"改写
    expect(oldSnapshot.rounds).toBe(snapshotRounds)
    expect(store.lastSaved[0].rounds).toBe(snapshotRounds + 1)
    expect(tracker.get(m.id)!.rounds).toBe(snapshotRounds + 1)
  })

  it('不注入 store 时使用内置内存存储', () => {
    const tracker = new MissionTracker()
    const m = tracker.create('内存目标')
    tracker.advance(m.id, 's', ev(false, 'note'))
    expect(tracker.get(m.id)!.rounds).toBe(1)
    expect(tracker.stats().total).toBe(1)
    expect(createMemoryStore().load()).toEqual([])
  })
})
