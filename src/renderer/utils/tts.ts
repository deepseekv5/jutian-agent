/**
 * 朗读文本净化：把 Markdown 正文转成适合 TTS 的纯口语文本。
 * 代码块/表格读出来是灾难，链接 URL 要剥掉，标点符号要收干净。
 */

export function textForSpeech(md: string, maxLen = 1800): string {
  let t = md || ''

  // 代码块 → 提示语
  t = t.replace(/```[\s\S]*?```/g, '（此处为代码，已省略）。')
  // 行内代码
  t = t.replace(/`([^`]+)`/g, '$1')
  // 图片 → 去掉
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  // 链接 → 只留文字
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 裸 URL → 去掉
  t = t.replace(/https?:\/\/\S+/g, '')
  // 标题符号
  t = t.replace(/^#{1,6}\s+/gm, '')
  // 引用符号
  t = t.replace(/^\s*>\s?/gm, '')
  // 分隔线
  t = t.replace(/^\s*([-*_]\s*){3,}$/gm, '')
  // 表格：分隔行整行删，数据行去掉竖线
  t = t.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
  t = t.replace(/\|/g, '，')
  // 列表符号
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+\.\s+/gm, '')
  // 加粗/斜体/删除线标记
  t = t.replace(/(\*\*|__|~~)/g, '')
  t = t.replace(/(\*|_)/g, '')
  // LaTeX 简单处理：$...$ 保留内容
  t = t.replace(/\$\$?([^$]+)\$\$?/g, '$1')
  // 多余空白
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()

  // 截断：在句子边界切
  if (t.length > maxLen) {
    const cut = t.slice(0, maxLen)
    const m = cut.match(/[\u3002\uff01\uff1f\uff1b\u2026]|\.!?;$/g)
    const lastDot = m ? cut.lastIndexOf(m[m.length - 1]) : -1
    t = (lastDot > maxLen * 0.5 ? cut.slice(0, lastDot + 1) : cut) + '……后文略。'
  }
  return t
}
