/**
 * FreeModelsPanel — 免费模型面板（v7.1）
 *
 * 数据源:Kilo Gateway 免 key 目录(全量免费档),经 /api/free-models 聚合。
 * 一键切换 = 写入 apiBaseUrl / apiKey(free)/ model 三个设置项。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { Settings } from '../types'
import { pushNotice } from '../notify'

interface FreeModel {
  id: string
  name: string
  context: number
  desc: string
  vision: boolean
}

export default function FreeModelsPanel({ settings, onSettingsChange }: { settings: Settings; onSettingsChange?: (s: Settings) => void }) {
  const { t } = useLanguage()
  const { c } = useTheme()
  const [models, setModels] = useState<FreeModel[]>([])
  const [meta, setMeta] = useState<{ total: number; paidCount: number; ts: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [testing, setTesting] = useState('')
  const [latency, setLatency] = useState<Record<string, number | string>>({})

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/free-models')
      const d = await r.json()
      if (d?.ok && Array.isArray(d.free)) {
        setModels(d.free)
        setMeta({ total: d.total || 0, paidCount: d.paidCount || 0, ts: d.ts || '' })
      } else setError(d?.error || '拉取失败')
    } catch (e: any) { setError(String(e?.message || e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const currentBase = settings.apiBaseUrl || ''
  const isKilo = /api\.kilo\.ai/.test(currentBase)
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return models
    return models.filter(m => m.id.toLowerCase().includes(k) || m.name.toLowerCase().includes(k))
  }, [models, q])

  const switchTo = (m: FreeModel) => {
    const next: Settings = {
      ...settings,
      provider: 'api',
      apiBaseUrl: 'https://api.kilo.ai/api/gateway/v1',
      apiKey: 'free',
      model: m.id,
    }
    onSettingsChange?.(next)
    pushNotice({ type: 'system', title: '已切换免费模型', body: m.name })
  }

  const testModel = async (m: FreeModel) => {
    setTesting(m.id)
    try {
      const r = await fetch('/api/free-model-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.id }) })
      const d = await r.json()
      setLatency(prev => ({ ...prev, [m.id]: d.ok ? d.ms : `✕ ${String(d.error || '失败').slice(0, 30)}` }))
    } catch (e: any) { setLatency(prev => ({ ...prev, [m.id]: `✕ ${e?.message || '失败'}` })) }
    setTesting('')
  }

  const fmtCtx = (n: number) => n ? (n >= 1024 ? (n / 1024).toFixed(0) + 'K' : String(n)) : '—'

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: c.bg }}>
      <div className="flex items-center gap-2 px-4 h-12 border-b shrink-0" style={{ borderColor: c.border }}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#10a37f" strokeWidth={1.8} strokeLinecap="round"><path d="M12 3l1.9 5.6L20 10l-5.1 2.4L16 18l-4-3-4 3 1.1-5.6L4 10l6.1-1.4L12 3z" /></svg>
        <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{t('免费模型', 'Free Models')}</span>
        <span className="text-[11px]" style={{ color: c.textTertiary }}>Kilo Gateway · 免 key</span>
        <div className="ml-auto flex items-center gap-1.5">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('搜索模型', 'Search')}
            className="h-7 px-2 rounded-md text-[11.5px] w-32 outline-none" style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }} />
          <button onClick={load} className="px-2 py-1 rounded-md text-[11px]" style={{ background: c.bgInput, color: c.textSecondary }}>{t('刷新', 'Refresh')}</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 min-h-0">
        {error && (
          <div className="mb-3 rounded-lg p-2.5 text-[12px]" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}>{error}</div>
        )}

        {/* 状态摘要 */}
        <div className="mb-3 flex items-center gap-2 flex-wrap text-[11.5px]" style={{ color: c.textSecondary }}>
          <span className="px-2 py-1 rounded-full" style={{ background: 'rgba(16,163,127,.12)', color: '#10a37f' }}>
            {models.length} {t('个免费模型可用', 'free models')}
          </span>
          {meta && meta.paidCount > 0 && (
            <span style={{ color: c.textTertiary }}>{t('另有', 'plus')} {meta.paidCount} {t('个付费档(需 Kilo 账户)', 'paid (need Kilo account)')}</span>
          )}
          {isKilo && settings.model && (
            <span className="ml-auto" style={{ color: '#10a37f' }}>{t('当前:', 'Current:')} {settings.model}</span>
          )}
        </div>

        {loading ? (
          <div className="grid place-items-center py-16 text-[12.5px]" style={{ color: c.textTertiary }}>{t('正在拉取 Kilo 免费模型目录…', 'Loading Kilo free catalog…')}</div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map(m => {
              const active = isKilo && settings.model === m.id
              return (
                <div key={m.id} className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                  style={{ background: active ? 'rgba(16,163,127,.10)' : c.surfaceCard, border: `1px solid ${active ? 'rgba(16,163,127,.45)' : c.border}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-medium truncate" style={{ color: c.textHead }}>{m.name}</span>
                      {m.vision && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(59,130,246,.14)', color: '#60a5fa' }}>{t('识图', 'Vision')}</span>}
                      {active && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(16,163,127,.16)', color: '#10a37f' }}>{t('使用中', 'In use')}</span>}
                    </div>
                    <div className="font-mono text-[10.5px] mt-0.5 truncate" style={{ color: c.textTertiary }}>{m.id} · ctx {fmtCtx(m.context)}</div>
                  </div>
                  <button onClick={() => testModel(m)} disabled={testing === m.id}
                    className="px-2 h-7 rounded-lg text-[11px] shrink-0 disabled:opacity-50"
                    style={{ background: c.bgInput, color: c.textSecondary }}
                    title={t('发送最小请求测延迟', 'Ping latency')}>
                    {testing === m.id ? '…' : (latency[m.id] !== undefined ? (typeof latency[m.id] === 'number' ? latency[m.id] + 'ms' : String(latency[m.id])) : t('测速', 'Ping'))}
                  </button>
                  <button onClick={() => switchTo(m)} disabled={active}
                    className="px-3 h-7 rounded-lg text-[11.5px] font-semibold shrink-0 disabled:opacity-40"
                    style={{ background: '#10a37f', color: '#fff' }}>
                    {t('切换', 'Use')}
                  </button>
                </div>
              )
            })}
            {filtered.length === 0 && !loading && (
              <div className="text-center py-10 text-[12px]" style={{ color: c.textTertiary }}>{t('没有匹配的模型', 'No match')}</div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t text-[10.5px] leading-relaxed" style={{ borderColor: c.border, color: c.textTertiary }}>
        {t('免费额度:每 IP 200 次/小时,无需注册。「切换」会把 API 地址设为 Kilo 网关、密钥填 free(免鉴权)。付费档模型需 Kilo 账户密钥,在 设置 → 推理 里手动填写。',
           'Free tier: 200 req/hour per IP, no signup. Switching sets the Kilo gateway URL with a keyless "free" token. Paid models need a Kilo account key (Settings → Inference).')}
      </div>
    </div>
  )
}
