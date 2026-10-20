/**
 * 快捷键系统（v12 新功能）
 *
 * 现状：快捷键散在 App.tsx / ChatView / CodeView / PPTView 里各写一遍
 * （`e.metaKey || e.ctrlKey` 重复 8 处），没有统一注册、没有冲突检测、
 * 也没有"哪些快捷键可用"的可发现性。
 *
 * 这里提供：
 *   - 统一解析（支持 mod/ctrl/meta/shift/alt + 键位）
 *   - 冲突检测（同一组合注册两次会报出来，而不是静默让后者覆盖）
 *   - 平台显示（mac 显示 ⌘K，Windows 显示 Ctrl+K）
 */

export type Modifier = 'mod' | 'ctrl' | 'meta' | 'shift' | 'alt'

export interface KeyBinding {
  id: string
  /** 例如 "mod+k" / "mod+shift+p" / "escape" */
  combo: string
  label: string
  description?: string
  /** 分组，用于快捷键面板 */
  group?: string
}

export interface ParsedCombo {
  key: string
  mod: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

const MOD_ALIASES: Record<string, Modifier> = {
  cmd: 'meta', command: 'meta', meta: 'meta', super: 'meta',
  ctrl: 'ctrl', control: 'ctrl',
  opt: 'alt', option: 'alt', alt: 'alt',
  shift: 'shift', mod: 'mod',
}

export function parseCombo(combo: string): ParsedCombo | null {
  const raw = String(combo || '').trim().toLowerCase()
  if (!raw) return null
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return null
  const out: ParsedCombo = { key: '', mod: false, ctrl: false, meta: false, shift: false, alt: false }
  for (const p of parts) {
    if (MOD_ALIASES[p]) {
      const m = MOD_ALIASES[p]
      if (m === 'mod') out.mod = true
      else if (m === 'shift') out.shift = true
      else if (m === 'alt') out.alt = true
      else if (m === 'ctrl') out.ctrl = true
      else out.meta = true
    } else {
      if (out.key) return null // 两个非修饰键，非法
      out.key = p
    }
  }
  return out.key ? out : null
}

/** 事件是否匹配组合；mod 在 mac=meta、其他=ctrl */
export function matchesCombo(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, parsed: ParsedCombo, isMac = detectMac()): boolean {
  const key = String(e.key || '').toLowerCase()
  // 空格键在部分浏览器是 ' '，统一成 'space'
  const normKey = key === ' ' ? 'space' : key
  if (normKey !== parsed.key) return false
  if (parsed.mod) {
    if (isMac ? !e.metaKey : !e.ctrlKey) return false
  } else {
    if (parsed.meta && !e.metaKey) return false
    if (parsed.ctrl && !e.ctrlKey) return false
  }
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false
  return true
}

export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const s = `${navigator.platform || ''} ${navigator.userAgent || ''}`
  return /mac|darwin/i.test(s)
}

/** 平台化展示：mod+k → ⌘K 或 Ctrl+K */
export function formatCombo(combo: string, isMac = detectMac()): string {
  const p = parseCombo(combo)
  if (!p) return combo
  const keyLabel = p.key.length === 1 ? p.key.toUpperCase() : p.key.charAt(0).toUpperCase() + p.key.slice(1)
  if (isMac) {
    const parts: string[] = []
    if (p.mod || p.meta) parts.push('⌘')
    if (p.ctrl) parts.push('⌃')
    if (p.alt) parts.push('⌥')
    if (p.shift) parts.push('⇧')
    parts.push(keyLabel)
    return parts.join('')
  }
  const parts: string[] = []
  if (p.mod || p.ctrl) parts.push('Ctrl')
  if (p.meta) parts.push('Win')
  if (p.alt) parts.push('Alt')
  if (p.shift) parts.push('Shift')
  parts.push(keyLabel)
  return parts.join('+')
}

/** 规范化用于冲突比较：mod+ctrl 在 mac/win 下等价性不同，这里按"最终修饰集合"比 */
function canonical(combo: string): string {
  const p = parseCombo(combo)
  if (!p) return combo
  const mods = [
    p.mod ? 'mod' : '',
    p.ctrl ? 'ctrl' : '',
    p.meta ? 'meta' : '',
    p.shift ? 'shift' : '',
    p.alt ? 'alt' : '',
  ].filter(Boolean).sort()
  return `${mods.join('+')}|${p.key}`
}

/** 找出重复注册的快捷键（返回成对冲突描述） */
export function findConflicts(bindings: KeyBinding[]): { combo: string; ids: string[] }[] {
  const map = new Map<string, string[]>()
  for (const b of bindings) {
    const c = canonical(b.combo)
    const arr = map.get(c) || []
    arr.push(b.id)
    map.set(c, arr)
  }
  const out: { combo: string; ids: string[] }[] = []
  for (const [c, ids] of map) {
    if (ids.length > 1) out.push({ combo: c.split('|')[1] + ' (' + c.split('|')[0] + ')', ids })
  }
  return out
}

/**
 * 在输入框里时是否应该跳过快捷键（Cmd+K 这类要跳过，Cmd+S 不该）。
 * 返回 true = 跳过。
 */
export function shouldIgnoreInInput(combo: string): boolean {
  const p = parseCombo(combo)
  if (!p) return false
  // 带 shift/alt 的通常是有意为之（如 mod+shift+v 粘贴），不算纯打字
  if (p.shift || p.alt) return false
  // 单字母且无修饰：纯打字，跳过
  if (!p.mod && !p.ctrl && !p.meta && p.key.length === 1) return true
  // 空格/回车/退格等编辑键
  return ['space', 'enter', 'backspace', 'delete', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(p.key)
}

/** 默认快捷键表（供面板展示与冲突自检） */
export const DEFAULT_BINDINGS: KeyBinding[] = [
  { id: 'palette', combo: 'mod+k', label: '命令面板', group: '全局' },
  { id: 'new-chat', combo: 'mod+n', label: '新建对话', group: '全局' },
  { id: 'new-tab', combo: 'mod+t', label: '新标签页', group: '全局' },
  { id: 'close-tab', combo: 'mod+w', label: '关闭标签', group: '全局' },
  { id: 'search', combo: 'mod+shift+f', label: '全局搜索', group: '全局' },
  { id: 'find-in-chat', combo: 'mod+f', label: '会话内查找', group: '对话' },
  { id: 'send', combo: 'mod+enter', label: '发送消息', group: '对话' },
  { id: 'paste-image', combo: 'mod+shift+v', label: '粘贴图片', group: '对话' },
  { id: 'toggle-sidebar', combo: 'mod+b', label: '收起/展开侧栏', group: '界面' },
  { id: 'toggle-theme', combo: 'mod+shift+l', label: '切换明暗主题', group: '界面' },
  { id: 'shortcuts-help', combo: 'mod+/', label: '快捷键一览', group: '帮助' },
]
