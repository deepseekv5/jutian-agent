import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'
import { BUILTIN_TOOLS } from '../types'
import { useEffect, useState } from 'react'
import { getRegisteredExts, subscribeExts, extType } from './extensions'
import NewTabSearch from './NewTabSearch'
import { festivalBanner, nextTapCount } from '../../shared/festival1024'
import { loadFavorites, type Favorite } from '../store/favorites'
import FestivalEgg from './FestivalEgg'
import FestivalHome from './FestivalHome'

// 工具数从 schema 派生：新增工具时这里不用跟着改
// （此前硬编码 "39 个工具"，加工具就得记得改文案，必然漂移）
const TOOL_COUNT = BUILTIN_TOOLS.length

// 新建标签页：点 Tab 栏 + 后打开的页面，列出全部工作区入口。
// 学 clerkbox 官网的展示结构：定位语 hero → 徽章亮点 → 分组能力卡；
// 每张卡都带「这是什么 / 能干嘛」介绍，用户不用猜。
// 保持应用自身的白色极简 + 液态玻璃审美，不引入外部素材与文案。

// CARDS / GROUPS 已抽到 pageCatalog.ts（v15.8.4）：CodexHome「全部功能」折叠区共用同一份数据
import { CARDS, GROUPS } from './pageCatalog'

export default function NewTabPage({ onPick, sessions = [] }: { onPick: (t: PageType) => void; sessions?: { id: string; title?: string; updated_at?: string; created_at?: string }[] }) {
  const [exts, setExts] = useState(getRegisteredExts)
  useEffect(() => subscribeExts(() => setExts(getRegisteredExts())), [])
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const byType = new Map(CARDS.map(k => [k.type, k]))
  const now = new Date()
  const festivalNow = now.getMonth() === 9 && now.getDate() >= 20 && now.getDate() <= 28
  const [eggOpen, setEggOpen] = useState(false)
  const [tap, setTap] = useState({ count: 0, lastAt: 0 })
  const [askText, setAskText] = useState('')
  const submitAsk = () => {
    const v = askText.trim()
    if (!v) return
    // App 接此事件：新建会话 → 会话挂载后把文字填进 composer
    window.dispatchEvent(new CustomEvent('jutian-minimal-ask', { detail: v }))
    setAskText('')
  }
  const banner = festivalBanner()
  const onBadgeTap = () => {
    const r = nextTapCount(tap)
    setTap({ count: r.count, lastAt: r.lastAt })
    if (r.fired) { setEggOpen(true); setTap({ count: 0, lastAt: 0 }) }
  }
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const todaySessions = sessions.filter(x => String(x.updated_at || x.created_at || '') >= dayStart.toISOString()).length
  const [favs, setFavs] = useState<Favorite[]>(loadFavorites)
  const [showAllFavs, setShowAllFavs] = useState(false)
  const [favHintClosed, setFavHintClosed] = useState(() => { try { return localStorage.getItem('lyclaw_fav_hint_done') === '1' } catch { return false } })
  useEffect(() => {
    const h = () => setFavs(loadFavorites())
    window.addEventListener('favorites-changed', h)
    return () => window.removeEventListener('favorites-changed', h)
  }, [])

  if (festivalNow) return <FestivalHome onPick={onPick} />

  const label = (type: PageType) => {
    const meta = PAGE_META[type] || { label: '扩展', labelEn: 'Extension' }
    return lang === 'en' && meta.labelEn ? meta.labelEn : meta.label
  }
  const muted = { color: c.textMuted, fontSize: 10.5 }
  const sec = { color: c.textTertiary, fontSize: 11, fontWeight: 500 } as const

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto px-8" style={{ maxWidth: 720, paddingTop: 80, paddingBottom: 72 }}>

        {/* 一句大字 */}
        <h1 className="text-center font-medium tracking-tight"
          style={{ color: c.textHead, fontSize: 32, letterSpacing: '-0.035em', lineHeight: 1.35 }}>
          {t('今天想做点什么？', 'What should we build?')}
        </h1>

        {/* 唯一输入框：新建对话并把文字带进 composer */}
        <div className="mt-8 rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
          <input
            value={askText}
            onChange={e => setAskText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAsk() } }}
            placeholder={t('输入一句话开始，回车新建对话…', 'Type to start a new chat…')}
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{ color: c.text }}
            aria-label={t('新建对话', 'New chat')}
          />
          <button onClick={submitAsk} className="w-7 h-7 rounded-lg grid place-items-center shrink-0 transition-colors"
            style={{ background: askText.trim() ? c.accent : c.bgHover, color: askText.trim() ? '#fff' : c.textTertiary }}
            title={t('新建对话', 'New chat')} aria-label={t('新建对话', 'New chat')}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* 概览：纯文字一行（统计一个不少） */}
        <div className="mt-5 flex items-center justify-center gap-6" style={muted}>
          <span>{t('今日会话', 'Chats today')} {todaySessions}</span>
          <span>{t('收藏', 'Favorites')} {favs.length}</span>
          <span>{t('速记', 'Quick notes')} {sessions.filter(x => x.title === '速记').length}</span>
          <span style={{ color: c.textTertiary }}>{lang === 'en' ? 'Have a productive day.' : '今天也请多指教。'}</span>
        </div>

        {/* 全局搜索（页面/扩展/会话/消息，回车打开） */}
        <div className="mt-12 jt-codex-search">
          <NewTabSearch cards={CARDS} onPickPage={onPick} />
        </div>

        {/* 最近会话：纯文字列表，点击直达 */}
        {sessions.length > 0 && (
          <section className="mt-9">
            <div className="mb-2" style={sec}>{t('最近', 'Recents')}</div>
            {(showAllFavs ? sessions.slice(0, 30) : sessions.slice(0, 6)).map(s => (
              <button key={s.id} onClick={() => window.dispatchEvent(new CustomEvent('newtab-open-session', { detail: { sessionId: s.id } }))}
                className="w-full text-left py-1.5 text-[12.5px] truncate transition-colors jt-text-row"
                style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                {s.title || t('新对话', 'New chat')}
              </button>
            ))}
            {sessions.length > 6 && (
              <button onClick={() => setShowAllFavs(v => !v)} className="text-[10.5px] mt-1" style={{ color: c.textTertiary, background: 'transparent', border: 'none' }}>
                {showAllFavs ? t('收起', 'Less') : `${t('全部', 'All')} (${sessions.length})`}
              </button>
            )}
          </section>
        )}

        {/* 收藏：文字列表 + 展开/收起/导出/空态引导（能力全保留） */}
        <section className="mt-9">
          <div className="flex items-center gap-3 mb-2">
            <span style={sec}>{t('收藏的消息', 'Favorites')}</span>
            <span style={muted}>{favs.length}</span>
            {favs.length > 0 && (
              <>
                {favs.length > 5 && (
                  <button onClick={() => setShowAllFavs(v => !v)} className="text-[10.5px]" style={{ color: c.textTertiary, background: 'transparent', border: 'none' }}>
                    {showAllFavs ? t('收起', 'Less') : t('全部', 'All')}
                  </button>
                )}
                <button onClick={() => {
                  const md = favs.map(f => `- [${f.role === 'user' ? '问' : '答'}] ${f.excerpt.replace(/\n/g, ' ')}`).join('\n')
                  const blob = new Blob([`# 收藏的消息\n\n${md}\n`], { type: 'text/markdown' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `jutian-favorites-${new Date().toISOString().slice(0, 10)}.md`
                  a.click(); URL.revokeObjectURL(a.href)
                }} className="text-[10.5px]" style={{ color: c.accent, background: 'transparent', border: 'none' }}>{t('导出', 'Export')}</button>
              </>
            )}
            {favs.length === 0 && !favHintClosed && (
              <button onClick={() => { setFavHintClosed(true); try { localStorage.setItem('lyclaw_fav_hint_done', '1') } catch {} }}
                className="text-[10.5px]" style={{ color: c.textTertiary, background: 'transparent', border: 'none' }}>{t('知道了', 'Got it')}</button>
            )}
          </div>
          {favs.length === 0 ? (
            !favHintClosed && <div className="text-[11.5px]" style={{ color: c.textTertiary }}>{t('聊天时点消息下方的 ★ 即可收藏，收藏会显示在这里。', 'Tap ★ under any message to keep it here.')}</div>
          ) : (
            <div>
              {(showAllFavs ? favs : favs.slice(0, 5)).map(f => (
                <button key={f.id} onClick={() => window.dispatchEvent(new CustomEvent('jutian-open-favorite', { detail: f }))}
                  className="w-full flex items-center gap-2 py-1.5 text-left jt-text-row"
                  style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                  <span className="text-[12px] truncate flex-1">{f.excerpt}</span>
                  <span className="text-[10px] shrink-0" style={muted}>{sessions.find(x => x.id === f.sessionId)?.title?.slice(0, 10) || (f.role === 'user' ? '问' : '答')}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 全部工作区入口：8 组纯文字列表（31 项一个不少，纵向堆叠不重叠） */}
        <section className="mt-9">
          <div className="flex items-center gap-3 mb-2">
            <span style={sec}>{t('工作区入口', 'Workspace')}</span>
            <span style={muted}>{CARDS.length}</span>
            <div className="flex-1 h-px" style={{ background: c.borderLight }} />
            <span style={muted}>{t('点击直达', 'Click to open')}</span>
          </div>
          {GROUPS.map(g => (
            <div key={g.label} className="mt-4">
              <div className="mb-1.5" style={muted}>{lang === 'en' ? g.labelEn : g.label}</div>
              <div>
                {g.items.map(type => {
                  const card = byType.get(type)
                  return (
                    <button key={type} onClick={() => onPick(type)}
                      className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
                      style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                      <span className="text-[12.5px] shrink-0">{label(type)}</span>
                      {card && <span className="text-[10.5px] truncate" style={muted}>{lang === 'en' ? card.descEn : card.desc}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>

        {/* 写公文 / 内核切换：纯文字行，能力不变 */}
        <section className="mt-9">
          <div className="mb-1.5" style={muted}>{t('快捷', 'Quick actions')}</div>
          <button onClick={() => onPick('gongwen')}
            className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
            style={{ color: '#c7000b', background: 'transparent', border: 'none' }}>
            <span className="text-[12.5px] shrink-0">{t('写公文', 'Write official documents')}</span>
            <span className="text-[10.5px] truncate" style={muted}>{t('通知 · 请示 · 报告 · 批复 · 函 · 纪要 — GB/T 9704', 'Notices · Requests · Reports — GB/T 9704')}</span>
          </button>
          <button onClick={() => {
            try {
              const raw = localStorage.getItem('lyclaw_settings'); const st = raw ? JSON.parse(raw) : {}
              const next = (st.agentEngine || 'vercel') === 'ultra' ? 'server' : 'ultra'
              st.agentEngine = next
              localStorage.setItem('lyclaw_settings', JSON.stringify(st))
              fetch('/api/agent/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: next }) }).catch(() => {})
              window.dispatchEvent(new CustomEvent('settings-updated', { detail: st }))
            } catch {}
          }} className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
            style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
            <span className="text-[12.5px] shrink-0">{t('切换内核', 'Switch kernel')}</span>
            <span className="text-[10.5px] truncate" style={muted}>{t('JT Core Pro+ / Ultra（composer 状态条、命令面板也可切换）', 'JT Core Pro+ / Ultra')}</span>
          </button>
          <button onClick={() => onPick('plugins')} className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
            style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
            <span className="text-[12.5px] shrink-0">{t('插件市场', 'Plugin market')}</span>
            <span className="text-[10.5px]" style={muted}>{t('LY HARNESS 插件中心', 'LY HARNESS')}</span>
          </button>
        </section>

        {/* 我的扩展：纯文字列表 */}
        {exts.length > 0 && (
          <section className="mt-9">
            <div className="mb-1.5" style={muted}>{t('我的扩展', 'My extensions')} · {exts.length}</div>
            {exts.map(e => (
              <button key={e.id} onClick={() => onPick(extType(e.id) as PageType)}
                className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
                style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                <span className="text-[12.5px] shrink-0">{e.name || e.id}</span>
                {e.description && <span className="text-[10.5px] truncate" style={muted}>{e.description}</span>}
              </button>
            ))}
          </section>
        )}

        {/* 1024 彩蛋入口：低调一行文字，功能保留 */}
        {banner && (
          <button onClick={banner.active ? onBadgeTap : () => setEggOpen(true)}
            className="w-full text-center text-[10.5px] mt-12 py-2"
            style={{ color: c.textMuted, background: 'transparent', border: 'none' }}>
            {banner.title} · {banner.subtitle}
          </button>
        )}
      </div>
      {eggOpen && <FestivalEgg onClose={() => setEggOpen(false)} />}
    </div>
  )
}
