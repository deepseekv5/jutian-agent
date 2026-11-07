/**
 * GitHub Star 求星门（v14.11.3）
 *
 * 首次启动强制显示的全屏模态：请用户给仓库点个 Star。
 * 三种出路：
 *   · 点「去 GitHub 点 Star」→ 新窗口打开仓库（Electron 外部浏览器）
 *   · 「稍后再说」→ 本次会话关闭，下次启动再显示
 *   · 「不再提示」→ 永久关闭（localStorage 标记）
 *
 * 复用 LegalGate 的强制门视觉（同 z-index / 毛玻璃背景），但不阻断功能——
 * 用户直接点右上角 ✕ 等同「稍后再说」。
 */

import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

/** 仓库地址：扩展管理/求星门/免费模型页共用 */
export const REPO_URL = 'https://github.com/deepseekv5/jutian-agent'
const KEY_NEVER = 'lyclaw_star_gate_never'
const KEY_LATER = 'lyclaw_star_gate_later'

/** 启动判定：点了「不再提示」就永不再弹 */
export function shouldShowStarGate(): boolean {
  try { return localStorage.getItem(KEY_NEVER) !== '1' } catch { return false }
}
export function dismissStarGate(never: boolean) {
  try {
    if (never) localStorage.setItem(KEY_NEVER, '1')
    else localStorage.setItem(KEY_LATER, String(Date.now()))
  } catch { /* ignore */ }
}

export default function StarGate({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const [leaving, setLeaving] = useState(false)

  const openRepo = () => {
    try { window.open(REPO_URL, '_blank') } catch { /* ignore */ }
    // 点过 Star 后本次不再打扰（用户可能还没点，所以只算「稍后」）
    dismissStarGate(false)
    onClose()
  }
  const close = (never: boolean) => {
    setLeaving(true)
    setTimeout(() => { dismissStarGate(never); onClose() }, leaving ? 0 : 120)
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: 'rgba(247,248,250,.9)', backdropFilter: 'blur(24px)' }}>
      {/* 右上角 ✕ = 稍后再说 */}
      <button onClick={() => close(false)} aria-label="关闭"
        className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        style={{ color: c.textTertiary, background: c.bgInput }}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="w-full max-w-md rounded-3xl overflow-hidden glass-strong text-center px-8 py-9"
        style={{ border: `1px solid ${c.border}` }}>
        {/* GitHub Mark + Star */}
        <div className="flex justify-center mb-5">
          <span className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(16,163,127,.12)' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="#10a37f">
              <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.26.8-.58v-2.04c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.9 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.82.58A12 12 0 0012 .3" />
            </svg>
          </span>
        </div>

        <h2 className="text-[20px] font-bold tracking-tight mb-2" style={{ color: c.textHead }}>
          {lang === 'en' ? 'Enjoying 巨天agent?' : '觉得巨天agent 好用吗？'}
        </h2>
        <p className="text-[13px] leading-relaxed mb-1.5" style={{ color: c.textSecondary }}>
          {lang === 'en'
            ? 'It is free, local-first, and has no telemetry. A GitHub Star is the best way to help more people find it — and it keeps the updates coming.'
            : '它免费、本地优先、零遥测。给仓库点一个 Star，是让更多人发现它、也让更新继续下去的最好方式。'}
        </p>
        <p className="text-[11.5px] mb-6" style={{ color: c.textTertiary }}>
          {lang === 'en'
            ? 'Free models, the extension layer, and every release are shipped for the community.'
            : '免费模型、扩展层、每一次发版，都是为社区做的。'}
        </p>

        <button onClick={openRepo}
          className="w-full h-11 rounded-full text-[13.5px] font-semibold flex items-center justify-center gap-2 mb-3 transition-transform hover:scale-[1.02]"
          style={{ background: '#10a37f', color: '#fff' }}>
          <svg className="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.26.8-.58v-2.04c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.9 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.82.58A12 12 0 0012 .3" />
          </svg>
          GitHub Star
        </button>

        <div className="flex items-center justify-center gap-4 text-[11.5px]">
          <button onClick={() => close(false)} className="transition-colors" style={{ color: c.textTertiary }}>
            {t('稍后再说', 'Maybe later')}
          </button>
          <span style={{ color: c.border }}>|</span>
          <button onClick={() => close(true)} className="transition-colors" style={{ color: c.textTertiary }}>
            {t('不再提示', 'Never ask again')}
          </button>
        </div>
      </div>
    </div>
  )
}
