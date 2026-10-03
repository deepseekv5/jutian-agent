import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'

interface FileEntry { path: string; sessionTitle: string; createdAt: string }

export default function OutputsPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => { loadOutputs() }, [])

  async function loadOutputs() {
    try {
      const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
      const entries: FileEntry[] = []
      for (const session of Array.isArray(sessions) ? sessions.slice(0, 50) : []) {
        try {
          const msgs = await fetch(`/api/sessions/${session.id}/messages`).then(r => r.json()).catch(() => [])
          for (const msg of Array.isArray(msgs) ? msgs : []) {
            if (!msg.tool_calls?.length) continue
            for (const tc of msg.tool_calls) {
              if (tc.name !== 'write_file' || tc.status !== 'done') continue
              let args: any = {}
              try { args = JSON.parse(tc.arguments || '{}') } catch {}
              const fp = args.path || args.filePath || args.file_path
              if (!fp) continue
              if (!entries.find(e => e.path === fp)) {
                entries.push({ path: fp, sessionTitle: typeof session.title === 'string' ? session.title : 'Chat', createdAt: msg.created_at || '' })
              }
            }
          }
        } catch {}
      }
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setFiles(entries)
    } catch {} finally { setLoading(false) }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return files
    const q = search.toLowerCase()
    return files.filter(f => f.path.toLowerCase().includes(q) || f.sessionTitle.toLowerCase().includes(q))
  }, [search, files])

  const openFile = (filePath: string) => { fetch('/api/open-file?path=' + encodeURIComponent(filePath)).catch(() => {}) }
  const revealFolder = (filePath: string) => { fetch('/api/open-finder?path=' + encodeURIComponent(filePath.replace(/[/\\][^/\\]+$/, ''))).catch(() => {}) }
  const trashFile = async (filePath: string) => { setDeleting(filePath); try { await fetch('/api/trash-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: filePath }) }); setFiles(p => p.filter(f => f.path !== filePath)) } catch {} setDeleting(null) }

  return (
    <PageShell onClose={onClose} title="产出文件" description="AI 生成的全部文件与作品，统一管理" wide icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10">
      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative max-w-md">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="搜索文件或聊天标题..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 h-9 rounded-lg text-[13px] outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
        </div>
      </div>

      {/* File list */}
      <div className="px-4 pb-4">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-5 h-5 mx-auto mb-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: c.accent, borderTopColor: 'transparent' }} />
            <p className="text-[13px]" style={{ color: c.textMuted }}>扫描历史记录...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-[13px]" style={{ color: c.textMuted }}>{search ? '无匹配文件' : '暂无 AI 生成的文件'}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((f) => (
              <div key={f.path} className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors glass" style={{ border: `1px solid ${c.borderLight}` }}
                onMouseEnter={e => e.currentTarget.style.background = c.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bgInput }}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textSecondary }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate" style={{ color: c.text }}>{f.path.split('/').pop()}</div>
                  <div className="text-[11px] truncate font-mono" style={{ color: c.textMuted }}>{f.path}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openFile(f.path)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors" style={{ background: c.bgInput, color: c.textSecondary }}
                    onMouseEnter={e => e.currentTarget.style.background = c.bgActive}
                    onMouseLeave={e => e.currentTarget.style.background = c.bgInput}>打开</button>
                  <button onClick={() => revealFolder(f.path)} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: c.textMuted }}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </button>
                  <button onClick={() => trashFile(f.path)} disabled={deleting === f.path} className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30" style={{ color: c.toolErr }}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
