import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTheme } from '../hooks/useTheme'
import TerminalPanel from '../code/TerminalPanel'
import GitPanel from './GitPanel'
import SubAgentTracker from '../app/SubAgentTracker'
import type { Message, Settings } from '../types'
import { estimateTokens, fmtTokens } from '../utils/tokens'
import { effectiveApiKey } from '../store/storage'

type SideTab = 'assistant' | 'review' | 'files' | 'terminal' | 'browser' | 'subagent' | 'git' | 'stats'

interface Props {
  workDir: string
  mainMessages: Message[]
  settings: Settings
}


/** 导出当前会话为 Markdown（纯前端，浏览器下载） */
function exportSessionMarkdown(messages: Message[]) {
  if (!messages.length) return
  const firstUser = messages.find(m => m.role === 'user')
  const title = (firstUser?.content || '对话').trim().split('\n')[0].slice(0, 40) || '对话'
  const lines: string[] = [`# ${title}`, '', `- 导出时间：${new Date().toLocaleString('zh-CN')}`, `- 消息数：${messages.length}`, '', '---', '']
  for (const m of messages) {
    const who = m.role === 'user' ? '🧑 我' : m.role === 'assistant' ? '🤖 巨天' : m.role
    const ts = (m as any).created_at ? new Date((m as any).created_at).toLocaleString('zh-CN') : ''
    lines.push(`## ${who}${ts ? `  ·  ${ts}` : ''}`, '')
    lines.push(m.content || '（无文本内容）')
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      lines.push('', '**工具调用：**')
      for (const tc of m.tool_calls) lines.push(`- ⚙️ \`${tc.name}\``)
    }
    lines.push('', '---', '')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  a.href = url
  a.download = `巨天agent-${title.replace(/[\\/:*?"<>|\s]+/g, '-')}-${stamp}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** 对话侧边面板：辅助对话 / 审查 / 终端 / 浏览器 */
export default function ChatSidePanel({ workDir, mainMessages, settings }: Props) {
  const { c } = useTheme()
  const [tab, setTab] = useState<SideTab>('assistant')

  return (
    <div className="h-full flex flex-col min-h-0 border-l glass" style={{ borderColor: c.borderLight }}>
      {/* 面板标签 */}
      <div className="h-9 flex items-center gap-0.5 px-2 border-b shrink-0" style={{ borderColor: c.borderLight }}>
        <button
          onClick={() => exportSessionMarkdown(mainMessages)}
          title="导出当前对话为 Markdown"
          className="mr-1 w-6 h-6 rounded-md grid place-items-center transition-colors"
          style={{ color: c.textTertiary }}
          onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover; e.currentTarget.style.color = c.textHead }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.textTertiary }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5l5 5 5-5M4 21h16"/></svg>
        </button>
        {([
          ['assistant', '辅助'],
          ['review', '审查'],
          ['files', '文件'],
          ['terminal', '终端'],
          ['browser', '浏览器'],
          ['subagent', '子Agent'],
          ['git', 'Git'],
          ['stats', '统计'],
        ] as [SideTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-2 py-1 rounded-lg text-[11px] font-medium transition-colors"
            style={{ background: tab === id ? `${c.accent}12` : 'transparent', color: tab === id ? c.accent : c.textTertiary }}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'assistant' && <AssistantChat settings={settings} workDir={workDir} />}
        {tab === 'review' && <ReviewChat mainMessages={mainMessages} settings={settings} />}
        {tab === 'files' && <FilesPane workDir={workDir} />}
        {tab === 'terminal' && <TerminalPanel cwd={workDir || undefined as any} />}
        {tab === 'browser' && <BrowserPane />}
        {tab === 'subagent' && (
          <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
            <SubAgentTracker />
            <div className="text-[11px] text-center pt-8 px-3 leading-relaxed" style={{ color: c.textMuted }}>
              主对话派出子代理（dispatch_subagents / 集群）时，<br />各成员的执行进度与回报会实时显示在这里
            </div>
          </div>
        )}
        {tab === 'git' && <GitPanel workDir={workDir} />}
        {tab === 'stats' && <StatsPane messages={mainMessages} />}
      </div>
    </div>
  )
}

// ─── 会话统计：消息构成 / 字数 / Token 估算 / 工具调用概况 ───
function StatsPane({ messages }: { messages: Message[] }) {
  const { c } = useTheme()
  const stats = useMemo(() => {
    const user = messages.filter(m => m.role === 'user')
    const assistant = messages.filter(m => m.role === 'assistant')
    const totalChars = messages.reduce((s, m) => s + (m.content || '').length, 0)
    const totalTokens = messages.reduce((s, m) => s + estimateTokens(m.content || '') + estimateTokens(m.thinking || ''), 0)
    const toolCalls = messages.reduce((s, m) => s + (m.tool_calls?.length || 0), 0)
    const toolNames = new Map<string, number>()
    for (const m of messages) for (const tc of (m.tool_calls || [])) toolNames.set(tc.name, (toolNames.get(tc.name) || 0) + 1)
    const firstTs = messages[0]?.created_at
    const lastTs = messages[messages.length - 1]?.created_at
    const durMin = firstTs && lastTs ? Math.max(1, Math.round((new Date(lastTs).getTime() - new Date(firstTs).getTime()) / 60000)) : 0
    return { user, assistant, totalChars, totalTokens, toolCalls, toolNames: [...toolNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), durMin }
  }, [messages])

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg glass">
      <span className="text-[12px]" style={{ color: c.textTertiary }}>{label}</span>
      <span className="text-[12px] font-mono" style={{ color: c.text }}>{value}</span>
    </div>
  )

  if (messages.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: c.textMuted }}>对话开始后可查看统计</div>
  }
  return (
    <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
      <Row label="消息总数" value={`${messages.length} 条`} />
      <Row label="用户 / 助手" value={`${stats.user.length} / ${stats.assistant.length}`} />
      <Row label="总字数" value={stats.totalChars.toLocaleString()} />
      <Row label="Token 估算" value={fmtTokens(stats.totalTokens)} />
      <Row label="工具调用" value={`${stats.toolCalls} 次`} />
      <Row label="对话时长" value={stats.durMin ? `约 ${stats.durMin} 分钟` : '—'} />
      {stats.toolNames.length > 0 && (
        <>
          <div className="text-[11px] font-medium pt-1.5 px-1" style={{ color: c.textTertiary }}>常用工具</div>
          {stats.toolNames.map(([name, n]) => (
            <div key={name} className="flex items-center justify-between px-3 py-1.5 rounded-lg glass">
              <span className="text-[11.5px] font-mono truncate" style={{ color: c.textSecondary }}>{name}</span>
              <span className="text-[11px] font-mono" style={{ color: c.textMuted }}>×{n}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── 文件：工作区轻量文件树（懒加载 + 点击预览），对应 ClerkBox 右侧「文件」页签 ───
interface DirEntry { name: string; path: string; type: 'directory' | 'file' }

function FilesPane({ workDir }: { workDir: string }) {
  const { c } = useTheme()
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [children, setChildren] = useState<Record<string, DirEntry[] | null>>({})
  const [preview, setPreview] = useState<{ path: string; name: string; content: string } | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)

  const root = workDir || ''
  useEffect(() => {
    setEntries(null); setError(''); setExpanded({}); setChildren({}); setPreview(null)
    if (!root) { setError('未设置工作目录（在顶栏选择目录后浏览文件）'); return }
    fetch('/api/code/read-dir?path=' + encodeURIComponent(root))
      .then(r => r.json())
      .then((d: any) => {
        if (Array.isArray(d)) setEntries(d)
        else setError(d?.error || '读取目录失败')
      })
      .catch(() => setError('读取目录失败'))
  }, [root])

  const toggleDir = useCallback(async (path: string) => {
    if (expanded[path]) { setExpanded(p => ({ ...p, [path]: false })); return }
    setExpanded(p => ({ ...p, [path]: true }))
    if (children[path] === undefined) {
      setChildren(ch => ({ ...ch, [path]: null }))
      try {
        const res = await fetch('/api/code/read-dir?path=' + encodeURIComponent(path))
        const data = await res.json()
        setChildren(ch => ({ ...ch, [path]: Array.isArray(data) ? data : [] }))
      } catch { setChildren(ch => ({ ...ch, [path]: [] })) }
    }
  }, [expanded, children])

  const openFile = useCallback(async (path: string, name: string) => {
    setLoadingFile(true)
    try {
      const res = await fetch('/api/code/read-file?path=' + encodeURIComponent(path))
      const data = await res.json()
      if (data?.success) setPreview({ path, name, content: String(data.content || '').slice(0, 200000) })
      else setPreview({ path, name, content: `（无法预览：${data?.error || '读取失败'}）` })
    } catch { setPreview({ path, name, content: '（读取失败）' }) }
    setLoadingFile(false)
  }, [])

  const renderLevel = (list: DirEntry[], depth: number): React.ReactNode => list.map(e => (
    <div key={e.path}>
      <button onClick={() => (e.type === 'directory' ? toggleDir(e.path) : openFile(e.path, e.name))}
        className="w-full flex items-center gap-1.5 py-1 pr-2 rounded-md text-left transition-colors hover:opacity-80"
        style={{ paddingLeft: 6 + depth * 14, background: preview?.path === e.path ? `${c.accent}14` : 'transparent' }}>
        {e.type === 'directory' ? (
          <>
            <svg className={`w-3 h-3 shrink-0 transition-transform ${expanded[e.path] ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ color: '#f59e0b' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          </>
        )}
        <span className="text-[11.5px] truncate" style={{ color: e.type === 'directory' ? c.textSecondary : c.text }}>{e.name}</span>
      </button>
      {e.type === 'directory' && expanded[e.path] && (
        children[e.path] === null || children[e.path] === undefined
          ? <div className="text-[10.5px] py-1" style={{ paddingLeft: 6 + (depth + 1) * 14, color: c.textMuted }}>加载中…</div>
          : children[e.path]!.length === 0
            ? <div className="text-[10.5px] py-1" style={{ paddingLeft: 6 + (depth + 1) * 14, color: c.textMuted }}>（空）</div>
            : renderLevel(children[e.path]!, depth + 1)
      )}
    </div>
  ))

  if (preview) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-8 flex items-center gap-2 px-2 border-b shrink-0" style={{ borderColor: c.borderLight }}>
          <button onClick={() => setPreview(null)} className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ color: c.textTertiary }} title="返回文件树">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-[11.5px] font-medium truncate" style={{ color: c.textHead }} title={preview.path}>{preview.name}</span>
          {loadingFile && <span className="text-[10px] shrink-0" style={{ color: c.textMuted }}>加载中…</span>}
          <span className="flex-1" />
          <button onClick={() => navigator.clipboard?.writeText(preview.content)} className="text-[10.5px] px-1.5 py-0.5 rounded shrink-0" style={{ color: c.textTertiary }} title="复制文件内容">复制</button>
        </div>
        <pre className="flex-1 overflow-auto scrollbar-thin px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: c.textSecondary, fontFamily: 'var(--font-mono)' }}>
          {preview.content}
        </pre>
      </div>
    )
  }

  if (error) return <div className="flex-1 flex items-center justify-center px-6 text-center text-[11.5px]" style={{ color: c.textMuted }}>{error}</div>
  if (!entries) return <div className="flex-1 flex items-center justify-center text-[11px]" style={{ color: c.textMuted }}>加载中…</div>
  return <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-1">{entries.length === 0 ? <div className="text-center text-[11px] py-6" style={{ color: c.textMuted }}>（空目录）</div> : renderLevel(entries, 0)}</div>
}

// ─── 辅助对话：轻量独立小助手（不走主对话，不写库）───
function AssistantChat({ settings, workDir }: { settings: Settings; workDir: string }) {
  const { c } = useTheme()
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs(next)
    try {
      const res = await fetch('/api/llm-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Base': settings.apiBaseUrl, 'X-Api-Key': effectiveApiKey(settings.apiKey) },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: `你是主对话旁的轻量辅助助手，帮助用户思考、翻译、润色、起名、查疑等小任务。回答简短直接。当前工作区：${workDir || '未设置'}。不要主动建议执行文件操作。` },
            ...next.slice(-10),
          ],
          max_tokens: 800,
          stream: false,
        }),
      })
      const data = await res.json()
      const reply = (data.choices?.[0]?.message?.content || data.error?.message || '（无回复）').trim()
      setMsgs(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e: any) {
      setMsgs(prev => [...prev, { role: 'assistant', content: `错误: ${e.message}` }])
    }
    setBusy(false)
  }, [input, busy, msgs, settings, workDir])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 scrollbar-thin">
        {msgs.length === 0 && (
          <div className="text-[11px] leading-relaxed pt-6 text-center" style={{ color: c.textMuted }}>
            独立小助手，处理轻量问题<br />不影响主对话上下文
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] text-[12px] leading-relaxed px-2.5 py-1.5 rounded-xl break-words ${m.role === 'user' ? 'whitespace-pre-wrap' : 'side-md'}`}
              style={m.role === 'user'
                ? { background: c.bgInput, color: c.text }
                : { background: 'transparent', border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>
              {m.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              ) : m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-[11px]" style={{ color: c.textMuted }}>思考中…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="p-2 border-t shrink-0" style={{ borderColor: c.borderLight }}>
        <div className="flex gap-1.5">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) send() }}
            placeholder="问点什么…"
            className="flex-1 px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
            style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
          <button onClick={send} disabled={busy || !input.trim()}
            className="px-3 rounded-lg text-[11px] font-medium text-white disabled:opacity-40" style={{ background: c.accent }}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 审查：让 AI 审查当前主对话（内容/风险/改进建议）───
function ReviewChat({ mainMessages, settings }: { mainMessages: Message[]; settings: Settings }) {
  const { c } = useTheme()
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<'conversation' | 'last'>('conversation')

  const runReview = useCallback(async () => {
    if (busy) return
    const msgs = scope === 'last' ? mainMessages.slice(-6) : mainMessages.slice(-30)
    if (msgs.length === 0) { setResult('当前对话还没有内容。'); return }
    setBusy(true)
    setResult('')
    try {
      const transcript = msgs.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${(m.content || '').slice(0, 800)}`).join('\n\n')
      const makeBody = () => JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: '你是一位严谨的审查员。审查给出的对话内容，输出结构化报告（中文，markdown）：\n## 总体评价\n## 事实与逻辑问题（如有，逐条列出并给出修正建议）\n## 风险点（操作风险、安全风险、遗漏项）\n## 改进建议\n只输出报告本身。若对话无明显问题，也请给出可提升的点。' },
          { role: 'user', content: transcript.slice(0, 12000) },
        ],
        max_tokens: 1500,
        stream: false,
      })
      const headers = { 'Content-Type': 'application/json', 'X-Target-Base': settings.apiBaseUrl, 'X-Api-Key': effectiveApiKey(settings.apiKey) }
      let res: Response
      try {
        res = await fetch('/api/llm-proxy', { method: 'POST', headers, body: makeBody() })
      } catch {
        // 免费档偶发断连：自动重试一次
        await new Promise(r => setTimeout(r, 1500))
        res = await fetch('/api/llm-proxy', { method: 'POST', headers, body: makeBody() })
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${errText.slice(0, 120)}`)
      }
      const data = await res.json()
      setResult((data.choices?.[0]?.message?.content || data.error?.message || '审查失败').trim())
    } catch (e: any) {
      setResult(`审查失败: ${e.message}`)
    }
    setBusy(false)
  }, [mainMessages, scope, busy, settings])

  // 简易 markdown 渲染（标题/列表/粗体）
  const renderMd = (text: string) => text.split('\n').map((line, i) => {
    const bold = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((seg, j) => j % 2 === 1 ? <b key={j} style={{ color: c.text }}>{seg}</b> : seg)
    if (line.startsWith('## ')) return <div key={i} className="text-[12.5px] font-semibold mt-3 mb-1" style={{ color: c.textHead }}>{bold(line.slice(3))}</div>
    if (line.startsWith('# ')) return <div key={i} className="text-[13px] font-bold mt-3 mb-1" style={{ color: c.textHead }}>{bold(line.slice(2))}</div>
    if (/^[-*] /.test(line)) return <div key={i} className="text-[12px] leading-relaxed flex gap-1.5" style={{ color: c.textSecondary }}><span style={{ color: c.accent }}>·</span><span>{bold(line.slice(2))}</span></div>
    if (!line.trim()) return <div key={i} className="h-1.5" />
    return <div key={i} className="text-[12px] leading-relaxed" style={{ color: c.textSecondary }}>{bold(line)}</div>
  })

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b space-y-2 shrink-0" style={{ borderColor: c.borderLight }}>
        <div className="flex gap-1.5">
          {([['conversation', '整个对话'], ['last', '最近几条']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setScope(id)}
              className="px-2 py-1 rounded-lg text-[10.5px] font-medium"
              style={{ background: scope === id ? `${c.accent}12` : c.bgInput, color: scope === id ? c.accent : c.textTertiary }}>
              {label}
            </button>
          ))}
          <button onClick={runReview} disabled={busy}
            className="ml-auto px-3 py-1 rounded-lg text-[10.5px] font-medium text-white disabled:opacity-40" style={{ background: c.accent }}>
            {busy ? '审查中…' : '开始审查'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
        {!result && !busy && <div className="text-[11px] pt-4 text-center" style={{ color: c.textMuted }}>让 AI 以第三方视角审查当前对话：事实、逻辑、风险、改进建议</div>}
        {busy && <div className="text-[11px] pt-4 text-center" style={{ color: c.textMuted }}>正在审查…</div>}
        {result && renderMd(result)}
      </div>
    </div>
  )
}

// ─── 浏览器：内置 webview ───
function BrowserPane() {
  const { c } = useTheme()
  const [url, setUrl] = useState('')
  const [current, setCurrent] = useState('')
  const [input, setInput] = useState('')
  const webviewRef = useRef<any>(null)

  const go = (u: string) => {
    let full = u.trim()
    if (!full) return
    if (!/^https?:\/\//i.test(full)) {
      // 不是 URL 就当搜索
      full = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(full) ? `https://${full}` : `https://www.bing.com/search?q=${encodeURIComponent(full)}`
    }
    setCurrent(full)
    setInput(full)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1.5 p-2 border-b shrink-0" style={{ borderColor: c.borderLight }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) go(input) }}
          placeholder="输入网址或搜索词…"
          className="flex-1 px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
          style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
        <button onClick={() => go(input)} className="px-3 rounded-lg text-[11px] font-medium text-white" style={{ background: c.accent }}>前往</button>
        <button onClick={() => webviewRef.current?.reload()} className="px-2 rounded-lg text-[11px]" style={{ background: c.bgInput, color: c.textTertiary }}>刷新</button>
      </div>
      <div className="flex-1 min-h-0" style={{ background: c.bgInput }}>
        {current ? (
          <webview
            ref={webviewRef}
            src={current}
            style={{ width: '100%', height: '100%' }}
            allowpopups={'true' as any}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-[11px]" style={{ color: c.textMuted }}>输入网址开始浏览</div>
        )}
      </div>
    </div>
  )
}
