/**
 * 权限审批弹窗（v14.4）
 *
 * 以前「需要我确认」是硬拒绝——用户连看都看不到就失败了。现在改成真正的询问：
 * 显示「什么操作 / 具体命令或路径 / 风险等级」，三选一：本次允许、本会话允许、拒绝。
 * 本会话允许按 scopeKey 记忆（同一命令/同一文件不再反复问）。
 */
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { setPermissionHandler, type PermissionDecision } from './permissionGate'
import type { PermissionRequest } from '../../shared/permission'

interface Pending {
  req: PermissionRequest
  resolve: (d: PermissionDecision) => void
}

export default function PermissionPrompt() {
  const { c } = useTheme()
  const [queue, setQueue] = useState<Pending[]>([])
  const current = queue[0]

  useEffect(() => {
    setPermissionHandler((req) => new Promise<PermissionDecision>((resolve) => {
      setQueue((prev) => [...prev, { req, resolve }])
    }))
    return () => setPermissionHandler(null)
  }, [])

  const decide = (d: PermissionDecision) => {
    if (!current) return
    current.resolve(d)
    setQueue((prev) => prev.slice(1))
  }

  // Esc = 拒绝（fail-closed）
  const curRef = useRef(current)
  curRef.current = current
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); decide('deny') }
      if (e.key === 'Enter') { e.preventDefault(); decide('allow') }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!current) return null
  const { req } = current
  const dangerous = req.risk === 'dangerous'

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.42)' }}>
      <div className="rounded-xl p-5 space-y-3 glass-strong" style={{ width: 520, maxWidth: '92vw', border: `1px solid ${dangerous ? '#ef444455' : c.border}` }}>
        <div className="flex items-center gap-2">
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: dangerous ? '#ef4444' : '#f59e0b', width: 18, height: 18 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[14px] font-semibold" style={{ color: c.textHead }}>需要确认：{req.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded ml-auto shrink-0"
            style={{ background: dangerous ? '#ef444418' : '#f59e0b18', color: dangerous ? '#ef4444' : '#b45309' }}>
            {dangerous ? '高风险' : '需留意'}
          </span>
        </div>

        <div className="rounded-lg px-3 py-2" style={{ background: c.bgInput }}>
          <div className="text-[10px] mb-1" style={{ color: c.textTertiary }}>
            {req.reason === 'dangerous-command' ? '命令' : '目标'}
          </div>
          <pre className="text-[11.5px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto scrollbar-thin" style={{ color: c.text }}>
            {req.preview}
          </pre>
        </div>

        <p className="text-[11px] leading-relaxed" style={{ color: c.textTertiary }}>
          模型请求执行上一步操作。你可以只批准这一次，或本会话内同类操作不再询问。
        </p>

        <div className="flex items-center gap-2 justify-end flex-wrap">
          <button onClick={() => decide('deny')} className="px-3.5 py-2 rounded-lg text-[12px] font-medium"
            style={{ background: c.bgInput, color: c.textSecondary }}>拒绝</button>
          <button onClick={() => decide('allow-session')} className="px-3.5 py-2 rounded-lg text-[12px] font-medium"
            style={{ background: c.bgInput, color: c.accent }}>本会话允许</button>
          <button onClick={() => decide('allow')} className="px-3.5 py-2 rounded-lg text-[12px] font-medium text-white"
            style={{ background: dangerous ? '#ef4444' : c.accent }}>允许一次</button>
        </div>
      </div>
    </div>
  )
}
