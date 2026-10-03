/**
 * HarnessPanel — LY HARNESS 插件中心（独立标签页，v5.6）
 * 一切皆插件：内置工具 38 个逐个开关（发送前过滤）、MCP 服务启停、Skills 入口。
 * 搜索过滤 + 分类统计，状态栏星标面板可一键跳转到本页。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

interface McpServer { id: string; name: string; command: string; enabled: boolean; running?: boolean; toolCount?: number | null }
interface ToolRow { name: string; description: string }

const DISABLED_KEY = 'harness-disabled-tools'
function getDisabled(): string[] {
  try { const a = JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
function setDisabled(list: string[]) {
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

export default function HarnessPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [mcp, setMcp] = useState<McpServer[]>([])
  const [tools, setTools] = useState<ToolRow[]>([])
  const [disabled, setDisabled] = useState<string[]>(getDisabled)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    Promise.all([
      fetch('/api/mcp/servers').then(r => r.json()).catch(() => []),
      fetch('/api/remote/tools').then(r => r.json()).then(r => r.tools || []).catch(() => []),
    ]).then(([m, t]) => { setMcp(Array.isArray(m) ? m : []); setTools(t); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const toggleTool = (name: string) => {
    const next = disabled.includes(name) ? disabled.filter(x => x !== name) : [...disabled, name]
    setDisabled(next)
  }
  const toggleAll = (on: boolean) => {
    const next = on ? [] : tools.map(t => t.name)
    setDisabled(next)
  }
  const toggleMcp = async (s: McpServer) => {
    await fetch('/api/mcp/servers/' + s.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
    load()
  }
  const removeMcp = async (s: McpServer) => {
    await fetch('/api/mcp/servers/' + s.id, { method: 'DELETE' })
    load()
  }

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tools
    return tools.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
  }, [tools, query])

  const enabledTools = tools.filter(t => !disabled.includes(t.name)).length
  const enabledMcp = mcp.filter(s => s.enabled).length

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: c.bg }}>
      {/* ── Hero ── */}
      <div className="shrink-0 border-b" style={{ borderColor: c.border, background: c.bgInput }}>
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl grid place-items-center" style={{ background: c.accent }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.accentText} strokeWidth={1.8} stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3L4.3 7.6l5.3-.8z" /></svg>
            </span>
            <div>
              <h1 className="text-[17px] font-bold tracking-wide" style={{ color: c.textHead }}>LY HARNESS · 插件中心</h1>
              <p className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>一切皆插件:工具、MCP 服务、Skills,即插即用,关掉的不会发给模型</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => toggleAll(true)} className="h-8 px-3 rounded-lg text-[12px] font-medium" style={{ background: c.surfaceCard, color: c.textSecondary, border: `1px solid ${c.border}` }}>全部启用</button>
              <button onClick={() => toggleAll(false)} className="h-8 px-3 rounded-lg text-[12px] font-medium" style={{ background: c.surfaceCard, color: c.textSecondary, border: `1px solid ${c.border}` }}>全部停用</button>
              <button onClick={onClose} className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: c.bgInput, color: c.textTertiary }} title="关闭标签页">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          {/* 概览 */}
          <div className="flex gap-2.5 mt-3.5">
            {[
              [`${enabledTools}/${tools.length}`, t('内置工具', 'Tools')],
              [`${enabledMcp}/${mcp.length}`, t('MCP 服务', 'MCP')],
              ['∞', 'Skills'],
            ].map(([v, l]) => (
              <div key={l} className="px-3.5 py-2 rounded-xl" style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }}>
                <span className="text-[15px] font-bold" style={{ color: c.textHead }}>{v}</span>
                <span className="text-[10.5px] ml-1.5" style={{ color: c.textTertiary }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 flex flex-col gap-6">
        {/* ── 内置工具 ── */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-[13.5px] font-bold" style={{ color: c.textHead }}>内置工具</h2>
            <span className="text-[11px]" style={{ color: c.textTertiary }}>开关立即生效,关闭的不会发给模型</span>
            <div className="flex-1" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('搜索工具…', 'Search tools…')}
              className="h-8 px-3 rounded-lg text-[12px] outline-none w-56"
              style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.border}` }} />
          </div>
          {loading ? (
            <div className="text-[12px] py-6 text-center" style={{ color: c.textTertiary }}>加载中…</div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
              {filteredTools.map(t => {
                const on = !disabled.includes(t.name)
                return (
                  <button key={t.name} onClick={() => toggleTool(t.name)}
                    className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{ background: on ? 'rgba(16,163,127,.06)' : 'transparent', border: `1px solid ${on ? 'rgba(16,163,127,.3)' : c.borderLight}`, opacity: on ? 1 : 0.55 }}>
                    <span className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5" style={{ background: on ? '#10a37f' : 'transparent', border: `2px solid ${on ? '#10a37f' : c.border}` }} />
                    <span className="min-w-0 flex-1">
                      <span className="text-[12px] font-mono font-semibold block truncate" style={{ color: c.textHead }}>{t.name}</span>
                      <span className="text-[10.5px] leading-snug block mt-0.5 line-clamp-2" style={{ color: c.textTertiary, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.description}</span>
                    </span>
                    <span className="text-[9.5px] font-bold shrink-0 mt-0.5" style={{ color: on ? '#10a37f' : c.textTertiary }}>{on ? 'ON' : 'OFF'}</span>
                  </button>
                )
              })}
              {filteredTools.length === 0 && <div className="text-[12px] py-4 text-center" style={{ color: c.textTertiary }}>没有匹配的工具</div>}
            </div>
          )}
        </section>

        {/* ── MCP 服务 ── */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-[13.5px] font-bold" style={{ color: c.textHead }}>MCP 服务</h2>
            <span className="text-[11px]" style={{ color: c.textTertiary }}>在 设置 → 安全 里添加新的 MCP 服务</span>
          </div>
          {mcp.length === 0 ? (
            <div className="rounded-xl border border-dashed p-5 text-center" style={{ borderColor: c.border }}>
              <span className="text-[12px]" style={{ color: c.textTertiary }}>还没有 MCP 服务 — 任何符合协议的 MCP Server 都能即插即用</span>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
              {mcp.map(s => (
                <div key={s.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl" style={{ background: s.enabled ? 'rgba(16,163,127,.06)' : 'transparent', border: `1px solid ${s.enabled ? 'rgba(16,163,127,.3)' : c.borderLight}` }}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.running ? '#10a37f' : s.enabled ? '#f59e0b' : c.border }} title={s.running ? '运行中' : s.enabled ? '未运行' : '已停用'} />
                  <span className="min-w-0 flex-1">
                    <span className="text-[12px] font-mono font-semibold block truncate" style={{ color: c.textHead }}>{s.name}</span>
                    <span className="text-[10px] block truncate" style={{ color: c.textTertiary }}>
                      {s.running ? `${s.toolCount ?? '?'} 个工具 · 运行中` : s.enabled ? '已启用 · 未运行' : '已停用'}
                    </span>
                  </span>
                  <button onClick={() => toggleMcp(s)} className="px-2 py-1 rounded-md text-[10.5px] font-semibold shrink-0" style={{ background: s.enabled ? c.bgInput : 'rgba(16,163,127,.15)', color: s.enabled ? c.textTertiary : '#10a37f' }}>
                    {s.enabled ? t('停用', 'Off') : t('启用', 'On')}
                  </button>
                  <button onClick={() => removeMcp(s)} className="px-2 py-1 rounded-md text-[10.5px] shrink-0" style={{ color: '#ef4444' }}>删除</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Skills ── */}
        <section>
          <div className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: c.borderLight }}>
            <span className="text-[13.5px] font-bold" style={{ color: c.textHead }}>Skills</span>
            <span className="text-[11px]" style={{ color: c.textTertiary }}>按消息挂载,在技能市场安装与管理</span>
            <span className="flex-1" />
            <button onClick={() => window.dispatchEvent(new CustomEvent('open-skills-market'))} className="h-8 px-3 rounded-lg text-[12px] font-medium" style={{ background: c.accent, color: c.accentText }}>打开技能市场 →</button>
          </div>
        </section>
      </div>
    </div>
  )
}
