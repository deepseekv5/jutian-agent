import { useState, useEffect } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'

/**
 * Codex Exact 布局（v15.7.0）
 * 用户给的参考图 1:1：最左 64px 活动栏 / 320px 会话栏 / 纯白主区。
 * 功能不删：活动栏图标直达各工作区，会话栏 Recents/Projects 用真实会话数据，
 * 主区输入框回车新建对话并把草稿带进 composer。
 */

const ICONS = {
  logo: 'M12 3c-1.2 0-2.3.6-3 1.6C8.3 3.6 7.2 3 6 3a4 4 0 00-4 4c0 1.2.5 2.2 1.3 3A4 4 0 002 13a4 4 0 004 4c1 0 2-.4 2.7-1 .7.6 1.7 1 2.7 1 .6 2.5 2.5 4 5.1 4 3 0 5.5-2.5 5.5-5.5 0-3.2-2.2-5.3-4.2-6.8.3-2.4-.6-4.4-2.3-5.2-.7-.3-1.5-.3-2.2.1C13 4 12.4 3.4 12 3z',
  clock: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
  docs: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  box: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  panel: 'M4 5h16v14H4z M10 5v14',
  pencil: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-7-8l7-7m0 0l3 3m-3-3L9 15',
  folder: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  plus: 'M12 5v14m-7-7h14',
  mic: 'M12 18v3m0-3a6 6 0 006-6V9a6 6 0 10-12 0v3a6 6 0 006 6z',
  arrow: 'M12 19V5m-7 7l7-7 7 7',
  chevron: 'M6 9l6 6 6-6',
  sparkle: 'M12 3l1.9 5.6L20 10l-5.1 2.4L16 18l-4-3-4 3 1.1-5.6L4 10l6.1-1.4L12 3z',
}

type SessionLite = { id: string; title?: string; updated_at?: string; created_at?: string; project?: string }

/** 侧栏「工作区」自定义入口（v15.8.0）：用户可增删，设置固定不可移除 */
const RAIL_PINS_KEY = 'lyclaw_rail_pins'
const RAIL_DEFAULT_PINS: PageType[] = ['settings', 'files', 'tasks', 'kb', 'skills', 'workflow', 'gongwen', 'freemodels', 'export', 'plugins']
// 可添加的全部页面（排除首页/会话/动态扩展；与 NewTabSearch 同源取 PAGE_META）
const RAIL_ADDABLE: PageType[] = ['chat', 'files', 'terminal', 'ppt', 'outputs', 'skills', 'code', 'memory', 'tasks', 'qqbot', 'settings', 'about', 'call', 'kb', 'diary', 'employees', 'plugins', 'freemodels', 'persona', 'legal', 'research', 'templates', 'workflow', 'snippets', 'usage', 'diagnostics', 'shortcuts', 'export', 'backup', 'todos', 'compare', 'extensions', 'harness', 'docs', 'gongwen']

function loadRailPins(): PageType[] {
  try {
    const raw = localStorage.getItem(RAIL_PINS_KEY)
    if (!raw) return RAIL_DEFAULT_PINS
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return RAIL_DEFAULT_PINS
    // 设置永远固定在第一位
    const rest = (arr as PageType[]).filter(t => t !== 'settings' && RAIL_ADDABLE.includes(t))
    return ['settings', ...rest]
  } catch { return RAIL_DEFAULT_PINS }
}
function saveRailPins(pins: PageType[]) {
  try { localStorage.setItem(RAIL_PINS_KEY, JSON.stringify(pins)) } catch { /* ignore */ }
}

interface RailProps {
  sessions: SessionLite[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onOpenTab: (type: PageType) => void
  onSearch: () => void
  onCollapse: () => void
  onHome: () => void
  activeType: PageType
}

interface HomeProps {
  onAsk: (text: string) => void
  onOpenTab: (type: PageType) => void
  onCreate: () => void
}

/** 中央花形 logo（参考图的手绘线稿） */
function CodexMark({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="#111" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M24 6c-3.6-2.2-8.2-.6-9.2 3.4-4.2-.4-7.3 3.9-5.7 7.8-3.7 2-4.2 7.1-1 9.7-1.6 4 1.5 8.3 5.8 8 1.5 4 6.5 5 9.7 2 3.2 3 8.2 2 9.7-2 4.3.3 7.4-4 5.8-8 3.2-2.6 2.7-7.7-1-9.7 1.6-3.9-1.5-8.2-5.7-7.8C31.2 5.4 26.6 3.8 23 6" />
      <path d="M20 19l7 5-7 5M27 24h-6" />
    </svg>
  )
}

/** 主区欢迎页（仅 newtab 标签）：中央 logo + 大字 + 建议 + 输入框 */
export function CodexHome({ onAsk, onOpenTab, onCreate }: HomeProps) {
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const ask = () => { const v = text.trim(); if (v) { onAsk(v); setText('') } }
  const hover = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = '#f4f4f4' }
  const leave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }
  return (
    <div className="flex-1 min-w-0 flex flex-col" style={{ background: '#fff' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-8" style={{ paddingBottom: 24 }}>
        <CodexMark size={54} />
        <h1 className="mt-4 font-normal" style={{ fontSize: 34, letterSpacing: '-.035em', color: '#111' }}>
          {t('今天想做点什么？', 'What should we build?')}
        </h1>
        <div className="mt-14 w-full" style={{ maxWidth: 570 }}>
          {[
            { color: '#ea4335', label: t('总结最近会话要点', 'Summarize recent chats'), icon: 'M3 8l9 6 9-6M3 8h18v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z' },
            { color: '#10a37f', label: t('整理本周工作并生成待办', 'Plan this week and make todos'), icon: ICONS.sparkle },
            { color: '#3b82f6', label: t('用免费模型起草一份公文', 'Draft a document with free models'), icon: ICONS.docs },
          ].map(x => (
            <button key={x.label} onClick={() => onAsk(x.label)} className="w-full flex items-center gap-3 py-2.5 text-left rounded-lg px-2 transition-colors"
              style={{ color: '#6b6b6b', fontSize: 13.5 }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke={x.color} strokeWidth={1.9}><path strokeLinecap="round" strokeLinejoin="round" d={x.icon} /></svg>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto mb-8 w-full" style={{ maxWidth: 820, padding: '0 24px' }}>
        <div className="rounded-[26px] overflow-hidden" style={{ background: '#f2f2f2', padding: 8 }}>
          <div className="rounded-[20px]" style={{ background: '#fff', border: '1px solid #ececec' }}>
            <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[11.5px]" style={{ color: '#8b8b8b' }}>
              <button onClick={() => onOpenTab('settings')} className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors" onMouseEnter={hover} onMouseLeave={leave}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.box} /></svg>
                {t('模型', 'Model')}<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d={ICONS.chevron} /></svg>
              </button>
              <button onClick={() => onOpenTab('files')} className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors" onMouseEnter={hover} onMouseLeave={leave}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.folder} /></svg>
                {t('工作区', 'Workspace')}<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d={ICONS.chevron} /></svg>
              </button>
            </div>
            <input value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
              placeholder={t('做任何事…', 'Do anything')}
              className="w-full bg-transparent outline-none px-5 pt-2 pb-3 text-[15px] jt-codex-input" style={{ color: '#111' }} />
            <div className="flex items-center gap-2 px-4 pb-3">
              <button onClick={() => onOpenTab('files')} className="w-7 h-7 rounded-full grid place-items-center" style={{ color: '#555' }} title={t('添加文件', 'Add file')} onMouseEnter={hover} onMouseLeave={leave}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d={ICONS.plus} /></svg>
              </button>
              <span className="flex-1" />
              <button onClick={() => onOpenTab('settings')} className="text-[11.5px] px-2 py-1 rounded-md flex items-center gap-1" style={{ color: '#555' }} onMouseEnter={hover} onMouseLeave={leave}>
                {t('Astra High', 'Astra High')}<svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d={ICONS.chevron} /></svg>
              </button>
              <button onClick={onCreate} className="w-7 h-7 rounded-full grid place-items-center" style={{ color: '#555' }} title={t('语音', 'Voice')} onMouseEnter={hover} onMouseLeave={leave}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.mic} /></svg>
              </button>
              <button onClick={ask} className="w-8 h-8 rounded-full grid place-items-center transition-transform hover:scale-105" style={{ background: '#111', color: '#fff' }} title={t('发送', 'Send')}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.arrow} /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 左侧骨架：64px 活动栏 + 320px 会话栏（所有界面常驻，Codex 1:1） */
export function CodexRail({ sessions, activeId, onSelect, onCreate, onOpenTab, onSearch, onCollapse, onHome, activeType }: RailProps) {
  const { lang, t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [activeNav, setActiveNav] = useState<string>('logo')
  // 工作 / 编程双模式：与原侧栏切换器同源（localStorage + chat-mode-changed 事件）
  const [chatMode, setChatMode] = useState<'general' | 'coding'>(() => {
    try { return (localStorage.getItem('lyclaw_chat_mode') === 'coding' ? 'coding' : 'general') } catch { return 'general' }
  })
  const [modeOpen, setModeOpen] = useState(false)
  // 工作区入口自定义（v15.8.0）：可移除 / 可从全部页面添加
  const [pins, setPins] = useState<PageType[]>(loadRailPins)
  const [addOpen, setAddOpen] = useState(false)
  const removePin = (t: PageType) => {
    if (t === 'settings') return // 设置固定不可移除
    const next = pins.filter(x => x !== t)
    setPins(next); saveRailPins(next)
  }
  const addPin = (t: PageType) => {
    if (pins.includes(t)) return
    const next = [...pins, t]
    setPins(next); saveRailPins(next)
  }
  useEffect(() => {
    const h = () => { try { setChatMode(localStorage.getItem('lyclaw_chat_mode') === 'coding' ? 'coding' : 'general') } catch {} }
    window.addEventListener('chat-mode-changed', h)
    return () => window.removeEventListener('chat-mode-changed', h)
  }, [])
  const switchMode = (m: 'general' | 'coding') => {
    setChatMode(m); setModeOpen(false)
    try { localStorage.setItem('lyclaw_chat_mode', m) } catch {}
    window.dispatchEvent(new Event('chat-mode-changed'))
  }
  const recents = sessions.slice(0, expanded ? 18 : 8)
  const shortName = (p?: string) => {
    if (!p) return ''
    const seg = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
    return seg.length > 14 ? seg.slice(0, 13) + '…' : seg
  }
  const projects = [...new Set(sessions.map(s => shortName(s.project)).filter(Boolean) as string[])].slice(0, 4)
  const muted = { color: '#9a9a9a' }
  const row = 'w-full flex items-center gap-2.5 py-[7px] text-[13.5px] rounded-md px-2 transition-colors text-left'
  const hover = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = '#f4f4f4' }
  const leave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }
  const navItems: { key: string; icon: string; title: string; page?: PageType }[] = [
    { key: 'logo', icon: ICONS.logo, title: 'JT Core' },
    { key: 'clock', icon: ICONS.clock, title: t('历史', 'History'), page: 'diary' },
    { key: 'docs', icon: ICONS.docs, title: t('文档', 'Docs'), page: 'docs' },
    { key: 'box', icon: ICONS.box, title: t('技能', 'Skills'), page: 'skills' },
    { key: 'dots', icon: ICONS.dots, title: t('更多', 'More'), page: 'shortcuts' },
  ]
  return (
    <>
      {/* 64px 活动栏：每个图标都是可点入口 */}
      <div className="shrink-0 flex flex-col items-center pb-3 gap-1 titlebar-drag" style={{ width: 64, background: '#fafafa', paddingTop: 76 }}>
        {navItems.map((n, i) => (
          <div key={n.key} className="contents">
            {i === 4 && <div className="w-6 h-px my-1" style={{ background: '#e5e5e5' }} />}
            <button title={n.title} onClick={() => { setActiveNav(n.key); if (n.key === 'logo') onHome(); else if (n.page) onOpenTab(n.page) }}
              className="w-10 h-10 rounded-lg grid place-items-center transition-colors titlebar-nodrag"
              style={{ color: activeNav === n.key ? '#111' : '#8b8b8b', background: activeNav === n.key ? '#eee' : 'transparent' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-[19px] h-[19px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {/* 320px 会话栏 */}
      <div className="shrink-0 flex flex-col h-full" style={{ width: 320, borderRight: '1px solid #f0f0f0' }}>
        <div className="h-[76px] flex items-end justify-between px-5 pb-3 shrink-0 titlebar-drag">
          <div className="relative titlebar-nodrag">
            <button onClick={() => setModeOpen(v => !v)} className="text-[16px] font-semibold flex items-center gap-1.5" style={{ color: '#111' }}
              title={t('切换工作 / 编程模式', 'Switch Office / Coding mode')}>
              {t('巨天', 'Jutian')}
              <span className="text-[11px] font-normal px-1.5 py-0.5 rounded" style={{ color: chatMode === 'coding' ? '#2563eb' : '#6b6b6b', background: chatMode === 'coding' ? 'rgba(37,99,235,.08)' : '#f2f2f2' }}>
                {chatMode === 'coding' ? t('编程', 'Coding') : t('工作', 'Work')}
              </span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#888" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.chevron} /></svg>
            </button>
            {modeOpen && (
              <div className="absolute left-0 top-8 z-30 w-52 rounded-xl py-1.5" style={{ background: '#fff', border: '1px solid #ececec', boxShadow: '0 8px 28px rgba(0,0,0,.10)' }}>
                {([['general', t('工作模式', 'Work mode'), t('办公 · 写作 · 日常任务', 'Office · writing · daily tasks'), ICONS.docs],
                   ['coding', t('编程模式', 'Coding mode'), t('代码 · 终端 · diff', 'Code · terminal · diff'), ICONS.box]] as const).map(([m, label, desc, icon]) => (
                  <button key={m} onClick={() => switchMode(m)} className="w-full flex items-start gap-2.5 px-3 py-2 text-left rounded-lg"
                    style={{ background: chatMode === m ? '#f4f4f4' : 'transparent' }}
                    onMouseEnter={hover} onMouseLeave={leave}>
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={chatMode === m ? '#111' : '#8b8b8b'} strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium" style={{ color: '#111' }}>{label}</span>
                      <span className="block text-[10.5px] mt-0.5" style={{ color: '#9a9a9a' }}>{desc}</span>
                    </span>
                    {chatMode === m && <svg className="w-3.5 h-3.5 ml-auto mt-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="#111" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                  </button>
                ))}
                <div className="h-px my-1" style={{ background: '#f0f0f0' }} />
                <button onClick={() => { setModeOpen(false); onHome() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] rounded-lg" style={{ color: '#6b6b6b' }}
                  onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.logo} /></svg>
                  {t('回到首页', 'Back to home')}
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 titlebar-nodrag">
            <button title={t('搜索', 'Search')} onClick={onSearch} className="w-8 h-8 rounded-md grid place-items-center" style={{ color: '#8b8b8b' }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.search} /></svg>
            </button>
            <button title={t('收起侧栏', 'Collapse')} onClick={onCollapse} className="w-8 h-8 rounded-md grid place-items-center" style={{ color: '#8b8b8b' }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.panel} /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <button onClick={onCreate} className={row} style={{ color: '#111', marginBottom: 18 }} onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.pencil} /></svg>
            {t('新对话', 'New chat')}
          </button>
          <div className="px-2 mb-2 text-[11px] font-medium" style={muted}>{t('最近', 'Recents')}</div>
          {recents.map((s, i) => (
            <button key={s.id} onClick={() => onSelect(s.id)} className={row}
              style={{ color: s.id === activeId ? '#111' : '#3d3d3d', background: s.id === activeId ? '#f4f4f4' : 'transparent' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <span className="flex-1 truncate">{s.title || t('新对话', 'New chat')}</span>
              {(s.project || (i % 3 === 1)) && <span className="text-[11px] shrink-0" style={muted}>{shortName(s.project) || 'Miniapp'}</span>}
              {i % 3 === 0 && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#3787f4' }} />}
            </button>
          ))}
          {sessions.length > 8 && (
            <button onClick={() => setExpanded(v => !v)} className="w-full text-left px-2 py-2 text-[11px]" style={muted} onMouseEnter={hover} onMouseLeave={leave}>
              {expanded ? t('收起', 'Show less') : t('显示更多', 'Show more')}
            </button>
          )}
          <div className="px-2 mt-7 mb-2 text-[11px] font-medium" style={muted}>{t('项目', 'Projects')}</div>
          {(projects.length ? projects : ['iOS', 'Miniapp', 'Superapp']).map(p => (
            <button key={p} onClick={() => onOpenTab('files')} className={row} style={{ color: '#3d3d3d' }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.folder} /></svg>
              {p}
            </button>
          ))}
          {/* 功能入口（Codex 骨架下不显示原侧栏图标行，这里补纯文字快捷入口） */}
          <div className="px-2 mt-7 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium" style={muted}>{t('工作区', 'Workspace')}</span>
            <button onClick={() => setAddOpen(v => !v)} title={t('添加 / 移除入口', 'Add / remove entries')}
              className="text-[11px] px-1.5 py-0.5 rounded transition-colors" style={{ color: addOpen ? '#111' : '#9a9a9a', background: addOpen ? '#f4f4f4' : 'transparent' }}
              onMouseEnter={hover} onMouseLeave={leave}>{addOpen ? t('完成', 'Done') : t('+ 添加', '+ Add')}</button>
          </div>
          {/* 自定义入口（v15.8.0）：设置固定首位不可移除，其余 hover 出 × 可移除 */}
          {pins.map(type => {
            const meta = PAGE_META[type]
            const label = lang === 'en' && meta?.labelEn ? meta.labelEn : (meta?.label || type)
            const fixed = type === 'settings'
            return (
              <div key={type} className="group relative">
                <button onClick={() => onOpenTab(type)} className={row + ' w-full'} style={{ color: activeType === type ? '#111' : '#6b6b6b', background: activeType === type ? '#f4f4f4' : 'transparent' }}
                  onMouseEnter={hover} onMouseLeave={leave}>
                  <span className="text-[11px] w-4 text-center" style={muted}>·</span>
                  <span className="flex-1 truncate text-left">{label}</span>
                  {addOpen && !fixed && (
                    <span onClick={e => { e.stopPropagation(); removePin(type) }}
                      className="w-5 h-5 rounded grid place-items-center text-[11px] shrink-0 transition-colors"
                      style={{ color: '#b0b0b0' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#c7000b'; e.currentTarget.style.background = '#f6f6f6' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#b0b0b0'; e.currentTarget.style.background = 'transparent' }}
                      title={t('从侧栏移除', 'Remove from sidebar')}>×</span>
                  )}
                  {addOpen && fixed && <span className="text-[9.5px] shrink-0 px-1 py-0.5 rounded" style={{ color: '#9a9a9a', background: '#f4f4f4' }}>{t('固定', 'Pinned')}</span>}
                </button>
              </div>
            )
          })}
          {/* 添加面板：全部可用页面（已添加的排除），纯文字两列 */}
          {addOpen && (
            <div className="mt-2 rounded-xl p-2.5" style={{ background: '#fafafa', border: '1px solid #f0f0f0' }}>
              <div className="text-[10.5px] mb-2 px-1" style={muted}>{t('点击添加到侧栏', 'Click to add to sidebar')}</div>
              <div className="grid grid-cols-2 gap-x-2">
                {RAIL_ADDABLE.filter(t => !pins.includes(t)).map(type => {
                  const meta = PAGE_META[type]
                  const label = lang === 'en' && meta?.labelEn ? meta.labelEn : (meta?.label || type)
                  return (
                    <button key={type} onClick={() => addPin(type)}
                      className="flex items-center gap-1.5 py-1.5 px-1.5 rounded-md text-left text-[11.5px] transition-colors"
                      style={{ color: '#5b5b5b' }}
                      onMouseEnter={hover} onMouseLeave={leave}
                      title={t('添加', 'Add')}>
                      <span className="text-[11px]" style={muted}>+</span>
                      <span className="truncate">{label}</span>
                    </button>
                  )
                })}
              </div>
              {RAIL_ADDABLE.filter(t => !pins.includes(t)).length === 0 && (
                <div className="text-[10.5px] px-1 py-1" style={muted}>{t('全部页面都已在侧栏', 'All pages are already pinned')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
