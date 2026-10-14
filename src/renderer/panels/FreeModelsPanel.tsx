/**
 * FreeModelsPanel — 免费模型面板（v8.2）
 *
 * 双免 key 源:GitHub Models(匿名免费档)+ Kilo Gateway(免费档/付费档)。
 * 一键切换 = 写入对应网关地址 + free 占位密钥 + 模型。
 * 主张:科技不是高高而上,而是服务于人民。
 */
import { useCallback, useEffect, useState } from 'react'
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
interface Provider {
  id: string
  name: string
  base: string
  signup: string
  free: string
  models: { id: string; name: string; context: number }[]
}

export default function FreeModelsPanel({ settings, onSettingsChange }: { settings: Settings; onSettingsChange?: (s: Settings) => void }) {
  const { t } = useLanguage()
  const { c } = useTheme()
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [showProviders, setShowProviders] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [testing, setTesting] = useState('')
  const [latency, setLatency] = useState<Record<string, number | string>>({})
  // Kilo 账户密钥(解锁付费档):存 DB 的 kilo_api_key,GET 回显为掩码

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/free-models')
      const d = await r.json()
      if (d?.ok && Array.isArray(d.sources)) {
        setSources(d.sources)
        setProviders(Array.isArray(d.providers) ? d.providers : [])
      }
      else setError(d?.error || '拉取失败')
    } catch (e: any) { setError(String(e?.message || e)) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const gh = sources.find(s => s.id === 'github')
  const kilo = sources.find(s => s.id === 'kilo')
  const currentBase = settings.apiBaseUrl || ''
  const isGh = /models\.github\.ai/.test(currentBase)
  const isKilo = /api\.kilo\.ai/.test(currentBase)

  const filter = (list: ModelInfo[]) => {
    const k = q.trim().toLowerCase()
    if (!k) return list
    return list.filter(m => m.id.toLowerCase().includes(k) || m.name.toLowerCase().includes(k))
  }

  const switchTo = (m: ModelInfo, src: Source) => {
    const next: Settings = {
      ...settings,
      provider: 'api',
      apiBaseUrl: src.base,
      apiKey: 'free',
      model: m.id,
    }
    onSettingsChange?.(next)
    pushNotice({ type: 'system', title: '已切换免费模型', body: m.name })
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

  const fillProvider = (p: Provider, modelId: string) => {
    const next: Settings = {
      ...settings,
      provider: 'api',
      apiBaseUrl: p.base,
      apiKey: settings.apiKey && !settings.apiKey.includes('****') ? settings.apiKey : '',
      model: modelId,
    }
    onSettingsChange?.(next)
    pushNotice({ type: 'system', title: '已填入模型地址', body: `${p.name} · ${modelId} — 请到 设置→推理 粘贴该平台的免费密钥` })
  }

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
          {(m as any).unavailable && (
            <div className="text-[10.5px] mt-0.5" style={{ color: '#d97706' }}>
              {(m as any).reason || '当前网络下不可用'}
            </div>
          )}
        </div>
        {/* 测速按钮：Zen 车道不给——它的请求姿势与通用探测不同
            （必须带 x-opencode-* 指纹头 + 强制流式 + 四个指纹工具），
            拿通用最小请求去测只会得到误导性的失败，不如不给。 */}
        {src.id !== 'opencode-zen' && (
          <button onClick={() => testModel(m, src)} disabled={testing === m.id}
            className="px-2 h-7 rounded-lg text-[11px] shrink-0 disabled:opacity-50"
            style={{ background: c.bgInput, color: c.textSecondary }}
            title={t('发送最小请求测延迟', 'Ping latency')}>
            {testing === m.id ? '…' : (latency[m.id] !== undefined ? (typeof latency[m.id] === 'number' ? latency[m.id] + 'ms' : String(latency[m.id])) : t('测速', 'Ping'))}
          </button>
        )}
        <button onClick={() => switchTo(m, src)} disabled={active}
          className="px-3 h-7 rounded-lg text-[11.5px] font-semibold shrink-0 disabled:opacity-40"
          style={{ background: '#10a37f', color: '#fff' }}>
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
              <span className="text-[13px] font-bold" style={{ color: c.textHead }}>Pollinations · GPT-OSS 20B</span>
              <span className="text-[10px]" style={{ color: c.textTertiary }}>{t('免 key 直连', 'keyless')}</span>
            </div>
            <div className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: c.textSecondary }}>
              {t('推理 + 工具调用能力,完全免费无需注册;另有 Kilo 网关 21 个免费档(默认 openrouter/free 自动路由)。', 'Reasoning + tool calling, fully free, no signup. Plus Kilo gateway with 21 free tiers (default openrouter/free auto-routing).')}
            </div>
            <button onClick={() => { const src = sources.find(s => s.id === 'pollinations'); if (src) switchTo(src.models[0], src) }}
              disabled={!sources.some(s => s.id === 'pollinations')}
              className="px-4 h-8 rounded-full text-[12px] font-semibold disabled:opacity-40"
              style={{ background: '#10a37f', color: '#fff' }}>
              {t('一键切换 GPT-OSS 20B', 'Switch to GPT-OSS 20B')}
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid place-items-center py-16 text-[12.5px]" style={{ color: c.textTertiary }}>{t('正在拉取免费模型目录…', 'Loading free catalogs…')}</div>
        ) : (
          <>
            {/* 通用多源渲染:Pollinations / Kilo / 未来新源 */}
            {sources.map(src => (
              <div key={src.id} className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: c.textHead }}>{src.name}{src.paid ? ` · ${t('免费档', 'free')}` : ''}</span>
                  <span className="text-[10px]" style={{ color: c.textTertiary }}>{src.models.length} {t('个', 'models')}</span>
                  {src.note && <span className="text-[10px] truncate" style={{ color: c.textTertiary }}>{src.note}</span>}
                  {((src.id === 'kilo' ? isKilo : /pollinations/.test(currentBase)) && settings.model) &&
                    <span className="ml-auto text-[10.5px]" style={{ color: '#10a37f' }}>{t('当前:', 'Current:')} {settings.model}</span>}
                </div>
                <div className="space-y-1.5">
                  {filter(src.models).map(m => row(m, src, false,
                    src.id === 'kilo' ? m.id === 'openrouter/free' : m.id === 'openai-fast'))}
                  {filter(src.models).length === 0 && (
                    <div className="text-center py-6 text-[12px]" style={{ color: c.textTertiary }}>{t('没有匹配的模型', 'No match')}</div>
                  )}
                </div>
              </div>
            ))}

            {/* Kilo 免费档。
                这里只列免费模型：付费档（375 个）已移除——本面板的定位是
                "免 key 就能用"，混着付费档既让清单臃肿，也容易让人误以为
                选中的是免费额度。需要付费模型走设置里的常规供应商配置。 */}
            {kilo && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: c.textHead }}>Kilo Gateway · {t('免费档', 'free')}</span>
                  <span className="text-[10px]" style={{ color: c.textTertiary }}>{kilo.models.length} {t('个', 'models')}</span>
                </div>
                <div className="space-y-1.5">
                  {filter(kilo.models).map(m => row(m, kilo, false, m.id === 'openrouter/free'))}
                  {filter(kilo.models).length === 0 && (
                    <div className="text-center py-6 text-[12px]" style={{ color: c.textTertiary }}>{t('没有匹配的模型', 'No match')}</div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* 免费额度提供商(注册即免费,自备 key)— 位于滚动容器内 */}
        {providers.length > 0 && (
          <div className="mt-5">
            <button onClick={() => setShowProviders(v => !v)} className="flex items-center gap-2 mb-2 w-full text-left">
              <span className="text-[12px] font-bold" style={{ color: c.textHead }}>{t('免费额度提供商', 'Free-tier providers')}</span>
              <span className="text-[10px]" style={{ color: c.textTertiary }}>{providers.length} {t('家 · 注册即免费', 'providers · free on signup')}</span>
              <span className="ml-auto text-[11px]" style={{ color: c.textTertiary }}>{showProviders ? '▴' : '▾'}</span>
            </button>
            {showProviders && (
              <div className="space-y-2">
                <div className="text-[10.5px] leading-relaxed" style={{ color: c.textTertiary }}>
                  {t('均为 OpenAI 兼容端点(实测存活)。「填入」会写好地址和模型,密钥需到各平台免费注册后粘贴到 设置 → 推理。', 'All are verified OpenAI-compatible endpoints. Fill sets the URL + model; paste your free key in Settings → Inference.')}
                </div>
                {providers.map(p => (
                  <div key={p.id} className="rounded-xl p-3" style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[12.5px] font-semibold" style={{ color: c.textHead }}>{p.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,163,127,.12)', color: '#10a37f' }}>{p.free}</span>
                      <a href={p.signup} target="_blank" rel="noopener" className="ml-auto text-[10.5px]" style={{ color: '#60a5fa' }}>{t('去注册 →', 'Sign up →')}</a>
                    </div>
                    <div className="font-mono text-[10px] mb-2 truncate" style={{ color: c.textTertiary }}>{p.base}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.models.map(m => (
                        <button key={m.id} onClick={() => fillProvider(p, m.id)}
                          className="px-2.5 h-7 rounded-full text-[11px] flex items-center gap-1.5"
                          style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.border}` }}
                          title={`${m.id} · ctx ${fmtCtx(m.context)}`}>
                          {m.name}
                          <span style={{ color: '#10a37f' }}>{t('填入', 'Fill')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

        <div className="shrink-0 px-4 py-2.5 border-t text-[10.5px] leading-relaxed" style={{ borderColor: c.border, color: c.textTertiary }}>
        {t('科技不是高高在上,而是服务于人民。Kilo 网关免 key,每 IP 200 次/小时。其余模型请自行测试可用性,空响应会自动重试;配置 Kilo 账户密钥后可用全部付费档。',
           'Technology should serve people, not stand above them. Kilo gateway is keyless, 200 req/hour per IP. Other models: test yourself — empty replies auto-retry. Add a Kilo key to unlock paid tiers.')}
      </div>
    </div>
  )
}
