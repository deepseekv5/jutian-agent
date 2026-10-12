/**
 * 会话导出测试
 *
 * 重点两件事：
 *  1) HTML/Word 必须正确转义 —— 对话里 < > & 是常态，漏转义会把导出的
 *     页面结构直接弄坏，甚至造成注入（导出的文件会被分享给别人打开）。
 *  2) 各格式都要带上思考与工具调用 —— 导出是"留档"，丢了这些就不是
 *     对话的完整记录了。
 */
import { describe, it, expect } from 'vitest'
import { toMarkdown, toPlainText, toJson, toHtml, toWordHtml, buildExport, escapeHtml, EXPORT_META } from '../src/renderer/utils/exportChat'
import type { ExportMessage } from '../src/renderer/utils/exportChat'

const msgs: ExportMessage[] = [
  { role: 'user', content: '帮我修 <div> 的样式 && 布局', created_at: '2026-10-12T10:00:00Z' },
  { role: 'assistant', content: '改完了，用 flex 即可。', thinking: '先看结构再改', tool_calls: [{ name: 'edit_file' }] },
]

describe('escapeHtml', () => {
  it('五个基本字符都转义', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })

  it('空值不炸', () => {
    expect(escapeHtml('')).toBe('')
    expect(escapeHtml(undefined as any)).toBe('')
    expect(escapeHtml(null as any)).toBe('')
  })
})

describe('toMarkdown', () => {
  it('含标题与说话人', () => {
    const md = toMarkdown(msgs, '2026-10-12 10:00')
    expect(md).toContain('# 对话导出')
    expect(md).toContain('## ❯ 用户')
    expect(md).toContain('## ● 巨天')
  })

  it('保留思考过程(导出是留档,不能丢)', () => {
    expect(toMarkdown(msgs, 't')).toContain('先看结构再改')
  })

  it('保留工具调用', () => {
    expect(toMarkdown(msgs, 't')).toContain('edit_file')
  })
})

describe('toPlainText', () => {
  it('带说话人标记', () => {
    const t = toPlainText(msgs)
    expect(t).toContain('【用户】')
    expect(t).toContain('【巨天】')
  })

  it('空内容有占位', () => {
    expect(toPlainText([{ role: 'user', content: '' }])).toContain('（空）')
  })
})

describe('toJson', () => {
  it('结构可解析且字段齐全', () => {
    const j = JSON.parse(toJson('sid1', msgs))
    expect(j.session).toBe('sid1')
    expect(j.messages).toHaveLength(2)
    expect(j.messages[0].content).toContain('<div>')
    expect(j.messages[1].tool_calls[0].name).toBe('edit_file')
  })
})

describe('toHtml', () => {
  it('内容被转义,不会破坏页面结构', () => {
    const html = toHtml(msgs, 'stamp')
    // 原文里的 <div> 必须变成 &lt;div&gt;
    expect(html).toContain('&lt;div&gt;')
    expect(html).not.toContain('<div>的样式')   // 未转义的原文不能出现
  })

  it('引号也转义', () => {
    const h = toHtml([{ role: 'user', content: '他说"你好"了' }], 't')
    expect(h).toContain('&quot;你好&quot;')
  })

  it('完整文档骨架', () => {
    const h = toHtml(msgs, 't')
    expect(h.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(h).toContain('</html>')
    expect(h).toContain('lang="zh-CN"')
  })

  it('带深色模式', () => {
    expect(toHtml(msgs, 't')).toContain('prefers-color-scheme: dark')
  })
})

describe('toWordHtml', () => {
  it('转义内容', () => {
    expect(toWordHtml(msgs, 't')).toContain('&lt;div&gt;')
  })

  it('带 Word 命名空间与 mso 声明', () => {
    const w = toWordHtml(msgs, 't')
    expect(w).toContain('urn:schemas-microsoft-com:office:word')
    expect(w).toContain('mso 9')
  })
})

describe('buildExport', () => {
  it('每种格式都给文本和带正确后缀的文件名', () => {
    for (const fmt of ['md', 'txt', 'json', 'html', 'doc'] as const) {
      const r = buildExport(fmt, msgs, { date: '2026-10-12', stamp: 's' })
      expect(r.text.length).toBeGreaterThan(0)
      expect(r.name).toBe(`巨天对话-2026-10-12.${EXPORT_META[fmt].ext}`)
    }
  })

  it('html 走 utf-8 MIME', () => {
    expect(EXPORT_META.html.mime).toContain('charset=utf-8')
  })
})