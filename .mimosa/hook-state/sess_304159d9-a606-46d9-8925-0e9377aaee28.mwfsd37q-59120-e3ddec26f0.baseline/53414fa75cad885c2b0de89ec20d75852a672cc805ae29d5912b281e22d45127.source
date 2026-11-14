/**
 * WelcomeSplash —— 启动过场（v13.8.3 重做）
 *
 * 去掉了"内测/Beta"文案。动画改为「元素归位」编排：
 * 每个元素从不同方向飞入它在真实界面中的位置（品牌片→侧栏角、标题→顶栏），
 * 停留一拍后整体让位——用 transform 编排而不是简单淡入淡出，观感是
 * "界面被组装出来"而不是"海报盖上去"。
 *
 * 时长 2.25s（原 3.3s），点击随时跳过。
 */
import { useState, useEffect } from 'react'
import BrandMark from './BrandMark'
import { useLanguage } from '../hooks/useLanguage'
import { APP_NAME, APP_VERSION } from '../brand'

export default function WelcomeSplash() {
  const { lang } = useLanguage()
  const [phase, setPhase] = useState<'show' | 'leaving' | 'gone'>('show')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('leaving'), 1700)
    const t2 = setTimeout(() => setPhase('gone'), 2250)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (phase === 'gone') return null
  const dismiss = () => setPhase('leaving')
  const leaving = phase === 'leaving'

  return (
    <div onClick={dismiss}
      className="fixed inset-0 z-[2000] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, #17171c 0%, #0b0b0f 55%, #101318 100%)',
        opacity: leaving ? 0 : 1,
        transition: 'opacity .55s cubic-bezier(.4,0,.2,1)',
        cursor: 'pointer',
      }}>

      {/* 极光光球：离场时向角落收拢，呼应"元素归位" */}
      <div className="aurora-orb" style={{
        width: '55vw', height: '55vw', left: '-12vw', top: '-18vw',
        background: 'radial-gradient(circle, rgba(52,211,153,0.14), transparent 70%)',
        transition: leaving ? 'transform .55s ease, opacity .55s ease' : undefined,
        transform: leaving ? 'translate(-30%, -30%) scale(0.6)' : undefined,
        opacity: leaving ? 0.4 : 1,
      }} />
      <div className="aurora-orb" style={{
        width: '48vw', height: '48vw', right: '-14vw', top: '28vh',
        background: 'radial-gradient(circle, rgba(99,102,241,0.12), transparent 70%)',
        animationDelay: '-5s',
        transition: leaving ? 'transform .55s ease, opacity .55s ease' : undefined,
        transform: leaving ? 'translate(30%, 20%) scale(0.5)' : undefined,
        opacity: leaving ? 0.3 : 1,
      }} />
      <div className="aurora-orb" style={{
        width: '42vw', height: '42vw', left: '22vw', bottom: '-16vw',
        background: 'radial-gradient(circle, rgba(14,165,233,0.1), transparent 70%)',
        animationDelay: '-9s',
        opacity: leaving ? 0 : 1,
        transition: 'opacity .4s ease',
      }} />

      {/* 细网格纹理 */}
      <div className="pointer-events-none absolute inset-0" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, black 30%, transparent 75%)',
        opacity: leaving ? 0 : 1,
        transition: 'opacity .5s ease',
      }} />

      {/* 中央内容：三元素错峰飞入，离场时各自"归位"到界面对应的方位 */}
      <div className="relative z-10 flex flex-col items-center text-center px-8">
        {/* 品牌圆片：从下方飞入 → 离场时飞向左上（侧栏品牌角的位置） */}
        <div className="jt-splash-logo mb-7 rounded-[28px] flex items-center justify-center"
          style={{
            width: 96, height: 96,
            background: 'linear-gradient(150deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)',
            animation: 'jt-el-logo .8s cubic-bezier(.2,.8,.3,1) both',
            transition: leaving
              ? 'transform .55s cubic-bezier(.5,0,.8,.4), opacity .5s ease, box-shadow .55s ease'
              : undefined,
            transform: leaving ? 'translate(-42vw, -32vh) scale(0.42)' : undefined,
            opacity: leaving ? 0 : 1,
          }}>
          <BrandMark size={44} color="#ffffff" />
        </div>

        {/* 标题：从左侧滑入 → 离场时飞向顶栏（应用名的位置） */}
        <h1 className="jt-splash-title text-[34px] font-semibold text-white"
          style={{
            letterSpacing: '0.02em', textShadow: '0 2px 24px rgba(0,0,0,0.5)',
            animation: 'jt-el-title .7s cubic-bezier(.2,.8,.3,1) both',
            animationDelay: '.15s',
            transition: leaving ? 'transform .5s cubic-bezier(.5,0,.8,.4), opacity .45s ease' : undefined,
            transform: leaving ? 'translateY(-24vh) scale(0.6)' : undefined,
            opacity: leaving ? 0 : 1,
          }}>
          {APP_NAME}
        </h1>

        {/* 副标：从右侧滑入 */}
        <p className="jt-splash-sub mt-3 text-[14.5px]"
          style={{
            color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em',
            animation: 'jt-el-sub .7s cubic-bezier(.2,.8,.3,1) both',
            animationDelay: '.3s',
            opacity: leaving ? 0 : undefined,
            transition: 'opacity .4s ease',
          }}>
          {lang === 'en' ? 'AI Workbench' : 'AI 工作台'}
        </p>

        {/* 版本徽章：从下方弹入 → 离场时沉向底栏（状态栏版本号的位置） */}
        <div className="jt-splash-badge mt-7 flex items-center gap-2 px-4 h-8 rounded-full"
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(12px)',
            animation: 'jt-el-badge .7s cubic-bezier(.2,.8,.3,1) both',
            animationDelay: '.45s',
            transition: leaving ? 'transform .5s cubic-bezier(.5,0,.8,.4), opacity .45s ease' : undefined,
            transform: leaving ? 'translateY(30vh) scale(0.7)' : undefined,
            opacity: leaving ? 0 : 1,
          }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
          <span className="text-[11.5px] font-mono" style={{ color: 'rgba(255,255,255,0.65)' }}>{'v' + APP_VERSION}</span>
        </div>

        <p className="mt-9 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)', animation: 'jt-splash-hint 2.2s ease both' }}>
          {lang === 'en' ? 'Click anywhere to start' : '点击任意位置进入'}
        </p>
      </div>

      <style>{`
        /* 元素飞入（各自不同方向 + 微模糊，制造纵深） */
        @keyframes jt-el-logo {
          0% { opacity: 0; transform: translateY(34px) scale(0.5); filter: blur(8px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes jt-el-title {
          0% { opacity: 0; transform: translateX(-36px); filter: blur(4px); }
          100% { opacity: 1; transform: translateX(0); filter: blur(0); }
        }
        @keyframes jt-el-sub {
          0% { opacity: 0; transform: translateX(30px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes jt-el-badge {
          0% { opacity: 0; transform: translateY(22px) scale(0.9); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes jt-splash-hint {
          0%, 60% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
