/**
 * FreeModelsPanel — 免费模型面板（v8.2）
 *
 * 双免 key 源:GitHub Models(匿名免费档)+ Kilo Gateway(免费档/付费档)。
 * 一键切换 = 写入对应网关地址 + free 占位密钥 + 模型。
 * 主张:科技不是高高而上,而是服务于人民。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import type { Settings } from '../types'
import { pushNotice } from '../notify'

interface ModelInfo {
  id: string
  name: string
  context: number
  desc: string
  vision: boolean
}
interface Source {
  id: string
  name: string
  keyless: boolean
  base: string
  note?: string
  models: ModelInfo[]
  paid?: ModelInfo[]
  total?: number
}

export default function FreeModelsPanel({ settings, onSettingsChange }: { settings: Settings; onSettingsChange?: (s: Settings) => void }) {
  const { t } = useLanguage()
  const { c } = useTheme()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [testing, setTesting] = useState('')
  const [latency, setLatency] = useState<Record<string, number | string>>({})
  const [showPaid, setShowPaid] = useState(false)
  const [paidLimit, setPaidLimit] = useState(40)
  // Kilo 账户密钥(解锁付费档):存 DB 的 kilo_api_key,GET 回显为掩码
  const [kiloKey, setKiloKey] = useState('')
  const [kiloKeyDraft, setKiloKeyDraft] = useState('')
  const [kiloKeySaving, setKiloKeySaving] = useState(false)
  const [kiloKeyMsg, setKiloKeyMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/free-models')
      const d = await r.json()
      if (d?.ok && Array.isArray(d.sources)) setSources(d.sources)
      else setError(d?.error || '拉取失败')
    } catch (e: any) { setError(String(e?.message || e)) }
    setLoading(false)
  }, [])

  const loadKiloKey = useCallback(async () => {
    try {
      const r = await fetch('/api/settings')
      const d = await r.json()
      setKiloKey(String(d?.kilo_api_key || ''))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load(); loadKiloKey() }, [load, loadKiloKey])

  const saveKiloKey = async () => {
    const v = kiloKeyDraft.trim()
    if (!v) { setKiloKeyMsg('请输入密钥'); return }
    if (v.includes('****')) { setKiloKeyMsg('这是掩码回显,不是新密钥'); return }
    setKiloKeySaving(true); setKiloKeyMsg('')
    try {
      await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'kilo_api_key', value: v }) })
      setKiloKeyMsg('已保存 ✓'); setKiloKeyDraft('')
      await loadKiloKey()
    } catch (e: any) { setKiloKeyMsg('保存失败:' + String(e?.message || e)) }
    setKiloKeySaving(false)
  }

  const gh = sources.find(s => s.id === 'github')
  const kilo = sources.find(s => s.id === 'kilo')
  const currentBase = settings.apiBaseUrl || ''
  const isGh = /models\.github\.ai/.test(currentBase)
  const isKilo = /api\.kilo\.ai/.test(currentBase)
  const kiloReady = kiloKey !== '' && !kiloKey.includes('****')

  const filter = (list: ModelInfo[]) => {
    const k = q.trim().toLowerCase()
    if (!k) return list
    return list.filter(m => m.id.toLowerCase().includes(k) || m.name.toLowerCase().includes(k))
  }

  const switchTo = (m: ModelInfo, src: Source, isPaid: boolean) => {
    if (isPaid && !kiloReady) { setKiloKeyMsg('请先在上方配置 Kilo 账户密钥'); return }
    const next: Settings = {
      ...settings,
      provider: 'api',
      apiBaseUrl: src.base,
      apiKey: 'free',
      model: m.id,
    }
    onSettingsChange?.(next)
    pushNotice({ type: 'system', title: isPaid ? '已切换付费模型' : '已切换免费模型', body: m.name })
  }

  const testModel = async (m: ModelInfo, src: Source) => {
    setTesting(m.id)
    try {
      const r = await fetch('/api/free-model-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.id, base: src.id }) })
      const d = await r.json()
      setLatency(prev => ({ ...prev, [m.id]: d.ok ? d.ms : `✕ ${String(d.error || '失败').slice(0, 30)}` }))
    } catch (e: any) { setLatency(prev => ({ ...prev, [m.id]: `✕ ${e?.message || '失败'}` })) }
    setTesting('')
  }

  const fmtCtx = (n: number) => n ? (n >= 1024 ? (n / 1024).toFixed(0) + 'K' : String(n)) : '—'

  const row = (m: ModelInfo, src: Source, isPaid: boolean, isDefault = false) => {
    const active = (src.id === 'github' ? isGh : isKilo) && settings.model === m.id
    return (
      <div key={src.id + m.id} className="rounded-xl px-3 py-2.5 flex items-center gap-3"
        style={{ background: active ? 'rgba(16,163,127,.10)' : c.surfaceCard, border: `1px ${active ? 'solid rgba(16,163,127,.45)' : isDefault ? 'dashed rgba(16,163,127,.5)' : `solid ${c.border}`}` }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-medium truncate" style={{ color: c.textHead }}>{m.name}</span>
            {isDefault && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(16,163,127,.16)', color: '#10a37f' }}>{t('默认', 'Default')}</span>}
            {m.vision && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(59,130,246,.14)', color: '#60a5fa' }}>{t('识图', 'Vision')}</span>}
            {active && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(16,163,127,.16)', color: '#10a37f' }}>{t('使用中', 'In use')}</span>}
            {isPaid && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(245,158,11,.14)', color: '#f59e0b' }}>{t('付费', 'Paid')}</span>}
          </div>
          <div className="font-mono text-[10.5px] mt-0.5 truncate" style={{ color: c.textTertiary }}>{m.id} · ctx {fmtCtx(m.context)}</div>
        </div>
        <button onClick={() => testModel(m, src)} disabled={testing === m.id}
          className="px-2 h-7 rounded-lg text-[11px] shrink-0 disabled:opacity-50"
          style={{ background: c.bgInput, color: c.textSecondary }}
          title={t('发送最小请求测延迟', 'Ping latency')}>
          {testing === m.id ? '…' : (latency[m.id] !== undefined ? (typeof latency[m.id] === 'number' ? latency[m.id] + 'ms' : String(latency[m.id])) : t('测速', 'Ping'))}
        </button>
        <button onClick={() => switchTo(m, src, isPaid)} disabled={active}
          className="px-3 h-7 rounded-lg text-[11.5px] font-semibold shrink-0 disabled:opacity-40"
          style={{ background: isPaid ? '#b45309' : '#10a37f', color: '#fff' }}>
          {t('切换', 'Use')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: c.bg }}>
      <div className="flex items-center gap-2 px-4 h-12 border-b shrink-0" style={{ borderColor: c.border }}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#10a37f" strokeWidth={1.8} strokeLinecap="round"><path d="M12 3l1.9 5.6L20 10l-5.1 2.4L16 18l-4-3-4 3 1.1-5.6L4 10l6.1-1.4L12 3z" /></svg>
        <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{t('免费模型', 'Free Models')}</span>
        <span className="text-[11px]" style={{ color: c.textTertiary }}>{t('免 key · 免注册', 'keyless · no signup')}</span>
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

        {/* 推荐:GitHub Models 匿名免费档(质量最高) */}
        {gh && gh.models.length > 0 && (
          <div className="mb-3 rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(16,163,127,.14), rgba(255,255,255,.6) 70%)', border: '1px solid rgba(16,163,127,.4)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,163,127,.16)', color: '#10a37f' }}>{t('推荐', 'Top pick')}</span>
              <span className="text-[13px] font-bold" style={{ color: c.textHead }}>GitHub Models</span>
              <span className="text-[10px]" style={{ color: c.textTertiary }}>{t('免 key 直连', 'keyless')}</span>
            </div>
            <div className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: c.textSecondary }}>
              {t('GPT-4o/5、o4-mini、DeepSeek V3/R1、Llama、Mistral、Grok — 全部免 key 可用,有速率限制,失败会自动重试。', 'GPT-4o/5, o4-mini, DeepSeek V3/R1, Llama, Mistral, Grok — all keyless. Rate-limited; empty replies auto-retry.')}
            </div>
            <button onClick={() => switchTo(gh.models[0], gh, false)} disabled={isGh && settings.model === gh.models[0].id}
              className="px-4 h-8 rounded-full text-[12px] font-semibold disabled:opacity-40"
              style={{ background: '#10a37f', color: '#fff' }}>
              {isGh && settings.model === gh.models[0].id ? t('使用中', 'In use') : t('一键切换 GPT-4o mini', 'Switch to GPT-4o mini')}
            </button>
          </div>
        )}

        {/* Kilo 账户密钥配置(解锁付费档) */}
        <div className="mb-3 rounded-xl p-3" style={{ background: c.surfaceCard, border: `1px ${kiloReady ? 'solid rgba(16,163,127,.4)' : `dashed ${c.border}`}` }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12.5px] font-semibold" style={{ color: c.textHead }}>{t('Kilo 账户密钥', 'Kilo account key')}</span>
            <span className="text-[10.5px]" style={{ color: kiloReady ? '#10a37f' : c.textTertiary }}>
              {kiloReady ? `已配置 · ${kiloKey}` : t('未配置 — 仅能使用免费档', 'Not set — free tier only')}
            </span>
            <a href="https://app.kilo.ai" target="_blank" rel="noopener" className="ml-auto text-[10.5px]" style={{ color: '#60a5fa' }}>{t('去官网获取 →', 'Get one →')}</a>
          </div>
          <div className="flex items-center gap-2">
            <input value={kiloKeyDraft} onChange={e => setKiloKeyDraft(e.target.value)} type="password"
              placeholder={t('粘贴 Kilo API Key,仅存本机', 'Paste Kilo API key, stored locally only')}
              className="flex-1 h-8 px-2.5 rounded-lg text-[12px] outline-none" style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }} />
            <button onClick={saveKiloKey} disabled={kiloKeySaving}
              className="px-3 h-8 rounded-lg text-[12px] font-semibold disabled:opacity-50"
              style={{ background: '#10a37f', color: '#fff' }}>{kiloKeySaving ? '…' : t('保存', 'Save')}</button>
          </div>
          {kiloKeyMsg && <div className="text-[10.5px] mt-1.5" style={{ color: kiloKeyMsg.includes('✓') ? '#10a37f' : '#f59e0b' }}>{kiloKeyMsg}</div>}
        </div>

        {loading ? (
          <div className="grid place-items-center py-16 text-[12.5px]" style={{ color: c.textTertiary }}>{t('正在拉取免费模型目录…', 'Loading free catalogs…')}</div>
        ) : (
          <>
            {/* GitHub Models 全列表 */}
            {gh && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: c.textHead }}>GitHub Models</span>
                  <span className="text-[10px]" style={{ color: c.textTertiary }}>{gh.models.length} {t('个', 'models')}</span>
                  {isGh && settings.model && <span className="ml-auto text-[10.5px]" style={{ color: '#10a37f' }}>{t('当前:', 'Current:')} {settings.model}</span>}
                </div>
                <div className="space-y-1.5">
                  {filter(gh.models).map(m => row(m, gh, false, m.id === 'openai/gpt-4o-mini'))}
                </div>
              </div>
            )}

            {/* Kilo 免费档 */}
            {kilo && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: c.textHead }}>Kilo Gateway · {t('免费档', 'free')}</span>
                  <span className="text-[10px]" style={{ color: c.textTertiary }}>{kilo.models.length} {t('个', 'models')}</span>
                  {kilo.paid && kilo.paid.length > 0 && (
                    <button onClick={() => setShowPaid(v => !v)} className="ml-auto px-2 py-1 rounded-full" style={{ background: 'rgba(245,158,11,.12)', color: '#f59e0b' }}>
                      {t('付费档', 'Paid')} {kilo.paid.length} {showPaid ? '▴' : '▾'}
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {filter(kilo.models).map(m => row(m, kilo, false, m.id === 'openrouter/free'))}
                  {filter(kilo.models).length === 0 && (
                    <div className="text-center py-6 text-[12px]" style={{ color: c.textTertiary }}>{t('没有匹配的模型', 'No match')}</div>
                  )}
                </div>
                {showPaid && kilo.paid && (
                  <div className="mt-3 space-y-1.5">
                    <div className="text-[11px] font-semibold mb-1.5" style={{ color: '#f59e0b' }}>{t('付费档模型(使用上方 Kilo 账户密钥)', 'Paid models (uses your Kilo key)')}</div>
                    {filter(kilo.paid).slice(0, paidLimit).map(m => row(m, kilo, true))}
                    {kilo.paid.length > paidLimit && filter(kilo.paid).length >= paidLimit && (
                      <button onClick={() => setPaidLimit(v => v + 80)} className="w-full py-2 rounded-lg text-[11.5px]" style={{ background: c.bgInput, color: c.textSecondary }}>
                        {t('显示更多', 'Show more')}（{kilo.paid.length - paidLimit}）
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 px-4 py-2.5 border-t text-[10.5px] leading-relaxed" style={{ borderColor: c.border, color: c.textTertiary }}>
        {t('科技不是高高在上,而是服务于人民。两个源都免 key:GitHub Models(有速率限制)+ Kilo(每 IP 200 次/小时)。其余模型请自行测试可用性,空响应会自动重试;配置 Kilo 账户密钥后可用全部付费档。',
           'Technology should serve people, not stand above them. Both sources are keyless: GitHub Models (rate-limited) + Kilo (200 req/hour per IP). Other models: test yourself — empty replies auto-retry. Add a Kilo key to unlock paid tiers.')}
      </div>
    </div>
  )
}
