/**
 * 全局错误提示 —— 让静默失败变得可见
 *
 * 背景：渲染层有上百个 catch，其中大量是空实现或只 console.error，
 * 用户点了一下没反应、也不知道为什么。这里提供一个极简的单例通道：
 *
 *   reportError('保存失败：' + e.message)   // 任意位置调用，右下角弹出
 *
 * 另外 App 挂载时会监听 window 的 unhandledrejection / error，
 * 把漏网的异步异常也接到这里，不再只出现在控制台里。
 * 设计约束：只提示、不打断；3.5 秒自动消失；连续多条垂直堆叠。
 */

import { useEffect, useRef, useState } from 'react'
import { fetchCompat } from '../api'

export interface ToastItem { id: number; text: string }

type Listener = (items: ToastItem[]) => void
let items: ToastItem[] = []
let listeners: Listener[] = []
let seq = 0
// 同一条消息 2 秒内不重复弹（流式重试、轮询失败很容易刷屏）
const recent = new Map<string, number>()

function emit() {
  const snapshot = items.slice()
  listeners.forEach(l => l(snapshot))
}

/** 全局入口：任何位置都可以调用，不依赖 React 上下文 */
export function reportError(text: string) {
  const msg = String(text || '未知错误').slice(0, 300)
  const now = Date.now()
  const last = recent.get(msg) || 0
  if (now - last < 2000) return
  recent.set(msg, now)
  if (recent.size > 50) recent.clear()
  items = [...items, { id: ++seq, text: msg }].slice(-4)
  emit()
  setTimeout(() => {
    items = items.filter(i => i.id !== seq)
    emit()
  }, 3500)
}

export function dismissError(id: number) {
  items = items.filter(i => i.id !== id)
  emit()
}

/** 挂在 App 根部：监听漏网的异步异常 */
export function useGlobalErrorListener() {
  useEffect(() => {
    // 上报到服务端（诊断页可见）。节流：同一消息 10 秒内只报一次，
    // 避免轮询/流式重试把上报打满
    const reported = new Map<string, number>()
    const report = (message: string, stack?: string) => {
      const key = message.slice(0, 120)
      const now = Date.now()
      if (now - (reported.get(key) || 0) < 10_000) return
      reported.set(key, now)
      if (reported.size > 50) reported.clear()
      try {
        fetchCompat('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, stack: stack || '', url: location.href }),
        }).catch(() => { /* 上报失败不影响提示 */ })
      } catch { /* ignore */ }
    }
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason
      const msg = r instanceof Error ? r.message : (typeof r === 'string' ? r : '异步操作失败')
      reportError(msg)
      report(msg, r instanceof Error ? r.stack : undefined)
    }
    const onErr = (e: ErrorEvent) => {
      // 资源加载失败（img/script/link 404）噪音大，跳过——它们的 target 不是 window
      const t = e.target as unknown as HTMLElement | null
      if (t && typeof (t as HTMLElement).tagName === 'string') {
        const tag = (t as HTMLElement).tagName
        if (tag === 'IMG' || tag === 'SCRIPT' || tag === 'LINK') return
      }
      if (e.message) { reportError(e.message); report(e.message, e.error?.stack) }
    }
    window.addEventListener('unhandledrejection', onRej)
    window.addEventListener('error', onErr)
    return () => {
      window.removeEventListener('unhandledrejection', onRej)
      window.removeEventListener('error', onErr)
    }
  }, [])
}

/** 提示宿主：挂在 App 根部一次即可 */
export default function ErrorToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)
  const ref = useRef<Listener>(setList)
  ref.current = setList

  useEffect(() => {
    const l: Listener = (snapshot) => ref.current(snapshot)
    listeners.push(l)
    l(items)
    return () => { listeners = listeners.filter(x => x !== l) }
  }, [])

  if (list.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-[95] flex flex-col gap-2 items-end pointer-events-none"
      role="status" aria-live="polite">
      {list.map(it => (
        <div key={it.id}
          className="pointer-events-auto max-w-[380px] rounded-lg px-3 py-2 text-[12px] shadow-lg flex items-start gap-2"
          style={{
            background: 'var(--surface, #fff)',
            color: 'var(--text, #0d0d0d)',
            border: '1px solid var(--border, #e5e5e5)',
          }}>
          <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--tool-err, #dc2626)" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          <span className="leading-relaxed break-all">{it.text}</span>
          <button onClick={() => dismissError(it.id)} className="shrink-0 mt-0.5 opacity-50 hover:opacity-100"
            aria-label="关闭提示">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
