import { describe, it, expect } from 'vitest'
import {
  isFestival, daysUntilFestival, eggCards, festivalBanner,
  nextTapCount, TAP_TARGET, TAP_WINDOW_MS,
} from '../src/shared/festival1024'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

describe('1024 节日窗口', () => {
  it('10-24 当天为节日', () => {
    expect(isFestival(at(2026, 10, 24, 0))).toBe(true)
    expect(isFestival(at(2026, 10, 24, 23))).toBe(true)
  })

  it('10-25 凌晨 2 点前算宽限（程序员熬夜）', () => {
    expect(isFestival(at(2026, 10, 25, 1))).toBe(true)
    expect(isFestival(at(2026, 10, 25, 2))).toBe(false)
    expect(isFestival(at(2026, 10, 25, 12))).toBe(false)
  })

  it('前后一天不是节日', () => {
    expect(isFestival(at(2026, 10, 23, 23))).toBe(false)
    expect(isFestival(at(2026, 10, 26, 12))).toBe(false)
  })

  it('其他月份不误判', () => {
    expect(isFestival(at(2026, 9, 24))).toBe(false)
    expect(isFestival(at(2026, 11, 24))).toBe(false)
  })
})

describe('倒计时', () => {
  it('当天为 0', () => {
    expect(daysUntilFestival(at(2026, 10, 24))).toBe(0)
  })

  it('节前为正数', () => {
    expect(daysUntilFestival(at(2026, 10, 20))).toBe(4)
    expect(daysUntilFestival(at(2026, 10, 17))).toBe(7)
  })

  it('节后指向下一年（不会返回负数）', () => {
    const d = daysUntilFestival(at(2026, 10, 26))
    expect(d).toBeGreaterThan(0)
    // 到下一年 10-24 大约 363 天
    expect(d).toBeGreaterThan(350)
    expect(d).toBeLessThan(370)
  })
})

describe('主页横幅', () => {
  it('当天显示祝福 + 彩蛋提示', () => {
    const b = festivalBanner(at(2026, 10, 24))!
    expect(b.active).toBe(true)
    expect(b.title).toContain('1024')
    expect(b.subtitle).toContain('三次')
  })

  it('临近 7 天内显示倒计时', () => {
    const b = festivalBanner(at(2026, 10, 20))!
    expect(b.active).toBe(false)
    expect(b.title).toContain('4')
  })

  it('平时完全不出现（不做常驻广告）', () => {
    expect(festivalBanner(at(2026, 10, 10))).toBeNull()
    expect(festivalBanner(at(2026, 3, 1))).toBeNull()
  })
})

describe('连点彩蛋', () => {
  it('三次快速点击触发', () => {
    let s = { count: 0, lastAt: 0 }
    s = nextTapCount(s, 1000) as any
    expect(s.fired).toBe(false)
    s = nextTapCount(s, 1300) as any
    expect(s.fired).toBe(false)
    s = nextTapCount(s, 1600) as any
    expect(s.fired).toBe(true)
  })

  it('间隔太久重新计数', () => {
    let s: any = { count: 2, lastAt: 1000 }
    const r = nextTapCount(s, 1000 + TAP_WINDOW_MS + 1)
    expect(r.count).toBe(1)
    expect(r.fired).toBe(false)
  })

  it('TAP_TARGET 为 3', () => {
    expect(TAP_TARGET).toBe(3)
  })
})

describe('彩蛋内容', () => {
  const cards = eggCards({ toolCount: 50, sessionCount: 12, daysUsed: 30 })

  it('给出 4 张卡片且 id 唯一', () => {
    expect(cards.length).toBe(4)
    expect(new Set(cards.map((c) => c.id)).size).toBe(4)
  })

  it('包含真实统计而不是空话', () => {
    const stats = cards.find((c) => c.id === 'stats')!
    expect(stats.body).toContain('12')
    expect(stats.body).toContain('30')
  })

  it('没有会话时给引导而不是硬凑数字', () => {
    const empty = eggCards({ toolCount: 50, sessionCount: 0, daysUsed: 0 })
    expect(empty.find((c) => c.id === 'stats')!.body).toContain('还没开始')
  })

  it('诚实提醒 AI 会犯错（不吹嘘）', () => {
    const truth = cards.find((c) => c.id === 'truth')!
    expect(truth.body).toContain('犯错')
  })
})
