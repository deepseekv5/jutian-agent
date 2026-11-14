/**
 * 新标签页全局搜索（v14.11）——「搜索所有东西」
 *
 * 一个输入框同时搜四类：页面卡片 / 用户扩展 / 会话标题 / 消息正文。
 * 本地卡片+扩展即时过滤，会话与消息走 /api/search（350ms 防抖 + AbortController）。
 * 回车打开第一个结果；点击结果按类型派不同事件，由 App 接管路有。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'
import { getRegisteredExts, subscribeExts, extType } from './extensions'
import { fetchCompat } from '../api'

export interface SearchCard { type: PageType; desc: string; descEn: string; chips: string[]; chipsEn: string[] }

interface Props {
  cards: SearchCard[]
  onPickPage: (type: PageType) => void
}

interface Hit { id: string; title: string; snippet?: string; kind: 'session' | 'message'; sessionId?: string; messageId?: string }

export default function NewTabSearch({ cards, onPickPage }: Props) {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const [q, setQ] = useState('')
  const [exts, setExts] = useState(getRegisteredExts)
  const [remote, setRemote] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => subscribeExts(() => setExts(getRegisteredExts())), [])
  // Cmd/Ctrl+K 或 / 聚焦搜索（输入框内不抢）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // 远程搜索（会话标题 + 消息正文）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
    const kw = q.trim()
    if (!kw) { setRemote([]); setSearching(false); return }
    setSearching(true)
    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const r = await fetchCompat(`/api/search?q=${encodeURIComponent(kw)}&limit=20`, { signal: ctrl.signal })
        const d = await r.json()
        if (ctrl.signal.aborted) return
        const sessions: Hit[] = (d?.sessions || []).map((x: any) => ({
          id: 's-' + x.id, title: String(x.title || '未命名会话'), kind: 'session', sessionId: String(x.id),
        }))
        const messages: Hit[] = (d?.messages || []).map((x: any) => ({
          id: 'm-' + x.id, title: String(x.session_title || x.title || '会话'),
          snippet: String(x.snippet || x.content || '').replace(/\s+/g, ' ').slice(0, 90),
          kind: 'message', sessionId: String(x.session_id || ''), messageId: String(x.id || ''),
        }))
        setRemote([...sessions, ...messages])
      } catch { /* 中止/网络错误保留上次结果 */ }
      finally { if (!ctrl.signal.aborted) setSearching(false) }
    }, 350)
    return () => { if (timerRef.current) clearTimeout(timerRef.current); abortRef.current?.abort() }
  }, [q])

  const local = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const pages = cards.filter(c => {
      if (!kw) return false
      const meta = PAGE_META[c.type]
      return [meta?.label, meta?.labelEn, c.desc, c.descEn, ...(c.chips || []), ...(c.chipsEn || [])]
        .some(x => String(x || '').toLowerCase().includes(kw))
    }).map(c => ({ kind: 'page' as const, type: c.type, title: PAGE_META[c.type]?.label || c.type, desc: c.desc }))
    const e = exts.filter(x => !kw || [x.name, x.description, x.id].some(v => String(v || '').toLowerCase().includes(kw)))
      .map(x => ({ kind: 'ext' as const, type: extType(x.id) as PageType, title: x.name, desc: x.description || '用户扩展', icon: x.icon }))
    const r = remote.filter(x => !kw || [x.title, x.snippet].some(v => String(v || '').toLowerCase().includes(kw)))
    return { pages, exts: e, remote: r }
  }, [q, cards, exts, remote])

  const total = local.pages.length + local.exts.length + local.remote.length
  const first = local.pages[0] || local.exts[0] || local.remote[0]

  const openHit = (h: Hit) => {
    if (!h.sessionId) return
    if (h.kind === 'message' && h.messageId) {
      window.dispatchEvent(new CustomEvent('newtab-open-message', { detail: { sessionId: h.sessionId, messageId: h.messageId } }))
    } else {
      window.dispatchEvent(new CustomEvent('newtab-open-session', { detail: { sessionId: h.sessionId } }))
    }
  }

  return (
    <div className="mb-6">
      <div className="relative">
        <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.textTertiary }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && first) {
              e.preventDefault()
              const f: any = first
              if (f.kind === 'page' || f.kind === 'ext') onPickPage(f.type as PageType)
              else openHit({ id: f.id, title: f.title, snippet: f.snippet, kind: f.kind, sessionId: f.sessionId, messageId: f.messageId })
            } else if (e.key === 'Escape') { setQ(''); inputRef.current?.blur() }
          }}
          placeholder={t('搜索页面、扩展、会话和消息…（/ 或 Cmd+K 聚焦，回车打开）', 'Search pages, extensions, sessions and messages…')}
          className="w-full h-11 rounded-2xl text-[13px] outline-none transition-colors"
          style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text, paddingLeft: 38, paddingRight: 38 }}
        />
        {q && (
          <button onClick={() => { setQ(''); inputRef.current?.focus() }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] px-1" style={{ color: c.textTertiary }}>✕</button>
        )}
      </div>

      {q.trim() && (
        <div className="mt-2 rounded-2xl p-2.5" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
          {searching && <div className="px-2 py-1 text-[11px]" style={{ color: c.textTertiary }}>搜索中…</div>}
          {!searching && total === 0 && (
            <div className="px-2 py-2 text-[11.5px]" style={{ color: c.textTertiary }}>没有匹配结果</div>
          )}
          {local.pages.length > 0 && (
            <Group label="功能页面" c={c}>
              {local.pages.map(x => (
                <Row key={x.type} c={c} title={x.title} desc={x.desc} onClick={() => onPickPage(x.type)} />
              ))}
            </Group>
          )}
          {local.exts.length > 0 && (
            <Group label="我的扩展" c={c}>
              {local.exts.map(x => (
                <Row key={x.type} c={c} title={x.title} desc={x.desc} icon={x.icon} onClick={() => onPickPage(x.type)} />
              ))}
            </Group>
          )}
          {local.remote.length > 0 && (
            <Group label="会话与消息" c={c}>
              {local.remote.map(x => (
                <Row key={x.id} c={c} title={x.title} desc={x.snippet || (x.kind === 'session' ? '会话' : '消息')}
                  badge={x.kind === 'message' ? '消息' : '会话'} onClick={() => openHit(x)} />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, c, children }: { label: string; c: any; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="px-2 py-1 text-[10.5px] font-medium" style={{ color: c.textTertiary }}>{label}</div>
      {children}
    </div>
  )
}

function Row({ title, desc, icon, badge, c, onClick }: { title: string; desc: string; icon?: string; badge?: string; c: any; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors"
      onMouseEnter={e => e.currentTarget.style.background = c.surfaceHover || c.bgInput}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {icon && <span className="text-[15px] shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium truncate" style={{ color: c.textHead }}>{title}</span>
        <span className="block text-[10.5px] truncate" style={{ color: c.textTertiary }}>{desc}</span>
      </span>
      {badge && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: c.bgInput, color: c.textTertiary }}>{badge}</span>}
    </button>
  )
}
