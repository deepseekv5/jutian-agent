import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { PageType } from './TabBar'

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

interface Props {
  sessions: SessionLite[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onOpenTab: (type: PageType) => void
  onAsk: (text: string) => void
  onSearch: () => void
  onCollapse: () => void
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const d = Date.now() - new Date(iso).getTime()
  if (d < 3600e3) return `${Math.max(1, Math.round(d / 60e3))}m`
  if (d < 86400e3) return `${Math.round(d / 3600e3)}h`
  return `${Math.round(d / 86400e3)}d`
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

export default function CodexShell({ sessions, activeId, onSelect, onCreate, onOpenTab, onAsk, onSearch, onCollapse }: Props) {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState('')
  const [activeNav, setActiveNav] = useState<string>('logo')

  const recents = sessions.slice(0, expanded ? 18 : 8)
  const shortName = (p?: string) => {
    if (!p) return ''
    const seg = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
    return seg.length > 14 ? seg.slice(0, 13) + '…' : seg
  }
  const projects = [...new Set(sessions.map(s => shortName(s.project)).filter(Boolean) as string[])].slice(0, 4)
  const ask = () => { const v = text.trim(); if (v) { onAsk(v); setText('') } }

  const navItems: { key: string; icon: string; title: string; page?: PageType }[] = [
    { key: 'logo', icon: ICONS.logo, title: 'JT Core' },
    { key: 'clock', icon: ICONS.clock, title: t('历史', 'History'), page: 'diary' },
    { key: 'docs', icon: ICONS.docs, title: t('文档', 'Docs'), page: 'docs' },
    { key: 'box', icon: ICONS.box, title: t('技能', 'Skills'), page: 'skills' },
    { key: 'dots', icon: ICONS.dots, title: t('更多', 'More'), page: 'shortcuts' },
  ]

  const muted = { color: '#9a9a9a' }
  const row = 'w-full flex items-center gap-2.5 py-[7px] text-[13.5px] rounded-md px-2 transition-colors text-left'
  const hover = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = '#f4f4f4' }
  const leave = (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent' }

  return (
    <div className="flex h-full w-full" style={{ background: '#fff', color: '#111' }}>
      {/* ── 64px 活动栏 ── */}
      <div className="shrink-0 flex flex-col items-center pb-3 gap-1 titlebar-drag" style={{ width: 64, background: '#fafafa', paddingTop: 76 }}>
        {navItems.map((n, i) => (
          <div key={n.key} className="contents">
            {i === 4 && <div className="w-6 h-px my-1" style={{ background: '#e5e5e5' }} />}
            <button title={n.title} onClick={() => { setActiveNav(n.key); if (n.page) onOpenTab(n.page) }}
              className="w-10 h-10 rounded-lg grid place-items-center transition-colors"
              style={{ color: activeNav === n.key ? '#111' : '#8b8b8b', background: activeNav === n.key ? '#eee' : 'transparent' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-[19px] h-[19px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d={n.icon} />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* ── 320px 会话栏 ── */}
      <div className="shrink-0 flex flex-col h-full" style={{ width: 320, borderRight: '1px solid #f0f0f0' }}>
        {/* 标题行 */}
        <div className="h-[76px] flex items-end justify-between px-5 pb-3 shrink-0 titlebar-drag">
          <button onClick={onCreate} className="text-[16px] font-semibold flex items-center gap-1.5" style={{ color: '#111' }}>
            {t('巨天', 'Jutian')}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#888" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.chevron} /></svg>
          </button>
          <div className="flex items-center gap-1">
            <button title={t('搜索', 'Search')} onClick={onSearch}
              className="w-8 h-8 rounded-md grid place-items-center" style={{ color: '#8b8b8b' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.search} /></svg>
            </button>
            <button title={t('收起侧栏', 'Collapse')} onClick={onCollapse}
              className="w-8 h-8 rounded-md grid place-items-center" style={{ color: '#8b8b8b' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.panel} /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-6">
          {/* New chat */}
          <button onClick={onCreate} className={row} style={{ color: '#111', marginBottom: 18 }} onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.pencil} /></svg>
            {t('新对话', 'New chat')}
          </button>

          {/* Recents */}
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
            <button onClick={() => setExpanded(v => !v)} className="w-full text-left px-2 py-2 text-[11px]" style={muted}
              onMouseEnter={hover} onMouseLeave={leave}>
              {expanded ? t('收起', 'Show less') : t('显示更多', 'Show more')}
            </button>
          )}

          {/* Projects */}
          <div className="px-2 mt-7 mb-2 text-[11px] font-medium" style={muted}>{t('项目', 'Projects')}</div>
          {(projects.length ? projects : ['iOS', 'Miniapp', 'Superapp']).map(p => (
            <button key={p} onClick={() => onOpenTab('files')} className={row} style={{ color: '#3d3d3d' }}
              onMouseEnter={hover} onMouseLeave={leave}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.folder} /></svg>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ── 主区 ── */}
      <div className="flex-1 min-w-0 flex flex-col relative" style={{ background: '#fff' }}>
        {/* 窗口右上：返回/前进 + 新建（参考图的窗口导航区） */}
        <div className="absolute top-0 right-0 h-[76px] flex items-center gap-1 px-6 z-10 titlebar-nodrag">
          <button onClick={() => window.history.back()} className="w-7 h-7 rounded-md grid place-items-center" style={{ color: '#a0a0a0' }}
            title={t('后退', 'Back')} onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => window.history.forward()} className="w-7 h-7 rounded-md grid place-items-center" style={{ color: '#c8c8c8' }}
            title={t('前进', 'Forward')} onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </button>
          <button onClick={onCreate} className="w-7 h-7 rounded-md grid place-items-center ml-2" style={{ color: '#8b8b8b' }}
            title={t('新建对话', 'New chat')} onMouseEnter={hover} onMouseLeave={leave}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" d={ICONS.plus} /></svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8" style={{ paddingBottom: 40 }}>
          <CodexMark size={54} />
          <h1 className="mt-4 font-normal" style={{ fontSize: 34, letterSpacing: '-.035em', color: '#111' }}>
            {t('今天想做点什么？', 'What should we build?')}
          </h1>

          {/* 三条建议（彩色小图标） */}
          <div className="mt-14 w-full" style={{ maxWidth: 570, marginLeft: 'auto', marginRight: 'auto' }}>
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

        {/* 输入框：外壳 #f2f2f2，内芯白色 */}
        <div className="mx-auto mb-8 w-full" style={{ maxWidth: 820, padding: '0 24px', marginLeft: 'auto', marginRight: 'auto' }}>
          <div className="rounded-[26px] overflow-hidden" style={{ background: '#f2f2f2', padding: 8 }}>
            <div className="rounded-[20px]" style={{ background: '#fff', border: '1px solid #ececec' }}>
              {/* chip 行 */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[11.5px]" style={{ color: '#8b8b8b' }}>
                <button onClick={() => onOpenTab('settings')} className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors"
                  onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.box} /></svg>
                  {t('模型', 'Model')}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d={ICONS.chevron} /></svg>
                </button>
                <button onClick={() => onOpenTab('files')} className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors"
                  onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.folder} /></svg>
                  {t('工作区', 'Workspace')}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d={ICONS.chevron} /></svg>
                </button>
              </div>
              <input value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
                placeholder={t('做任何事…', 'Do anything')}
                className="w-full bg-transparent outline-none px-5 pt-2 pb-3 text-[15px] jt-codex-input"
                style={{ color: '#111' }} />
              {/* 底行 */}
              <div className="flex items-center gap-2 px-4 pb-3">
                <button onClick={() => onOpenTab('files')} className="w-7 h-7 rounded-full grid place-items-center" style={{ color: '#555' }}
                  title={t('添加文件', 'Add file')} onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d={ICONS.plus} /></svg>
                </button>
                <span className="flex-1" />
                <button onClick={() => onOpenTab('settings')} className="text-[11.5px] px-2 py-1 rounded-md flex items-center gap-1" style={{ color: '#555' }}
                  onMouseEnter={hover} onMouseLeave={leave}>
                  {t('Astra High', 'Astra High')}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d={ICONS.chevron} /></svg>
                </button>
                <button className="w-7 h-7 rounded-full grid place-items-center" style={{ color: '#555' }}
                  title={t('语音', 'Voice')} onMouseEnter={hover} onMouseLeave={leave}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.mic} /></svg>
                </button>
                <button onClick={ask} className="w-8 h-8 rounded-full grid place-items-center transition-transform hover:scale-105"
                  style={{ background: '#111', color: '#fff' }} title={t('发送', 'Send')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d={ICONS.arrow} /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
