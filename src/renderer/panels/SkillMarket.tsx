import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'
import { fetchCompat } from '../api'

interface SkillTool { name: string; description: string }
interface MarketSkill { id: string; name: string; version: string; author: string; description: string; tags: string[]; tools: SkillTool[]; instructions?: string; source_url?: string }
// 真实市场条目（anthropics/skills 官方 + superpowers 社区，服务端枚举归一化）
interface RemoteSkill { id: string; name: string; description: string; author: string; version: string; source: 'official' | 'community'; sourceLabel: string; repo: string; path: string }

type Tab = 'market' | 'remote' | 'installed'

export default function SkillMarket({ onClose, embedded: _embedded }: { onClose: () => void; embedded?: boolean }) {
  const { c } = useTheme()
  const [skills, setSkills] = useState<MarketSkill[]>([])
  const [search, setSearch] = useState('')
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set())
  const [uninstallingIds, setUninstallingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [githubInstalling, setGithubInstalling] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('market')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 在线市场状态
  const [remoteItems, setRemoteItems] = useState<RemoteSkill[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteLoaded, setRemoteLoaded] = useState(false)
  const [remoteStale, setRemoteStale] = useState(false)
  const [remoteSource, setRemoteSource] = useState<'all' | 'official' | 'community'>('all')
  const [remoteMd, setRemoteMd] = useState<Record<string, string>>({})

  const loadMarket = useCallback(async () => {
    try {
      const [marketRes, installedRes] = await Promise.all([
        fetchCompat('/api/skills/market'),
        fetchCompat('/api/tools/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'list_skills', args: {} }) })
      ])
      let marketSkills: MarketSkill[] = []
      if (marketRes.ok) {
        const ct = marketRes.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          try { marketSkills = await marketRes.json() } catch {}
        }
      }
      const ids = new Set<string>()
      const extraSkills: MarketSkill[] = []
      if (installedRes.ok) {
        const data = await installedRes.json()
        if (data.success) {
          let list: any[] = []
          try { list = JSON.parse(data.output) } catch {}
          for (const s of list) {
            if (s.name !== 'builtin') {
              ids.add(s.name)
              if (!marketSkills.find(m => m.id === s.name || m.id === s.id)) {
                extraSkills.push({ id: s.name || s.id, name: s.display_name || s.name || s.id, version: s.version || '1.0.0', author: s.author || 'Unknown', description: s.description || '', tags: ['installed'], tools: s.tools || [], source_url: s.source_url || '' })
              }
            }
          }
        }
      }
      setInstalledIds(ids)
      setSkills([...marketSkills, ...extraSkills])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadMarket() }, [loadMarket])

  // 在线市场懒加载：第一次切到该页签才拉（6h 服务端缓存，切换不重复请求）
  const loadRemote = useCallback(async (refresh = false) => {
    setRemoteLoading(true)
    try {
      const res = await fetchCompat(`/api/skills/remote${refresh ? '?refresh=1' : ''}`)
      const data = await res.json()
      if (data.success) { setRemoteItems(data.items || []); setRemoteStale(!!data.stale) }
      else setError(data.error || '在线市场拉取失败')
    } catch (e: any) { setError(e.message) }
    finally { setRemoteLoading(false); setRemoteLoaded(true) }
  }, [])

  const handleInstall = async (skill: MarketSkill) => {
    setInstallingIds(prev => new Set(prev).add(skill.id)); setError('')
    try {
      const res = await fetchCompat('/api/skills/install-from-market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillId: skill.id }) })
      const data = await res.json()
      if (data.success) { setInstalledIds(prev => new Set(prev).add(skill.id)); window.dispatchEvent(new Event('skills-changed')) }
      else setError(data.error || '安装失败')
    } catch (e: any) { setError(e.message) }
    finally { setInstallingIds(prev => { const n = new Set(prev); n.delete(skill.id); return n }) }
  }

  // 在线市场直装：从官方/社区仓库拉真实技能文件
  const handleInstallRemote = async (skill: RemoteSkill) => {
    setInstallingIds(prev => new Set(prev).add(skill.id)); setError('')
    try {
      const res = await fetchCompat('/api/skills/install-remote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: skill.repo, path: skill.path }) })
      const data = await res.json()
      if (data.success) { setInstalledIds(prev => new Set(prev).add(skill.id)); window.dispatchEvent(new Event('skills-changed')) }
      else setError(data.error || '安装失败')
    } catch (e: any) { setError(e.message) }
    finally { setInstallingIds(prev => { const n = new Set(prev); n.delete(skill.id); return n }) }
  }

  const handleUninstall = async (skillId: string) => {
    setUninstallingIds(prev => new Set(prev).add(skillId)); setError('')
    try {
      const res = await fetchCompat('/api/skills/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillName: skillId }) })
      const data = await res.json()
      if (data.success) { setInstalledIds(prev => { const n = new Set(prev); n.delete(skillId); return n }); setSkills(prev => prev.filter(s => s.id !== skillId)); window.dispatchEvent(new Event('skills-changed')) }
      else setError(data.error || '卸载失败')
    } catch (e: any) { setError(e.message) }
    finally { setUninstallingIds(prev => { const n = new Set(prev); n.delete(skillId); return n }) }
  }

  const handleGithubInstall = async () => {
    const url = githubUrl.trim(); if (!url) return
    setGithubInstalling(true); setError('')
    try {
      const res = await fetchCompat('/api/skills/install-from-github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ githubUrl: url }) })
      const data = await res.json()
      if (data.success) { setInstalledIds(prev => new Set(prev).add(data.repo || 'github-skill')); setGithubUrl(''); loadMarket(); window.dispatchEvent(new Event('skills-changed')) }
      else setError(data.error || '安装失败')
    } catch (e: any) { setError(e.message) }
    finally { setGithubInstalling(false) }
  }

  // 展开在线技能详情：按需取 SKILL.md 正文，取过不重复取
  const toggleRemoteDetail = async (skill: RemoteSkill) => {
    if (expandedId === skill.id) { setExpandedId(null); return }
    setExpandedId(skill.id)
    if (remoteMd[skill.id]) return
    try {
      const res = await fetchCompat(`/api/skills/remote-file?repo=${encodeURIComponent(skill.repo)}&path=${encodeURIComponent(skill.path + '/SKILL.md')}`)
      const data = await res.json()
      if (data.success) setRemoteMd(prev => ({ ...prev, [skill.id]: data.text }))
      else setRemoteMd(prev => ({ ...prev, [skill.id]: '（说明加载失败：' + (data.error || '') + '）' }))
    } catch { setRemoteMd(prev => ({ ...prev, [skill.id]: '（说明加载失败）' })) }
  }

  const q = search.trim().toLowerCase()
  const filteredSkills = skills.filter(s => {
    const isInstalled = s.tags.includes('installed') || installedIds.has(s.id)
    if (activeTab === 'installed' && !isInstalled) return false
    if (activeTab === 'market' && isInstalled) return false
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })
  const filteredRemote = remoteItems.filter(s => {
    if (remoteSource !== 'all' && s.source !== remoteSource) return false
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.author.toLowerCase().includes(q)
  })

  const tabLabel = (t: Tab) => t === 'market' ? '市场' : t === 'remote' ? '在线市场' : `已安装 (${installedIds.size})`

  return (
    <PageShell onClose={onClose} title="Skills 市场" description="真实技能市场：Anthropic 官方与社区仓库，一键安装" icon="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z">
      {/* Search bar */}
      <div className="px-4 py-3">
        <div className="relative max-w-md">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder={activeTab === 'remote' ? '搜索官方与社区技能...' : '搜索 Skills...'} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 h-9 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
        </div>
      </div>

      {/* GitHub install（仅本地市场页签展示，避免在线页签重复入口） */}
      {activeTab === 'market' && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 max-w-xl">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textSecondary }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12.001 6.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM12.001 6.5v6m0 0l-3-3m3 3l3-3"/>
            </svg>
            <input type="text" placeholder="粘贴 GitHub 仓库 URL 安装..." value={githubUrl} onChange={e => setGithubUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleGithubInstall() }}
              className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            <button onClick={handleGithubInstall} disabled={githubInstalling || !githubUrl.trim()}
              className="shrink-0 h-9 px-4 rounded-lg text-[13px] font-medium disabled:opacity-30" style={{ background: c.textHead, color: c.bg }}>
              {githubInstalling ? '安装中...' : '安装'}
            </button>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="px-4 pb-3 flex gap-2">
        {(['market', 'remote', 'installed'] as const).map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'remote' && !remoteLoaded && !remoteLoading) loadRemote() }}
            className="h-8 px-4 rounded-lg text-[13px] font-medium transition-colors"
            style={{ background: activeTab === tab ? c.bg : 'transparent', color: activeTab === tab ? c.textHead : c.textSecondary, border: `1px solid ${activeTab === tab ? c.border : 'transparent'}` }}>
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      {/* 在线市场来源过滤 */}
      {activeTab === 'remote' && (
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
          {([['all', '全部'], ['official', 'Anthropic 官方'], ['community', '社区']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setRemoteSource(k)}
              className="h-7 px-3 rounded-full text-[11.5px] font-medium transition-colors"
              style={{ background: remoteSource === k ? c.bgInput : 'transparent', color: remoteSource === k ? c.textHead : c.textTertiary, border: `1px solid ${remoteSource === k ? c.border : c.borderLight}` }}>
              {label}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => loadRemote(true)} disabled={remoteLoading}
            className="h-7 px-3 rounded-full text-[11.5px] disabled:opacity-40" style={{ color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>
            {remoteLoading ? '刷新中...' : '刷新'}
          </button>
          {remoteStale && <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706' }}>缓存数据（网络不可达）</span>}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg text-xs flex items-center justify-between" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
          <span> [!] {error}</span>
          <button onClick={() => setError('')} className="underline">关闭</button>
        </div>
      )}

      {/* Skills list */}
      <div className="px-4 pb-4">
        {loading || (activeTab === 'remote' && remoteLoading && !remoteLoaded) ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="px-4 py-3.5 rounded-xl glass" style={{ border: `1px solid ${c.borderLight}` }}>
                <div className="h-3.5 rounded mb-2 animate-pulse" style={{ background: c.bgInput, width: '32%' }} />
                <div className="h-2.5 rounded animate-pulse" style={{ background: c.bgInput, width: '72%' }} />
              </div>
            ))}
          </div>
        ) : activeTab === 'remote' ? (
          filteredRemote.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <p className="text-[13px]" style={{ color: c.textMuted }}>{q ? '未找到匹配的在线技能' : '在线市场暂无技能，点「刷新」重试'}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredRemote.map(skill => {
                const isInstalled = installedIds.has(skill.id)
                const isInstalling = installingIds.has(skill.id)
                const isUninstalling = uninstallingIds.has(skill.id)
                const official = skill.source === 'official'
                return (
                  <div key={`${skill.repo}/${skill.path}`} className="flex items-start gap-3 px-4 py-3 rounded-xl glass" style={{ border: `1px solid ${c.borderLight}` }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[13px] font-semibold" style={{ color: c.text }}>{skill.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                          style={official ? { background: 'rgba(16,163,127,0.1)', color: '#0d9d73' } : { background: c.bgInput, color: c.textMuted }}>
                          {skill.sourceLabel}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: c.bgInput, color: c.textMuted }}>v{skill.version}</span>
                        <span className="text-[10px]" style={{ color: c.textMuted }}>by {skill.author}</span>
                      </div>
                      <p className="text-[12px] leading-relaxed" style={{ color: c.textSecondary }}>{skill.description}</p>
                      <div className="mt-2">
                        <button onClick={() => toggleRemoteDetail(skill)}
                          className="text-[11px] font-medium flex items-center gap-1" style={{ color: c.accent }}>
                          {expandedId === skill.id ? '收起说明' : '查看 SKILL.md'}
                          <svg className={`w-3 h-3 transition-transform ${expandedId === skill.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {expandedId === skill.id && (
                          <pre className="mt-2 px-3 py-2.5 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto" style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>{remoteMd[skill.id] || '加载中...'}</pre>
                        )}
                      </div>
                    </div>
                    <button onClick={() => { if (isInstalled && !isUninstalling) handleUninstall(skill.id); else if (!isInstalled && !isInstalling) handleInstallRemote(skill) }} disabled={isInstalling || isUninstalling}
                      className="shrink-0 h-8 px-3.5 rounded-lg text-[12px] font-medium disabled:opacity-30"
                      style={{ background: isInstalled ? c.toolErr : c.textHead, color: '#fff' }}>
                      {isInstalling ? '安装中...' : isUninstalling ? '卸载中...' : isInstalled ? '卸载' : '安装'}
                    </button>
                  </div>
                )
              })}
            </div>
          )
        ) : filteredSkills.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-[13px]" style={{ color: c.textMuted }}>
              {activeTab === 'installed' ? '暂无已安装的 Skills' : search ? '未找到匹配的 Skills' : '市场暂无 Skills'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredSkills.map(skill => {
              const isInstalled = installedIds.has(skill.id)
              const isInstalling = installingIds.has(skill.id)
              const isUninstalling = uninstallingIds.has(skill.id)
              return (
                <div key={skill.id} className="flex items-start gap-3 px-4 py-3 rounded-xl glass" style={{ border: `1px solid ${c.borderLight}` }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold" style={{ color: c.text }}>{skill.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: c.bgInput, color: c.textMuted }}>v{skill.version}</span>
                      <span className="text-[10px]" style={{ color: c.textMuted }}>by {skill.author}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed" style={{ color: c.textSecondary }}>{skill.description}</p>
                    {skill.tools.length > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {skill.tools.slice(0, 4).map(t => (
                          <span key={t.name} className="text-[10px] font-mono px-1.5 py-0.5 rounded-md" style={{ background: c.bgInput, color: c.textMuted }}>{t.name}</span>
                        ))}
                        {skill.tools.length > 4 && <span className="text-[10px]" style={{ color: c.textMuted }}>+{skill.tools.length - 4}</span>}
                      </div>
                    )}
                    {skill.instructions && (
                      <div className="mt-2">
                        <button onClick={() => setExpandedId(prev => prev === skill.id ? null : skill.id)}
                          className="text-[11px] font-medium flex items-center gap-1" style={{ color: c.accent }}>
                          {expandedId === skill.id ? '收起指令' : '查看指令'}
                          <svg className={`w-3 h-3 transition-transform ${expandedId === skill.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {expandedId === skill.id && (
                          <pre className="mt-2 px-3 py-2.5 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto" style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>{skill.instructions}</pre>
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { if (isInstalled && !isUninstalling) handleUninstall(skill.id); else if (!isInstalled && !isInstalling) handleInstall(skill) }} disabled={isInstalling || isUninstalling}
                    className="shrink-0 h-8 px-3.5 rounded-lg text-[12px] font-medium disabled:opacity-30"
                    style={{ background: isInstalled ? c.toolErr : c.textHead, color: '#fff' }}>
                    {isInstalling ? '安装中...' : isUninstalling ? '卸载中...' : isInstalled ? '卸载' : '安装'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PageShell>
  )
}
