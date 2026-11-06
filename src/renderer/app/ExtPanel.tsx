/**
 * 扩展面板宿主（v14.11）
 *
 * 用 iframe sandbox="allow-scripts"（**刻意不给 allow-same-origin**）装载
 * ~/.lyclaw/extensions/<id>/panel.html。扩展 JS 拿不到父窗口 DOM/Cookie，
 * 只能通过 postMessage 走宿主白名单 API 桥读数据 —— 与现有 HTML Artifacts
 * 沙箱同源的安全模型。
 *
 * 面板内协议：
 *   parent.postMessage({ type:'ext:ready' }, '*')
 *   parent.postMessage({ type:'ext:api', requestId, capability, method:'get', params }, '*')
 * 宿主回：
 *   iframe.contentWindow.postMessage({ type:'ext:api-result', requestId, ok, data|error }, '*')
 */

import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { EXT_CAPABILITY_ENDPOINTS, type RegisteredExt } from './extensions'
import { extIdFromType } from './extensions'

interface Props {
  /** 形如 ext:pomodoro 的页面 type */
  type: string
}

export default function ExtPanel({ type }: Props) {
  const { c } = useTheme()
  const id = extIdFromType(type)
  const ref = useRef<HTMLIFrameElement>(null)
  const [ext, setExt] = useState<RegisteredExt | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/extensions/active', { signal: AbortSignal.timeout(8000) })
        const d = await r.json()
        const hit = (d?.items || []).find((x: any) => x.id === id)
        if (!alive) return
        if (!hit) { setError('扩展不存在或已被禁用'); return }
        setExt({
          id: hit.id, name: hit.name, icon: hit.icon, description: hit.description,
          entry: hit.entry || 'panel.html', capabilities: hit.capabilities || [], slot: hit.slot || 'tab',
        })
      } catch (e) { if (alive) setError('加载扩展信息失败：' + String((e as Error)?.message || e)) }
    })()
    return () => { alive = false }
  }, [id])

  // API 桥：只放行扩展已声明的能力 + 只读 method=get
  useEffect(() => {
    if (!ext) return
    const onMessage = async (e: MessageEvent) => {
      // 只接受来自本 iframe 的消息
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const d = e.data
      if (!d || d.type !== 'ext:api') return
      const reply = (ok: boolean, data?: unknown, err?: string) => {
        try {
          ref.current?.contentWindow?.postMessage({
            type: 'ext:api-result', requestId: String(d.requestId || ''), ok,
            ...(ok ? { data } : { error: err }),
          }, '*')
        } catch { /* ignore */ }
      }
      const cap = String(d.capability || '')
      if (!ext.capabilities.includes(cap)) return reply(false, undefined, '未声明的能力：' + cap)
      if (String(d.method || '') !== 'get') return reply(false, undefined, '仅允许只读 get')
      const endpoint = EXT_CAPABILITY_ENDPOINTS[cap]
      if (!endpoint) return reply(false, undefined, '未知能力')
      try {
        const r = await fetch(endpoint, { signal: AbortSignal.timeout(8000) })
        const j = await r.json().catch(() => null)
        reply(r.ok, j, r.ok ? undefined : 'HTTP ' + r.status)
      } catch (err) { reply(false, undefined, String((err as Error)?.message || err)) }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [ext])

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-[13px]" style={{ color: c.textTertiary }}>
        {error}
      </div>
    )
  }
  if (!ext) {
    return (
      <div className="h-full flex items-center justify-center text-[13px]" style={{ color: c.textTertiary }}>
        正在加载扩展…
      </div>
    )
  }

  const src = `/api/extensions/file?id=${encodeURIComponent(ext.id)}&path=${encodeURIComponent(ext.entry)}`
  return (
    <iframe
      ref={ref}
      title={`扩展：${ext.name}`}
      src={src}
      // allow-scripts 但绝不给 allow-same-origin：扩展脚本碰不到父窗口 localStorage/Cookie
      sandbox="allow-scripts"
      style={{ display: 'block', width: '100%', height: '100%', border: 0, background: c.surfaceCard || '#fff' }}
    />
  )
}
