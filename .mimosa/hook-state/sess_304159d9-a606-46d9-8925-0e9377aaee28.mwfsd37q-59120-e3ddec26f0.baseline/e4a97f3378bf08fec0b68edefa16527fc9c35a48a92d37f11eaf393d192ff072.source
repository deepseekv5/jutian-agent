/**
 * 目标模式卡片 —— 学 ClerkBox「目标模式 · 进行中」浮层。
 * 一个目标而非一串指令：独立评估器每轮检查完成度，未达标自动续跑（封顶 3 轮）。
 * 亮色液态玻璃风格，非深色。
 */
import { useTheme } from '../hooks/useTheme'

interface GoalState {
  text: string
  rounds: number
  status: 'running' | 'done' | 'stopped'
  lastCheck: string
}

export default function GoalCard({ goal, onStop, onDismiss }: { goal: GoalState; onStop: () => void; onDismiss: () => void }) {
  const { c } = useTheme()
  const running = goal.status === 'running'
  const done = goal.status === 'done'
  const ring = done ? '#0b6b4f' : running ? c.accent : c.textMuted
  return (
    <div className="mx-auto w-full rounded-2xl px-4 py-3.5 glass-strong"
      style={{ border: `1px solid ${done ? 'rgba(16,185,129,0.35)' : c.border}`, maxWidth: 760, background: c.bgCard }}>
      <div className="flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${ring}18`, color: ring }}>
          {running ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : done ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold" style={{ color: c.textHead }}>目标模式</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: done ? 'rgba(16,185,129,0.12)' : running ? `${c.accent}18` : c.bgInput, color: done ? '#0b6b4f' : running ? c.accent : c.textTertiary }}>
              {done ? '已达成' : running ? `进行中 · 第 ${goal.rounds}/3 轮` : '已停止'}
            </span>
          </div>
          <div className="text-[12px] mt-0.5 truncate" style={{ color: c.text }} title={goal.text}>{goal.text}</div>
          {goal.lastCheck && (
            <div className="text-[11px] mt-0.5 truncate" style={{ color: c.textTertiary }} title={goal.lastCheck}>
              最近检查：{goal.lastCheck}
            </div>
          )}
        </div>
        {running ? (
          <button onClick={onStop} className="h-7 px-2.5 rounded-lg text-[11.5px] shrink-0"
            style={{ border: `1px solid ${c.borderLight}`, color: c.textSecondary }} title="停止自动续跑（不打断当前回复）">停止</button>
        ) : (
          <button onClick={onDismiss} className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ color: c.textMuted }} title="关闭">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>
      <div className="mt-2 text-[10.5px] flex items-center gap-1.5" style={{ color: c.textMuted }}>
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
        每轮回复后由独立评估器检查目标，未达成自动续跑（最多 3 轮）
      </div>
    </div>
  )
}