import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../hooks/useTheme'

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
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const webviewRef = useRef<any>(null)
  const { c } = useTheme()

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOpenBrowserOverlay((incomingUrl: string) => { setUrl(incomingUrl); setHistory(prev => [...prev, incomingUrl]); setHistoryIdx(prev => prev + 1) })
    }
    return () => { if (window.electronAPI) window.electronAPI.removeBrowserOverlayListener() }
  }, [])

  useEffect(() => {
    if (initialUrl) { setUrl(initialUrl); setHistory(prev => [...prev, initialUrl]); setHistoryIdx(prev => prev + 1) }
  }, [initialUrl])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !url) return
    const handleStart = () => setLoading(true)
    const handleStop = () => setLoading(false)
    const handleNavigate = (e: any) => { setUrl(e.url); setLoading(false) }
    wv.addEventListener('did-start-loading', handleStart)
    wv.addEventListener('did-stop-loading', handleStop)
    wv.addEventListener('did-navigate', handleNavigate)
    wv.addEventListener('did-navigate-in-page', handleNavigate)
    return () => { wv.removeEventListener('did-start-loading', handleStart); wv.removeEventListener('did-stop-loading', handleStop); wv.removeEventListener('did-navigate', handleNavigate); wv.removeEventListener('did-navigate-in-page', handleNavigate) }
  }, [url])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!url) return null

  const goBack = () => { if (webviewRef.current) webviewRef.current.goBack() }
  const goForward = () => { if (webviewRef.current) webviewRef.current.goForward() }
  const refresh = () => { if (webviewRef.current) webviewRef.current.reload() }
  const openExternal = () => { window.open(url, '_blank') }

  const displayUrl = url.length ? (url.length > 80 ? url.slice(0, 80) + '...' : url) : ''

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: c.bg }}>
      {/* Navigation Bar */}
      <div className="h-12 flex items-center gap-2 px-3 shrink-0 select-none" style={{ background: c.bgCard, borderBottom: `1px solid ${c.border}` }}>
        {/* Close / Back */}
        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: c.text }} title="Back (Esc)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>

        {/* History nav */}
        <button onClick={goBack} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: c.textTertiary }} title="Back">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button onClick={goForward} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: c.textTertiary }} title="Forward">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>

        {/* Refresh */}
        <button onClick={refresh} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: c.textTertiary }} title="Refresh">
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2" />
          </svg>
        </button>

        {/* Address Bar */}
        <div className="flex-1 h-8 rounded-lg flex items-center px-3 text-xs overflow-hidden" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
          <svg className="w-3.5 h-3.5 mr-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          <span className="truncate" style={{ color: c.textTertiary }}>{displayUrl}</span>
        </div>

        {/* Open external */}
        <button onClick={openExternal} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ color: c.textTertiary }} title="Open in browser">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* Webview */}
      <div className="flex-1 relative" style={{ background: '#ffffff' }}>
        {/* webview 无官方类型定义,按 any 处理 */}
        <webview ref={webviewRef} src={url} className="w-full h-full" style={{ border: 'none' }} />
      </div>
    </div>
  )
}
