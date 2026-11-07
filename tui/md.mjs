/** Markdown → 终端 ANSI（marked + marked-terminal；失败回落纯文本） */
import { marked } from 'marked'
import * as mtNS from 'marked-terminal'

const mt = mtNS.default ?? mtNS.markedTerminal ?? mtNS

let ready = false
try {
  marked.use(mt({
    width: 96, reflowText: true,
    heading: (text) => `\x1b[1;36m${text}\x1b[0m`,
    firstHeading: (text) => `\x1b[1;36m${text}\x1b[0m`,
    codespan: (text) => `\x1b[33m${text}\x1b[0m`,
    code: (code) => `\x1b[2m${'─'.repeat(4)}\x1b[0m\n\x1b[36m${code}\x1b[0m\n\x1b[2m${'─'.repeat(4)}\x1b[0m`,
  }))
  ready = true
} catch { /* 渲染降级 */ }

export function renderMd(text) {
  const s = String(text || '')
  if (!ready) return s
  try { return String(marked.parse(s)).replace(/\n+$/, '') } catch { return s }
}
