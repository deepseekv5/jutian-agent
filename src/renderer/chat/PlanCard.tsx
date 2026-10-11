/**
 * 任务清单卡片 —— update_plan 工具的可视化（对标 Claude Code 的 TodoWrite）
 *
 * 多步任务最痛的是"不知道进行到哪了"：一长串工具调用滚过去，用户得自己
 * 数哪步做完了。模型通过 update_plan 维护清单，这里把它显示成进度。
 *
 * 亮色液态玻璃风格，与 GoalCard 同一视觉语言。
 */
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { Plan } from '../../shared/planTool'
import { planProgress } from '../../shared/planTool'

export default function PlanCard({ plan, onClear }: { plan: Plan; onClear: () => void }) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const { done, total, label } = planProgress(plan)
  const allDone = done === total

  return (
    <div className="mx-auto w-full rounded-2xl px-4 py-3 glass-strong"
      style={{ border: `1px solid ${allDone ? 'rgba(16,185,129,0.32)' : c.border}`, maxWidth: 760, background: c.bgCard }}>
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: allDone ? 'rgba(16,185,129,0.14)' : `${c.accent}14`, color: allDone ? c.toolOk : c.accent }}>
          {allDone ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold" style={{ color: c.textHead }}>{t('任务清单', 'Plan')}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: allDone ? 'rgba(16,185,129,0.12)' : c.bgInput, color: allDone ? c.toolOk : c.textTertiary }}>
              {label}
            </span>
            {plan.explanation && (
              <span className="text-[10.5px] truncate" style={{ color: c.textTertiary }}>{plan.explanation}</span>
            )}
          </div>
          {/* 进度条：比数字更直观地传达"还剩多少" */}
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: c.bgInput }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${total ? Math.round(done / total * 100) : 0}%`, background: allDone ? c.toolOk : c.accent }} />
          </div>
        </div>
        <button onClick={onClear} className="w-5 h-5 rounded flex items-center justify-center shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: c.textTertiary }} title={t('清除清单', 'Clear plan')} aria-label={t('清除清单', 'Clear plan')}>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-2 space-y-1">
        {plan.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="w-3.5 shrink-0 text-center text-[11px] leading-[18px]"
              style={{ color: s.status === 'completed' ? c.toolOk : s.status === 'in_progress' ? c.accent : c.textMuted }}>
              {s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '◐' : '○'}
            </span>
            <span className="text-[11.5px] leading-[18px] min-w-0"
              style={{
                color: s.status === 'completed' ? c.textMuted : s.status === 'in_progress' ? c.textHead : c.textSecondary,
                textDecoration: s.status === 'completed' ? 'line-through' : 'none',
              }}>
              {s.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
