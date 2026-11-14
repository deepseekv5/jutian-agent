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

/** 公文红头样式（v14.19.0）：仿 GB/T 9704 版式——红标题小标宋、红色分隔线、正文仿宋 */
export function wrapGongwenDocument(title: string, bodyHtml: string, metaLine = ''): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 3.7cm 2.8cm 3.5cm 2.6cm; }
  body { margin: 0; background: #f5f1e8; }
  .gw { max-width: 780px; margin: 0 auto; padding: 48px 56px 64px; background: #fff; box-shadow: 0 2px 24px rgba(0,0,0,.08); }
  .gw-head { text-align: center; color: #c7000b; font-family: 'STZhongsong', 'Songti SC', 'SimSun', serif; font-size: 30px; letter-spacing: .12em; font-weight: 700; padding: 18px 0 10px; }
  .gw-sub { text-align: center; color: #8a8378; font-size: 12px; font-family: 'Songti SC', 'SimSun', serif; letter-spacing: .3em; padding-bottom: 14px; }
  .gw-line { border: none; border-top: 2.5px solid #c7000b; margin: 0 0 26px; }
  .gw-title { text-align: center; font-family: 'STZhongsong', 'Songti SC', 'SimSun', serif; font-size: 22px; color: #1d150d; margin: 6px 0 22px; }
  .gw-meta { text-align: center; color: #6b5d4a; font-size: 12px; margin-bottom: 24px; }
  .gw-body { font-family: 'Fangsong', 'FangSong_GB2312', 'STFangsong', 'Songti SC', serif; font-size: 16px; line-height: 2; color: #241c12; }
  .gw-body p { margin: 0 0 14px; text-indent: 2em; }
  .gw-body h2 { font-family: 'Heiti SC', 'SimHei', sans-serif; font-size: 16px; margin: 18px 0 8px; }
  .gw-body pre, .gw-body code { font-family: inherit; background: transparent; }
  .gw-body blockquote { margin: 12px 0; padding: 4px 16px; border-left: 3px solid #c7000b; color: #4a4034; }
  .gw-body table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
  .gw-body th, .gw-body td { border: 1px solid #b9ab90; padding: 6px 10px; }
  .gw-foot { margin-top: 40px; text-align: center; color: #b0a794; font-size: 11px; font-family: 'Songti SC', serif; }
</style></head>
<body><div class="gw">
<div class="gw-head">巨 天 文 电</div>
<div class="gw-sub">JUTIAN OFFICIAL</div>
<hr class="gw-line">
<div class="gw-title">${escapeHtml(title)}</div>
${metaLine ? `<div class="gw-meta">${escapeHtml(metaLine)}</div>` : ''}
<div class="gw-body">${bodyHtml}</div>
<div class="gw-foot">由巨天agent 导出 · ${new Date().toLocaleString('zh-CN')}</div>
</div></body></html>`
}
