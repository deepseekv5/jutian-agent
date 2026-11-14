/**
 * 时间格式化工具测试
 *
 * 这个模块是 23 处散落调用的收敛点，出错会影响消息气泡、导出文件头、
 * 用量统计按天分组等多处。重点覆盖：非法输入回落、本地时区一致性、
 * relativeShort 的今天/更早分支。
 */
import { describe, it, expect } from 'vitest'
import { hhmm, hhmmss, ymd, dateCN, dateTimeCN, relativeShort, isValidTime } from '../src/renderer/utils/datetime'

describe('基础格式', () => {
  it('hhmm 输出 24 小时制两位时分', () => {
    const d = new Date(2026, 9, 11, 9, 5)
    expect(hhmm(d)).toBe('09:05')
  })

  it('hhmm 下午不转 12 小时制（关键：文件名与时间戳不该出现 AM/PM）', () => {
    const d = new Date(2026, 9, 11, 21, 30)
    expect(hhmm(d)).toBe('21:30')
  })

  it('hhmmss 带秒且 24 小时制', () => {
    const d = new Date(2026, 9, 11, 21, 30, 7)
    expect(hhmmss(d)).toMatch(/^21:30:07$/)
  })

  it('ymd 输出本地日期 YYYY-MM-DD', () => {
    expect(ymd(new Date(2026, 0, 3))).toBe('2026-01-03')
  })

  it('ymd 用本地时区，不是 UTC（跨时区不该差一天）', () => {
    // 本地 23:59 必须仍是当天
    expect(ymd(new Date(2026, 5, 15, 23, 59))).toBe('2026-06-15')
    expect(ymd(new Date(2026, 5, 15, 0, 1))).toBe('2026-06-15')
  })

  it('dateCN / dateTimeCN 支持自定义 locale', () => {
    const d = new Date(2026, 9, 11)
    expect(dateCN(d)).toBe(dateCN(d, 'zh-CN'))
    expect(dateCN(d, 'en-US')).toMatch(/2026/)
  })
})

describe('输入容错', () => {
  it('接受 ISO 字符串与时间戳', () => {
    const iso = new Date(2026, 9, 11, 14, 20).toISOString()
    expect(hhmm(iso)).toBe('14:20')
    const ts = new Date(2026, 9, 11, 14, 20).getTime()
    expect(hhmm(ts)).toBe('14:20')
  })

  it('非法日期回落到当前时间而非抛错或输出 Invalid Date', () => {
    expect(hhmm('not-a-date')).toMatch(/^\d{2}:\d{2}$/)
    expect(hhmm(new Date('invalid'))).toMatch(/^\d{2}:\d{2}$/)
  })

  it('isValidTime 正确区分空值与非法值', () => {
    expect(isValidTime(null)).toBe(false)
    expect(isValidTime(undefined)).toBe(false)
    expect(isValidTime('')).toBe(false)
    expect(isValidTime('nope')).toBe(false)
    expect(isValidTime(new Date())).toBe(true)
    expect(isValidTime(new Date().toISOString())).toBe(true)
  })
})

describe('relativeShort', () => {
  it('今天只给时分', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 30)
    expect(relativeShort(today)).toBe('08:30')
  })

  it('更早的日期给「月/日 时分」', () => {
    const old = new Date(2020, 7, 14, 9, 5)
    expect(relativeShort(old)).toBe('8/14 09:05')
  })

  it('今天但已过零点边界：昨天 23:59 不显示为今天', () => {
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59)
    // 跨月/跨年时月日仍应正确
    const expectPrefix = `${yesterday.getMonth() + 1}/${yesterday.getDate()} `
    expect(relativeShort(yesterday).startsWith(expectPrefix)).toBe(true)
  })
})
