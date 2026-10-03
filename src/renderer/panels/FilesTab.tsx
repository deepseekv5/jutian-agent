import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { Settings } from '../types'

interface DirEntry {
  name: string
  isDir: boolean
}

function getDefaultDir(workDir: string, home: string): string {
  const isWin = /Win/i.test(navigator.platform || '')
  if (workDir) return workDir
  if (home) return home
  return isWin ? 'C:\\Users' : '/'
}

export default function FilesTab({ settings }: { settings: Settings }) {
  const { c } = useTheme()
  const [path, setPath] = useState('')
  const [defaultDir, setDefaultDir] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => {
      const home = d.home || ''
      const dir = getDefaultDir(settings.workDir || '', home)
      setDefaultDir(dir)
      setPath(dir)
    }).catch(() => {
      const dir = getDefaultDir(settings.workDir || '', '')
      setDefaultDir(dir)
      setPath(dir)
    })
  }, [settings.workDir])

  const load = useCallback(async (dir: string) => {
    setLoading(true)
    setError('')
    setSelected(null)
    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(settings.workDir ? { 'X-Work-Dir': encodeURIComponent(settings.workDir) } : {}) },
        body: JSON.stringify({ name: 'list_dir', args: { path: dir, showHidden } }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '读取失败')
      const lines: string[] = (data.output || '').split('\n')
      lines.pop() // remove count line
      const list: DirEntry[] = lines
        .map(l => {
          const isDir = l.startsWith('[目录]')
          const name = l.replace(/^\[(目录|文件)\]\s*/, '').replace(/\/+$/, '').trim()
          return { name, isDir }
        })
        .filter(e => e.name && e.name !== '项')
      list.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      setEntries(list)
      setPath(dir)
    } catch (e: any) {
      setError(e.message || '读取失败')
    } finally {
      setLoading(false)
    }
  }, [showHidden, settings.workDir])

  useEffect(() => { if (defaultDir) load(defaultDir) }, [defaultDir])

  const openFile = async (p: string) => {
    try { await fetch('/api/open-file?path=' + encodeURIComponent(p)) } catch {}
  }
  const revealInFinder = async (p: string) => {
    const dir = p.replace(/[/\\][^/\\]+$/, '')
    try { await fetch('/api/open-finder?path=' + encodeURIComponent(dir)) } catch {}
  }
  const trashFile = async (p: string) => {
    try {
      await fetch('/api/trash-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) })
      load(path)
    } catch {}
  }

  const isWin = /Win/i.test(navigator.platform || '')
  const joinPath = (dir: string, name: string) => isWin ? `${dir.replace(/[\\]+$/, '')}\\${name}` : `${dir.replace(/\/+$/, '')}/${name}`
  const parentPath = (dir: string) => {
    const sep = isWin ? '\\' : '/'
    const clean = dir.replace(/[\\/]+$/, '')
    const idx = clean.lastIndexOf(sep)
    if (idx <= 0) return isWin ? clean : '/'
    return clean.slice(0, idx)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 页头 */}
      <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b shrink-0 glass" style={{ borderColor: c.borderLight }}>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: c.bgInput, color: c.textSecondary }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold leading-5" style={{ color: c.textHead }}>文件</h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: c.textTertiary }}>浏览、打开与管理当前工作目录</p>
        </div>
      </div>
      {/* Header */}
      <div className="h-11 flex items-center gap-2 px-4 border-b shrink-0 glass" style={{ borderColor: c.borderLight }}>
        <button onClick={() => load(parentPath(path))} disabled={path === '/' || path === defaultDir}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30"
          style={{ color: c.textSecondary }}
          onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = c.bgHover }}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div className="flex-1 flex items-center gap-2 px-3 h-8 rounded-lg" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <input value={path} onChange={e => setPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load(path) }}
            className="flex-1 bg-transparent text-[12px] font-mono outline-none" style={{ color: c.text }} />
        </div>

        <button onClick={() => load(path)} disabled={loading}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30"
          style={{ color: c.textSecondary }}>
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        <button onClick={() => setShowHidden(v => !v)}
          className="h-8 px-2.5 rounded-lg text-[11px] font-medium transition-colors"
          style={{ color: showHidden ? c.textHead : c.textSecondary, background: showHidden ? c.bgActive : 'transparent' }}>
          {showHidden ? '隐藏文件：开' : '显示隐藏'}
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
        {error && (
          <div className="text-xs py-3 px-3 rounded-lg mb-2" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
            {error}
          </div>
        )}
        {!loading && entries.length === 0 && !error && (
          <div className="text-center text-xs py-16" style={{ color: c.textMuted }}>空目录</div>
        )}
        <div className="space-y-0.5">
          {entries.map(entry => {
            const fullPath = joinPath(path, entry.name)
            const isActive = selected === fullPath
            return (
              <div key={entry.name}
                onClick={() => { setSelected(fullPath); if (entry.isDir) load(fullPath); else openFile(fullPath) }}
                onDoubleClick={() => { if (entry.isDir) load(fullPath); else openFile(fullPath) }}
                className="group flex items-center gap-2.5 px-3 py-[6px] rounded-lg cursor-pointer transition-colors"
                style={{ background: isActive ? c.bgActive : 'transparent' }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
                {entry.isDir ? (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#f5b301' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textMuted }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
                  </svg>
                )}
                <span className="text-[13px] truncate flex-1" style={{ color: entry.isDir ? c.textHead : c.textSecondary }}>
                  {entry.name}
                </span>
                <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!entry.isDir && (
                    <button onClick={(e) => { e.stopPropagation(); openFile(fullPath) }} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: c.textMuted }} title="打开">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); trashFile(fullPath) }} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: c.toolErr }} title="删除">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-7 flex items-center px-4 text-[10.5px] border-t shrink-0" style={{ borderColor: c.borderLight, color: c.textMuted }}>
        {entries.length} 项 · {path}
      </div>
    </div>
  )
}
