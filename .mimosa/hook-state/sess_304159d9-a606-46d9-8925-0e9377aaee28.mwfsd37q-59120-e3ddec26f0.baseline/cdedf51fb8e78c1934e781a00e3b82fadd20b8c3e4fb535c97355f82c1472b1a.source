/**
 * 应用内剪贴板历史（v14.9）
 *
 * 记录用户在应用内的复制动作（复制消息/代码块/表格），存 localStorage。
 * 用途：输入框 Cmd+Shift+B 面板一键引用最近复制的内容，不用来回切换粘贴。
 *
 * 设计约束：
 *  · 只捕获应用内的 copy 事件（不监听系统剪贴板——隐私敏感且无必要）
 *  · 上限 20 条，去重（连续复制同一段不重复记）
 *  · 超长截断 500 字符（引用时用户可以再展开粘贴完整内容——不，引用即全文，
 *    所以存全文但上限 50KB/条，防止把大文件复制进来撑爆 localStorage）
 */

const KEY = 'lyclaw_clip_history'
const MAX_ITEMS = 20
const MAX_ITEM_BYTES = 50_000

export interface ClipItem {
  text: string
  ts: number
  /** 来源标记：msg=复制消息 code=复制代码 table=复制表格 manual=手动粘贴 */
  src?: string
}

export function loadClipHistory(): ClipItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, MAX_ITEMS) : []
  } catch { return [] }
}

export function recordClip(text: string, src?: string): void {
  const t = String(text || '')
  if (!t.trim()) return
  if (t.length > MAX_ITEM_BYTES) return // 过大不记（如整段代码文件）
  try {
    const list = loadClipHistory()
    // 去重：与最近一条相同则跳过；与更早条目相同则移到最前
    if (list[0]?.text === t) { list[0].ts = Date.now(); list[0].src = src || list[0].src }
    else {
      const idx = list.findIndex(x => x.text === t)
      if (idx > 0) list.splice(idx, 1)
      list.unshift({ text: t, ts: Date.now(), src })
    }
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)))
    window.dispatchEvent(new CustomEvent('clip-history-changed'))
  } catch { /* 存储满等，静默 */ }
}

export function clearClipHistory(): void {
  try {
    localStorage.removeItem(KEY)
    window.dispatchEvent(new CustomEvent('clip-history-changed'))
  } catch { /* ignore */ }
}

export function removeClipItem(ts: number): void {
  try {
    const list = loadClipHistory().filter(x => x.ts !== ts)
    localStorage.setItem(KEY, JSON.stringify(list))
    window.dispatchEvent(new CustomEvent('clip-history-changed'))
  } catch { /* ignore */ }
}
