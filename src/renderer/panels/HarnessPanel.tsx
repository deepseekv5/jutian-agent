/**
 * the agent harness WebUI 面板（v14.11）
 *
 * 语义说明（重要）：这是「嵌入 Harness 的界面」，不是把 Harness 内核嵌进巨天。
 * 官方 dsh 是独立 Cordis 应用（npx @deepseek-ai/dsh web → 127.0.0.1:3080），
 * 巨天通过 <webview partition="harness"> 当壳展示它，Harness 自己的
 * Creator Mode / 插件 / 工具 / 权限全部由它自己跑，互不干扰。
 *
 * 与官方更新不冲突：配置存 ~/.lyclaw 设置里，面板是 asar 内置页面；
 * dsh 由用户自行安装启动，我们不打包、不引入任何 npm 依赖。
 */

import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

const DEFAULT_URL = 'http://127.0.0.1:3080'

interface Props {
  /** 初始地址（设置页可配）；不传则从 localStorage 读 */
  url?: string
}

export default function HarnessPanel({ url: initialUrl }: Props) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const webviewRef = useRef<any>(null)
  const [url, setUrl] = useState(() => {
    try {
      const raw = localStorage.getItem('lyclaw_settings')
      const saved = raw ? JSON.parse(raw).harnessUrl : ''
      return initialUrl || saved || DEFAULT_URL
    } catch { return initialUrl || DEFAULT_URL }
  })
  const [input, setInput] = useState(url)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 设置页改地址后同步（settings-updated 事件）
  useEffect(() => {
    const h = (e: Event) => {
      const next = (e as CustomEvent).detail?.harnessUrl
      if (next && next !== url) { setUrl(next); setInput(next); setLoadError(null) }
    }
    window.addEventListener('settings-updated', h)
    return () => window.removeEventListener('settings-updated', h)
  }, [url])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !url) return
    const start = () => { setLoading(true); setLoadError(null) }
    const stop = () => setLoading(false)
    const nav = (e: any) => { if (e.url) { setUrl(e.url); setInput(e.url); setLoadError(null) } }
    const fail = (e: any) => {
      if (e.errorCode === -3) return
      setLoading(false)
      setLoadError(e.errDesc || `加载失败 (${e.errorCode})`)
    }
    wv.addEventListener('did-start-loading', start)
    wv.addEventListener('did-stop-loading', stop)
    wv.addEventListener('did-navigate', nav)
    wv.addEventListener('did-navigate-in-page', nav)
    wv.addEventListener('did-fail-load', fail)
    return () => {
      wv.removeEventListener('did-start-loading', start)
      wv.removeEventListener('did-stop-loading', stop)
      wv.removeEventListener('did-navigate', nav)
      wv.removeEventListener('did-navigate-in-page', nav)
      wv.removeEventListener('did-fail-load', fail)
    }
  }, [url])

  const go = () => {
    const u = input.trim() || DEFAULT_URL
    const full = /^https?:\/\//.test(u) ? u : 'http://' + u
    setUrl(full); setLoadError(null)
  }
  const refresh = () => { setLoadError(null); webviewRef.current?.reload() }

  return (
    <div className="h-full flex flex-col" style={{ background: c.surfaceCard || '#fff' }}>
      {/* 地址栏 */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
        <span className="text-[11px] font-semibold shrink-0" style={{ color: c.textHead }}>the agent harness</span>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') go() }}
          placeholder={DEFAULT_URL}
          className="flex-1 min-w-0 h-8 px-3 rounded-lg text-[12px] font-mono outline-none"
          style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.borderLight}` }} />
        <button onClick={go} className="px-3 h-8 rounded-lg text-[11.5px] font-medium shrink-0"
          style={{ background: c.accent || '#10a37f', color: '#fff' }}>{t('前往', 'Go')}</button>
        <button onClick={refresh} className="px-2.5 h-8 rounded-lg text-[11.5px] shrink-0"
          style={{ background: c.bgInput, color: c.textSecondary }}>{t('刷新', 'Refresh')}</button>
      </div>

      {/* 内容区 */}
      <div className="relative flex-1 min-h-0">
        {/* webview 用独立 partition，与巨天自己的 Cookie/存储完全隔离 */}
        <webview ref={webviewRef} src={url} partition="harness"
          className="w-full h-full" style={{ border: 'none', visibility: loadError ? 'hidden' : 'visible' }} />

        {loading && !loadError && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10.5px]"
            style={{ background: c.bgInput, color: c.textTertiary }}>加载中…</div>
        )}

        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center p-6" style={{ background: c.surfaceCard || '#fff' }}>
            <div className="max-w-lg text-center">
              <div className="text-[28px] mb-3">🧩</div>
              <div className="text-[14px] font-semibold mb-2" style={{ color: c.textHead }}>
                {t('连不上 the agent harness', 'Cannot reach the agent harness')}
              </div>
              <div className="text-[12px] leading-relaxed mb-4" style={{ color: c.textTertiary }}>
                {t('该引擎需要你在本机先启动 DeepSeek Harness 服务。它是独立应用，巨天只负责把它的界面嵌进来，不会自动安装或替换自己的对话内核。',
                   'This engine requires the DeepSeek Harness service running locally. It is a standalone app; Jutian only embeds its UI and never replaces its own chat engine.')}
              </div>
              <div className="rounded-xl p-3 mb-4 text-left font-mono text-[11.5px]" style={{ background: c.bgInput, color: c.textSecondary }}>
                npx @deepseek-ai/dsh web
                <div className="mt-1.5 font-sans text-[11px]" style={{ color: c.textTertiary }}>
                  {t('启动后默认地址 http://127.0.0.1:3080，然后点「刷新」。',
                     'Default URL is http://127.0.0.1:3080 — click Refresh once it is up.')}
                </div>
              </div>
              {loadError && <div className="text-[10.5px] mb-3" style={{ color: c.textMuted }}>{loadError}</div>}
              <button onClick={refresh} className="px-4 h-8 rounded-full text-[12px] font-medium"
                style={{ background: c.accent || '#10a37f', color: '#fff' }}>
                {t('已启动，重试', 'Retry')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
