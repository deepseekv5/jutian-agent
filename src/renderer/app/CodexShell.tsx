import { useState, useEffect } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'
import { CARDS, GROUPS } from './pageCatalog'

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

/** 活动栏可自定义目录（v15.9.2）：logo 固定，其余可增删 */
export const NAV_CATALOG: { key: string; icon: string; title: string; page?: PageType }[] = [
  { key: 'logo', icon: ICONS.logo, title: 'JT Core' },
  { key: 'diary', icon: ICONS.clock, title: '历史' },
  { key: 'docs', icon: ICONS.docs, title: '文档', page: 'docs' },
  { key: 'skills', icon: ICONS.box, title: '技能', page: 'skills' },
  { key: 'shortcuts', icon: ICONS.dots, title: '更多', page: 'shortcuts' },
  { key: 'files', icon: ICONS.folder, title: '文件', page: 'files' },
  { key: 'tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', title: '任务', page: 'tasks' },
  { key: 'settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', title: '设置', page: 'settings' },
  { key: 'kb', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', title: '知识库', page: 'kb' },
  { key: 'plugins', icon: 'M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3L4.3 7.6l5.3-.8z', title: '插件', page: 'plugins' },
  { key: 'freemodels', icon: ICONS.sparkle, title: '免费模型', page: 'freemodels' },
  { key: 'gongwen', icon: 'M6 2h9l5 5v15H6V2zm8 1.5V8h4.5M9 12h8M9 15.5h8M9 19h5', title: '公文台', page: 'gongwen' },
]
const RAIL_NAV_KEY = 'lyclaw_rail_nav'
const RAIL_NAV_DEFAULT = ['logo', 'diary', 'docs', 'skills', 'shortcuts']
function loadRailNav(): string[] {
  try {
    const raw = localStorage.getItem(RAIL_NAV_KEY)
    if (!raw) return RAIL_NAV_DEFAULT
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || !arr.length) return RAIL_NAV_DEFAULT
    const rest = (arr as string[]).filter(k => k !== 'logo' && NAV_CATALOG.some(c => c.key === k))
    return ['logo', ...rest]
  } catch { return RAIL_NAV_DEFAULT }
}
function saveRailNav(nav: string[]) {
  try { localStorage.setItem(RAIL_NAV_KEY, JSON.stringify(nav)) } catch { /* ignore */ }
}

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
  onExpand: () => void
  collapsed: boolean
  onHome: () => void
  activeType: PageType
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}

interface HomeProps {
  onAsk: (text: string) => void
  onOpenTab: (type: PageType) => void
  onCreate: () => void
  modelLabel?: string
  workLabel?: string
}

/** 中央花形 logo（参考图的手绘线稿） */
function CodexMark({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="var(--jt-ink)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M24 6c-3.6-2.2-8.2-.6-9.2 3.4-4.2-.4-7.3 3.9-5.7 7.8-3.7 2-4.2 7.1-1 9.7-1.6 4 1.5 8.3 5.8 8 1.5 4 6.5 5 9.7 2 3.2 3 8.2 2 9.7-2 4.3.3 7.4-4 5.8-8 3.2-2.6 2.7-7.7-1-9.7 1.6-3.9-1.5-8.2-5.7-7.8C31.2 5.4 26.6 3.8 23 6" />
      <path d="M20 19l7 5-7 5M27 24h-6" />
    </svg>
  )
}

/** 新标签页「工作台」（v15.9.1）：可滚动的应用启动台，与聊天页彻底区分。
 *  不再是「中央大字 + 底部 composer」（和对话页太像且展开后无法滚动），
 *  改为：顶部紧凑提问/搜索行 + 8 组常驻功能分区；整页自身 overflow-y-auto。 */
export function CodexHome({ onAsk, onOpenTab, onCreate, modelLabel, workLabel }: HomeProps) {
  const { lang, t } = useLanguage()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const ask = () => { const v = text.trim(); if (v) { onAsk(v); setText('') } }
  const catalogByType = new Map(CARDS.map(k => [k.type, k]))
  const hover = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'var(--jt-focus)' }
  const leave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }
  const kw = q.trim().toLowerCase()
  const match = (type: PageType, desc: string) => {
    if (!kw) return true
    const m = PAGE_META[type]
    const label = lang === 'en' && m?.labelEn ? m.labelEn : (m?.label || type)
    return (label + ' ' + desc + ' ' + type).toLowerCase().includes(kw)
  }
  return (
    <div className="jt-home-launcher h-full overflow-y-auto scrollbar-thin" style={{ background: 'var(--jt-paper)' }}>
      <div className="mx-auto w-full" style={{ maxWidth: 860, padding: '40px 32px 64px' }}>
        {/* 头部：标题 + 当前上下文（不再是聊天式大问句） */}
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-semibold" style={{ fontSize: 22, letterSpacing: '-.02em', color: 'var(--jt-ink)' }}>
              {t('工作台', 'Workspace')}
            </h1>
            <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--jt-ink-3)' }}>
              {t(`全部 ${CARDS.length} 项功能 · 点击直达`, `${CARDS.length} features · click to open`)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] shrink-0" style={{ color: 'var(--jt-ink-3)' }}>
            <span className="px-2 py-1 rounded-md" style={{ background: 'var(--jt-paper-alt)' }}>{modelLabel || t('未配置模型', 'No model')}</span>
            <span className="px-2 py-1 rounded-md" style={{ background: 'var(--jt-paper-alt)' }}>{workLabel || t('工作区', 'Workspace')}</span>
          </div>
        </div>

        {/* 紧凑提问行：在上方、单行、不悬浮 */}
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-8" style={{ background: 'var(--jt-paper-alt)', border: '1px solid var(--jt-hairline-soft)' }}>
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="var(--jt-ink-3)" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.plus} /></svg>
          <input value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
            placeholder={t('输入一句话开始新对话，或搜索下面的功能…', 'Start a chat, or search features below…')}
            className="flex-1 bg-transparent outline-none text-[13px] jt-codex-input" style={{ color: 'var(--jt-ink)' }} />
          <button onClick={ask} className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: 'var(--jt-ink)', color: 'var(--jt-paper)' }} title={t('发送', 'Send')}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.arrow} /></svg>
          </button>
        </div>

        {/* 过滤框（纯文字，不额外占大块） */}
        <div className="flex items-center gap-2 mb-5 pb-2" style={{ borderBottom: '1px solid var(--jt-hairline-soft)' }}>
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="var(--jt-ink-3)" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.search} /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('筛选功能…', 'Filter features…')}
            className="flex-1 bg-transparent outline-none text-[12px] jt-codex-input" style={{ color: 'var(--jt-ink)' }} />
          {kw && <button onClick={() => setQ('')} className="text-[11px] px-1" style={{ color: 'var(--jt-ink-3)' }}>{t('清除', 'Clear')}</button>}
        </div>

        {/* 8 组功能分区：常驻可见、可滚动、与聊天页完全不同 */}
        {GROUPS.map(g => {
          const items = g.items.filter(type => match(type, catalogByType.get(type)?.desc || ''))
          if (!items.length) return null
          return (
            <section key={g.label} className="mb-7">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[11px] font-medium" style={{ color: 'var(--jt-ink-3)' }}>{lang === 'en' ? g.labelEn : g.label}</span>
                <span className="text-[10px]" style={{ color: 'var(--jt-ink-4)' }}>{items.length}</span>
                <div className="flex-1 h-px" style={{ background: 'var(--jt-hairline-soft)' }} />
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                {items.map(type => {
                  const card = catalogByType.get(type)
                  const m = PAGE_META[type]
                  const label = lang === 'en' && m?.labelEn ? m.labelEn : (m?.label || type)
                  return (
                    <button key={type} onClick={() => onOpenTab(type)}
                      className="flex items-start gap-2.5 py-2 px-2 rounded-lg text-left transition-colors"
                      onMouseEnter={hover} onMouseLeave={leave}>
                      <span className="w-5 h-5 rounded-md grid place-items-center shrink-0 mt-0.5" style={{ background: 'var(--jt-paper-alt)', color: 'var(--jt-ink-3)' }}>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={m?.icon || ICONS.dots} /></svg>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-medium" style={{ color: 'var(--jt-ink)' }}>{label}</span>
                        {card && <span className="block text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--jt-ink-3)' }}>{lang === 'en' ? card.descEn : card.desc}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* 底部保留三个快捷动作（纯文字，不再是大 composer） */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3" style={{ borderTop: '1px solid var(--jt-hairline-soft)' }}>
          <button onClick={onCreate} className="text-[11.5px]" style={{ color: 'var(--jt-ink-3)' }} onMouseEnter={hover} onMouseLeave={leave}>+ {t('新建对话', 'New chat')}</button>
          <button onClick={() => onOpenTab('settings')} className="text-[11.5px]" style={{ color: 'var(--jt-ink-3)' }} onMouseEnter={hover} onMouseLeave={leave}>{t('设置', 'Settings')}</button>
          <button onClick={() => onOpenTab('gongwen')} className="text-[11.5px]" style={{ color: 'var(--jt-ink-3)' }} onMouseEnter={hover} onMouseLeave={leave}>{t('公文写作台', 'Doc desk')}</button>
          <button onClick={() => onAsk(t('总结最近会话要点', 'Summarize recent chats'))} className="text-[11.5px]" style={{ color: 'var(--jt-ink-3)' }} onMouseEnter={hover} onMouseLeave={leave}>{t('总结最近会话', 'Summarize recent chats')}</button>
        </div>
      </div>
    </div>
  )
}

/** 左侧骨架：64px 活动栏 + 320px 会话栏（所有界面常驻，Codex 1:1） */
export function CodexRail({ sessions, activeId, onSelect, onCreate, onOpenTab, onSearch, onCollapse, onExpand, collapsed, onHome, activeType, onDelete, onRename }: RailProps) {
  const { lang, t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  // Projects 点击 → 过滤 Recents（再点同一个取消）
  const [projFilter, setProjFilter] = useState<string | null>(null)
  // Recents 右键菜单（v15.8.5）：重命名 / 删除，与原侧栏能力对齐
  const [ctx, setCtx] = useState<{ id: string; title: string; x: number; y: number } | null>(null)
  // 工作 / 编程双模式：与原侧栏切换器同源（localStorage + chat-mode-changed 事件）
  const [chatMode, setChatMode] = useState<'general' | 'coding'>(() => {
    try { return (localStorage.getItem('lyclaw_chat_mode') === 'coding' ? 'coding' : 'general') } catch { return 'general' }
  })
  const [modeOpen, setModeOpen] = useState(false)
  // 活动栏高亮跟随当前页面：newtab→logo，diary→clock，docs→docs，skills→box，其余→更多
  const activeNav = activeType === 'newtab' ? 'logo' : activeType === 'diary' ? 'clock' : activeType === 'docs' ? 'docs' : activeType === 'skills' ? 'box' : 'dots'
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
  // 右键菜单点空白处关闭
  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [ctx])
  const switchMode = (m: 'general' | 'coding') => {
    setChatMode(m); setModeOpen(false)
    try { localStorage.setItem('lyclaw_chat_mode', m) } catch {}
    window.dispatchEvent(new Event('chat-mode-changed'))
  }
  const allRecents = projFilter ? sessions.filter(x => (x.project || '').endsWith('/' + projFilter) || x.project === projFilter) : sessions
  const recents = allRecents.slice(0, expanded ? 18 : 8)
  const shortName = (p?: string) => {
    if (!p) return ''
    const seg = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
    return seg.length > 14 ? seg.slice(0, 13) + '…' : seg
  }
  const projects = [...new Set(sessions.map(s => shortName(s.project)).filter(Boolean) as string[])].slice(0, 4)
  const muted = { color: 'var(--jt-ink-3)' }
  const row = 'w-full flex items-center gap-2.5 py-[7px] text-[13.5px] rounded-md px-2 transition-colors text-left'
  const hover = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'var(--jt-focus)' }
  const leave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }
  // 活动栏目录（v15.9.2）：全部可自定义，logo 固定首位不可移除
  const [nav, setNav] = useState<string[]>(() => loadRailNav())
  const [navEdit, setNavEdit] = useState(false)
  const [navAddOpen, setNavAddOpen] = useState(false)
  const navByKey = new Map(NAV_CATALOG.map(n => [n.key, n]))
  const navItems = nav.map(k => navByKey.get(k)).filter(Boolean) as { key: string; icon: string; title: string; page?: PageType }[]
  const saveNav = (next: string[]) => { setNav(next); saveRailNav(next) }
  const removeNav = (k: string) => { if (k !== 'logo') saveNav(nav.filter(x => x !== k)) }
  const addNav = (k: string) => { if (!nav.includes(k)) saveNav([...nav, k]) }
  return (
    <>
      {/* 64px 活动栏：图标全部可自定义（v15.9.2），logo 固定 */}
      <div className="shrink-0 flex flex-col items-center pb-2 gap-1 titlebar-drag relative" style={{ width: 64, background: 'var(--jt-paper-alt)', paddingTop: collapsed ? 20 : 76 }}>
        {navItems.map((n, i) => (
          <div key={n.key} className="contents">
            {i === 4 && <div className="w-6 h-px my-1" style={{ background: 'var(--jt-hairline)' }} />}
            <button title={n.title} onClick={() => { if (n.key === 'logo') onHome(); else if (n.page) onOpenTab(n.page) }}
              className="w-10 h-10 rounded-lg grid place-items-center transition-colors titlebar-nodrag relative"
              style={{ color: activeNav === n.key ? 'var(--jt-ink)' : 'var(--jt-ink-3)', background: activeNav === n.key ? 'var(--jt-focus)' : 'transparent' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-[19px] h-[19px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
              </svg>
              {navEdit && n.key !== 'logo' && (
                <span onClick={e => { e.stopPropagation(); removeNav(n.key) }}
                  className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full grid place-items-center text-[9px] z-10"
                  style={{ background: 'var(--jt-ink)', color: 'var(--jt-paper)' }}
                  title={t('从活动栏移除', 'Remove from activity bar')}>×</span>
              )}
            </button>
          </div>
        ))}
        {navEdit ? (
          <>
            <button onClick={() => setNavAddOpen(v => !v)} title={t('添加图标', 'Add icon')}
              className="w-10 h-10 rounded-lg grid place-items-center titlebar-nodrag"
              style={{ color: 'var(--jt-ink-3)', border: '1px dashed var(--jt-hairline)' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d={ICONS.plus} /></svg>
            </button>
            <button onClick={() => { setNavEdit(false); setNavAddOpen(false) }} className="text-[10px] px-1 py-0.5 titlebar-nodrag" style={{ color: 'var(--jt-ink-3)' }}
              onMouseEnter={hover} onMouseLeave={leave}>{t('完成', 'Done')}</button>
          </>
        ) : (
          <button onClick={() => setNavEdit(true)} title={t('自定义活动栏', 'Customize activity bar')}
            className="w-10 h-10 rounded-lg grid place-items-center mt-auto titlebar-nodrag"
            style={{ color: 'var(--jt-ink-4)' }}
            onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" d={ICONS.dots} /></svg>
          </button>
        )}
        {navAddOpen && (
          <div className="absolute left-[68px] top-24 z-50 w-[240px] rounded-xl p-2.5 titlebar-nodrag"
            style={{ background: 'var(--jt-paper)', border: '1px solid var(--jt-hairline)', boxShadow: '0 10px 32px rgba(0,0,0,.12)' }}>
            <div className="text-[10.5px] mb-2 px-1" style={{ color: 'var(--jt-ink-3)' }}>{t('点击添加到活动栏', 'Click to add to activity bar')}</div>
            <div className="grid grid-cols-2 gap-x-2 max-h-[300px] overflow-y-auto scrollbar-thin">
              {NAV_CATALOG.filter(c => !nav.includes(c.key)).map(c => (
                <button key={c.key} onClick={() => addNav(c.key)}
                  className="flex items-center gap-1.5 py-1.5 px-1.5 rounded-md text-left text-[11.5px] transition-colors"
                  style={{ color: 'var(--jt-ink-2)' }} onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d={c.icon} /></svg>
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            </div>
            {NAV_CATALOG.filter(c => !nav.includes(c.key)).length === 0 && (
              <div className="text-[10.5px] px-1 py-1" style={{ color: 'var(--jt-ink-3)' }}>{t('全部页面都已在活动栏', 'All pages are in the activity bar')}</div>
            )}
          </div>
        )}
        {collapsed && (
          <button onClick={onExpand} title={t('展开侧栏', 'Expand sidebar')}
            className="w-8 h-8 rounded-lg grid place-items-center mt-2 titlebar-nodrag"
            style={{ color: 'var(--jt-ink-2)' }}
            onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
      {/* 320px 会话栏（收起时隐藏，只留活动栏） */}
      {!collapsed && <div className="shrink-0 flex flex-col h-full" style={{ width: 320, borderRight: '1px solid var(--jt-hairline-soft)' }}>
        <div className="h-[76px] flex items-end justify-between px-5 pb-3 shrink-0 titlebar-drag">
          <div className="relative titlebar-nodrag">
            <button onClick={() => setModeOpen(v => !v)} className="text-[16px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--jt-ink)' }}
              title={t('切换工作 / 编程模式', 'Switch Office / Coding mode')}>
              {t('巨天', 'Jutian')}
              <span className="text-[11px] font-normal px-1.5 py-0.5 rounded" style={{ color: chatMode === 'coding' ? '#2563eb' : 'var(--jt-ink-2)', background: chatMode === 'coding' ? 'rgba(37,99,235,.08)' : 'var(--jt-paper-alt)' }}>
                {chatMode === 'coding' ? t('编程', 'Coding') : t('工作', 'Work')}
              </span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="var(--jt-ink-3)" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.chevron} /></svg>
            </button>
            {modeOpen && (
              <div className="absolute left-0 top-8 z-30 w-52 rounded-xl py-1.5" style={{ background: 'var(--jt-paper)', border: '1px solid var(--jt-hairline-soft)', boxShadow: '0 8px 28px rgba(0,0,0,.10)' }}>
                {([['general', t('工作模式', 'Work mode'), t('办公 · 写作 · 日常任务', 'Office · writing · daily tasks'), ICONS.docs],
                   ['coding', t('编程模式', 'Coding mode'), t('代码 · 终端 · diff', 'Code · terminal · diff'), ICONS.box]] as const).map(([m, label, desc, icon]) => (
                  <button key={m} onClick={() => switchMode(m)} className="w-full flex items-start gap-2.5 px-3 py-2 text-left rounded-lg"
                    style={{ background: chatMode === m ? 'var(--jt-focus)' : 'transparent' }}
                    onMouseEnter={hover} onMouseLeave={leave}>
                    <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={chatMode === m ? 'var(--jt-ink)' : 'var(--jt-ink-3)'} strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium" style={{ color: 'var(--jt-ink)' }}>{label}</span>
                      <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--jt-ink-3)' }}>{desc}</span>
                    </span>
                    {chatMode === m && <svg className="w-3.5 h-3.5 ml-auto mt-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="var(--jt-ink)" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                  </button>
                ))}
                <div className="h-px my-1" style={{ background: 'var(--jt-hairline-soft)' }} />
                <button onClick={() => { setModeOpen(false); onHome() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] rounded-lg" style={{ color: 'var(--jt-ink-2)' }}
                  onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.logo} /></svg>
                  {t('回到首页', 'Back to home')}
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 titlebar-nodrag">
            <button title={t('搜索', 'Search')} onClick={onSearch} className="w-8 h-8 rounded-md grid place-items-center" style={{ color: 'var(--jt-ink-3)' }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.search} /></svg>
            </button>
            <button title={t('收起侧栏', 'Collapse')} onClick={onCollapse} className="w-8 h-8 rounded-md grid place-items-center" style={{ color: 'var(--jt-ink-3)' }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.panel} /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <button onClick={onCreate} className={row} style={{ color: 'var(--jt-ink)', marginBottom: 18 }} onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.pencil} /></svg>
            {t('新对话', 'New chat')}
          </button>
          <div className="px-2 mb-2 text-[11px] font-medium" style={muted}>{t('最近', 'Recents')}</div>
          {recents.map((s, i) => (
            <button key={s.id} onClick={() => onSelect(s.id)}
              onContextMenu={e => { e.preventDefault(); setCtx({ id: s.id, title: s.title || '', x: e.clientX, y: e.clientY }) }}
              className={row}
              style={{ color: s.id === activeId ? 'var(--jt-ink)' : 'var(--jt-ink-2)', background: s.id === activeId ? 'var(--jt-focus)' : 'transparent' }}
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
            <button key={p} onClick={() => onOpenTab('files')} className={row} style={{ color: 'var(--jt-ink-2)' }} onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.folder} /></svg>
              {p}
            </button>
          ))}
          {/* 功能入口（Codex 骨架下不显示原侧栏图标行，这里补纯文字快捷入口） */}
          <div className="px-2 mt-7 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium" style={muted}>{t('工作区', 'Workspace')}</span>
            <button onClick={() => setAddOpen(v => !v)} title={t('添加 / 移除入口', 'Add / remove entries')}
              className="text-[11px] px-1.5 py-0.5 rounded transition-colors" style={{ color: addOpen ? 'var(--jt-ink)' : 'var(--jt-ink-3)', background: addOpen ? 'var(--jt-focus)' : 'transparent' }}
              onMouseEnter={hover} onMouseLeave={leave}>{addOpen ? t('完成', 'Done') : t('+ 添加', '+ Add')}</button>
          </div>
          {/* 自定义入口（v15.8.0）：设置固定首位不可移除，其余 hover 出 × 可移除 */}
          {pins.map(type => {
            const meta = PAGE_META[type]
            const label = lang === 'en' && meta?.labelEn ? meta.labelEn : (meta?.label || type)
            const fixed = type === 'settings'
            return (
              <div key={type} className="group relative">
                <button onClick={() => onOpenTab(type)} className={row + ' w-full'} style={{ color: activeType === type ? 'var(--jt-ink)' : 'var(--jt-ink-2)', background: activeType === type ? 'var(--jt-focus)' : 'transparent' }}
                  onMouseEnter={hover} onMouseLeave={leave}>
                  <span className="text-[11px] w-4 text-center" style={muted}>·</span>
                  <span className="flex-1 truncate text-left">{label}</span>
                  {addOpen && !fixed && (
                    <span onClick={e => { e.stopPropagation(); removePin(type) }}
                      className="w-5 h-5 rounded grid place-items-center text-[11px] shrink-0 transition-colors"
                      style={{ color: 'var(--jt-ink-4)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#c7000b'; e.currentTarget.style.background = 'var(--jt-focus)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--jt-ink-4)'; e.currentTarget.style.background = 'transparent' }}
                      title={t('从侧栏移除', 'Remove from sidebar')}>×</span>
                  )}
                  {addOpen && fixed && <span className="text-[9.5px] shrink-0 px-1 py-0.5 rounded" style={{ color: 'var(--jt-ink-3)', background: 'var(--jt-focus)' }}>{t('固定', 'Pinned')}</span>}
                </button>
              </div>
            )
          })}
          {/* 添加面板：全部可用页面（已添加的排除），纯文字两列 */}
          {addOpen && (
            <div className="mt-2 rounded-xl p-2.5" style={{ background: 'var(--jt-paper-alt)', border: '1px solid var(--jt-hairline-soft)' }}>
              <div className="text-[10.5px] mb-2 px-1" style={muted}>{t('点击添加到侧栏', 'Click to add to sidebar')}</div>
              <div className="grid grid-cols-2 gap-x-2">
                {RAIL_ADDABLE.filter(t => !pins.includes(t)).map(type => {
                  const meta = PAGE_META[type]
                  const label = lang === 'en' && meta?.labelEn ? meta.labelEn : (meta?.label || type)
                  return (
                    <button key={type} onClick={() => addPin(type)}
                      className="flex items-center gap-1.5 py-1.5 px-1.5 rounded-md text-left text-[11.5px] transition-colors"
                      style={{ color: 'var(--jt-ink-2)' }}
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
      </div>}
      {ctx && (
        <div className="fixed z-50 rounded-xl py-1.5 min-w-[160px]" style={{ left: ctx.x, top: ctx.y, background: 'var(--jt-paper)', border: '1px solid var(--jt-hairline)', boxShadow: '0 8px 28px rgba(0,0,0,.14)' }} onContextMenu={e => e.preventDefault()}>
          <button onClick={() => { const val = prompt(t('重命名对话', 'Rename chat'), ctx.title); if (val && val.trim() && onRename) onRename(ctx.id, val.trim()); setCtx(null) }}
            className="w-full text-left px-3 py-2 text-[12.5px] rounded-lg" style={{ color: 'var(--jt-ink-2)' }}
            onMouseEnter={hover} onMouseLeave={leave}>{t('重命名', 'Rename')}</button>
          <button onClick={() => { if (confirm(t('确定删除这个对话？不可恢复。', 'Delete this chat? This cannot be undone.')) && onDelete) onDelete(ctx.id); setCtx(null) }}
            className="w-full text-left px-3 py-2 text-[12.5px] rounded-lg" style={{ color: '#c7000b' }}
            onMouseEnter={hover} onMouseLeave={leave}>{t('删除', 'Delete')}</button>
        </div>
      )}
    </>
  )
}
