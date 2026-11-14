/**
 * QuickOpenPanel —— Cmd+P 快速打开（CODE-SPEC v1.0）
 * 入参与 CodeView 对齐：fileTree / projectRoot / onOpenFile / onClose
 */
import { useState, useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { FileNode } from '../types/code'
import { CMEmpty, CMBtn } from './ui'

interface Props {
  fileTree: FileNode[]
  projectRoot?: string
  onOpenFile: (path: string, name: string) => void
  onClose: () => void
}

/** 递归拍平文件树为文件列表 */
function flattenFiles(nodes: FileNode[], acc: { path: string; name: string }[] = []): { path: string; name: string }[] {
  for (const n of nodes || []) {
    if (n.type === 'file') acc.push({ path: n.path, name: n.name })
    if (n.children?.length) flattenFiles(n.children, acc)
  }
  return acc
}

export default function QuickOpenPanel({ fileTree, onOpenFile, onClose }: Props) {
  const { c } = useTheme()
  const [q, setQ] = useState('')

  // 入参兜底：空树/undefined 都不炸
  const allFiles = useMemo(() => flattenFiles(Array.isArray(fileTree) ? fileTree : []), [fileTree])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return allFiles.slice(0, 50)
    return allFiles.filter(f => f.name.toLowerCase().includes(s) || f.path.toLowerCase().includes(s)).slice(0, 50)
  }, [q, allFiles])

  return (
    <div className="absolute inset-x-4 bottom-4 top-12 z-50 rounded-xl border glass-strong shadow-2xl flex flex-col animate-fade-in"
      style={{ borderColor: c.border, background: c.surfaceCard }}>
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 h-11 border-b shrink-0" style={{ borderColor: c.borderLight }}>
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.textTertiary }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="按文件名搜索…"
          className="flex-1 bg-transparent outline-none text-[13px]"
          style={{ color: c.text }} />
        <CMBtn icon="M6 18L18 6M6 6l12 12" title="关闭 (Esc)" onClick={onClose} c={c} small />
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1.5 px-1.5">
        {allFiles.length === 0 ? (
          <CMEmpty c={c} icon="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" title="项目内暂无文件" desc="等待文件树加载完成" />
        ) : filtered.length === 0 ? (
          <CMEmpty c={c} icon="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" title="没有匹配的文件" desc="换个关键词试试" />
        ) : filtered.map((f, i) => (
          <button key={f.path} onClick={() => onOpenFile(f.path, f.name)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors"
            style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}
            onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} style={{ color: c.textTertiary }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] truncate" style={{ color: c.text }}>{f.name}</div>
              <div className="text-[10.5px] truncate font-mono" style={{ color: c.textMuted }}>{f.path}</div>
            </div>
            {i < 9 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: c.bgInput, color: c.textMuted }}>⌘{i + 1}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
