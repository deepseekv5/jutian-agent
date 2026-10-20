/**
 * 会话右键菜单（v12）：置顶 / 打标签 / 归档 / 复制标题
 *
 * 用 fixed 定位的轻量弹层，不引第三方 menu 库。
 * 关闭策略：点外部、Esc、滚动都关——菜单跟着会话项走的场景，
 * 列表一滚动菜单就该消失，否则会飘在错误的行上。
 */
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { getMeta, saveMeta } from '../store/sessionMeta'
import { addTag, removeTag, normalizeTag, togglePin } from '../../shared/sessionMeta'

interface Props {
  sessionId: string
  title: string
  x: number
  y: number
  onClose: () => void
  onArchived?: () => void
}

export default function SessionContextMenu({ sessionId, title, x, y, onClose, onArchived }: Props) {
  const { c } = useTheme()
  const [meta, setMeta] = useState(() => getMeta(sessionId))
  const [tagInput, setTagInput] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // 滚动即关：菜单是绝对定位，不跟随列表项
    const onScroll = () => onClose()
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const apply = (next: typeof meta) => {
    setMeta(next)
    saveMeta(sessionId, next)
  }

  const addTagNow = () => {
    const t = normalizeTag(tagInput)
    if (!t) { setShowTagInput(false); return }
    apply(addTag(meta, t))
    setTagInput('')
    setShowTagInput(false)
  }

  // 视口边缘保护：菜单不超出屏幕
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, Math.max(8, window.innerWidth - 240)),
    top: Math.min(y, Math.max(8, window.innerHeight - 320)),
    zIndex: 60,
  }

  const Item = ({ label, hint, onClick, danger }: { label: string; hint?: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick}
      className="w-full text-left px-3 py-1.5 rounded-lg text-[12px] flex items-center gap-2 transition-colors"
      style={{ color: danger ? '#ef4444' : c.textHead }}
      onMouseEnter={(e) => { e.currentTarget.style.background = c.bgHover || c.bgInput }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[10px] shrink-0" style={{ color: c.textTertiary }}>{hint}</span>}
    </button>
  )

  return (
    <div ref={ref} style={style} className="w-56 rounded-xl border shadow-2xl p-1.5"
      onContextMenu={(e) => e.preventDefault()}
      // 阻止冒泡，避免触发列表项自身的点击
      onClick={(e) => e.stopPropagation()}>
      <div className="px-3 pt-1 pb-1.5 text-[10.5px] truncate" style={{ color: c.textTertiary }}>{title}</div>

      <Item label={meta.pinnedAt ? '取消置顶' : '置顶'} onClick={() => { apply(togglePin(meta)); onClose() }} />

      {/* 标签区 */}
      <div className="px-3 py-1.5">
        <div className="flex items-center gap-1 flex-wrap">
          {meta.tags.map((t) => (
            <button key={t} onClick={() => apply(removeTag(meta, t))}
              className="text-[10px] px-1.5 py-0.5 rounded-full group"
              style={{ background: c.bgInput, color: c.textSecondary || c.textTertiary }}
              title="点击移除">
              {t}<span className="ml-1 opacity-40 group-hover:opacity-100">×</span>
            </button>
          ))}
          {!showTagInput && (
            <button onClick={() => setShowTagInput(true)}
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: c.bgInput, color: c.textTertiary }}>+ 标签</button>
          )}
        </div>
        {showTagInput && (
          <input autoFocus value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addTagNow() }
              else if (e.key === 'Escape') { e.stopPropagation(); setShowTagInput(false); setTagInput('') }
            }}
            onBlur={addTagNow}
            placeholder="输入标签，回车确认"
            className="mt-1 w-full px-2 py-1 rounded-md text-[11px] outline-none"
            style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.border}` }} />
        )}
      </div>

      <div className="my-1 h-px" style={{ background: c.borderLight }} />
      <Item label="复制标题" onClick={() => { navigator.clipboard?.writeText(title).catch(() => {}); onClose() }} />
      <Item label={meta.archived ? '取消归档' : '归档（从列表隐藏）'}
        onClick={() => { apply({ ...meta, archived: !meta.archived }); onArchived?.(); onClose() }} />
    </div>
  )
}
