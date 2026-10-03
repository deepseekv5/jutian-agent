/**
 * CliInstallModal —— jtcode 命令行工具安装邀请
 * 首次进入 App 时弹出；也可随时从设置触发。玻璃卡片 + 终端演示。
 */
import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import BrandMark from './BrandMark'

const FLAG = 'lyclaw_jtcode_prompt'

export function shouldShowCliPrompt(): boolean {
  try { return localStorage.getItem(FLAG) !== 'forever' } catch { return true }
}

export default function CliInstallModal({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [state, setState] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ path: string; needsPathNote?: boolean; binDir?: string } | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const install = async () => {
    setState('installing')
    try {
      const r = await fetch('/api/cli/install', { method: 'POST' }).then((r) => r.json())
      if (r.success) { setResult(r); setState('done') }
      else { setErrMsg(r.error || '安装失败'); setState('error') }
    } catch { setErrMsg('服务不可用'); setState('error') }
  }

  const dismissForever = () => {
    try { localStorage.setItem(FLAG, 'forever') } catch {}
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6" style={{ background: c.modalOverlay, backdropFilter: 'blur(6px)' }}
      onClick={state === 'installing' ? undefined : onClose}>
      <div className="w-[460px] max-w-full rounded-2xl border overflow-hidden shadow-2xl animate-scale-in glass-strong"
        style={{ borderColor: c.border }} onClick={(e) => e.stopPropagation()}>

        {/* 头部 */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <BrandMark size={30} color={c.textHead} />
            <span className="text-[19px] font-mono font-bold tracking-tight" style={{ color: c.textHead }}>jtcode</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${c.accent}15`, color: c.accent }}>新</span>
          </div>
          <h2 className="text-[15.5px] font-semibold" style={{ color: c.textHead }}>在终端里随时呼叫巨天</h2>
          <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: c.textSecondary }}>
            安装命令行工具后，打开终端输入 <code className="px-1.5 py-0.5 rounded font-mono text-[11.5px]" style={{ background: c.surfaceInput, color: c.accent }}>jtcode</code> 即可与 AI 对话 —— 无需切换窗口。
          </p>
        </div>

        {/* 终端演示 */}
        <div className="mx-6 rounded-xl overflow-hidden border" style={{ borderColor: c.border, background: '#0d1117' }}>
          <div className="h-6 flex items-center gap-1.5 px-3" style={{ background: '#161b22' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: '#f85149' }} />
            <span className="w-2 h-2 rounded-full" style={{ background: '#d29922' }} />
            <span className="w-2 h-2 rounded-full" style={{ background: '#3fb950' }} />
            <span className="text-[9px] font-mono ml-1" style={{ color: '#8b949e' }}>Terminal</span>
          </div>
          <div className="px-3.5 py-2.5 font-mono text-[11px] leading-relaxed">
            <div><span style={{ color: '#3fb950' }}>❯</span> <span style={{ color: '#e6edf3' }}>jtcode "用Python写个快排"</span></div>
            <div style={{ color: '#8b949e' }}>思考中…</div>
            <div style={{ color: '#e6edf3' }}>好的，这是一个简洁的快排实现…</div>
            <div><span style={{ color: '#3fb950' }}>❯</span> <span className="inline-block w-1.5 h-3 align-middle animate-pulse" style={{ background: '#3fb950' }} /></div>
          </div>
        </div>

        {/* 操作区 */}
        <div className="px-6 py-4">
          {state === 'done' ? (
            <div className="text-center space-y-2.5">
              <div className="text-[13px] font-medium" style={{ color: c.toolOk }}>
                ✓ 已安装到 {result?.path}
              </div>
              {result?.needsPathNote && (
                <div className="text-[11px] leading-relaxed" style={{ color: c.textTertiary }}>
                  已安装到 {result.binDir}（当前 PATH 未包含）。请在新终端执行：<br />
                  <code className="font-mono" style={{ color: c.accent }}>echo 'export PATH="$PATH:{result.binDir}"' &gt;&gt; ~/.zshrc</code>
                </div>
              )}
              <button onClick={onClose}
                className="w-full h-9 rounded-xl text-[13px] font-medium"
                style={{ background: c.accent, color: c.accentText }}>开始使用</button>
            </div>
          ) : state === 'error' ? (
            <div className="text-center space-y-2.5">
              <div className="text-[12px]" style={{ color: c.toolErr }}>{errMsg}</div>
              <div className="flex gap-2">
                <button onClick={install} className="flex-1 h-9 rounded-xl text-[13px] font-medium"
                  style={{ background: c.accent, color: c.accentText }}>重试</button>
                <button onClick={onClose} className="flex-1 h-9 rounded-xl text-[13px]"
                  style={{ border: `1px solid ${c.border}`, color: c.textSecondary }}>关闭</button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={install} disabled={state === 'installing'}
                className="w-full h-9 rounded-xl text-[13px] font-medium disabled:opacity-50"
                style={{ background: c.accent, color: c.accentText }}>
                {state === 'installing' ? '安装中…' : '安装 jtcode'}
              </button>
              <div className="flex items-center justify-between mt-2.5">
                <button onClick={dismissForever} className="text-[11px]" style={{ color: c.textMuted }}>不再提醒</button>
                <button onClick={onClose} className="text-[11px]" style={{ color: c.textTertiary }}>以后再说</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}