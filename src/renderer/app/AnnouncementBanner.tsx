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

  return (
    <div className="relative flex items-start gap-3 px-4 py-2.5 border-b" style={{ background: s.bg, borderColor: c.borderLight }}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: s.bar }} />
      <svg className="mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={s.bar} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={s.icon} />
      </svg>
      <div className="min-w-0 flex-1 text-[12.5px]" style={{ color: c.textHead }}>
        <div className="font-bold">{ann.title}{ann.date && <span className="ml-2 font-normal opacity-50 text-[11px]">{ann.date}</span>}</div>
        {ann.body && <div className="mt-1 text-[12px] opacity-90" style={{ color: c.textTertiary }}><NoticeBody text={ann.body} /></div>}
      </div>
      <button
        onClick={() => { dismiss(ann.id); setAnn(null) }}
        className="shrink-0 w-6 h-6 rounded-md grid place-items-center transition-colors hover:bg-black/5"
        style={{ color: c.textTertiary }} aria-label="关闭公告">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
