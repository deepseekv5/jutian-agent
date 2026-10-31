import { describe, it, expect } from 'vitest'
import { parseCronField, parseCron, nextCronTime, validateCron } from '../src/shared/cron'

// 定时任务 cron（v14）：服务端此前根本不解析 cron，nextRun 从未计算，
// UI 创建的任务永远不触发。这里钉住解析与「下一次触发」的语义。

describe('parseCronField', () => {
  it('星号覆盖全范围', () => {
    expect([...parseCronField('*', 0, 59)!].length).toBe(60)
  })
  it('列表', () => {
    expect([...parseCronField('1,5,9', 0, 59)!]).toEqual([1, 5, 9])
  })
  it('范围', () => {
    expect([...parseCronField('1-3', 0, 23)!]).toEqual([1, 2, 3])
  })
  it('步长（* 与范围两种写法）', () => {
    expect([...parseCronField('*/15', 0, 59)!]).toEqual([0, 15, 30, 45])
    expect([...parseCronField('0-30/10', 0, 59)!]).toEqual([0, 10, 20, 30])
  })
  it('单值起步长（5/10 从 5 开始）', () => {
    expect([...parseCronField('5/10', 0, 59)!]).toEqual([5, 15, 25, 35, 45, 55])
  })
  it('越界/非法返回 null', () => {
    expect(parseCronField('60', 0, 59)).toBeNull()
    expect(parseCronField('5-1', 0, 59)).toBeNull()
    expect(parseCronField('*/0', 0, 59)).toBeNull()
    expect(parseCronField('a', 0, 59)).toBeNull()
    expect(parseCronField('', 0, 59)).toBeNull()
  })
})

describe('parseCron', () => {
  it('5 段解析成功，段数不对返回 null', () => {
    expect(parseCron('0 9 * * *')).toBeTruthy()
    expect(parseCron('0 9 * *')).toBeNull()
    expect(parseCron('0 9 * * * *')).toBeNull()
  })
  it('周日 7 归一化为 0', () => {
    expect([...parseCron('0 0 * * 7')!.weekdays]).toEqual([0])
  })
  it('标记日/周是否受限', () => {
    expect(parseCron('0 9 * * 1-5')!.dowRestricted).toBe(true)
    expect(parseCron('0 9 * * 1-5')!.domRestricted).toBe(false)
    expect(parseCron('0 9 1 * *')!.domRestricted).toBe(true)
  })
})

describe('nextCronTime', () => {
  const at = (s: string) => new Date(s)

  it('每分钟：下一次是下一分钟', () => {
    const n = nextCronTime('* * * * *', at('2026-11-01T10:30:20'))!
    expect(n.toISOString()).toBe(at('2026-11-01T10:31:00').toISOString())
  })
  it('每天 9:00：当天已过则顺延到明天', () => {
    const n = nextCronTime('0 9 * * *', at('2026-11-01T10:30:00'))!
    expect(n.toISOString()).toBe(at('2026-11-02T09:00:00').toISOString())
  })
  it('每天 9:00：当天未到则当天', () => {
    const n = nextCronTime('0 9 * * *', at('2026-11-01T08:00:00'))!
    expect(n.toISOString()).toBe(at('2026-11-01T09:00:00').toISOString())
  })
  it('工作日 9:00：周五之后跳到周一', () => {
    // 2026-11-06 是周五
    const n = nextCronTime('0 9 * * 1-5', at('2026-11-06T10:00:00'))!
    expect(n.getDay()).toBe(1) // 周一
    expect(n.getHours()).toBe(9)
  })
  it('每月 1 号：跨月', () => {
    const n = nextCronTime('30 8 1 * *', at('2026-11-01T09:00:00'))!
    expect(n.getMonth()).toBe(11) // 12 月
    expect(n.getDate()).toBe(1)
    expect(n.getHours()).toBe(8)
    expect(n.getMinutes()).toBe(30)
  })
  it('多小时列表：9:00 与 18:00', () => {
    const n = nextCronTime('0 9,18 * * *', at('2026-11-01T10:00:00'))!
    expect(n.getHours()).toBe(18)
  })
  it('日与周同时受限按「或」（Vixie 语义）', () => {
    // 每月 15 号 或 每周一
    const n = nextCronTime('0 0 15 * 1', at('2026-11-01T00:00:00'))!
    expect(n.getDate() === 15 || n.getDay() === 1).toBe(true)
  })
  it('永不成立返回 null', () => {
    expect(nextCronTime('0 0 30 2 *', at('2026-11-01T00:00:00'))).toBeNull()
  })
})

describe('validateCron', () => {
  it('合法表达式返回 null', () => {
    expect(validateCron('0 9 * * 1-5')).toBeNull()
    expect(validateCron('*/15 * * * *')).toBeNull()
  })
  it('段数不对给出明确提示', () => {
    expect(validateCron('0 9 *')).toContain('5 段')
  })
  it('永不成立的条件被识别', () => {
    expect(validateCron('0 0 30 2 *')).toContain('永远不会触发')
  })
})
