// 全局搜索面板
import { useState, useCallback, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { SearchResult } from '../types/code'

interface Props {
  projectRoot: string
  onOpenFile: (path: string, name: string) => void
  onClose: () => void
  /** 打开时预填并自动搜索的关键词（如 TODO|FIXME 任务扫描） */
  initialKeyword?: string
}

export default function CodeSearchPanel({ projectRoot, onOpenFile, onClose, initialKeyword }: Props) {
  const { c } = useTheme()
  const [keyword, setKeyword] = useState(initialKeyword || '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = useCallback(async (kw: string) => {
    setKeyword(kw)
    if (!kw.trim()) { setResults([]); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/code/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw.trim(), rootPath: projectRoot }),
      })
      const data = await res.json()
      if (data.success) {
        setResults(data.results || [])
      } else {
        setError(data.error || '搜索失败')
      }
    } catch { setError('搜索请求失败') }
    finally { setLoading(false) }
  }, [projectRoot])

  // 预填关键词：打开即自动扫描
  useEffect(() => {
    if (initialKeyword && initialKeyword.trim()) handleSearch(initialKeyword)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  return (
    <div className="flex flex-col h-full glass">
      {/* Header */}
      <div className="h-9 flex items-center px-3 border-b gap-2" style={{ borderColor: c.borderLight }}>
        <svg className="w-3.5 h-3.5 shrink-0" style={{ color: c.accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-[11px] font-medium" style={{ color: c.textTertiary }}>全局搜索</span>
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: c.textMuted }}>ESC Close</span>
        <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center btn-liquid"
          style={{ color: c.textMuted }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Search Input */}
      <div className="p-2 shrink-0">
        <input
          type="text"
          value={keyword}
          onChange={e => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索项目文件内容..."
          className="w-full px-2.5 py-1.5 rounded-md text-[12px] border outline-none transition-colors"
          style={{ background: c.bgInput, borderColor: c.borderLight, color: c.text }}
          autoFocus
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-6">
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: c.border, borderTopColor: c.accent }} />
          </div>
        )}
        {error && (
          <div className="px-3 py-2 text-[11px]" style={{ color: c.toolErr }}>{error}</div>
        )}
        {!loading && !error && keyword && results.length === 0 && (
          <div className="text-center text-[11px] py-6" style={{ color: c.textMuted }}>无匹配</div>
        )}
        {results.length > 0 && (
          <div className="py-1">
            <div className="text-[10px] px-3 pb-1" style={{ color: c.textMuted }}>
              Total: {results.length}  results
            </div>
            {results.map((r, i) => {
              const fileName = r.filePath.split('/').pop() || r.filePath
              const dir = r.filePath.substring(0, r.filePath.lastIndexOf('/')) || '/'
              return (
                <div
                  key={i}
                  onClick={() => onOpenFile(r.filePath, fileName)}
                  className="px-3 py-2 cursor-pointer transition-colors border-b"
                  style={{ borderColor: c.borderLight }}
                  onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: c.textMuted }}>
                    <span style={{ color: c.accent }}>{fileName}</span>
                    <span>:</span>
                    <span style={{ color: c.textSecondary }}>{r.line}</span>
                  </div>
                  <div className="text-[10px] mt-0.5 truncate" style={{ color: c.textMuted }}>{dir}</div>
                  <pre className="text-[11px] mt-1 truncate font-mono" style={{ color: c.textSecondary }}>
                    {r.content}
                  </pre>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
