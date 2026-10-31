/**
 * 全局底部状态栏（VS Code 风格）：服务状态 · 工作区 · 模型 · 上下文 · 版本。
 * 企业级信息密度的关键件——始终可见的系统状态。
 */
import { useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { APP_VERSION } from '../brand'
import NotificationCenter from './NotificationCenter'
import { summarizeUsage } from '../store/usage'
import { fmtTokens } from '../utils/tokens'

interface Props {
  /** 工具服务健康状态：null = 检测中 */
  serverOk: boolean | null
  model: string
  workDir: string
}

export default function StatusBar({ serverOk, model, workDir }: Props) {
  const { c } = useTheme()
  const { lang, tt } = useLanguage()
  const minuteKey = Math.floor(Date.now() / 60000)
  // minuteKey 只作为「分钟时钟」参与依赖：每分钟变化一次以触发用量重算，回调内不直接引用它
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const usage = useMemo(() => summarizeUsage(1).today, [minuteKey])
  const usedTokens = usage.prompt + usage.completion

  return (
    <div className="jt-in-bottom group/status h-6 shrink-0 flex items-center gap-4 px-3 text-[11px] select-none transition-opacity glass"
      style={{ color: c.textMuted, opacity: 0.85 }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.55' }}>
      {/* 服务状态 */}
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{
          background: serverOk === null ? '#d97706' : serverOk ? '#16a34a' : '#dc2626',
          boxShadow: serverOk === true ? '0 0 4px rgba(22,163,74,0.5)' : 'none',
        }} />
        {serverOk === null ? tt('state.loading') : serverOk ? tt('state.connected') : tt('state.disconnected')}
      </span>

      {/* 工作区 */}
      <span className="flex items-center gap-1 min-w-0">
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="truncate max-w-[280px]" title={workDir || '系统默认'}>{workDir || '系统默认工作区'}</span>
      </span>

      <span className="flex-1" />

      {/* 今日用量 */}
      <span className="font-mono hidden sm:inline" title="今日对话轮次 / tokens">
        {lang === 'en' ? `Today ${usage.msgs} turns · ${fmtTokens(usedTokens)} tok` : `今日 ${usage.msgs} 轮 · ${fmtTokens(usedTokens)} tok`}
      </span>

      {/* 模型 */}
      <span className="font-mono max-w-[180px] truncate" title={`当前模型：${model}`}>{model || 'default'}</span>

      {/* 版本 */}
      <span className="font-mono">{'v' + APP_VERSION}</span>
        <NotificationCenter />
    </div>
  )
}
