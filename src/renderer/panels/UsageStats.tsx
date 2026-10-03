import { useState, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import { summarizeUsage } from '../store/usage'
import { fmtTokens } from '../utils/tokens'

interface Props { compact?: boolean }

export default function UsageStats({ compact = false }: Props) {
  const { c } = useTheme()
  const [sum, setSum] = useState(() => summarizeUsage(7))
  useEffect(() => {
    const onVisible = () => setSum(summarizeUsage(7))
    const t = setInterval(() => { if (!document.hidden) onVisible() }, 10000)
    return () => clearInterval(t)
  }, [])

  if (!sum || sum.total.msgs === 0) {
    return <p className="text-[11px]" style={{ color: c.textMuted }}>暂无使用记录</p>
  }

  const today = sum.days[sum.days.length - 1]
  const cards = compact
    ? [
        { label: '今日对话', value: `${today?.msgs || 0} 轮` },
        { label: '今日 tokens', value: fmtTokens((today?.prompt || 0) + (today?.completion || 0)) },
      ]
    : [
        { label: '7 天对话', value: `${sum.total.msgs} 轮` },
        { label: '7 天 tokens', value: fmtTokens(sum.total.prompt + sum.total.completion) },
        { label: '今日对话', value: `${today?.msgs || 0} 轮` },
        { label: '今日 tokens', value: fmtTokens((today?.prompt || 0) + (today?.completion || 0)) },
      ]

  return (
    <div className={compact ? 'flex gap-3 justify-center' : 'grid grid-cols-2 gap-2'}>
      {cards.map(card => (
        <div key={card.label} className="px-3 py-2.5 rounded-lg text-center" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
          <div className="text-[10px]" style={{ color: c.textMuted }}>{card.label}</div>
          <div className="text-[14px] font-semibold mt-1" style={{ color: c.textHead }}>{card.value}</div>
        </div>
      ))}
    </div>
  )
}
