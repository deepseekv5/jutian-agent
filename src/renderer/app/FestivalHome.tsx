/**
 * 1024 节日主页（v12.3.1）
 *
 * 用户反馈「1024 不够隆重」，所以节日期间整页换肤，而不是只加一条横幅：
 *   · 全屏 hero：巨大 1024 + 渐变大字 + 二进制雨背景
 *   · 节日配色：琥珀金（程序员的"金色时刻"），仍保持亮色液态玻璃
 *   · 六张能力卡改为"节日版"措辞
 *   · 彩蛋入口做成显眼但克制的按钮
 *
 * 只在节日窗口内挂载；平时 NewTabPage 走原版，两套互不影响。
 */
import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'
import { nextTapCount } from '../../shared/festival1024'
import { BUILTIN_TOOLS } from '../types'

const TOOL_COUNT = BUILTIN_TOOLS.length

/** 二进制雨：canvas 绘制，低开销（每帧只画 ~40 列） */
function BinaryRain({ opacity = 0.13 }: { opacity?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let raf = 0
    let cols: { x: number; y: number; speed: number; chars: string[] }[] = []
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      const w = cv.clientWidth || 800
      const h = cv.clientHeight || 600
      cv.width = w * dpr
      cv.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const step = 26
      const n = Math.max(1, Math.floor(w / step))
      cols = Array.from({ length: n }, (_, i) => ({
        x: i * step + step / 2,
        y: Math.random() * h,
        speed: 0.35 + Math.random() * 0.9,
        chars: Array.from({ length: 12 }, () => (Math.random() > 0.5 ? '1' : '0')),
      }))
    }

    const draw = () => {
      // 页面不可见（切到其他标签/最小化）时跳过绘制但保留 rAF 循环，
      // 回到前台自动恢复——背景动画不值得在后台烧 GPU
      if (!document.hidden) {
        const w = cv.clientWidth || 800
        const h = cv.clientHeight || 600
        ctx.clearRect(0, 0, w, h)
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
        for (const c of cols) {
          c.y += c.speed
          if (c.y > h + 140) { c.y = -140; c.speed = 0.35 + Math.random() * 0.9 }
          for (let i = 0; i < c.chars.length; i++) {
            const y = c.y - i * 14
            if (y < -14 || y > h + 14) continue
            // 越靠上越淡：形成拖尾
            const a = opacity * (1 - i / c.chars.length)
            ctx.fillStyle = `rgba(180,130,20,${a.toFixed(3)})`
            ctx.fillText(c.chars[i], c.x, y)
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [opacity])

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />
}

const FESTIVAL_CARDS: { type: PageType; title: string; desc: string; tag: string }[] = [
  { type: 'chat', tag: '01', title: '让它真的动手', desc: `${TOOL_COUNT} 个工具直连你的系统——读文件、跑命令、改代码，不是只给建议。` },
  { type: 'code', tag: '02', title: '编程工作台', desc: '文件树、编辑器、终端、diff 一体。AI 改了什么，逐行看清楚再决定留不留。' },
  { type: 'research', tag: '03', title: '深度调研', desc: '多路检索、交叉验证、带引用的报告。不用再自己开十个标签页。' },
  { type: 'persona', tag: '04', title: 'AI 角色', desc: '有长期记忆的角色，能说能画。数据留在本地。' },
  { type: 'freemodels', tag: '05', title: '免费模型', desc: '不填 API Key 也能开始。26 个免费档，开箱即聊。' },
  { type: 'kb', tag: '06', title: '本地知识库', desc: '文件夹变知识库，对话时自动引用你写过的内容。' },
]

export default function FestivalHome({ onPick }: { onPick: (t: PageType) => void }) {
  const { lang, t } = useLanguage()
  const [eggOpen, setEggOpen] = useState(false)
  const [tap, setTap] = useState({ count: 0, lastAt: 0 })
  const [stats, setStats] = useState({ toolCount: TOOL_COUNT, sessionCount: 0, daysUsed: 0 })

  useEffect(() => {
    let dead = false
    fetch('/api/sessions').then((r) => r.json()).then((d) => {
      if (dead || !Array.isArray(d)) return
      const times = d.map((s: any) => new Date(s?.created_at || 0).getTime()).filter((n: number) => n > 0)
      const daysUsed = times.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...times)) / 86400000)) : 0
      setStats({ toolCount: TOOL_COUNT, sessionCount: d.length, daysUsed })
    }).catch(() => { /* 用默认值 */ })
    return () => { dead = true }
  }, [])


  const onEggTap = () => {
    const r = nextTapCount(tap)
    setTap({ count: r.count, lastAt: r.lastAt })
    if (r.fired) { setEggOpen(true); setTap({ count: 0, lastAt: 0 }) }
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin relative"
      style={{ background: 'linear-gradient(180deg, #fdfaf3 0%, #f7f6f4 42%, #f4f2ee 100%)' }}>
      <BinaryRain opacity={0.11} />

      {/* 顶部节日条 */}
      <div className="relative flex items-center justify-center gap-2 py-2 text-[10.5px] font-mono tracking-[0.18em]"
        style={{ color: '#9a7b2e' }}>
        <span>0x400</span><span style={{ opacity: 0.4 }}>·</span>
        <span>2¹⁰ = 1024</span><span style={{ opacity: 0.4 }}>·</span>
        <span>PROGRAMMER'S DAY</span>
      </div>

      <div className="relative max-w-5xl mx-auto px-6 pb-14">
        {/* Hero */}
        <div className="text-center pt-6 pb-10">
          <div className="text-[68px] sm:text-[104px] font-extrabold leading-[0.86] tracking-[-0.045em] select-none"
            style={{
              background: 'linear-gradient(170deg, #1b1a17 8%, #8a6a1f 62%, #d9a521 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontVariantNumeric: 'tabular-nums',
            }}>
            1024
          </div>
          <h1 className="mt-4 text-[21px] font-semibold tracking-tight" style={{ color: '#232320', letterSpacing: '-0.02em' }}>
            {t('程序员节快乐', 'Happy Programmer’s Day')}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed max-w-[430px] mx-auto" style={{ color: '#77756e' }}>
            {t(
              '一年里只有这一天，写代码的人可以名正言顺地为自己庆祝。不搞抽奖、不搞限时折扣——就把工具摊开给你看。',
              'One day a year to celebrate the people who write the code. No raffles, no discounts — just the tools, laid out.'
            )}
          </p>

          {/* 节日数据：前四项是产品事实，后两项是"你的"真实使用数据 */}
          <div className="mt-7 flex items-center justify-center gap-7 flex-wrap">
            {[
              { v: String(TOOL_COUNT), l: t('内置工具', 'Tools') },
              { v: '26', l: t('免费模型档', 'Free tiers') },
              { v: '0', l: t('数据上传', 'Uploads') },
              { v: 'MIT', l: t('开源协议', 'License') },
              ...(stats.sessionCount > 0
                ? [
                    { v: String(stats.sessionCount), l: t('你的会话', 'Your chats') },
                    { v: String(stats.daysUsed), l: t('使用天数', 'Days') },
                  ]
                : []),
            ].map((s) => (
              <div key={s.l} className="text-center">
                <div className="text-[22px] font-bold tabular-nums" style={{ color: '#232320', letterSpacing: '-0.02em' }}>{s.v}</div>
                <div className="text-[10.5px] mt-0.5" style={{ color: '#9a988f' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 能力卡（节日版） */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {FESTIVAL_CARDS.map((card, i) => {
            const meta = PAGE_META[card.type]
            return (
              <button key={card.type} onClick={() => onPick(card.type)}
                className="group relative text-left p-4 rounded-2xl transition-all"
                style={{
                  background: 'rgba(255,255,255,.66)',
                  border: '1px solid rgba(0,0,0,.055)',
                  backdropFilter: 'blur(18px) saturate(1.5)',
                  animationDelay: `${i * 45}ms`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)'
                  e.currentTarget.style.boxShadow = '0 14px 34px rgba(140,110,30,.11)'
                  e.currentTarget.style.borderColor = 'rgba(190,150,40,.32)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,.055)'
                }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(190,150,40,.12)', color: '#8a6a1f' }}>{card.tag}</span>
                  <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 ml-auto"
                    style={{ background: 'rgba(190,150,40,.1)', color: '#8a6a1f' }}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={meta.icon} />
                    </svg>
                  </span>
                </div>
                <div className="text-[13.5px] font-semibold" style={{ color: '#232320' }}>{card.title}</div>
                <p className="mt-1 text-[11.5px] leading-[1.65]" style={{ color: '#77756e' }}>{card.desc}</p>
              </button>
            )
          })}
        </div>

        {/* 彩蛋入口 */}
        <div className="mt-10 text-center">
          <button onClick={onEggTap}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[12.5px] font-medium transition-all"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,.9), rgba(250,240,215,.85))',
              border: '1px solid rgba(190,150,40,.3)',
              color: '#8a6a1f',
              boxShadow: '0 6px 22px rgba(190,150,40,.13)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(190,150,40,.2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(190,150,40,.13)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
            </svg>
            {t('今天有东西给你', 'There’s something for you')}
            <span className="text-[10px] opacity-60">{t('点三次', 'tap 3×')}</span>
          </button>
          <div className="mt-2.5 text-[10.5px]" style={{ color: '#a8a69d' }}>
            {t('也可以发送 /1024，或输入 1024 搜索', 'Or send /1024, or search 1024')}
          </div>
        </div>

        {/* 常用入口（次要） */}
        <div className="mt-9 flex items-center gap-2 flex-wrap justify-center">
          <span className="text-[10px] tracking-wider" style={{ color: '#a8a69d' }}>{t('全部工作区', 'All workspaces')}</span>
          {(['files', 'terminal', 'ppt', 'skills', 'memory', 'tasks', 'outputs', 'settings'] as PageType[]).map((tp) => {
            const m = PAGE_META[tp]
            return (
              <button key={tp} onClick={() => onPick(tp)}
                className="text-[11px] px-2.5 py-1 rounded-full transition-colors"
                style={{ background: 'rgba(255,255,255,.6)', color: '#77756e', border: '1px solid rgba(0,0,0,.05)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#8a6a1f'; e.currentTarget.style.borderColor = 'rgba(190,150,40,.3)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#77756e'; e.currentTarget.style.borderColor = 'rgba(0,0,0,.05)' }}>
                {lang === 'en' && m.labelEn ? m.labelEn : m.label}
              </button>
            )
          })}
        </div>
      </div>

      {eggOpen && <FestivalEggLazy onClose={() => setEggOpen(false)} />}
    </div>
  )
}

/** 懒加载彩蛋弹层，避免把弹层代码并进主页首屏 chunk */
function FestivalEggLazy({ onClose }: { onClose: () => void }) {
  const [Comp, setComp] = useState<React.ComponentType<{ onClose: () => void }> | null>(null)
  useEffect(() => {
    import('./FestivalEgg').then((m) => setComp(() => m.default)).catch(() => { /* ignore */ })
  }, [])
  if (!Comp) return null
  return <Comp onClose={onClose} />
}
