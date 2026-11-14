import { describe, it, expect } from 'vitest'
import { parseNoticeMd } from '../src/shared/announcement'

// 公告格式很宽松（写公告的人不该被格式卡住），但解析必须稳：
// 误判"没有公告"= 用户看不到通知；误判"有公告"= 空横幅骚扰。

describe('parseNoticeMd', () => {
  it('完整公告：标题/正文/元信息', () => {
    const a = parseNoticeMd(`# v11 更新说明
<!-- id: 2026-10-18 -->
<!-- level: warn -->

修复了 Windows 上的三个问题。
- 全局搜索恢复
- 自更新可用
`)
    expect(a).not.toBeNull()
    expect(a!.title).toBe('v11 更新说明')
    expect(a!.level).toBe('warn')
    expect(a!.id).toBe('2026-10-18')
    expect(a!.body).toContain('全局搜索恢复')
  })

  it('无元信息时 id 用内容哈希：内容变、id 变', () => {
    const a1 = parseNoticeMd('# A\n正文一')
    const a2 = parseNoticeMd('# A\n正文二')
    const a3 = parseNoticeMd('# A\n正文一')
    expect(a1!.id).toBeTruthy()
    expect(a1!.id).not.toBe(a2!.id)
    // 同样内容哈希必须相同——横幅"关闭后不再弹"全靠 id 稳定
    expect(a3!.id).toBe(a1!.id)
  })

  it('level 非法值回退 info', () => {
    const a = parseNoticeMd('<!-- level: shout -->\n# T\n正文')
    expect(a!.level).toBe('info')
  })

  it('只有正文没有标题：标题兜底"公告"', () => {
    const a = parseNoticeMd('今天服务器维护，可能短暂掉线')
    expect(a).not.toBeNull()
    expect(a!.title).toBe('公告')
    expect(a!.body).toContain('服务器维护')
  })

  it('空文件/纯注释 → null（不弹横幅）', () => {
    expect(parseNoticeMd('')).toBeNull()
    expect(parseNoticeMd('   \n  \n')).toBeNull()
    expect(parseNoticeMd('<!-- id: x -->\n<!-- level: warn -->')).toBeNull()
  })

  it('id/level/date 大小写不敏感', () => {
    const a = parseNoticeMd('<!-- ID: up-1 -->\n<!-- Level: Critical -->\n<!-- DATE: 2026-10-18 -->\n# T\nB')
    expect(a!.id).toBe('up-1')
    expect(a!.level).toBe('critical')
    expect(a!.date).toBe('2026-10-18')
  })

  it('CRLF（Windows 写的公告）正常解析', () => {
    const a = parseNoticeMd('# 标题\r\n<!-- id: win -->\r\n正文\r\n')
    expect(a!.title).toBe('标题')
    expect(a!.id).toBe('win')
    expect(a!.body).toContain('正文')
  })

  it('仓库里的 docs/notice.md 本体必须解析得出公告', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const raw = fs.readFileSync(path.resolve(__dirname, '../docs/notice.md'), 'utf-8')
    const a = parseNoticeMd(raw)
    expect(a).not.toBeNull()
    // id 会随公告版本变——断言格式而不是具体值
    expect(a!.id).toMatch(/2026-\d\d-\d\d-v\d+/)
    expect(a!.title).toBeTruthy()
    expect(a!.body.length).toBeGreaterThan(10)
  })

  it('正文保留换行与列表（前端按行渲染）', () => {
    const a = parseNoticeMd('# T\n- 一\n- 二\n\n段落二')
    expect(a!.body.split('\n').length).toBeGreaterThanOrEqual(4)
  })

  it('二级标题也能当标题认（写公告的人常记不清层级）', () => {
    const a = parseNoticeMd('## 二级标题\n正文')
    expect(a!.title).toBe('二级标题')
  })
})
