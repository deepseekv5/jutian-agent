import { useState, useRef, useEffect, useMemo } from 'react'
import type { Session } from '../types'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import BrandMark from './BrandMark'
import SubAgentTracker from './SubAgentTracker'
import type { PageType } from './TabBar'
import { APP_NAME, APP_VERSION } from '../brand'

interface Props {
  sessions: Session[]
  activeId: string | null
  workingIds?: Set<string>
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onOpenTab: (type: PageType) => void
  onCollapse?: () => void
  /** 全局搜索命中某条消息：打开该会话并滚动定位 */
  onJumpToMessage?: (sessionId: string, messageId: string) => void
}

interface SearchHit {
  id: string
  session_id: string
  role: string
  content: string
  created_at?: string | number
  session_title?: string
  snippet: string
}

function loadStarred(): Set<string> {
  try { const raw = localStorage.getItem('lyclaw_starred'); const arr = raw ? JSON.parse(raw) : []; return new Set(Array.isArray(arr) ? arr : []) } catch { return new Set() }
}

/** 按更新时间分组：今天 / 昨天 / 前 7 天 / 前 30 天 / 更早 */
/** 相对时间显示（侧栏会话行右侧；兼容 ISO 字符串 / 毫秒时间戳 / 数字字符串） */
function relTime(raw?: string | number): string {
  if (raw === undefined || raw === null || raw === '') return ''
  let v: any = raw
  if (typeof v === 'string' && /^\d{10,}$/.test(v.trim())) v = Number(v.trim())
  const t = new Date(v).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  const MIN = 60000, HOUR = 3600000, DAY = 86400000
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MIN))}分钟`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}天`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 搜索摘要里的关键词高亮（大小写不敏感） */
function highlightSnippet(text: string, q: string) {
  const s = String(text || '')
  const needle = q.trim()
  if (!needle) return s
  const i = s.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return s
  return (
    <>
      {s.slice(0, i)}
      <mark style={{ background: 'rgba(16,163,127,.28)', color: 'inherit', borderRadius: 3, padding: '0 1px' }}>{s.slice(i, i + needle.length)}</mark>
      {s.slice(i + needle.length)}
    </>
  )
}

function groupSessions(list: Session[], lang: 'zh' | 'en'): { label: string; items: Session[] }[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 86400000
  const buckets: { label: string; items: Session[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '前 7 天', items: [] },
    { label: '前 30 天', items: [] },
    { label: '更早', items: [] },
  ]
  for (const s of list) {
    const raw = s.updated_at || s.created_at
    const t = raw ? new Date(raw).getTime() : NaN
    if (isNaN(t)) { buckets[4].items.push(s); continue }
    const diff = startOfToday - new Date(t).setHours(0, 0, 0, 0)
    if (t >= startOfToday) buckets[0].items.push(s)
    else if (diff <= DAY) buckets[1].items.push(s)
    else if (diff <= 7 * DAY) buckets[2].items.push(s)
    else if (diff <= 30 * DAY) buckets[3].items.push(s)
    else buckets[4].items.push(s)
  }
  return buckets.filter(b => b.items.length > 0)
}

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

export default function Sidebar({ sessions, activeId, workingIds, onSelect, onCreate, onDelete, onOpenTab, onCollapse, onJumpToMessage }: Props) {
  const { lang, t } = useLanguage()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [starred, setStarred] = useState<Set<string>>(loadStarred())
  const [search, setSearch] = useState('')
  const [msgHits, setMsgHits] = useState<SearchHit[]>([])
  const [titleHits, setTitleHits] = useState<{ id: string; title: string }[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // 会话颜色标记：标题前的色点用于人工分类（工作/学习/临时…）
  const [colors, setColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('lyclaw_session_colors') || '{}') || {} } catch { return {} }
  })
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null)
  // 批量管理模式：勾选多个会话一键删除
  const [manageMode, setManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const onDeleteRef = useRef(onDelete)
  onDeleteRef.current = onDelete
  const batchDelete = async (id: string) => { onDeleteRef.current(id); setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  const { c, theme, toggle } = useTheme()

  const SESSION_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#64748b']

  const setColor = (id: string, color: string) => {
    setColors(prev => {
      const next = { ...prev }
      if (color) next[id] = color; else delete next[id]
      try { localStorage.setItem('lyclaw_session_colors', JSON.stringify(next)) } catch {}
      return next
    })
    setColorPickerFor(null)
  }

  // Cmd+K 已升级为全局命令面板（CommandPalette），此处不再抢占焦点

  const toggleStar = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setStarred(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem('lyclaw_starred', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = [...sessions].sort((a, b) => {
      const sa = starred.has(a.id) ? 1 : 0, sb = starred.has(b.id) ? 1 : 0
      if (sa !== sb) return sb - sa
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    })
    if (!q) return base
    return base.filter(s => String(s.title || '').toLowerCase().includes(q))
  }, [search, sessions, starred])

  const groups = useMemo(() => groupSessions(filtered, lang), [filtered, lang])

  // 全局全文搜索：标题命中（即时，本地过滤）+ 消息正文命中（服务端 SQLite LIKE，防抖 350ms）
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = search.trim()
    if (!q) { setMsgHits([]); setTitleHits([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(() => {
      const ctrl = new AbortController()
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=40`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(d => {
          setMsgHits(Array.isArray(d?.messages) ? d.messages : [])
          setTitleHits(Array.isArray(d?.sessions) ? d.sessions.map((s: any) => ({ id: s.id, title: s.title })) : [])
        })
        .catch(() => { /* 忽略中止/网络错误，保留上一次结果 */ })
        .finally(() => setSearching(false))
      return () => ctrl.abort()
    }, 350)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [search])

  const handleStartEdit = (session: Session, e: React.MouseEvent) => { e.stopPropagation(); setEditingId(session.id); setEditTitle(session.title || '新对话') }
  const handleSaveTitle = async (id: string) => {
    if (editTitle.trim()) {
      try { await fetch(`/api/sessions/${id}/title`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: editTitle.trim() }) }) } catch {}
    }
    setEditingId(null)
  }

  const renderItem = (session: Session) => {
    const isActive = activeId === session.id
    const isWorking = workingIds?.has(session.id) || false
    const isStarred = starred.has(session.id)
    const title = typeof session.title === 'string' && session.title.trim() ? session.title : '新对话'
    return (
      <div key={session.id}
        onClick={() => onSelect(session.id)}
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
        className="group relative flex items-center gap-2 px-2.5 h-9 rounded-lg cursor-pointer transition-colors"
        style={{ background: isActive ? c.sidebarActiveBg : hoveredId === session.id ? c.surfaceHover : 'transparent' }}>

        {/* 前导状态指示 */}
        {manageMode ? (
          <button onClick={e => { e.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); n.has(session.id) ? n.delete(session.id) : n.add(session.id); return n }) }}
            className="w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center transition-colors"
            style={{ borderColor: selectedIds.has(session.id) ? c.accent : c.border, background: selectedIds.has(session.id) ? c.accent : 'transparent' }}>
            {selectedIds.has(session.id) && (
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
          </button>
        ) : isWorking ? (
          <svg className="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : isStarred ? (
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="#f5b301" stroke="#f5b301" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ) : colors[session.id] ? (
          <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full" style={{ background: colors[session.id] }} />
          </span>
        ) : (
          <svg className="w-3.5 h-3.5 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} style={{ color: c.textTertiary }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}

        {editingId === session.id ? (
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} onClick={e => e.stopPropagation()}
            onBlur={() => handleSaveTitle(session.id)} onKeyDown={e => e.key === 'Enter' && handleSaveTitle(session.id)}
            className="flex-1 bg-transparent outline-none text-[13px]" style={{ color: c.text }} autoFocus />
        ) : (
          <>
            <span className="text-[13px] truncate flex-1" style={{ color: isActive ? c.textHead : c.text }}>
              {title}
            </span>
            {/* 相对时间（非悬停时显示，企业级信息密度） */}
            <span className="text-[10.5px] font-mono shrink-0"
              style={{ color: c.textMuted, display: hoveredId === session.id ? 'none' : 'block' }}>
              {relTime(session.updated_at)}
            </span>
          </>
        )}

        {/* 悬停操作 */}
        {hoveredId === session.id && editingId !== session.id && (
          <div className="absolute right-1.5 flex items-center gap-0.5">
            <button onClick={e => { e.stopPropagation(); toggleStar(session.id, e) }} title={isStarred ? '取消星标' : '星标'}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
              style={{ color: isStarred ? '#f5b301' : c.textTertiary, background: isActive ? c.sidebarActiveBg : c.surfaceHover }}
              onMouseEnter={e => e.currentTarget.style.background = c.surfaceActive}
              onMouseLeave={e => e.currentTarget.style.background = isActive ? c.sidebarActiveBg : c.surfaceHover}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isStarred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
            <button onClick={e => { e.stopPropagation(); setColorPickerFor(colorPickerFor === session.id ? null : session.id) }} title="颜色标记"
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
              style={{ color: colors[session.id] || c.textTertiary, background: isActive ? c.sidebarActiveBg : c.surfaceHover }}
              onMouseEnter={e => e.currentTarget.style.background = c.surfaceActive}
              onMouseLeave={e => e.currentTarget.style.background = isActive ? c.sidebarActiveBg : c.surfaceHover}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </button>
            <button onClick={e => { e.stopPropagation(); handleStartEdit(session, e) }} title="重命名"
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
              style={{ color: c.textTertiary, background: isActive ? c.sidebarActiveBg : c.surfaceHover }}
              onMouseEnter={e => e.currentTarget.style.background = c.surfaceActive}
              onMouseLeave={e => e.currentTarget.style.background = isActive ? c.sidebarActiveBg : c.surfaceHover}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(session.id) }} title="删除"
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
              style={{ color: c.textTertiary, background: isActive ? c.sidebarActiveBg : c.surfaceHover }}
              onMouseEnter={e => { e.currentTarget.style.background = c.surfaceActive; e.currentTarget.style.color = c.toolErr }}
              onMouseLeave={e => { e.currentTarget.style.background = isActive ? c.sidebarActiveBg : c.surfaceHover; e.currentTarget.style.color = c.textTertiary }}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}

        {/* 颜色标记选择板 */}
        {colorPickerFor === session.id && (
          <div className="absolute right-1.5 top-9 z-20 flex items-center gap-1.5 rounded-lg px-2 py-1.5 shadow-lg"
            style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            {SESSION_COLORS.map(color => (
              <button key={color} onClick={e => { e.stopPropagation(); setColor(session.id, color) }}
                className="w-4 h-4 rounded-full transition-transform hover:scale-110"
                style={{ background: color, outline: colors[session.id] === color ? `2px solid ${c.text}` : 'none', outlineOffset: 1 }}
                title="标记" />
            ))}
            <button onClick={e => { e.stopPropagation(); setColor(session.id, '') }}
              className="text-[10.5px] px-1.5 py-0.5 rounded" style={{ color: c.textTertiary }} title="清除标记">清除</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col glass" style={{ borderRight: `1px solid ${c.border}` }}>
      {/* ── 品牌头部 ── */}
      <div className="h-14 flex items-center justify-between shrink-0 titlebar-drag" style={{ paddingLeft: isMac ? 78 : 12, paddingRight: 12 }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark size={20} color={c.textHead} />
          <span className="text-[14px] font-semibold tracking-tight truncate" style={{ color: c.textHead }}>{APP_NAME}</span>
        </div>
        {onCollapse && (
          <button onClick={onCollapse} className="btn-icon shrink-0 titlebar-nodrag" title="收起侧边栏" aria-label="收起侧边栏">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* ── 新建对话（ChatGPT 风格中性按钮）+ 批量管理 ── */}
      <div className="px-3 pb-1 shrink-0">
        <div className="flex gap-1.5">
          <button onClick={onCreate}
            className="flex-1 h-10 rounded-xl flex items-center gap-2.5 px-3 text-[13.5px] font-medium transition-colors"
            style={{ color: c.text, background: 'transparent', border: `1px solid ${c.border}` }}
            onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            {lang === 'en' ? 'New Chat' : '新建对话'}
          </button>
          <button onClick={() => { setManageMode(v => !v); setSelectedIds(new Set()) }}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0"
            style={{ color: manageMode ? c.accent : c.textTertiary, background: c.surfaceCard, border: `1px solid ${manageMode ? c.accent : c.border}` }}
            title={manageMode ? '退出批量管理' : '批量管理会话'}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </button>
        </div>
        {manageMode && (
          <div className="mt-2 flex items-center gap-1.5 rounded-xl px-2.5 h-9" style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }}>
            <button onClick={() => setSelectedIds(new Set(filtered.map(s => s.id)))}
              className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: c.textSecondary }}>全选</button>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: c.textTertiary }}>清空</button>
            <span className="flex-1" />
            <span className="text-[11px] font-mono" style={{ color: c.textMuted }}>{selectedIds.size}</span>
            <button onClick={async () => {
              if (selectedIds.size === 0) return
              if (!confirm(`确定删除选中的 ${selectedIds.size} 个会话？不可恢复。`)) return
              for (const id of selectedIds) { await batchDelete(id) }
              setManageMode(false); setSelectedIds(new Set())
            }} disabled={selectedIds.size === 0}
              className="text-[11px] px-2 py-1 rounded-lg font-medium disabled:opacity-40"
              style={{ background: c.toolErr, color: '#fff' }}>删除</button>
          </div>
        )}
        {/* 功能入口：紧凑图标行（ChatGPT 风格弱化，功能全保留） */}
        <div className="flex items-center gap-1 mt-2">
          {[
            { tab: 'call', label: t('通话','Call'), title: t('打电话模式：语音对话，可执行任务','Voice call mode'), icon: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 011.11-.21 11.36 11.36 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.57 1 1 0 01-.21 1.11z', fill: true },
            { tab: 'computer', label: t('电脑','PC'), title: t('Computer Use：说目标，它操作这台电脑','Computer Use'), icon: 'M12 3v4m-4.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM4 8V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8z', fill: false },
            { tab: 'employees', label: t('集群','Swarm'), title: t('集群指挥室','Swarm console'), icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', fill: false },
            { tab: 'code', label: 'Code', title: t('代码模式','Code mode'), icon: 'M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z', fill: false },
            { tab: 'kb', label: t('知识库','KB'), title: t('知识库：文档索引 / 知识图谱','Knowledge base'), icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', fill: false },
          ].map(item => (
            <button key={item.tab} onClick={() => onOpenTab(item.tab as any)}
              className="flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 text-[11.5px] font-medium transition-colors"
              style={{ color: c.textTertiary, background: 'transparent', border: '1px solid transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover; e.currentTarget.style.color = c.text }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.textTertiary }}
              title={item.title}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={item.fill ? 'currentColor' : 'none'} stroke={item.fill ? 'none' : 'currentColor'} strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 搜索 ── */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.textTertiary }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('搜索标题与全部消息', 'Search titles & messages')}
            className="w-full pl-8.5 pr-3 h-9 rounded-xl text-[13px] outline-none transition-colors"
            style={{ background: 'transparent', border: `1px solid transparent`, color: c.text, paddingLeft: 32 }}
            onFocus={e => { e.currentTarget.style.background = c.surfaceCard; e.currentTarget.style.borderColor = c.border }}
            onBlur={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
            aria-label="搜索对话" />
        </div>
      </div>

      {/* ── 子代理进度（AI 派出时显示）── */}
      <SubAgentTracker />

      {/* ── 全局搜索结果：标题命中 + 消息正文命中（可跳转定位）── */}
      {search.trim() && (msgHits.length > 0 || titleHits.length > 0 || searching) && (
        <div className="px-2 pb-3 shrink-0">
          {/* 标题命中 */}
          {titleHits.length > 0 && (
            <>
              <div className="text-[10.5px] font-medium px-2 pb-1.5" style={{ color: c.textTertiary }}>标题命中</div>
              <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                {titleHits.map(h => (
                  <button key={h.id} onClick={() => onSelect(h.id)}
                    className="px-2.5 h-7 rounded-full text-[11.5px] font-medium truncate max-w-full transition-colors"
                    style={{ background: activeId === h.id ? c.sidebarActiveBg : c.bgInput, color: c.text }}>
                    {h.title || '新对话'}
                  </button>
                ))}
              </div>
            </>
          )}
          {/* 消息命中 */}
          {(msgHits.length > 0 || searching) && (
            <>
              <div className="flex items-center gap-2 px-2 pb-1.5">
                <span className="text-[10.5px] font-medium" style={{ color: c.textTertiary }}>消息命中</span>
                <span className="text-[10px]" style={{ color: c.textMuted }}>{searching ? '搜索中…' : `${msgHits.length} 条`}</span>
              </div>
              <div className="space-y-0.5 max-h-[280px] overflow-y-auto scrollbar-thin">
                {msgHits.map(h => (
                  <button key={h.id}
                    onClick={() => { onSelect(h.session_id); onJumpToMessage?.(h.session_id, h.id) }}
                    className="w-full text-left px-2.5 py-2 rounded-lg transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: h.role === 'user' ? c.bgInput : c.accentBg, color: h.role === 'user' ? c.textSecondary : c.accent }}>
                        {h.role === 'user' ? '我' : 'AI'}
                      </span>
                      <span className="text-[11.5px] font-medium truncate" style={{ color: c.text }}>{h.session_title || '新对话'}</span>
                      <span className="text-[10px] shrink-0 ml-auto" style={{ color: c.textMuted }}>{relTime(h.created_at)}</span>
                    </div>
                    <div className="text-[11px] leading-relaxed mt-1 line-clamp-2" style={{ color: c.textMuted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {highlightSnippet(h.snippet, search)}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 会话列表（按日期分组）── */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <div className="px-3 py-10 text-center text-[12.5px]" style={{ color: c.textTertiary }}>
            {search ? '未找到匹配的对话' : '还没有对话'}
          </div>
        )}
        {groups.map(g => (
          <div key={g.label}>
            <div className="sidebar-group-label">{g.label}</div>
            <div className="space-y-0.5">{g.items.map(renderItem)}</div>
          </div>
        ))}
      </div>

      {/* ── 底部 ── */}
      <div className="px-3 py-2.5 shrink-0 border-t" style={{ borderColor: c.border }}>
        <div className="flex items-center justify-between">
          <button onClick={toggle}
            className="flex items-center gap-2 px-2 h-8 rounded-lg text-[12.5px] transition-colors"
            style={{ color: c.textSecondary }}
            onMouseEnter={e => e.currentTarget.style.background = c.surfaceHover}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            title="切换主题" aria-label="切换主题">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d={theme === 'dark' ? 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' : 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z'} />
            </svg>
            {theme === 'dark' ? t('浅色','Light') : t('深色','Dark')}
          </button>
          <div className="flex items-center gap-1 titlebar-nodrag">
            <span className="text-[11px] tabular-nums" style={{ color: c.textMuted }}>v{APP_VERSION}</span>
            <button onClick={() => onOpenTab('settings')} className="btn-icon" title="设置" aria-label="设置">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
