/**
 * McpSection — MCP 服务器管理（v5.0 起，v14 扩展远程传输与权限）
 *
 * v14 新增：
 *   - 三种传输：本地 stdio / Streamable HTTP / 旧版 SSE
 *   - 保存前「测试连接」：握手 + 列工具，直接看到能拿到几个工具、哪些只读
 *   - 服务级权限：允许清单 / 禁用清单（支持 * 通配）/ 只读模式
 *     远程 server 常带写操作，用户需要「这个服务只准读」的粒度
 *
 * 模块级组件：自带状态与请求逻辑，避免内联组件导致的重挂载丢焦点。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { fetchCompat } from '../api'

type Transport = 'stdio' | 'http' | 'sse'

interface McpServer {
  id: string
  name: string
  type: Transport
  command: string
  args: string[]
  url?: string
  enabled: boolean
  allowTools?: string[]
  denyTools?: string[]
  readOnly?: boolean
  running?: boolean
  toolCount?: number | null
  lastError?: string
}

interface TestResult {
  ok: boolean
  type?: string
  ms?: number
  tools?: { name: string; description: string; readOnly: boolean }[]
  error?: string
}

const TRANSPORTS: { id: Transport; zh: string; en: string }[] = [
  { id: 'stdio', zh: '本地', en: 'Local' },
  { id: 'http', zh: '远程 HTTP', en: 'HTTP' },
  { id: 'sse', zh: '远程 SSE', en: 'SSE' },
]

export default function McpSection({ c, t }: { c: any; t: (zh: string, en: string) => string }) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [tools, setTools] = useState<{ name: string; description: string; server: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [transport, setTransport] = useState<Transport>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [test, setTest] = useState<TestResult | null>(null)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [permOpen, setPermOpen] = useState<string | null>(null)

  const refresh = useCallback(async (refreshTools = false) => {
    try {
      const [sRes, tRes] = await Promise.all([
        fetchCompat('/api/mcp/servers').then(r => r.json()),
        fetchCompat('/api/mcp/tools' + (refreshTools ? '?refresh=1' : '')).then(r => r.json()).catch(() => ({ tools: [], errors: [] })),
      ])
      setServers(Array.isArray(sRes) ? sRes : [])
      setTools(Array.isArray(tRes?.tools) ? tRes.tools : [])
      if (tRes?.errors?.length) setMsg(tRes.errors.map((e: any) => `${e.server}: ${e.error}`).join('；'))
      else setMsg('')
    } catch { setMsg('无法连接本地服务') }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  /** 解析 "Key: Value" 每行一条的请求头 */
  const parseHeaders = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    return out
  }

  const payload = () => ({
    name: name.trim() || (transport === 'stdio' ? 'mcp-server' : 'remote-mcp'),
    type: transport,
    command: command.trim(),
    args: args.trim(),
    url: url.trim(),
    headers: parseHeaders(headers),
  })

  const runTest = async () => {
    setTest(null); setLoading(true)
    try {
      const r = await fetchCompat('/api/mcp/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()),
      })
      setTest(await r.json())
    } catch (e: any) { setTest({ ok: false, error: String(e.message || e) }) }
    finally { setLoading(false) }
  }

  const add = async () => {
    if (transport === 'stdio' && !command.trim()) { setMsg(t('启动命令不能为空', 'Command is required')); return }
    if (transport !== 'stdio' && !url.trim()) { setMsg(t('远程服务需要填写地址', 'URL is required for remote servers')); return }
    setLoading(true)
    try {
      const r = await fetchCompat('/api/mcp/servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()),
      })
      const d = await r.json()
      if (d.error) setMsg(d.error)
      else {
        setName(''); setCommand(''); setArgs(''); setUrl(''); setHeaders(''); setTest(null)
        setMsg(t('已添加，正在拉取工具清单…', 'Added, fetching tools…'))
        await refresh(true)
      }
    } catch (e: any) { setMsg(String(e.message || e)) }
    finally { setLoading(false) }
  }

  const toggle = async (s: McpServer) => {
    await fetchCompat('/api/mcp/servers/' + s.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) })
    refresh(true)
  }
  const del = async (s: McpServer) => {
    await fetchCompat('/api/mcp/servers/' + s.id, { method: 'DELETE' })
    refresh(true)
  }
  const patch = async (s: McpServer, body: Record<string, unknown>) => {
    await fetchCompat('/api/mcp/servers/' + s.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    refresh(true)
  }

  const typeLabel = (ty: Transport) => ty === 'stdio' ? t('本地', 'Local') : ty === 'sse' ? 'SSE' : 'HTTP'
  const inputCls = 'h-8 px-2.5 rounded-md text-[11.5px] outline-none'
  const inputStyle = { background: c.bgElevated || c.surfaceCard, border: `1px solid ${c.border}`, color: c.textHead }

  return (
    <div className="space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: c.textTertiary }}>
        {t('接入任何 MCP Server（本地进程或远程地址），它的工具会自动出现在对话与集群里。命名规则 mcp__服务__工具。',
          'Plug in any MCP Server (local process or remote URL); its tools appear in chat and swarm. Named mcp__server__tool.')}
      </p>

      {/* 服务列表 */}
      {servers.map(s => {
        const perm = permOpen === s.id
        return (
          <div key={s.id} className="rounded-lg overflow-hidden" style={{ background: c.bgInput }}>
            <div className="flex items-center gap-2.5 p-2.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.running ? '#22c55e' : s.enabled ? '#f59e0b' : '#8f8f93' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-semibold truncate" style={{ color: c.textHead }}>{s.name}</span>
                  <span className="text-[9.5px] px-1 py-0.5 rounded" style={{ background: c.surfaceHover, color: c.textTertiary }}>{typeLabel(s.type)}</span>
                  {s.readOnly && <span className="text-[9.5px] px-1 py-0.5 rounded" style={{ background: `${c.accent}18`, color: c.accent }}>{t('只读', 'Read-only')}</span>}
                  <span className="text-[10px]" style={{ color: c.textTertiary }}>
                    {s.running ? `${s.toolCount ?? '?'} ${t('个工具', 'tools')}` : s.enabled ? t('未运行', 'Idle') : t('已停用', 'Disabled')}
                  </span>
                </div>
                <div className="text-[10.5px] font-mono truncate" style={{ color: c.textTertiary }} title={s.type === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}>
                  {s.type === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}
                </div>
                {s.lastError && <div className="text-[10px] truncate" style={{ color: '#ef4444' }} title={s.lastError}>{s.lastError}</div>}
              </div>
              <button onClick={() => setPermOpen(perm ? null : s.id)} className="px-2 h-7 rounded-md text-[10.5px] shrink-0"
                style={{ background: perm ? `${c.accent}18` : c.surfaceHover, color: perm ? c.accent : c.textTertiary }}>
                {t('权限', 'Rules')}
              </button>
              <button onClick={() => toggle(s)} className="px-2 h-7 rounded-md text-[10.5px] font-medium shrink-0" style={{ background: s.enabled ? 'rgba(16,163,127,.14)' : c.surfaceHover, color: s.enabled ? c.accent : c.textTertiary }}>
                {s.enabled ? t('停用', 'Disable') : t('启用', 'Enable')}
              </button>
              <button onClick={() => del(s)} className="px-2 h-7 rounded-md text-[10.5px] shrink-0" style={{ color: '#ef4444' }}>{t('删除', 'Delete')}</button>
            </div>

            {/* 服务级权限 */}
            {perm && (
              <div className="px-2.5 pb-2.5 space-y-2 border-t pt-2" style={{ borderColor: c.borderLight }}>
                <div className="flex items-center gap-2">
                  <label className="text-[10.5px]" style={{ color: c.textSecondary }}>{t('只读模式（仅放行声明只读的工具）', 'Read-only mode (only read-only tools)')}</label>
                  <button role="switch" aria-checked={!!s.readOnly} onClick={() => patch(s, { readOnly: !s.readOnly })}
                    className="relative w-9 h-[18px] rounded-full transition-colors shrink-0" style={{ background: s.readOnly ? c.accent : `${c.textMuted}44` }}>
                    <div className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform" style={{ left: s.readOnly ? 'calc(100% - 16px)' : '2px' }} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] mb-1" style={{ color: c.textTertiary }}>{t('允许清单（空=全部，支持 *）', 'Allow list (empty = all, * ok)')}</div>
                    <input defaultValue={(s.allowTools || []).join(', ')} onBlur={e => patch(s, { allowTools: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                      placeholder="read_*, list_*" className={`w-full ${inputCls} font-mono`} style={inputStyle} />
                  </div>
                  <div>
                    <div className="text-[10px] mb-1" style={{ color: c.textTertiary }}>{t('禁用清单（支持 *）', 'Deny list (* ok)')}</div>
                    <input defaultValue={(s.denyTools || []).join(', ')} onBlur={e => patch(s, { denyTools: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                      placeholder="delete_*, write_*" className={`w-full ${inputCls} font-mono`} style={inputStyle} />
                  </div>
                </div>
                <div className="text-[9.5px]" style={{ color: c.textMuted }}>
                  {t('被禁用的工具不会暴露给模型；只读模式额外按 server 声明的 readOnlyHint 过滤。',
                    'Denied tools are hidden from the model; read-only mode also filters by server-declared readOnlyHint.')}
                </div>
              </div>
            )}
          </div>
        )
      })}

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
        {/* 传输选择 */}
        <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: `1px solid ${c.borderLight}` }}>
          {TRANSPORTS.map(tr => (
            <button key={tr.id} onClick={() => { setTransport(tr.id); setTest(null) }}
              className="px-2.5 h-7 text-[10.5px] transition-colors"
              style={{ background: transport === tr.id ? c.accent : 'transparent', color: transport === tr.id ? '#fff' : c.textTertiary }}>
              {t(tr.zh, tr.en)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('服务名（如 filesystem）', 'Name')}
            className={inputCls} style={inputStyle} />
          {transport === 'stdio'
            ? <input value={args} onChange={e => setArgs(e.target.value)} placeholder={t('参数（空格分隔）', 'Args (space separated)')}
                className={`${inputCls} font-mono`} style={inputStyle} />
            : <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp"
                className={`${inputCls} font-mono`} style={inputStyle} />}
        </div>

        {transport === 'stdio' ? (
          <input value={command} onChange={e => setCommand(e.target.value)} placeholder={t('启动命令，如：npx -y @modelcontextprotocol/server-everything', 'Command, e.g. npx -y @modelcontextprotocol/server-everything')}
            className={`w-full ${inputCls} font-mono`} style={inputStyle} />
        ) : (
          <textarea value={headers} onChange={e => setHeaders(e.target.value)} rows={2}
            placeholder={t('请求头，每行一条（可选）：\nAuthorization: Bearer xxx', 'Headers, one per line (optional):\nAuthorization: Bearer xxx')}
            className="w-full px-2.5 py-1.5 rounded-md text-[11px] outline-none font-mono resize-y"
            style={{ background: c.bgElevated || c.surfaceCard, border: `1px solid ${c.border}`, color: c.textHead }} />
        )}

        {/* 测试结果 */}
        {test && (
          <div className="text-[10.5px] rounded-md px-2 py-1.5" style={{ background: c.bgInput, color: test.ok ? c.textSecondary : '#ef4444' }}>
            {test.ok
              ? t(`连接成功 · ${test.type} · ${test.ms}ms · ${test.tools?.length || 0} 个工具${test.tools?.some(x => x.readOnly) ? `（${test.tools.filter(x => x.readOnly).length} 个只读）` : ''}`,
                  `Connected · ${test.type} · ${test.ms}ms · ${test.tools?.length || 0} tools`)
              : t(`连接失败：${test.error}`, `Failed: ${test.error}`)}
            {test.ok && !!test.tools?.length && (
              <div className="mt-1 font-mono text-[10px] truncate" style={{ color: c.textTertiary }}>
                {test.tools.slice(0, 6).map(x => x.name).join(' · ')}{test.tools.length > 6 ? ' …' : ''}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={add} disabled={loading} className="px-3 h-8 rounded-lg text-[11.5px] font-semibold disabled:opacity-50" style={{ background: c.accent, color: c.accentText }}>
            {loading ? t('处理中…', 'Working…') : t('添加服务', 'Add server')}
          </button>
          <button onClick={runTest} disabled={loading} className="px-3 h-8 rounded-lg text-[11.5px] disabled:opacity-50" style={{ background: c.bgInput, color: c.textSecondary }}>
            {t('测试连接', 'Test')}
          </button>
          <button onClick={() => refresh(true)} className="px-3 h-8 rounded-lg text-[11.5px]" style={{ background: c.bgInput, color: c.textSecondary }}>
            {t('刷新工具', 'Refresh tools')}
          </button>
          {msg && <span className="text-[10.5px] truncate" style={{ color: /失败|不能|无法|错误/.test(msg) ? '#ef4444' : c.textTertiary }}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}
