/**
 * DiaryPanel —— 日记（Beta）：按日记录，左侧列表右侧编辑，存本地 diary.json
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import PageShell from '../app/PageShell'
import { useTheme } from '../hooks/useTheme'

interface Entry { id: string; date: string; title: string; content: string; createdAt?: string; updatedAt?: string }

const todayStr = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = (d: string) => {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const now = new Date()
  const sameYear = dt.getFullYear() === now.getFullYear()
  return `${dt.getMonth() + 1}月${dt.getDate()}日${sameYear ? '' : ` · ${dt.getFullYear()}`}`
}
const weekday = (d: string) => { try { return '周' + '日一二三四五六'[new Date(d + 'T00:00:00').getDay()] } catch { return '' } }

export default function DiaryPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [entries, setEntries] = useState<Entry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTip, setSavedTip] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const list = await fetch('/api/diary').then(r => r.json())
      setEntries(Array.isArray(list) ? list : [])
      return list as Entry[]
    } catch { return [] }
  }, [])

  useEffect(() => { (async () => { const l = await load(); setLoading(false); if (l.length > 0) openEntry(l[0]) })() }, [load])

  const openEntry = (e: Entry) => { setActiveId(e.id); setDraft({ ...e }) }

  const newEntry = () => {
    const e: Entry = { id: '', date: todayStr(), title: '', content: '' }
    setDraft(e); setActiveId(null)
  }

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const saved = await fetch('/api/diary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }).then(r => r.json())
      const list = await load()
      setActiveId(saved.id)
      setDraft(prev => prev ? { ...prev, id: saved.id, createdAt: saved.createdAt, updatedAt: saved.updatedAt } : prev)
      setSavedTip('已保存'); setTimeout(() => setSavedTip(''), 1800)
    } catch { setSavedTip('保存失败'); setTimeout(() => setSavedTip(''), 1800) }
    finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    if (!confirm('删除这篇日记？不可恢复。')) return
    await fetch('/api/diary/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const list = await load()
    setEntries(list)
    if (activeId === id) { setActiveId(null); setDraft(null) }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => (e.title || '').toLowerCase().includes(q) || (e.content || '').toLowerCase().includes(q))
  }, [entries, search])

  const dirty = useMemo(() => {
    if (!draft) return false
    const orig = entries.find(e => e.id === draft.id)
    if (!orig) return (draft.title || draft.content).trim() !== ''
    return orig.content !== draft.content || orig.title !== draft.title || orig.date !== draft.date
  }, [draft, entries])

  const actions = (
    <div className="flex items-center gap-2">
      {savedTip && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.15)', color: '#10b981' }}>{savedTip}</span>}
      <button onClick={newEntry} className="h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5"
        style={{ background: c.accent, color: c.accentText }}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
        新建
      </button>
    </div>
  )

  return (
    <PageShell onClose={onClose} title="日记" fill description="记录每一天 · Beta" icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" actions={actions}>
      <div className="flex-1 flex min-h-0">
        {/* 左：日记列表 */}
        <div className="w-60 shrink-0 border-r flex flex-col" style={{ borderColor: c.borderLight }}>
          <div className="px-3 py-2 shrink-0">
            <div className="relative">
              <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.textMuted }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索日记"
                className="w-full h-8 pl-8 pr-2 rounded-lg text-[12px] outline-none"
                style={{ background: c.bgInput, color: c.text, border: `1px solid ${search ? c.border : 'transparent'}` }} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-1">
            {loading ? (
              <div className="text-center py-8 text-[12px]" style={{ color: c.textTertiary }}>加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-[12px]" style={{ color: c.textTertiary }}>
                {search ? '未找到匹配日记' : '还没有日记\n点上方「新建」开始记录'}
              </div>
            ) : filtered.map(e => (
              <button key={e.id} onClick={() => openEntry(e)}
                className="w-full text-left px-2.5 py-2 rounded-lg transition-colors"
                style={{ background: activeId === e.id ? c.surfaceActive : 'transparent' }}
                onMouseEnter={ev => { if (activeId !== e.id) ev.currentTarget.style.background = c.surfaceHover }}
                onMouseLeave={ev => { if (activeId !== e.id) ev.currentTarget.style.background = 'transparent' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono shrink-0" style={{ color: activeId === e.id ? c.accent : c.textTertiary }}>{fmtDate(e.date)}</span>
                  <span className="text-[10px]" style={{ color: c.textMuted }}>{weekday(e.date)}</span>
                </div>
                <div className="text-[12.5px] font-medium truncate mt-0.5" style={{ color: c.text }}>{e.title || '（无标题）'}</div>
                <div className="text-[11px] truncate" style={{ color: c.textMuted }}>{e.content.replace(/[#*`>\-\n]/g, ' ').slice(0, 40) || '空白日记'}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 右：编辑器 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {draft ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: c.borderLight }}>
                <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}
                  className="h-8 px-2 rounded-lg text-[12px] font-mono outline-none"
                  style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }} />
                <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="标题（可选）"
                  className="flex-1 h-8 px-3 rounded-lg text-[13px] outline-none"
                  style={{ background: 'transparent', color: c.textHead, border: 'none', fontWeight: 600 }} />
                {dirty && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>未保存</span>}
                <button onClick={() => { if (draft.id) remove(draft.id) }} disabled={!draft.id}
                  className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30"
                  style={{ color: c.toolErr }} title="删除这篇">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button onClick={save} disabled={saving || !dirty}
                  className="h-8 px-3.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
                  style={{ background: c.accent, color: c.accentText }}>{saving ? '保存中…' : '保存'}</button>
              </div>
              <textarea value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })}
                placeholder="今天发生了什么？想法、心情、收获……"
                className="flex-1 resize-none outline-none px-5 py-4 text-[14px] leading-[1.8]"
                style={{ background: 'transparent', color: c.text, fontFamily: 'inherit' }} />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: c.bgInput }}>
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textMuted }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="text-[13px]" style={{ color: c.textSecondary }}>选择左侧日记，或新建一篇</div>
              <button onClick={newEntry} className="h-8 px-4 rounded-lg text-[12px] font-medium"
                style={{ background: c.accent, color: c.accentText }}>写今天的日记</button>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}