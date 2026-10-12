/**
 * 任务清单卡片 —— update_plan 工具的可视化（对标 Claude Code 的 TodoWrite）
 *
 * 多步任务最痛的是"不知道进行到哪了"：一长串工具调用滚过去，用户得自己
 * 数哪步做完了。模型通过 update_plan 维护清单，这里把它显示成进度。
 *
 * 计划模式下它同时是"计划确认卡"：给出方案后等用户批准（或带反馈打回），
 * 批准才解除只读门禁。所以卡片有两种形态：
 *   - 待批准（planModeOn）：底部一排 批准 / 提修改意见 / 退出计划模式
 *   - 执行中/已完成：只有原有的进度展示与清除
 *
 * 亮色液态玻璃风格，与 GoalCard 同一视觉语言。
 */
import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { Plan } from '../../shared/planTool'
import { planProgress } from '../../shared/planTool'

export default function PlanCard({ plan, onClear, planModeOn = false, onApprove, onExitPlanMode }: {
  plan: Plan
  onClear: () => void
  /** 计划模式且未批准：显示批准/反馈按钮 */
  planModeOn?: boolean
  onApprove?: (feedback?: string) => void
  onExitPlanMode?: () => void
}) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const { done, total, label } = planProgress(plan)
  const allDone = done === total
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <div className="mx-auto w-full rounded-2xl px-4 py-3 glass-strong"
      style={{ border: `1px solid ${planModeOn ? 'rgba(124,58,237,0.34)' : allDone ? 'rgba(16,185,129,0.32)' : c.border}`, maxWidth: 760, background: c.bgCard }}>
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: planModeOn ? 'rgba(124,58,237,0.10)' : allDone ? 'rgba(16,185,129,0.14)' : `${c.accent}14`, color: planModeOn ? '#7c3aed' : allDone ? c.toolOk : c.accent }}>
          {planModeOn ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          ) : allDone ? (
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
            <span className="text-[12.5px] font-semibold" style={{ color: c.textHead }}>
              {planModeOn ? t('计划待你确认', 'Plan awaiting approval') : t('任务清单', 'Plan')}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: planModeOn ? 'rgba(124,58,237,0.10)' : allDone ? 'rgba(16,185,129,0.12)' : c.bgInput, color: planModeOn ? '#7c3aed' : allDone ? c.toolOk : c.textTertiary }}>
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

      {/* 计划模式下的确认操作：批准即解除只读门禁；反馈让模型重出方案 */}
      {planModeOn && (
        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: `1px solid ${c.border}` }}>
          {showFeedback ? (
            <>
              <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
                placeholder={t('哪里需要改？比如：第二步换成不重启服务的方式', 'What should change?')}
                rows={2} autoFocus
                className="w-full text-[12px] rounded-lg px-2.5 py-2 outline-none resize-none"
                style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textHead }} />
              <div className="flex items-center gap-2">
                <button onClick={() => onApprove?.(feedback)} disabled={!feedback.trim()}
                  className="h-7 px-3 rounded-lg text-[12px] font-medium transition-opacity disabled:opacity-40"
                  style={{ background: '#7c3aed', color: '#fff' }}>
                  {t('按意见改方案', 'Revise with feedback')}
                </button>
                <button onClick={() => { setShowFeedback(false); setFeedback('') }}
                  className="h-7 px-3 rounded-lg text-[12px] font-medium"
                  style={{ color: c.textSecondary }}>
                  {t('取消', 'Cancel')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => onApprove?.()}
                className="h-7 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5"
                style={{ background: '#7c3aed', color: '#fff' }}
                title={t('批准后我开始按计划执行', 'Approve to start executing')}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {t('批准执行', 'Approve & execute')}
              </button>
              <button onClick={() => setShowFeedback(true)}
                className="h-7 px-3 rounded-lg text-[12px] font-medium"
                style={{ border: `1px solid ${c.border}`, color: c.textSecondary }}>
                {t('提修改意见', 'Give feedback')}
              </button>
              {onExitPlanMode && (
                <button onClick={onExitPlanMode}
                  className="h-7 px-3 rounded-lg text-[12px] font-medium ml-auto"
                  style={{ color: c.textTertiary }}
                  title={t('退出计划模式', 'Exit plan mode')}>
                  {t('退出计划模式')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
