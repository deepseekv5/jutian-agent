/**
 * 用量与成本面板（v12）
 *
 * 数据来源：store/usage 已经累计的 usage 记录 + 本轮新增的逐条明细。
 * 金额一律标注"估算"——本地定价表会过时，不能让用户以为这是账单。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { summarize, dailySeries, formatTokens, formatUSD, budgetState, MODEL_PRICES } from '../../shared/usageCost'
import { loadUsageRecords, type UsageLike } from '../store/usageHistory'

export default function UsagePanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [records, setRecords] = useState<UsageLike[]>([])
  const [days, setDays] = useState(7)
  const [budget, setBudget] = useState(0)

  useEffect(() => {
    setRecords(loadUsageRecords())
    const on = () => setRecords(loadUsageRecords())
    window.addEventListener('usage-updated', on)
    return () => window.removeEventListener('usage-updated', on)
  }, [])

  useEffect(() => {
    try {
      const b = Number(localStorage.getItem('jt:usage-budget') || 0)
      if (Number.isFinite(b) && b > 0) setBudget(b)
    } catch { /* ignore */ }
  }, [])

  const windowed = useMemo(() => {
    const cutoff = Date.now() - days * 86400_000
    return records.filter((r) => r.ts >= cutoff)
  }, [records, days])

  const sum = useMemo(() => summarize(windowed), [windowed])
  const series = useMemo(() => dailySeries(windowed, days), [windowed, days])
  const maxTokens = Math.max(1, ...series.map((s) => s.tokens))
  const bud = budgetState(sum.costUSD, budget)

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>用量与成本</span>
        <span className="text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>估算</span>
        <span className="flex-1" />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="px-2 py-1 rounded-lg text-[11.5px] outline-none"
          style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }}>
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={90}>近 90 天</option>
        </select>
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
        {/* 概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '请求数', value: String(sum.requests) },
            { label: '总 Token', value: formatTokens(sum.totalTokens) },
            { label: '输入 / 输出', value: `${formatTokens(sum.promptTokens)} / ${formatTokens(sum.completionTokens)}` },
            { label: '估算花费', value: formatUSD(sum.costUSD) },
          ].map((k) => (
            <div key={k.label} className="rounded-xl px-3.5 py-3" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
              <div className="text-[10.5px]" style={{ color: c.textTertiary }}>{k.label}</div>
              <div className="text-[17px] font-bold mt-0.5" style={{ color: c.textHead }}>{k.value}</div>
            </div>
          ))}
        </div>

        {sum.unpriced > 0 && (
          <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(245,158,11,.1)', color: '#8a5a00' }}>
            有 {sum.unpriced} 次请求的模型不在本地定价表里，未计入花费 —— 实际金额可能更高。
          </div>
        )}
        {budget > 0 && (
          <div className="rounded-xl px-3.5 py-3" style={{ background: bud.over ? 'rgba(239,68,68,.09)' : c.bgInput, border: `1px solid ${c.borderLight}` }}>
            <div className="flex items-center text-[11.5px]" style={{ color: c.textSecondary || c.textTertiary }}>
              预算 {formatUSD(budget)} · 已用 {bud.pct}%
              <span className="flex-1" />
              <span style={{ color: bud.over ? '#ef4444' : c.textTertiary }}>{bud.over ? '已超出预算' : `剩余 ${formatUSD(bud.remaining)}`}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: c.borderLight }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, bud.pct)}%`, background: bud.over ? '#ef4444' : (c.accent || '#10a37f') }} />
            </div>
          </div>
        )}

        {/* 趋势 */}
        <div>
          <div className="text-[12px] font-bold mb-2" style={{ color: c.textHead }}>每日 Token</div>
          <div className="flex items-end gap-1.5 h-28">
            {series.map((s) => (
              <div key={s.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="w-full rounded-t transition-all"
                  style={{ height: `${Math.max(2, (s.tokens / maxTokens) * 88)}px`, background: s.tokens ? (c.accent || '#10a37f') : c.borderLight, opacity: s.tokens ? 0.85 : 0.5 }} />
                <span className="text-[8.5px] truncate w-full text-center" style={{ color: c.textTertiary }}>{s.date.slice(5)}</span>
                <div className="absolute -top-7 hidden group-hover:block px-1.5 py-0.5 rounded text-[9.5px] whitespace-nowrap z-10"
                  style={{ background: c.surfaceCard, color: c.textHead, border: `1px solid ${c.borderLight}` }}>
                  {formatTokens(s.tokens)} · {formatUSD(s.costUSD)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 按模型 */}
        <div>
          <div className="text-[12px] font-bold mb-2" style={{ color: c.textHead }}>按模型</div>
          {sum.byModel.length === 0 ? (
            <div className="text-[11.5px] py-4 text-center" style={{ color: c.textTertiary }}>这段时间还没有使用记录</div>
          ) : (
            <div className="space-y-1">
              {sum.byModel.map((m) => (
                <div key={m.model} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: c.bgInput }}>
                  <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: c.textHead }}>{m.model}</span>
                  <span className="text-[10.5px] shrink-0" style={{ color: c.textTertiary }}>{m.requests} 次</span>
                  <span className="text-[10.5px] shrink-0 w-16 text-right" style={{ color: c.textTertiary }}>{formatTokens(m.tokens)}</span>
                  <span className="text-[11px] shrink-0 w-20 text-right font-mono" style={{ color: m.priced ? (c.textHead) : c.textTertiary }}>
                    {m.priced ? formatUSD(m.costUSD) : '未定价'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-[10px] leading-relaxed pt-2" style={{ color: c.textTertiary }}>
          金额按本地内置定价表估算（每百万 token），共收录 {Object.keys(MODEL_PRICES).length} 个常见模型。
          供应商调价或走中转时实际账单可能不同，请以供应商账单为准。
        </div>
      </div>
    </div>
  )
}
