/**
 * Code 模式 UI 基元（CODE-SPEC v1.0）
 * 所有 Code 子界面必须复用这里的组件；禁止内联定义组件（重挂载 bug 之源）。
 */
import { ReactNode } from 'react'

export function CMPanel({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-xl border glass-strong ${className}`} style={{ borderColor: 'var(--border)', ...style }}>
      {children}
    </div>
  )
}

export function CMBtn({ icon, label, title, active, onClick, c, small, disabled }: { icon?: string; label?: string; title: string; active?: boolean; onClick: () => void; c: any; small?: boolean; disabled?: boolean }) {
  const sz = small ? 'w-6 h-6' : 'w-7 h-7'
  return (
    <button onClick={onClick} title={title} aria-label={title} disabled={disabled}
      className={`${sz} rounded-lg flex items-center justify-center transition-colors shrink-0 disabled:opacity-40`}
      style={{ color: active ? c.accent : c.textTertiary, background: active ? c.accentBg : 'transparent' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.bgHover }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      {icon ? (
        <svg className={small ? 'w-3.5 h-3.5' : 'w-[15px] h-[15px]'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      ) : (
        <span className="text-[10px] font-bold">{label}</span>
      )}
    </button>
  )
}

export function CMInput({ value, onChange, placeholder, c, className = '', onKeyDown }: { value: string; onChange: (v: string) => void; placeholder?: string; c: any; className?: string; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} onKeyDown={onKeyDown}
      className={`h-9 w-full rounded-lg px-3 text-[12px] outline-none transition-colors ${className}`}
      style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }}
      onFocus={e => { e.currentTarget.style.borderColor = c.borderFocus }}
      onBlur={e => { e.currentTarget.style.borderColor = c.border }} />
  )
}

export function CMEmpty({ icon, title, desc, c, action }: { icon: string; title: string; desc?: string; c: any; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-10">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: c.bgInput }}>
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4} style={{ color: c.textMuted }}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div className="text-[13px] font-medium" style={{ color: c.textSecondary }}>{title}</div>
      {desc && <div className="text-[11px] max-w-xs leading-relaxed" style={{ color: c.textMuted }}>{desc}</div>}
      {action}
    </div>
  )
}

export function CMHeader({ title, c, right }: { title?: string; c: any; right?: ReactNode }) {
  return (
    <div className="h-9 flex items-center gap-2 px-3 shrink-0 border-b" style={{ borderColor: c.borderLight }}>
      {title && <span className="text-[13px] font-semibold tracking-tight" style={{ color: c.textHead }}>{title}</span>}
      <div className="flex-1" />
      {right}
    </div>
  )
}

export function CMPrimaryBtn({ children, onClick, c, disabled, className = '' }: { children: ReactNode; onClick: () => void; c: any; disabled?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`h-9 px-4 rounded-lg text-[12.5px] font-medium disabled:opacity-40 ${className}`}
      style={{ background: c.accent, color: c.accentText }}>
      {children}
    </button>
  )
}