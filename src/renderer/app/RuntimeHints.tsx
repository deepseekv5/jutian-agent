import { useEffect, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

/**
 * 运行时提示（v13.5）：离线徽标 + PWA 安装邀请
 *
 * 两个都是"该出现才出现"的低调提示：
 *  · 断网时状态栏出灰色徽标——不然用户以为模型挂了在傻等
 *  · 浏览器/手机端支持安装成独立应用时，右上角给一次入口（可关，不再打扰）
 * 桌面 Electron 里没有 beforeinstallprompt，安装项自动不渲染。
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: string }>
}

export default function RuntimeHints() {
  const { c } = useTheme()
  const { tt, lang } = useLanguage()
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('lyclaw_pwa_dismissed') === '1' } catch { return false }
  })

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const onInstall = (e: Event) => {
      e.preventDefault() // 拦下浏览器默认横幅，换成我们的低调入口
      setInstallEvt(e as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onInstall)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('beforeinstallprompt', onInstall)
    }
  }, [])

  return (
    <>
      {/*
  断网徽标：固定右下角，不挡内容。恢复网络即消失。
*/}
      {!online && (
        <div className="fixed z-[70] flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
          style={{ right: 12, bottom: `calc(12px + var(--safe-bottom))`, background: 'rgba(0,0,0,.72)', color: '#fff' }}
          role="status">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414" />
          </svg>
          {tt('state.offline')}
        </div>
      )}

      {/*
  PWA 安装邀请：只在浏览器支持安装时出现一次，关闭后永久记住。
*/}
      {online && installEvt && !dismissed && (
        <div className="fixed z-[70] flex items-center gap-2 px-3 py-1.5 rounded-full text-[11.5px] shadow-lg"
          style={{ right: 12, bottom: `calc(12px + var(--safe-bottom))`, background: c.textHead, color: c.bg }}>
          <span>{lang === 'en' ? 'Install the app' : tt('mobile.installHint')}</span>
          <button
            onClick={async () => {
              try { await installEvt.prompt() } catch { /* 用户拒绝 */ }
              setInstallEvt(null)
            }}
            className="px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: c.accent, color: '#fff' }}>
            {tt('action.install')}
          </button>
          <button
            onClick={() => { setDismissed(true); try { localStorage.setItem('lyclaw_pwa_dismissed', '1') } catch { /* 隐私模式 */ } }}
            className="opacity-70 hover:opacity-100 px-1"
            aria-label={tt('action.close')}>✕</button>
        </div>
      )}
    </>
  )
}
