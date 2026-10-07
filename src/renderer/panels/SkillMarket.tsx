import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'

interface SkillTool { name: string; description: string }
interface MarketSkill { id: string; name: string; version: string; author: string; description: string; tags: string[]; tools: SkillTool[]; instructions?: string; source_url?: string }

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
  const [activeTab, setActiveTab] = useState<'market' | 'installed'>('market')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadMarket = useCallback(async () => {
    try {
      const [marketRes, installedRes] = await Promise.all([
        fetch('/api/skills/market'),
        fetch('/api/tools/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'list_skills', args: {} }) })
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

  const handleInstall = async (skill: MarketSkill) => {
    setInstallingIds(prev => new Set(prev).add(skill.id)); setError('')
    try {
      const res = await fetch('/api/skills/install-from-market', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillId: skill.id }) })
      const data = await res.json()
      if (data.success) { setInstalledIds(prev => new Set(prev).add(skill.id)); window.dispatchEvent(new Event('skills-changed')) }
      else setError(data.error || '安装失败')
    } catch (e: any) { setError(e.message) }
    finally { setInstallingIds(prev => { const n = new Set(prev); n.delete(skill.id); return n }) }
  }

  const handleUninstall = async (skillId: string) => {
    setUninstallingIds(prev => new Set(prev).add(skillId)); setError('')
    try {
      const res = await fetch('/api/skills/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillName: skillId }) })
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
      const res = await fetch('/api/skills/install-from-github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ githubUrl: url }) })
      const data = await res.json()
      if (data.success) { setInstalledIds(prev => new Set(prev).add(data.repo || 'github-skill')); setGithubUrl(''); loadMarket(); window.dispatchEvent(new Event('skills-changed')) }
      else setError(data.error || '安装失败')
    } catch (e: any) { setError(e.message) }
    finally { setGithubInstalling(false) }
  }

  const filteredSkills = skills.filter(s => {
    const isInstalled = s.tags.includes('installed') || installedIds.has(s.id)
    if (activeTab === 'installed' && !isInstalled) return false
    if (activeTab === 'market' && isInstalled) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })

  return (
    <PageShell onClose={onClose} title="Skills 市场" description="安装与管理技能，扩展 AI 能力边界" icon="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z">
      {/* Search bar */}
      <div className="px-4 py-3">
        <div className="relative max-w-md">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="搜索 Skills..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 h-9 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
        </div>
      </div>

      {/* GitHub install */}
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

      {/* Tab switcher */}
      <div className="px-4 pb-3 flex gap-2">
        {(['market', 'installed'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="h-8 px-4 rounded-lg text-[13px] font-medium transition-colors"
            style={{ background: activeTab === tab ? c.bg : 'transparent', color: activeTab === tab ? c.textHead : c.textSecondary, border: `1px solid ${activeTab === tab ? c.border : 'transparent'}` }}>
            {tab === 'market' ? '市场' : `已安装 (${installedIds.size})`}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg text-xs flex items-center justify-between" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
          <span> [!] {error}</span>
          <button onClick={() => setError('')} className="underline">关闭</button>
        </div>
      )}

      {/* Skills list */}
      <div className="px-4 pb-4">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-5 h-5 mx-auto mb-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: c.accent, borderTopColor: 'transparent' }} />
            <p className="text-[13px]" style={{ color: c.textMuted }}>加载中...</p>
          </div>
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
