import { describe, it, expect } from 'vitest'
import { markdownToHtml, inlineMd, wrapHtmlDocument } from '../src/shared/exportHtml'

// 导出 HTML/PDF（v14）：会话导出要能直接发给别人看，所以既要好看也要安全
// （消息内容是不可信输入，必须转义，不能注入脚本）。

describe('inlineMd', () => {
  it('粗体/斜体/行内代码', () => {
    expect(inlineMd('**粗** 与 *斜* 与 `code`')).toBe('<strong>粗</strong> 与 <em>斜</em> 与 <code>code</code>')
  })
  it('行内代码里的星号不被当成强调', () => {
    expect(inlineMd('`a*b*c`')).toBe('<code>a*b*c</code>')
  })
  it('链接只接受 http(s)', () => {
    expect(inlineMd('[站](https://x.com)')).toContain('href="https://x.com"')
    expect(inlineMd('[坏](javascript:alert(1))')).not.toContain('href="javascript')
  })
  it('HTML 被转义（防注入）', () => {
    expect(inlineMd('<img src=x onerror=alert(1)>')).toContain('&lt;img')
    expect(inlineMd('<script>alert(1)</script>')).not.toContain('<script>')
  })
})

describe('markdownToHtml', () => {
  it('标题与段落', () => {
    const html = markdownToHtml('# 标题\n\n正文一段')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>正文一段</p>')
  })
  it('代码围栏：内容转义且不被当 HTML 渲染', () => {
    const html = markdownToHtml('```js\nconst a = "<b>"\n```')
    expect(html).toContain('<pre><code class="lang-js">')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })
  it('列表（有序/无序）成对闭合', () => {
    const ul = markdownToHtml('- a\n- b')
    expect(ul).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
    const ol = markdownToHtml('1. x\n2. y')
    expect(ol).toBe('<ol>\n<li>x</li>\n<li>y</li>\n</ol>')
  })
  it('列表遇到空行正确闭合，后续段落不进列表', () => {
    const html = markdownToHtml('- a\n\n段落')
    expect(html).toContain('</ul>')
    expect(html).toContain('<p>段落</p>')
  })
  it('引用块合并', () => {
    const html = markdownToHtml('> 第一行\n> 第二行')
    expect(html).toBe('<blockquote>\n<p>第一行</p>\n<p>第二行</p>\n</blockquote>')
  })
  it('分隔线', () => {
    expect(markdownToHtml('---')).toContain('<hr>')
  })
  it('未闭合的代码围栏也能输出（不吞内容）', () => {
    const html = markdownToHtml('```\nabc')
    expect(html).toContain('<pre><code>abc</code></pre>')
  })
})

describe('wrapHtmlDocument', () => {
  it('自包含：内联样式 + 标题 + 页脚', () => {
    const doc = wrapHtmlDocument('我的会话', '<p>正文</p>', '元信息')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<title>我的会话</title>')
    expect(doc).toContain('<style>')
    expect(doc).toContain('<p>正文</p>')
    expect(doc).toContain('元信息')
    expect(doc).toContain('@media print')
  })
  it('标题里的特殊字符被转义', () => {
    expect(wrapHtmlDocument('<x>', '')).toContain('&lt;x&gt;')
  })
})
