import { useEffect, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { indentUnit } from '@codemirror/language'
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
  // 真实缩进与行尾（v13.11）：原实现写死「Spaces: 2」，与文件实际不符
  const [indentLabel, setIndentLabel] = useState('Spaces: 2')
  const [eol, setEol] = useState<'LF' | 'CRLF'>('LF')

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
      // 缩进：读编辑器实际配置（tab 或 N 空格）
      const unit = view.state.facet(indentUnit)
      setIndentLabel(unit === '\t' ? 'Tabs' : `Spaces: ${unit.length}`)
      // 行尾：只看文件开头 4KB，避免大文件每次全量扫描
      setEol(view.state.doc.sliceString(0, 4000).includes('\r\n') ? 'CRLF' : 'LF')
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
      <span title={lang === 'en' ? 'Indentation' : '缩进'}>{indentLabel}</span>
      {sep}
      <span title={lang === 'en' ? 'Line ending' : '行尾序列'}>{eol}</span>
      {sep}
      <span title={lang === 'en' ? 'Encoding' : '编码'}>UTF-8</span>
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
