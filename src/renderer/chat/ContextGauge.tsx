import { useState, useRef, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import { CONTEXT_LIMIT, fmtTokens, fmtPercent, guessModelContext } from '../utils/tokens'

export interface ContextPart {
  label: string
  tokens: number
  color: string
}

interface Props {
  parts: ContextPart[]
  limit?: number
  /** 紧凑模式（用于窄侧栏，如 Code 视图对话面板） */
  compact?: boolean
}

/** 半圆环上下文仪表盘：显示用量占上下文窗口比例 + 各部分占比明细 */
export default function ContextGauge({ parts, limit, compact = false }: Props) {
  const effectiveLimit = limit ?? CONTEXT_LIMIT
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const total = parts.reduce((s, p) => s + p.tokens, 0)
  const frac = Math.min(total / limit, 1)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 半圆环几何
  const r = 20
  const cx = 24
  const cy = 22
  const stroke = 4.5
  const arcLen = Math.PI * r
  const filled = arcLen * frac

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg transition-colors"
        style={{ color: c.textMuted }}
        title="上下文用量"
        onMouseEnter={e => { e.currentTarget.style.background = c.bgInput }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
        <svg width={48} height={33} viewBox="0 0 48 33">
          {/* 背景半圆 */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke={c.border} strokeWidth={stroke} strokeLinecap="round"
          />
          {/* 已用部分 */}
          {total > 0 && (
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none" stroke={c.accent} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${filled} ${arcLen}`}
            />
          )}
          {/* 中心数值 */}
          <text x={cx} y={cy - 3} textAnchor="middle" fontSize="8.5" fontWeight="600" fill={c.textSecondary}>
            {fmtPercent(frac)}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize="6.5" fill={c.textMuted}>
            {fmtTokens(total)}/{fmtTokens(limit)}
          </text>
        </svg>
      </button>

      {/* 明细浮层 */}
      {open && (
        <div className="absolute bottom-8 right-0 z-50 rounded-xl shadow-lg border p-3.5 w-72"
          style={{ background: c.modalBg, borderColor: c.border }}>
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="text-[12px] font-semibold" style={{ color: c.textHead }}>上下文占用</span>
            <span className="text-[11px] font-mono" style={{ color: c.textMuted }}>
              {fmtTokens(total)} / {fmtTokens(limit)}
            </span>
          </div>

          {/* 堆叠占比条 */}
          <div className="h-2 rounded-full overflow-hidden flex mb-3" style={{ background: c.bgInput }}>
            {parts.map(p => (
              <div key={p.label} style={{ width: `${total > 0 ? (p.tokens / total) * 100 : 0}%`, background: p.color, minWidth: p.tokens > 0 ? 2 : 0 }} />
            ))}
          </div>

          {/* 各部分明细 */}
          <div className="space-y-1.5">
            {parts.map(p => (
              <div key={p.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
                <span className="flex-1" style={{ color: c.textSecondary }}>{p.label}</span>
                <span className="font-mono" style={{ color: c.textTertiary }}>{fmtTokens(p.tokens)}</span>
                <span className="font-mono w-11 text-right" style={{ color: c.textMuted }}>
                  {total > 0 ? fmtPercent(p.tokens / total) : '0%'}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-2.5 pt-2 text-[10px]" style={{ borderTop: `1px solid ${c.borderLight}`, color: c.textMuted }}>
            上下文窗口 {fmtTokens(limit)} tokens · 估算值
          </div>
        </div>
      )}
    </div>
  )
}
