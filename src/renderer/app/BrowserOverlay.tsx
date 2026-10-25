import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { isMac as platformIsMac } from '../utils/platform'

declare global {
  interface Window {
    electronAPI?: {
      onOpenBrowserOverlay: (cb: (url: string) => void) => void
      removeBrowserOverlayListener: () => void
    }
  }
}

interface Props { initialUrl?: string | null; onClose: () => void }

export default function BrowserOverlay({ initialUrl, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl || null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const webviewRef = useRef<any>(null)
  const { c } = useTheme()
  const { t } = useLanguage()

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOpenBrowserOverlay((incomingUrl: string) => { setUrl(incomingUrl) })
    }
    return () => { if (window.electronAPI) window.electronAPI.removeBrowserOverlayListener() }
  }, [])

  useEffect(() => {
    if (initialUrl) { setUrl(initialUrl) }
  }, [initialUrl])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !url) return
    const handleStart = () => { setLoading(true); setLoadError(null) }
    const handleStop = () => setLoading(false)
    const handleNavigate = (e: any) => { setUrl(e.url); setLoading(false); setLoadError(null) }
    // 加载失败要有可见兜底：否则站点被拦(X-Frame/CSP/SSL/断网)时整页纯白，
    // 用户以为「关不掉」——其实是点不到内容、又看不出发生了什么
    const handleFail = (e: any) => {
      // -3 是用户主动取消/跳转中断，忽略；其余按真失败处理
      if (e.errorCode === -3) return
      setLoading(false)
      setLoadError(e.errDesc || `加载失败 (${e.errorCode})`)
    }
    wv.addEventListener('did-start-loading', handleStart)
    wv.addEventListener('did-stop-loading', handleStop)
    wv.addEventListener('did-navigate', handleNavigate)
    wv.addEventListener('did-navigate-in-page', handleNavigate)
    wv.addEventListener('did-fail-load', handleFail)
    return () => {
      wv.removeEventListener('did-start-loading', handleStart)
      wv.removeEventListener('did-stop-loading', handleStop)
      wv.removeEventListener('did-navigate', handleNavigate)
      wv.removeEventListener('did-navigate-in-page', handleNavigate)
      wv.removeEventListener('did-fail-load', handleFail)
    }
  }, [url])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!url) return null

  const goBack = () => { if (webviewRef.current) webviewRef.current.goBack() }
  const goForward = () => { if (webviewRef.current) webviewRef.current.goForward() }
  const refresh = () => { setLoadError(null); if (webviewRef.current) webviewRef.current.reload() }
  const openExternal = () => { window.open(url, '_blank') }

  const displayUrl = url.length ? (url.length > 80 ? url.slice(0, 80) + '...' : url) : ''
  const isMac = platformIsMac()

  // 导航按钮本身必须 no-drag：整条工具栏是拖拽区，而 Electron 里
  // -webkit-app-region: drag 会吞掉鼠标点击，导致压在它下面的 ✕ 点不动
  const navBtn = "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 titlebar-nodrag"

  return (
    // v11.0.2:z-[80] 防普通浮层穿透;macOS 左上让出红绿灯区(此前第一个按钮压在
    // 系统红绿灯下,点击触发系统行为,表现为"被开关按钮搞住、退出不了")
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: c.bg }}>
      {/* Navigation Bar */}
      <div className="h-12 flex items-center gap-2 px-3 shrink-0 select-none titlebar-drag" style={{ background: c.bgCard, borderBottom: `1px solid ${c.border}`, paddingLeft: isMac ? 84 : 12 }}>
        {/* History nav */}
        <button onClick={goBack} className={navBtn} style={{ color: c.textSecondary }} title="后退">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button onClick={goForward} className={navBtn} style={{ color: c.textTertiary }} title="前进">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>

        {/* Refresh */}
        <button onClick={refresh} className={navBtn} style={{ color: c.textTertiary }} title="刷新">
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2" />
          </svg>
        </button>

        {/* Address Bar */}
        <div className="flex-1 h-8 rounded-lg flex items-center px-3 text-xs overflow-hidden min-w-0" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
          <svg className="w-3.5 h-3.5 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          <span className="truncate" style={{ color: c.textTertiary }}>{displayUrl}</span>
        </div>

        {/* Open external */}
        <button onClick={openExternal} className={navBtn} style={{ color: c.textTertiary }} title="在系统浏览器打开">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>

        {/* 显式关闭：右上角 ✕（红 hover），Esc 亦可用。no-drag 保证鼠标点得到 */}
        <button onClick={onClose} className={`${navBtn} transition-colors`}
          style={{ color: c.textSecondary }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.textSecondary }}
          title="关闭浏览器（Esc）" aria-label="关闭浏览器">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Webview */}
      <div className="flex-1 relative" style={{ background: '#ffffff' }}>
        {/* webview 无官方类型定义,按 any 处理 */}
        <webview ref={webviewRef} src={url} partition="web-browse" className="w-full h-full" style={{ border: 'none', visibility: loadError ? 'hidden' : 'visible' }} />
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6" style={{ background: c.bg }}>
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke={c.textMuted} strokeWidth={1.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div className="text-[13px] font-medium" style={{ color: c.textHead }}>{t('这个页面加载不出来', 'This page failed to load')}</div>
            <div className="text-[11px] max-w-[420px] text-center leading-relaxed break-all" style={{ color: c.textTertiary }}>
              {loadError}
            </div>
            <div className="flex gap-2 mt-1">
              <button onClick={refresh} className="h-8 px-3.5 rounded-lg text-[12px] font-medium"
                style={{ background: c.accent, color: c.accentText }}>
                {t('重试', 'Retry')}
              </button>
              <button onClick={openExternal} className="h-8 px-3.5 rounded-lg text-[12px]"
                style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                {t('在系统浏览器打开', 'Open externally')}
              </button>
              <button onClick={onClose} className="h-8 px-3.5 rounded-lg text-[12px]"
                style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}>
                {t('关闭', 'Close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
