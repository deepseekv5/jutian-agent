import { useEffect, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

/**
 * 编辑器状态栏（v13.7）—— VSCode 同款底部信息条
 *
 * 显示：光标行列、选中字符数、语言、缩进、文件路径。
 * 数据从 CodeMirror 的 selection/doc 读，随光标移动实时更新。
 */
export interface CursorInfo {
  line: number
  col: number
  selected: number
  lines: number
}

export function EditorStatusBar({ view, path, language }: { view: EditorView | null; path: string; language: string }) {
  const { c } = useTheme()
  const { lang } = useLanguage()
  const [info, setInfo] = useState<CursorInfo>({ line: 1, col: 1, selected: 0, lines: 1 })

  useEffect(() => {
    if (!view) return
    const read = () => {
      const sel = view.state.selection.main
      const line = view.state.doc.lineAt(sel.head)
      setInfo({
        line: line.number,
        col: sel.head - line.from + 1,
        selected: Math.abs(sel.to - sel.from),
        lines: view.state.doc.lines,
      })
    }
    read()
    // 光标/选区变化即刷新（用 updateListener 会与主编辑器重复，这里挂 DOM 事件更轻）
    const dom = view.dom
    const onUp = () => read()
    const onKey = () => read()
    dom.addEventListener('keyup', onKey)
    dom.addEventListener('mouseup', onUp)
    const id = window.setInterval(read, 500) // 兜底：键盘长按/拖选
    return () => {
      dom.removeEventListener('keyup', onKey)
      dom.removeEventListener('mouseup', onUp)
      window.clearInterval(id)
    }
  }, [view])

  const sep = <span style={{ opacity: 0.35 }}>|</span>
  return (
    <div className="shrink-0 flex items-center gap-3 px-3 h-6 text-[10.5px] font-mono select-none"
      style={{ color: c.textTertiary, borderTop: `1px solid ${c.borderLight}`, background: c.bgInput }}
      role="status" aria-live="off">
      <span title={lang === 'en' ? 'Cursor position' : '光标位置'}>
        {lang === 'en' ? `Ln ${info.line}, Col ${info.col}` : `行 ${info.line}，列 ${info.col}`}
      </span>
      {info.selected > 0 && (
        <>
          {sep}
          <span>{lang === 'en' ? `${info.selected} selected` : `已选 ${info.selected}`}</span>
        </>
      )}
      {sep}
      <span title={lang === 'en' ? 'Total lines' : '总行数'}>{info.lines} {lang === 'en' ? 'lines' : '行'}</span>
      {sep}
      <span title={lang === 'en' ? 'Language' : '语言'}>{language || 'text'}</span>
      {sep}
      <span title={lang === 'en' ? 'Indentation' : '缩进'}>Spaces: 2</span>
      <span className="flex-1" />
      <span className="truncate max-w-[45%]" title={path}>{path || (lang === 'en' ? 'No file' : '未打开文件')}</span>
    </div>
  )
}

/**
 * 面包屑（v13.7）：把文件路径拆成可点击的分段（VSCode 顶部路径条）。
 * 点击分段只做提示（当前版本无目录级跳转），但完整路径一眼可见、可选中复制。
 */
export function Breadcrumbs({ path, onPick }: { path: string; onPick?: (segment: string) => void }) {
  const { c } = useTheme()
  if (!path) return null
  const parts = path.split(/[\\/]/).filter(Boolean)
  return (
    <div className="shrink-0 flex items-center gap-1 px-3 h-6 text-[11px] overflow-x-auto"
      style={{ color: c.textTertiary, borderBottom: `1px solid ${c.borderLight}`, scrollbarWidth: 'none' }}>
      {parts.map((seg, i) => (
        <span key={i} className="flex items-center gap-1 shrink-0">
          {i > 0 && <span style={{ opacity: 0.4 }}>›</span>}
          <button
            onClick={() => onPick?.(parts.slice(0, i + 1).join('/'))}
            className="px-0.5 rounded hover:underline"
            style={{ color: i === parts.length - 1 ? c.textSecondary : c.textTertiary }}>
            {seg}
          </button>
        </span>
      ))}
    </div>
  )
}
