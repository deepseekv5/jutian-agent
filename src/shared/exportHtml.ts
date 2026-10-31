/**
 * Markdown → 自包含 HTML（v14，会话导出用）
 *
 * 为什么自己写而不引 marked：导出只需要覆盖对话里实际出现的语法
 * （标题、代码块、行内代码、粗斜体、列表、引用、链接、分隔线、表格略）。
 * 引一个 30KB 的库只为这点转换不划算，而且渲染端已有 react-markdown。
 *
 * 输出是**单文件**：内联样式 + 打印 CSS，浏览器打开可直接「打印为 PDF」，
 * 也可以用 Electron 的 printToPDF 直接落盘。
 */

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内语法：代码 > 粗体 > 斜体 > 链接（先处理代码，避免把代码里的 * 当强调） */
export function inlineMd(text: string): string {
  const codes: string[] = []
  let s = String(text).replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c)
    return `@@JTC${codes.length - 1}@@`
  })
  s = escapeHtml(s)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
  s = s.replace(/@@JTC(\d+)@@/g, (_m, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`)
  return s
}

/** 把一段 Markdown 转成 HTML 片段 */
export function markdownToHtml(md: string): string {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inQuote = false

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null } }
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false } }

  for (const raw of lines) {
    const line = raw
    // 代码围栏
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      if (inCode) {
        out.push(`<pre><code${codeLang ? ` class="lang-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        inCode = false; codeBuf = []; codeLang = ''
      } else {
        closeList(); closeQuote()
        inCode = true; codeLang = fence[1] || ''
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }

    // 空行
    if (!line.trim()) { closeList(); closeQuote(); continue }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList(); closeQuote()
      const lv = h[1].length
      out.push(`<h${lv}>${inlineMd(h[2])}</h${lv}>`)
      continue
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr>'); continue }

    // 引用
    const q = line.match(/^\s*>\s?(.*)$/)
    if (q) {
      closeList()
      if (!inQuote) { out.push('<blockquote>'); inQuote = true }
      out.push(`<p>${inlineMd(q[1])}</p>`)
      continue
    }
    closeQuote()

    // 无序 / 有序列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want }
      out.push(`<li>${inlineMd((ul || ol)![1])}</li>`)
      continue
    }
    closeList()

    // 普通段落
    out.push(`<p>${inlineMd(line)}</p>`)
  }
  if (inCode && codeBuf.length) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  closeList(); closeQuote()
  return out.join('\n')
}

/** 导出用样式：屏幕与打印都好看（浅色，A4 友好） */
export const EXPORT_CSS = `
:root{--ink:#1f2328;--muted:#6b7280;--line:#e5e7eb;--accent:#10a37f;--code:#f6f8fa}
*{box-sizing:border-box}
body{margin:0;padding:32px 28px;background:#fff;color:var(--ink);
  font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.wrap{max-width:760px;margin:0 auto}
h1,h2,h3,h4{line-height:1.35;margin:1.4em 0 .6em;font-weight:650}
h1{font-size:26px;border-bottom:2px solid var(--line);padding-bottom:.35em}
h2{font-size:20px;margin-top:1.8em}
h3{font-size:17px}
p{margin:.65em 0}
a{color:#0b7a5f;text-decoration:none;border-bottom:1px solid rgba(16,163,127,.35)}
code{background:var(--code);padding:.15em .38em;border-radius:5px;font-size:.9em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre{background:var(--code);padding:12px 14px;border-radius:10px;overflow:auto;border:1px solid var(--line)}
pre code{background:none;padding:0;font-size:13px;line-height:1.6}
blockquote{margin:.8em 0;padding:.2em 1em;border-left:3px solid var(--accent);color:var(--muted);background:#fafafa}
ul,ol{padding-left:1.5em;margin:.6em 0}
li{margin:.25em 0}
hr{border:none;border-top:1px solid var(--line);margin:1.6em 0}
.meta{color:var(--muted);font-size:13px;margin-bottom:1.5em}
.msg{margin:1.1em 0;padding:10px 14px;border-radius:10px;border:1px solid var(--line)}
.msg.user{background:#f7f9fb}
.msg.assistant{background:#fff}
.role{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:.3em}
footer{margin-top:2.5em;padding-top:1em;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@page{margin:16mm 14mm}
@media print{
  body{padding:0}
  .msg{break-inside:avoid}
  pre{break-inside:avoid}
  a{color:inherit;border:none}
}
`

/** 包成完整 HTML 文档 */
export function wrapHtmlDocument(title: string, bodyHtml: string, metaLine = ''): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style></head>
<body><div class="wrap">
<h1>${escapeHtml(title)}</h1>
${metaLine ? `<div class="meta">${escapeHtml(metaLine)}</div>` : ''}
${bodyHtml}
<footer>由巨天agent 导出 · ${new Date().toLocaleString('zh-CN')}</footer>
</div></body></html>`
}
