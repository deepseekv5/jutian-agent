/**
 * 快捷键一览 + 自定义（v14.20.0）
 *
 * 展示生效键位（默认表 + 用户覆盖）；可重映射的条目支持「修改」：
 * 点击后捕获下一次按键组合，冲突检测通过才落盘（覆盖层存 localStorage）。
 * 与系统/浏览器冲突的组合不禁止（用户自负），但会在顶部提示。
 */
import { useMemo, useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { DEFAULT_BINDINGS, formatCombo, findConflicts, detectMac, effectiveBindings, setBindingOverride, resetBindingOverrides, type KeyBinding } from '../../shared/shortcuts'

/** 可重映射的动作（其余为固定实现，展示但不开放编辑） */
const REMAPPABLE = new Set([
  'palette', 'new-chat', 'new-tab', 'close-tab',
  'copy-last-reply', 'open-export', 'clip-history', 'open-diagnostics', 'read-aloud-last', 'reopen-tab',
  'next-tab', 'prev-tab', 'font-up', 'font-down', 'font-reset',
])

function comboFromEvent(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod && !e.altKey) return null
  const k = e.key.toLowerCase()
  if (['control', 'meta', 'shift', 'alt', 'capslock'].includes(k)) return null
  const parts: string[] = []
  if (e.metaKey) parts.push('mod')
  else if (e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  parts.push(k)
  return parts.join('+')
}

export default function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const isMac = useMemo(() => detectMac(), [])
  const [q, setQ] = useState('')
  const [version, setVersion] = useState(0)
  const [captureId, setCaptureId] = useState<string | null>(null)
  const [tip, setTip] = useState('')

  const bindings = useMemo(() => effectiveBindings(), [version])
  const conflicts = useMemo(() => findConflicts(bindings), [version, bindings])

  const groups = useMemo(() => {
    const list = bindings.filter((b) =>
      !q.trim() || b.label.toLowerCase().includes(q.trim().toLowerCase()) || String(b.group || '').includes(q.trim())
    )
    const map = new Map<string, KeyBinding[]>()
    for (const b of list) {
      const g = b.group || '其他'
      map.set(g, [...(map.get(g) || []), b])
    }
    return [...map.entries()]
  }, [q, bindings])

  const capture = useCallback((e: KeyboardEvent) => {
    if (!captureId) return
    e.preventDefault(); e.stopPropagation()
    if (e.key === 'Escape') { setCaptureId(null); return }
    const combo = comboFromEvent(e)
    if (!combo) return
    const others = bindings.filter(b => b.id !== captureId && b.combo === combo)
    if (others.length) { setTip(`与「${others[0].label}」冲突，未保存`); return }
    setBindingOverride(captureId, combo)
    setCaptureId(null)
    setVersion(v => v + 1)
    setTip('已更新')
  }, [captureId, bindings])

  useEffect(() => {
    if (!captureId) return
    const opts = { capture: true } as AddEventListenerOptions
    window.addEventListener('keydown', capture, opts)
    return () => window.removeEventListener('keydown', capture, opts)
  }, [capture, captureId])

  const rowBtn = 'px-2 py-1 rounded-lg text-[11px] shrink-0 transition-colors'

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>快捷键</span>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>{isMac ? 'macOS' : 'Windows / Linux'} · ⌘/Ctrl 类可自定义</span>
        <span className="flex-1" />
        {tip && <span className="text-[11px]" style={{ color: c.accent }}>{tip}</span>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="筛选…"
          className="w-40 px-2.5 py-1 rounded-lg text-[11.5px] outline-none"
          style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
        <button onClick={() => { resetBindingOverrides(); setVersion(v => v + 1); setTip('已恢复默认') }}
          className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>恢复默认</button>
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
        {conflicts.length > 0 && (
          <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,.08)', color: '#b91c1c' }}>
            检测到 {conflicts.length} 组快捷键冲突：{conflicts.map((x) => x.combo).join('、')}
          </div>
        )}
        {groups.map(([group, list]) => (
          <div key={group}>
            <div className="text-[11px] font-bold tracking-wider mb-2" style={{ color: c.textTertiary }}>{group}</div>
            <div className="space-y-1">
              {list.map((b) => {
                const editable = REMAPPABLE.has(b.id)
                const capturing = captureId === b.id
                return (
                  <div key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: capturing ? c.accentBg : c.bgInput }}>
                    <span className="text-[12.5px] flex-1 min-w-0 truncate" style={{ color: c.textHead }}>{b.label}</span>
                    {editable ? (
                      <button
                        onClick={() => { setTip(''); setCaptureId(capturing ? null : b.id) }}
                        className={rowBtn}
                        style={{ background: capturing ? c.accent : c.surfaceCard, color: capturing ? c.accentText : c.textSecondary, border: `1px solid ${capturing ? c.accent : c.borderLight}` }}
                        title={editable ? '点击后按下新组合' : ''}>
                        {capturing ? '请按下新组合…' : formatCombo(b.combo, isMac)}
                      </button>
                    ) : (
                      <kbd className="text-[11px] px-2 py-0.5 rounded font-mono shrink-0"
                        style={{ background: c.surfaceCard, color: c.textTertiary, border: `1px solid ${c.borderLight}` }}>
                        {formatCombo(b.combo, isMac)}
                      </kbd>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="text-center text-[11.5px] py-8" style={{ color: c.textTertiary }}>没有匹配的快捷键</div>}
      </div>
    </div>
  )
}
