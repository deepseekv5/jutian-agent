/**
 * LY HARNESS — 一切皆插件（v5.6）
 * 状态栏铃铛 → 面板双页签：通知 / 插件。
 * 插件页：MCP 服务（开关）、内置工具（38 个，逐个开关）、Skills（跳转管理）。
 * 工具开关持久化于 localStorage('harness-disabled-tools')，streamChat 发送前过滤。
 */
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useNoticeBadge, getNotices, markAllRead, clearNotices, mergeServerNotices, type AppNotice } from '../notify'

const TYPE_META: Record<AppNotice['type'], { icon: string; label: string }> = {
  swarm: { icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', label: '集群' },
  subagent: { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: '子代理' },
  computer: { icon: 'M9 3h6m-3 0v6a3 3 0 11-6 0M4 8V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8z', label: '电脑' },
  system: { icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: '系统' },
}

const DISABLED_KEY = 'harness-disabled-tools'
function getDisabledTools(): string[] {
  try { const a = JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
function setDisabledTools(list: string[]) {
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

interface McpServer { id: string; name: string; command: string; enabled: boolean; running?: boolean; toolCount?: number | null }
interface ToolRow { name: string; description: string }

export default function NotificationCenter() {
  const { c } = useTheme()
  const badge = useNoticeBadge()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'notices' | 'plugins'>('notices')
  const [list, setList] = useState<AppNotice[]>(getNotices)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const refresh = () => { setList(getNotices()) }
  useEffect(() => {
    if (open) { mergeServerNotices().then(refresh); refresh() }
    const h = () => { if (open) refresh() }
    window.addEventListener('app-notice', h)
    return () => window.removeEventListener('app-notice', h)
  }, [open])
  // 服务端通知轮询（定时任务完成 / 手机接入）
  useEffect(() => {
    const iv = setInterval(() => mergeServerNotices(), 60000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const t = setTimeout(() => document.addEventListener('mousedown', h))
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h) }
  }, [open])

  const rel = (t: number) => {
    const d = Date.now() - t
    if (d < 60000) return '刚刚'
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前'
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前'
    return new Date(t).toLocaleDateString('zh-CN')
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-6 h-6 rounded-md grid place-items-center transition-colors relative"
        style={{ color: open ? c.textHead : c.textTertiary }}
        title="LY HARNESS · 通知与插件" aria-label="LY HARNESS">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3L4.3 7.6l5.3-.8z" />
        </svg>
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full text-[8.5px] font-bold grid place-items-center"
            style={{ background: '#10a37f', color: '#fff' }}>{badge > 9 ? '9+' : badge}</span>
        )}
      </button>

      {open && (
        <div className="fixed z-50 w-[360px] rounded-xl border overflow-hidden shadow-2xl"
          style={{ bottom: 'calc(100% + 10px)', right: 0, background: c.surfaceCard, borderColor: c.border, backdropFilter: 'blur(20px)' }}>
          {/* 页签头 */}
          <div className="flex items-center gap-1 px-3 h-10 border-b" style={{ borderColor: c.borderLight }}>
            {([['notices', `通知${badge ? ` (${badge})` : ''}`], ['plugins', '插件']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className="px-2.5 py-1 rounded-md text-[12px] font-bold transition-colors"
                style={{ background: tab === k ? c.bgActive || c.bgInput : 'transparent', color: tab === k ? c.textHead : c.textTertiary }}>
                {label}
              </button>
            ))}
            <span className="flex-1" />
            <span className="text-[10px] font-mono tracking-widest" style={{ color: c.textTertiary }}>LY HARNESS</span>
          </div>

          {/* ═══ 通知页签 ═══ */}
          {tab === 'notices' && (
            <>
              <div className="flex items-center px-3.5 h-8 border-b" style={{ borderColor: c.borderLight }}>
                <span className="flex-1" />
                {list.length > 0 && <button onClick={() => { clearNotices(); refresh() }} className="text-[10.5px]" style={{ color: c.textTertiary }}>清空</button>}
              </div>
              <div className="max-h-[320px] overflow-y-auto scrollbar-thin">
                {list.length === 0 && (
                  <div className="px-4 py-8 text-center text-[11.5px]" style={{ color: c.textTertiary }}>
                    暂无通知。集群任务、子代理、Computer Use 完成后会出现在这里。
                  </div>
                )}
                {list.map(n => {
                  const meta = TYPE_META[n.type] || TYPE_META.system
                  return (
                    <div key={n.id} className="flex gap-2.5 px-3.5 py-2.5 border-b" style={{ borderColor: c.borderLight, background: n.read ? 'transparent' : 'rgba(16,163,127,.05)' }}>
                      <span className="w-6 h-6 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ background: 'rgba(16,163,127,.12)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10a37f" strokeWidth={1.8} stroke-linecap="round" stroke-linejoin="round"><path d={meta.icon} /></svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9.5px] px-1 py-0.5 rounded font-mono" style={{ background: c.bgInput, color: c.textTertiary }}>{meta.label}</span>
                          <span className="text-[9.5px] ml-auto" style={{ color: c.textTertiary }}>{rel(n.ts)}</span>
                        </div>
                        <div className="text-[12px] font-medium mt-0.5 truncate" style={{ color: c.textHead }}>{n.title}</div>
                        {n.body && <div className="text-[10.5px] truncate" style={{ color: c.textTertiary }}>{n.body}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ═══ 插件页签：一切皆插件 ═══ */}
          {tab === 'plugins' && <PluginsTab c={c} />}
        </div>
      )}
    </div>
  )
}

/* ═══════════ 插件页签 ═══════════ */
function PluginsTab({ c }: { c: any }) {
  const [mcp, setMcp] = useState<McpServer[]>([])
  const [tools, setTools] = useState<ToolRow[]>([])
  const [disabled, setDisabled] = useState<string[]>(getDisabledTools)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/mcp/servers').then(r => r.json()).catch(() => []),
      fetch('/api/remote/tools').then(r => r.json()).then(r => r.tools || []).catch(() => []),
    ]).then(([m, t]) => { setMcp(Array.isArray(m) ? m : []); setTools(t); setLoading(false) })
  }, [])

  const toggleTool = (name: string) => {
    const next = disabled.includes(name) ? disabled.filter(x => x !== name) : [...disabled, name]
    setDisabled(next); setDisabledTools(next)
  }
  const toggleMcp = async (s: McpServer) => {
    await fetch('/api/mcp/servers/' + s.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
    const m = await fetch('/api/mcp/servers').then(r => r.json()).catch(() => [])
    setMcp(Array.isArray(m) ? m : [])
  }

  const enabledTools = tools.filter(t => !disabled.includes(t.name)).length
  const enabledMcp = mcp.filter(s => s.enabled).length

  return (
    <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
      {/* 概览 */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2.5 border-b" style={{ borderColor: c.borderLight }}>
        <div className="rounded-lg px-2 py-1.5" style={{ background: c.bgInput }}>
          <div className="text-[14px] font-bold" style={{ color: c.textHead }}>{enabledTools}<span className="text-[10px] font-normal" style={{ color: c.textTertiary }}>/{tools.length}</span></div>
          <div className="text-[9.5px]" style={{ color: c.textTertiary }}>内置工具</div>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: c.bgInput }}>
          <div className="text-[14px] font-bold" style={{ color: c.textHead }}>{enabledMcp}<span className="text-[10px] font-normal" style={{ color: c.textTertiary }}>/{mcp.length}</span></div>
          <div className="text-[9.5px]" style={{ color: c.textTertiary }}>MCP 服务</div>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: c.bgInput }}>
          <div className="text-[14px] font-bold" style={{ color: c.textHead }}>∞</div>
          <div className="text-[9.5px]" style={{ color: c.textTertiary }}>Skills</div>
        </div>
      </div>

      {/* 内置工具(逐个开关) */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <span className="text-[10px] font-bold tracking-wider" style={{ color: c.textTertiary }}>内置工具 · 关掉的不会发给模型</span>
        <span className="flex-1" />
        <button onClick={() => window.dispatchEvent(new CustomEvent('open-harness', { detail: { page: 'plugins' } }))} className="text-[10px] font-medium" style={{ color: c.accent }}>独立标签页 →</button>
      </div>
      {loading && <div className="px-3 pb-3 text-[11px]" style={{ color: c.textTertiary }}>加载中…</div>}
      <div className="px-2 pb-2 space-y-0.5">
        {tools.map(t => {
          const on = !disabled.includes(t.name)
          return (
            <button key={t.name} onClick={() => toggleTool(t.name)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors"
              style={{ background: on ? 'rgba(16,163,127,.07)' : 'transparent', opacity: on ? 1 : 0.5 }}
              title={t.description}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: on ? '#10a37f' : c.border }} />
              <span className="text-[11px] font-mono truncate flex-1" style={{ color: c.textHead }}>{t.name}</span>
              <span className="text-[9.5px] shrink-0" style={{ color: on ? '#10a37f' : c.textTertiary }}>{on ? 'ON' : 'OFF'}</span>
            </button>
          )
        })}
      </div>

      {/* MCP */}
      <div className="px-3 pt-2 pb-1">
        <span className="text-[10px] font-bold tracking-wider" style={{ color: c.textTertiary }}>MCP 服务 · 在设置里添加</span>
      </div>
      <div className="px-2 pb-2 space-y-0.5">
        {mcp.length === 0 && <div className="px-2 pb-2 text-[10.5px]" style={{ color: c.textTertiary }}>还没有 MCP 服务 — 设置 → 安全 → MCP 外部工具</div>}
        {mcp.map(s => (
          <button key={s.id} onClick={() => toggleMcp(s)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors"
            style={{ background: s.enabled ? 'rgba(16,163,127,.07)' : 'transparent', opacity: s.enabled ? 1 : 0.5 }}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.running ? '#10a37f' : s.enabled ? '#f59e0b' : c.border }} />
            <span className="text-[11px] font-mono truncate flex-1" style={{ color: c.textHead }}>{s.name}</span>
            <span className="text-[9.5px] shrink-0" style={{ color: s.enabled ? '#10a37f' : c.textTertiary }}>{s.running ? `${s.toolCount ?? '?'} 工具` : s.enabled ? '未运行' : 'OFF'}</span>
          </button>
        ))}
      </div>

      {/* Skills */}
      <div className="px-3 py-2 border-t" style={{ borderColor: c.borderLight }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-wider" style={{ color: c.textTertiary }}>SKILLS · 按消息挂载</span>
          <span className="flex-1" />
          <button onClick={() => { window.dispatchEvent(new CustomEvent('open-skills-market')) }} className="text-[10.5px] font-medium" style={{ color: c.accent }}>去技能市场 →</button>
        </div>
      </div>
    </div>
  )
}
