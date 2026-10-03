/**
 * McpSection — MCP 服务器管理（v5.0，学自 Zode 的可插拔工具生态）
 * 模块级组件：自带状态与请求逻辑，避免内联组件导致的重挂载丢焦点。
 */
import React, { useCallback, useEffect, useState } from 'react'

interface McpServer {
  id: string
  name: string
  command: string
  args: string[]
  enabled: boolean
  running?: boolean
  toolCount?: number | null
  lastError?: string
}

export default function McpSection({ c, t }: { c: any; t: (zh: string, en: string) => string }) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [tools, setTools] = useState<{ name: string; description: string; server: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async (refreshTools = false) => {
    try {
      const [sRes, tRes] = await Promise.all([
        fetch('/api/mcp/servers').then(r => r.json()),
        fetch('/api/mcp/tools' + (refreshTools ? '?refresh=1' : '')).then(r => r.json()).catch(() => ({ tools: [], errors: [] })),
      ])
      setServers(Array.isArray(sRes) ? sRes : [])
      setTools(Array.isArray(tRes?.tools) ? tRes.tools : [])
      if (tRes?.errors?.length) setMsg(tRes.errors.map((e: any) => `${e.server}: ${e.error}`).join('；'))
      else setMsg('')
    } catch { setMsg('无法连接本地服务') }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const add = async () => {
    if (!command.trim()) { setMsg('启动命令不能为空，如：npx -y @modelcontextprotocol/server-filesystem ~/Documents'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/mcp/servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'mcp-server', command: command.trim(), args: args.trim() }),
      })
      const d = await r.json()
      if (d.error) setMsg(d.error)
      else { setName(''); setCommand(''); setArgs(''); setMsg('已添加，正在拉取工具清单…'); await refresh(true) }
    } catch (e: any) { setMsg(String(e.message || e)) }
    finally { setLoading(false) }
  }

  const toggle = async (s: McpServer) => {
    await fetch('/api/mcp/servers/' + s.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
    refresh(true)
  }
  const del = async (s: McpServer) => {
    await fetch('/api/mcp/servers/' + s.id, { method: 'DELETE' })
    refresh(true)
  }

  return (
    <div className="space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: c.textTertiary }}>
        {t('接入任何 MCP Server，它的工具会自动出现在对话与集群里。命名规则 mcp__服务__工具。',
          'Plug in any MCP Server; its tools appear automatically in chat and swarm. Named mcp__server__tool.')}
      </p>

      {/* 服务列表 */}
      {servers.map(s => (
        <div key={s.id} className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ background: c.bgInput }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.running ? '#22c55e' : s.enabled ? '#f59e0b' : '#8f8f93' }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-semibold truncate" style={{ color: c.textHead }}>{s.name}</span>
              <span className="text-[10px]" style={{ color: c.textTertiary }}>
                {s.running ? `${s.toolCount ?? '?'} 个工具` : s.enabled ? '未运行' : '已停用'}
              </span>
            </div>
            <div className="text-[10.5px] font-mono truncate" style={{ color: c.textTertiary }} title={s.command + ' ' + s.args.join(' ')}>
              {s.command} {s.args.join(' ')}
            </div>
            {s.lastError && <div className="text-[10px] truncate" style={{ color: '#ef4444' }} title={s.lastError}>{s.lastError}</div>}
          </div>
          <button onClick={() => toggle(s)} className="px-2 h-7 rounded-md text-[10.5px] font-medium shrink-0" style={{ background: s.enabled ? 'rgba(16,163,127,.14)' : c.surfaceHover, color: s.enabled ? c.accent : c.textTertiary }}>
            {s.enabled ? t('停用', 'Disable') : t('启用', 'Enable')}
          </button>
          <button onClick={() => del(s)} className="px-2 h-7 rounded-md text-[10.5px] shrink-0" style={{ color: '#ef4444' }}>{t('删除', 'Delete')}</button>
        </div>
      ))}

      {/* 工具清单（可折叠） */}
      {tools.length > 0 && (
        <div>
          <button onClick={() => setExpanded(v => !v)} className="text-[10.5px] font-medium" style={{ color: c.accent }}>
            {expanded ? '▾' : '▸'} {t(`已接入 ${tools.length} 个外部工具`, `${tools.length} external tools`)}
          </button>
          {expanded && (
            <div className="mt-1.5 space-y-1">
              {tools.map(t2 => (
                <div key={t2.name} className="flex items-baseline gap-2 px-2 py-1 rounded" style={{ background: c.bgInput }}>
                  <span className="text-[10.5px] font-mono truncate" style={{ color: c.textHead }}>{t2.name}</span>
                  <span className="text-[10px] truncate" style={{ color: c.textTertiary }}>{t2.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 添加表单 */}
      <div className="space-y-2 p-2.5 rounded-lg" style={{ background: c.surfaceHover }}>
        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('服务名（如 filesystem）', 'Name')}
            className="h-8 px-2.5 rounded-md text-[11.5px] outline-none" style={{ background: c.bgElevated || c.surfaceCard, border: `1px solid ${c.border}`, color: c.textHead }} />
          <input value={args} onChange={e => setArgs(e.target.value)} placeholder={t('参数（空格分隔）', 'Args (space separated)')}
            className="h-8 px-2.5 rounded-md text-[11.5px] outline-none font-mono" style={{ background: c.bgElevated || c.surfaceCard, border: `1px solid ${c.border}`, color: c.textHead }} />
        </div>
        <input value={command} onChange={e => setCommand(e.target.value)} placeholder={t('启动命令，如：npx -y @modelcontextprotocol/server-everything', 'Command, e.g. npx -y @modelcontextprotocol/server-everything')}
          className="w-full h-8 px-2.5 rounded-md text-[11.5px] outline-none font-mono" style={{ background: c.bgElevated || c.surfaceCard, border: `1px solid ${c.border}`, color: c.textHead }} />
        <div className="flex items-center gap-2">
          <button onClick={add} disabled={loading} className="px-3 h-8 rounded-lg text-[11.5px] font-semibold disabled:opacity-50" style={{ background: c.accent, color: c.accentText }}>
            {loading ? t('连接中…', 'Connecting…') : t('添加服务', 'Add server')}
          </button>
          <button onClick={() => refresh(true)} className="px-3 h-8 rounded-lg text-[11.5px]" style={{ background: c.bgInput, color: c.textSecondary }}>
            {t('刷新工具', 'Refresh tools')}
          </button>
          {msg && <span className="text-[10.5px] truncate" style={{ color: msg.includes('失败') || msg.includes('不能') || msg.includes('无法') ? '#ef4444' : c.textTertiary }}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}
