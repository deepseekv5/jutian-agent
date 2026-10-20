/**
 * 快捷键一览（v12）
 *
 * 只展示、不编辑（编辑要处理与浏览器/系统快捷键的冲突，收益低于风险）。
 * 组合统一走 shared/shortcuts 的格式化，确保 mac/Windows 显示正确。
 */
import { useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { DEFAULT_BINDINGS, formatCombo, findConflicts, detectMac, type KeyBinding } from '../../shared/shortcuts'

export default function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const isMac = useMemo(() => detectMac(), [])
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const list = DEFAULT_BINDINGS.filter((b) =>
      !q.trim() || b.label.toLowerCase().includes(q.trim().toLowerCase()) || String(b.group || '').includes(q.trim())
    )
    const map = new Map<string, KeyBinding[]>()
    for (const b of list) {
      const g = b.group || '其他'
      map.set(g, [...(map.get(g) || []), b])
    }
    return [...map.entries()]
  }, [q])

  const conflicts = useMemo(() => findConflicts(DEFAULT_BINDINGS), [])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>快捷键</span>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>{isMac ? 'macOS' : 'Windows / Linux'}</span>
        <span className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="筛选…"
          className="w-40 px-2.5 py-1 rounded-lg text-[11.5px] outline-none"
          style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
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
              {list.map((b) => (
                <div key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: c.bgInput }}>
                  <span className="text-[12px]" style={{ color: c.textHead }}>{b.label}</span>
                  <span className="flex-1" />
                  <kbd className="text-[11px] px-2 py-0.5 rounded font-mono"
                    style={{ background: c.surfaceCard, color: c.textSecondary || c.textTertiary, border: `1px solid ${c.borderLight}` }}>
                    {formatCombo(b.combo, isMac)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="text-center text-[11.5px] py-8" style={{ color: c.textTertiary }}>没有匹配的快捷键</div>}
      </div>
    </div>
  )
}
