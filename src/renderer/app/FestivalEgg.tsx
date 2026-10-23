/**
 * 1024 彩蛋弹层（v12.3）
 *
 * 亮色液态玻璃，与全站一致。内容来自 shared/festival1024（可测），
 * 统计数字在打开时实时取，不写死。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { eggCards } from '../../shared/festival1024'

export default function FestivalEgg({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [stats, setStats] = useState<{ toolCount: number; sessionCount: number; daysUsed: number }>({
    toolCount: 0, sessionCount: 0, daysUsed: 0,
  })

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const [toolsRes, sessRes] = await Promise.all([
          fetch('/api/tools').then((r) => r.json()).catch(() => null),
          fetch('/api/sessions').then((r) => r.json()).catch(() => null),
        ])
        if (dead) return
        const toolCount = Array.isArray(toolsRes?.tools) ? toolsRes.tools.length : 0
        const sessions = Array.isArray(sessRes) ? sessRes : []
        // 使用天数：最早会话到今天，至少算 1 天
        let daysUsed = 1
        const times = sessions
          .map((s: any) => new Date(s?.created_at || 0).getTime())
          .filter((t: number) => Number.isFinite(t) && t > 0)
        if (times.length) {
          const earliest = Math.min(...times)
          daysUsed = Math.max(1, Math.ceil((Date.now() - earliest) / 86400000))
        }
        setStats({ toolCount, sessionCount: sessions.length, daysUsed })
      } catch { /* 取不到就用 0，卡片里有兜底文案 */ }
    })()
    return () => { dead = true }
  }, [])

  const cards = useMemo(() => eggCards(stats), [stats])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-6"
      style={{ background: 'rgba(20,20,24,.28)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] max-h-[86vh] overflow-y-auto scrollbar-thin rounded-2xl p-6 animate-fade-in"
        style={{
          background: 'rgba(255,255,255,.82)',
          border: '1px solid rgba(255,255,255,.6)',
          boxShadow: '0 24px 70px rgba(0,0,0,.18)',
          backdropFilter: 'blur(28px) saturate(1.6)',
        }}>
        {/* 顶部：1024 大字 */}
        <div className="flex items-center gap-3 mb-5">
          <div className="text-[34px] font-bold tracking-tight leading-none"
            style={{ color: c.textHead, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>
            1024
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium" style={{ color: c.textHead }}>程序员节快乐</div>
            <div className="text-[10.5px] font-mono" style={{ color: c.textTertiary }}>0x400 · 2^10</div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg grid place-items-center transition-colors"
            style={{ color: c.textTertiary }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,.05)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            aria-label="关闭">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {cards.map((card, i) => (
            <div key={card.id} className="rounded-xl px-4 py-3.5"
              style={{
                background: 'rgba(255,255,255,.55)',
                border: '1px solid rgba(0,0,0,.05)',
                animationDelay: `${i * 70}ms`,
              }}>
              <div className="text-[12.5px] font-semibold mb-1" style={{ color: c.textHead }}>{card.title}</div>
              <div className="text-[12px] leading-[1.7]" style={{ color: c.textSecondary }}>{card.body}</div>
              {card.mono && (
                <div className="mt-2 text-[10px] font-mono break-all" style={{ color: c.textTertiary }}>{card.mono}</div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 text-center text-[10.5px]" style={{ color: c.textTertiary }}>
          这个彩蛋不会自动弹出来，只有你主动点开才看得到
        </div>
      </div>
    </div>
  )
}
