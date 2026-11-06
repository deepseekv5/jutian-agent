import { describe, it, expect } from 'vitest'
import {
  normalizeSource, previewOf, appendActivity, sanitizeActivity, relTime,
  LA_MAX, type LocalApiActivity,
} from '../src/shared/localActivity'

describe('localActivity 本地 API 活动', () => {
  it('User-Agent 归一化', () => {
    expect(normalizeSource('OpenAI/v1 PythonBindings/2.5.0', true)).toBe('本机 · OpenAI') // UA 取主产品名
    expect(normalizeSource('curl/8.5.0', false)).toBe('局域网设备 · curl')
    expect(normalizeSource('', true)).toBe('本机')
    expect(normalizeSource(undefined, true)).toBe('本机')
    expect(normalizeSource('PostmanRuntime/7.32.0', false)).toBe('局域网设备 · PostmanRuntime')
  })

  it('预览截断 80 字，不塞全文', () => {
    const long = '这是一段很长的文本 '.repeat(50)
    const p = previewOf(long)
    expect(p.length).toBeLessThanOrEqual(80)
    expect(previewOf(' a\n b  c ')).toBe('a b c')
    expect(previewOf('')).toBe('')
  })

  it('started 插最前，done 按 id 合并更新', () => {
    let list: LocalApiActivity[] = []
    list = appendActivity(list, { id: 'a1', ts: 100, source: '本机 · curl', preview: 'hi', status: 'started' })
    expect(list[0].status).toBe('started')
    list = appendActivity(list, { id: 'a1', status: 'done', ttft: 300, totalMs: 1200 })
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('done')
    expect(list[0].ttft).toBe(300)
    expect(list[0].totalMs).toBe(1200)
    // 没有 id 的按新条目处理
    list = appendActivity(list, { preview: '二', status: 'started' })
    expect(list).toHaveLength(2)
  })

  it('上限 30 条', () => {
    let list: LocalApiActivity[] = []
    for (let i = 0; i < LA_MAX + 20; i++) {
      list = appendActivity(list, { preview: 'x' + i, status: 'done' })
    }
    expect(list).toHaveLength(LA_MAX)
  })

  it('sanitize 容错：坏数据当空', () => {
    expect(sanitizeActivity(null)).toEqual([])
    expect(sanitizeActivity('x')).toEqual([])
    expect(sanitizeActivity([{ ts: 'bad' }, null, 42])).toEqual([])
    expect(sanitizeActivity([{ ts: 1, status: 'weird' }])[0].status).toBe('done')
  })

  it('相对时间', () => {
    const now = Date.now()
    expect(relTime(now - 2000, now)).toBe('刚刚')
    expect(relTime(now - 30_000, now)).toBe('30 秒前')
    expect(relTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relTime(now - 2 * 3600_000, now)).toBe('2 小时前')
    expect(relTime(now - 3 * 86400_000, now)).toBe('3 天前')
  })
})
