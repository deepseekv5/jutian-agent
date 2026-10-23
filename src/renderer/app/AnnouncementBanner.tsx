/**
 * AnnouncementBanner — 应用公告横幅（v11.7）
 *
 * 来源：GitHub 仓库 docs/notice.md（serve.ts 缓存 6h，/api/announcement）。
 * 行为按需求「每次进入应用自动读取显示」：已读状态记在 sessionStorage——
 * 同一次运行内关掉不再打扰，下次冷启动会重新显示（公告就是要让人看到）；
 * 换新公告（id 不同）运行中也会立刻弹出。
 *
 * 渲染只认最朴素的 markdown 子集（标题行/列表/空行），
 * 引 react-markdown 会把重依赖拖进首屏 chunk（vite 懒加载坑，见记忆）。
 */
import { useEffect, useState } from 'react'
import type { Announcement } from '../../shared/announcement'
import { useTheme } from '../hooks/useTheme'
import { fetchCompat } from '../api'

const READ_KEY = 'jutian-announcement-read'

function readDismissedId(): string {
  // sessionStorage（非 local）：重启应用后重新显示 = 「每次进入自动读取显示」
  try { return sessionStorage.getItem(READ_KEY) || '' } catch { return '' }
}
function dismiss(id: string) {
  try { sessionStorage.setItem(READ_KEY, id) } catch { /* ignore */ }
}

const LEVEL_STYLE: Record<Announcement['level'], { bar: string; bg: string; icon: string }> = {
  info: { bar: '#10a37f', bg: 'rgba(16,163,127,.08)', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  warn: { bar: '#f59e0b', bg: 'rgba(245,158,11,.09)', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  critical: { bar: '#ef4444', bg: 'rgba(239,68,68,.08)', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
}

/** 公告正文按行渲染：**加粗** 用轻量替换，不引 markdown 库 */
function NoticeBody({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((l, i) => {
        const t = l.trim()
        if (!t) return null
        const isItem = /^[-•]\s+/.test(t)
        const clean = t.replace(/^[-•]\s+/, '')
        const parts = clean.split(/\*\*(.+?)\*\*/g)
        const node = parts.length > 1
          ? parts.map((p, j) => j % 2 === 1 ? <b key={j}>{p}</b> : <span key={j}>{p}</span>)
          : clean
        return (
          <span key={i} className="block leading-[1.65]">
            {isItem && <span className="opacity-50 mr-1">·</span>}{node}
          </span>
        )
      })}
    </>
  )
}

export default function AnnouncementBanner() {
  const { c } = useTheme()
  const [ann, setAnn] = useState<Announcement | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let dead = false
    fetchCompat('/api/announcement')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (dead || !d?.announcement) return
        if (d.announcement.id === readDismissedId()) return
        setAnn(d.announcement)
      })
      .catch(() => { /* 拿不到就当没公告 */ })
    return () => { dead = true }
  }, [])

  if (!ann) return null
  const s = LEVEL_STYLE[ann.level]
  const hasBody = !!ann.body.trim()

  // 折叠态只占一行（约 32px）：公告是"告知"，不该长期占据主操作区。
  // 点击标题行展开全文，再点收起——展开状态不持久化，每次进来都是收起态。
  return (
    <div className="border-b" style={{ background: s.bg, borderColor: c.borderLight }}>
      <div className="flex items-center gap-2 px-4 h-8 cursor-pointer select-none"
        onClick={() => hasBody && setExpanded(v => !v)}
        role={hasBody ? 'button' : undefined}
        aria-expanded={hasBody ? expanded : undefined}
        title={hasBody ? (expanded ? '收起' : '展开公告') : undefined}>
        <span className="w-[3px] h-3 rounded-full shrink-0" style={{ background: s.bar }} />
        <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={s.bar} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d={s.icon} />
        </svg>
        <span className="text-[11.5px] font-medium truncate min-w-0 flex-1" style={{ color: c.textHead }}>{ann.title}</span>
        {ann.date && <span className="text-[10px] shrink-0" style={{ color: c.textTertiary }}>{ann.date}</span>}
        {hasBody && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth={2.2}
            strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(ann.id); setAnn(null) }}
          className="shrink-0 w-5 h-5 rounded grid place-items-center transition-colors"
          style={{ color: c.textTertiary }} aria-label="关闭公告"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,.06)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {expanded && hasBody && (
        <div className="px-4 pb-3 pl-[26px] text-[11.5px] leading-[1.7]" style={{ color: c.textSecondary || c.textTertiary }}>
          <NoticeBody text={ann.body} />
        </div>
      )}
    </div>
  )
}
