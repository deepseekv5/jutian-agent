// 会话导出序列化。
//
// 原来的导出是 ChatTab 里一段内联 if-else，只出 md/txt/json/kb。
// 抽成纯模块是为了：能测、能加格式、且 HTML/Word 这类"要转义内容"的
// 格式不会因为内联字符串拼接漏掉 escaping——对话里含 < > & 是常态，
// 漏转义会直接把导出的 HTML 结构弄坏。
//
// Word 走 .doc + text/html MIME 这个老路子，而不是引入 docx 依赖：
// Word / Pages / Numbers 都能直接打开，为一个导出功能引整个 docx 库不划算。

export interface ExportMessage {
  role: string
  content: string
  thinking?: string
  tool_calls?: { name: string; arguments?: string }[]
  created_at?: string
}

export type ExportFormat = 'md' | 'txt' | 'json' | 'html' | 'doc'

/** HTML 转义：导出的任何内容都必须过这里 */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function speaker(role: string): string {
  if (role === 'user') return '用户'
  if (role === 'assistant') return '巨天'
  return role || '系统'
}

/** Markdown */
export function toMarkdown(messages: ExportMessage[], stamp: string): string {
  const lines = ['# 对话导出', `> ${stamp} · 巨天agent`, '']
  for (const m of messages) {
    lines.push(`## ${m.role === 'user' ? '❯ 用户' : '● 巨天'}`, '', m.content || '（空）', '')
    if (m.thinking) { lines.push('<details><summary>思考过程</summary>', '', m.thinking, '', '</details>', '') }
    if (m.tool_calls?.length) {
      lines.push('**工具调用：**', '')
      for (const tc of m.tool_calls) lines.push(`- \`${tc.name}\``)
      lines.push('')
    }
  }
  return lines.join('\n')
}

/** 纯文本 */
export function toPlainText(messages: ExportMessage[]): string {
  return messages.map(m => {
    let s = `【${speaker(m.role)}】\n${m.content || '（空）'}\n`
    if (m.thinking) s += `\n（思考：${m.thinking}\n）\n`
    return s
  }).join('\n')
}

/** JSON（含工具调用与思考，便于二次处理） */
export function toJson(sessionId: string, messages: ExportMessage[]): string {
  return JSON.stringify({
    session: sessionId,
    exported_at: new Date().toISOString(),
    messages: messages.map(m => ({
      role: m.role, content: m.content, thinking: m.thinking,
      tool_calls: m.tool_calls, created_at: m.created_at,
    })),
  }, null, 2)
}

/** HTML 页面：自带样式，双击即看（自带亮/暗自适应与代码/表格排版） */
export function toHtml(messages: ExportMessage[], stamp: string, title = '对话导出'): string {
  const body = messages.map(m => {
    const isUser = m.role === 'user'
    let inner = `<p>${escapeHtml(m.content || '（空）').replace(/\n/g, '<br>')}</p>`
    if (m.thinking) {
      inner += `<details class="think"><summary>思考过程</summary><pre>${escapeHtml(m.thinking)}</pre></details>`
    }
    if (m.tool_calls?.length) {
      inner += `<ul class="tools">${m.tool_calls.map(tc => `<li><code>${escapeHtml(tc.name)}</code></li>`).join('')}</ul>`
    }
    return `<section class="msg ${isUser ? 'user' : 'ai'}">
      <header>${isUser ? '❯ 用户' : '● 巨天'}${m.created_at ? `<time>${escapeHtml(String(m.created_at))}</time>` : ''}</header>
      ${inner}
    </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink:#0d0d0d; --ink2:#5d5d5d; --line:#e5e5e5; --bg:#fff; --card:#fafafa; --accent:#10a37f; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#ececec; --ink2:#a1a1a1; --line:#333; --bg:#1a1a1a; --card:#222; }
  }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.75 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:48px 24px 96px; }
  h1 { font-size:1.8rem; margin:0 0 4px }
  .meta { color:var(--ink2); font-size:.85rem; margin-bottom:32px }
  .msg { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin:14px 0 }
  .msg header { font-size:.78rem; font-weight:600; color:var(--ink2); margin-bottom:8px;
    display:flex; gap:10px; align-items:center }
  .msg.ai header { color:var(--accent) }
  .msg p { margin:0; white-space:pre-wrap; word-break:break-word }
  .think { margin-top:10px; font-size:.85rem; color:var(--ink2) }
  .think summary { cursor:pointer }
  .think pre { white-space:pre-wrap; background:var(--bg); border:1px solid var(--line);
    border-radius:8px; padding:10px; font-size:.8rem; line-height:1.6 }
  .tools { margin:10px 0 0; padding-left:1.2em; font-size:.82rem; color:var(--ink2) }
  code { font-family:ui-monospace,Menlo,Consolas,monospace; background:var(--bg);
    border:1px solid var(--line); border-radius:4px; padding:1px 5px; font-size:.85em }
</style></head>
<body><div class="wrap">
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(stamp)} · 巨天agent</div>
${body}
</div></body></html>`
}

/**
 * Word 文档。
 * 走 .doc + text/html：Word/Pages/Numbers 直接打开，无需 docx 依赖。
 * 带 MHT 头，中文字体与深色不会被浏览器默认样式干扰。
 */
export function toWordHtml(messages: ExportMessage[], stamp: string, title = '对话导出'): string {
  const body = messages.map(m => `
  <p style="margin:0 0 4px"><b style="color:${m.role === 'user' ? '#5d5d5d' : '#10a37f'}">${escapeHtml(m.role === 'user' ? '❯ 用户' : '● 巨天')}</b></p>
  <p style="margin:0 0 12px">${escapeHtml(m.content || '（空）').replace(/\n/g, '<br>')}</p>
  ${m.thinking ? `<p style="margin:0 0 12px;color:#8f8f8f;font-size:10.5pt"><i>（思考：${escapeHtml(m.thinking).replace(/\n/g, '<br>')}）</i></p>` : ''}`).join('\n')

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page { margin: 2cm }
  body { font-family:"PingFang SC","Microsoft YaHei",sans-serif; font-size:11pt; line-height:1.7; color:#0d0d0d }
  h1 { font-size:18pt; margin:0 0 6pt }
  .meta { color:#8f8f8f; font-size:9.5pt; margin:0 0 18pt }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(stamp)} · 巨天agent</p>
${body}
</body></html>`
}

/** 每种格式对应的文件名后缀与 MIME */
export const EXPORT_META: Record<ExportFormat, { ext: string; mime: string; label: string }> = {
  md: { ext: 'md', mime: 'text/markdown;charset=utf-8', label: 'Markdown 文档' },
  txt: { ext: 'txt', mime: 'text/plain;charset=utf-8', label: '纯文本' },
  json: { ext: 'json', mime: 'application/json;charset=utf-8', label: 'JSON 数据' },
  html: { ext: 'html', mime: 'text/html;charset=utf-8', label: '网页（可打印）' },
  doc: { ext: 'doc', mime: 'application/msword;charset=utf-8', label: 'Word 文档' },
}

/** 按格式生成 {文本, 文件名}；kb 不在这里，它是写知识库而非下载 */
export function buildExport(
  fmt: ExportFormat,
  messages: ExportMessage[],
  opts: { sessionId?: string; stamp?: string; date?: string } = {},
): { text: string; name: string } {
  const date = opts.date || new Date().toISOString().slice(0, 10)
  const stamp = opts.stamp || ''
  const meta = EXPORT_META[fmt]
  const text = fmt === 'json' ? toJson(opts.sessionId || '', messages)
    : fmt === 'txt' ? toPlainText(messages)
    : fmt === 'html' ? toHtml(messages, stamp)
    : fmt === 'doc' ? toWordHtml(messages, stamp)
    : toMarkdown(messages, stamp)
  return { text, name: `巨天对话-${date}.${meta.ext}` }
}