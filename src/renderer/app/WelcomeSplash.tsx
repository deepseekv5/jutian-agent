/**
 * WelcomeSplash —— 每次启动的「{lang === 'en' ? 'Welcome to the Beta' : '欢迎来到内测'}」宣传页
 * 深空玻璃 + 极光流动 + 品牌标识，2.8s 自动淡出，点击即进。
 */
import { useState, useEffect } from 'react'
import BrandMark from './BrandMark'
import { useLanguage } from '../hooks/useLanguage'
import { APP_NAME, APP_VERSION } from '../brand'

export default function WelcomeSplash() {
  const { lang } = useLanguage()
  const [phase, setPhase] = useState<'show' | 'fading' | 'gone'>('show')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fading'), 2600)
    const t2 = setTimeout(() => setPhase('gone'), 3300)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (phase === 'gone') return null
  const dismiss = () => setPhase('fading')

  return (
    <div onClick={dismiss}
      className="fixed inset-0 z-[2000] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, #17171c 0%, #0b0b0f 55%, #101318 100%)',
        opacity: phase === 'fading' ? 0 : 1,
        transform: phase === 'fading' ? 'scale(1.04)' : 'scale(1)',
        transition: 'opacity .7s ease, transform .7s ease',
        cursor: 'pointer',
      }}>

      {/* 极光光球 */}
      <div className="aurora-orb" style={{ width: '55vw', height: '55vw', left: '-12vw', top: '-18vw', background: 'radial-gradient(circle, rgba(52,211,153,0.14), transparent 70%)', animationDelay: '0s' }} />
      <div className="aurora-orb" style={{ width: '48vw', height: '48vw', right: '-14vw', top: '28vh', background: 'radial-gradient(circle, rgba(99,102,241,0.12), transparent 70%)', animationDelay: '-5s' }} />
      <div className="aurora-orb" style={{ width: '42vw', height: '42vw', left: '22vw', bottom: '-16vw', background: 'radial-gradient(circle, rgba(14,165,233,0.1), transparent 70%)', animationDelay: '-9s' }} />

      {/* 细网格纹理（低调科技感） */}
      <div className="pointer-events-none absolute inset-0" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)',
      }} />

      {/* 中央内容 */}
      <div className="relative z-10 flex flex-col items-center text-center px-8"
        style={{ animation: 'splash-in .9s cubic-bezier(.2,.8,.3,1) both' }}>
        {/* 品牌标识：玻璃圆片 */}
        <div className="mb-7 rounded-[28px] flex items-center justify-center"
          style={{
            width: 96, height: 96,
            background: 'linear-gradient(150deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)',
          }}>
          <BrandMark size={44} color="#ffffff" />
        </div>

        <h1 className="text-[34px] font-semibold text-white" style={{ letterSpacing: '0.02em', textShadow: '0 2px 24px rgba(0,0,0,0.5)' }}>
          {lang === 'en' ? 'Welcome to the Beta' : '欢迎来到内测'}
        </h1>
        <p className="mt-3 text-[14.5px]" style={{ color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em' }}>
          {APP_NAME} · AI 工作台
        </p>

        {/* 版本徽章 */}
        <div className="mt-7 flex items-center gap-2 px-4 h-8 rounded-full"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(12px)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
          <span className="text-[11.5px] font-mono" style={{ color: 'rgba(255,255,255,0.65)' }}>{'Beta v' + APP_VERSION + ' · ' + (lang === 'en' ? 'Beta Exclusive' : '内测专属版')}</span>
        </div>

        <p className="mt-9 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)', animation: 'splash-hint 2.6s ease both' }}>
          {lang === 'en' ? 'Click anywhere to start' : '点击任意位置进入'}
        </p>
      </div>

      <style>{`
        @keyframes splash-in {
          0% { opacity: 0; transform: translateY(18px) scale(0.97); filter: blur(6px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes splash-hint {
          0%, 55% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}