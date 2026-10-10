import { useState, useRef, useCallback, useEffect, memo, Fragment } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ToolCall } from '../types'
import { useTheme } from '../hooks/useTheme'
import { textForSpeech } from '../utils/tts'
import BrandMark from '../app/BrandMark'
import DiffCardView from '../app/DiffCardView'

export function ToolCallCard({ tool }: { tool: ToolCall }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const isRunning = tool.status === 'running' || tool.status === 'pending'
  const isError = tool.status === 'error'
  const isDone = tool.status === 'done'

  let argsPreview = ''
  try {
    const args = JSON.parse(tool.arguments || '{}')
    argsPreview = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60)}`).join(' · ')
  } catch { argsPreview = (tool.arguments || '').slice(0, 100) }

  const toolNames: Record<string, string> = {
    shell: '终端', read_file: '读取文件', write_file: '写入文件', list_dir: '列目录',
    web_fetch: '抓取网页', search_files: '搜索文件', search_content: '搜索内容',
    system_info: '系统信息', process_list: '进程列表', port_check: '端口检查',
    move_file: '移动文件', delete_file: '删除文件', image_generate: '生成图片',
    web_search: '联网搜索', base64_tools: 'Base64', hash_tools: '哈希',
    url_tools: 'URL', text_tools: '文本', random_tools: '随机',
    color_tools: '颜色', json_process: 'JSON', timestamp_tools: '时间',
    uuid_generate: 'UUID', remember: '记忆写入', recall: '记忆读取', forget: '记忆删除',
  }
  const displayName = toolNames[tool.name] || tool.name
  const statusColor = isError ? c.toolErr : isRunning ? c.toolWarn : c.toolOk

  return (
    <div className="tool-card my-2">
      <div className="tool-card-header" onClick={() => setOpen(v => !v)}>
        {isRunning ? (
          <svg className="w-4 h-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: statusColor }}>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: statusColor }}>
            {isDone
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />}
          </svg>
        )}
        <span className="text-[12.5px] font-medium flex-1" style={{ color: c.textSecondary }}>
          {displayName}{isRunning ? '…' : ''}
        </span>
        {argsPreview && <span className="text-[11px] truncate max-w-[40%] hidden sm:block" style={{ color: c.textTertiary }}>{argsPreview}</span>}
        <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textTertiary }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {open && (
        <div className="tool-card-content">
          {(tool.arguments || '') && (
            <pre className="whitespace-pre-wrap leading-relaxed">
              {(() => { try { return JSON.stringify(JSON.parse(tool.arguments), null, 2) } catch { return tool.arguments } })()}
            </pre>
          )}
          {tool.result && (
            <pre className="whitespace-pre-wrap leading-relaxed mt-2" style={{ color: c.textSecondary, fontFamily: 'var(--font-mono)' }}>
              {tool.result.length > 3000 ? tool.result.slice(0, 3000) + '\n…[已截断]' : tool.result}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** 读取消息的「首字耗时」侧车（useChat 在流式增量到达时写入） */
function readThinkMs(msgId?: string): number | null {
  if (!msgId) return null
  try {
    const map = JSON.parse(localStorage.getItem('lyclaw_msg_think_ms') || '{}')
    const v = Number(map[msgId])
    return v > 500 ? v : null
  } catch { return null }
}

function fmtThink(ms: number): string {
  return ms < 60000 ? `思考了 ${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒` : `思考了 ${Math.round(ms / 60000)} 分钟`
}

function ThinkingCard({ thinking, isStreaming, open, onToggle, thinkMs }: { thinking: string; isStreaming: boolean; open: boolean; onToggle: () => void; thinkMs?: number | null }) {
  const { c } = useTheme()
  if (!thinking && !isStreaming && !thinkMs) return null
  const label = isStreaming ? '思考中…' : (thinkMs ? fmtThink(thinkMs) : '已深度思考')
  const collapsible = !!thinking || isStreaming
  return (
    <div className="thinking-card my-2">
      <div className="thinking-header" onClick={collapsible ? onToggle : undefined} style={collapsible ? undefined : { cursor: 'default' }}>
        {collapsible && (
          <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textTertiary }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        <span>{label}</span>
      </div>
      {open && collapsible && (
        <div className="thinking-content">
          {thinking || (isStreaming ? '思考中…' : '')}
        </div>
      )}
    </div>
  )
}

/** 代码块：语言栏 + 复制按钮（ChatGPT 风格） */
function CodeBlock({ children }: { children?: any }) {
  const [copied, setCopied] = useState(false)
  const codeEl = Array.isArray(children) ? children[0] : children
  const className: string = codeEl?.props?.className || ''
  const lang = (/language-([\w-]+)/.exec(className)?.[1]) || 'text'
  const raw = String(codeEl?.props?.children ?? '').replace(/\n$/, '')

  const copy = () => {
    navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{lang}</span>
        <button onClick={copy} title="复制代码">
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              已复制
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              复制
            </>
          )}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

/** 表格：悬停显示复制按钮（复制为 TSV，可直接粘贴到 Excel/Numbers/表格软件） */
function TableBlock({ children }: { children?: any }) {
  const [copied, setCopied] = useState(false)
  const tableRef = useRef<HTMLTableElement>(null)
  const { c } = useTheme()

  const copy = () => {
    const el = tableRef.current
    if (!el) return
    const rows = Array.from(el.querySelectorAll('tr'))
    const tsv = rows.map(tr => Array.from(tr.querySelectorAll('th,td'))
      .map(td => (td.textContent || '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n')
    navigator.clipboard?.writeText(tsv).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  return (
    <div className="table-block relative group/table">
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/table:opacity-100 transition-opacity">
        <button onClick={copy} title="复制表格（可粘贴到 Excel/Numbers）"
          className="h-6 px-2 rounded-md flex items-center gap-1 text-[11px] font-medium shadow-sm"
          style={{ background: c.surfaceCard, border: `1px solid ${c.border}`, color: c.textSecondary }}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table ref={tableRef}>{children}</table>
      </div>
    </div>
  )
}

/** 幽灵图标按钮 */
function IconAction({ icon, label, onClick, active }: { icon: string; label: string; onClick: () => void; active?: boolean }) {
  const { c } = useTheme()
  return (
    <button onClick={onClick} title={label}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
      style={{ color: active ? c.accent : c.textTertiary }}
      onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
    </button>
  )
}

const MessageBubble = memo(function MessageBubble({ content, thinking, role, isStreaming, toolCalls, isLast, onRegenerate, onOpenBrowser, onRollback, onEdit, createdAt, variants, msgId, swarm: swarmProp }: {
  content: string; thinking?: string; role: 'user' | 'assistant'; isStreaming?: boolean;
  toolCalls?: ToolCall[]; isLast?: boolean; onRegenerate?: () => void;
  onOpenBrowser?: (url: string) => void; onRollback?: () => void;
  onEdit?: (newContent: string) => void;
  createdAt?: string;
  /** 消息分支：旧回答版本（重新生成时归档），0 号即主内容 */
  variants?: string[];
  msgId?: string;
  swarm?: any
}) {
  const isUser = role === 'user'
  const [copied, setCopied] = useState(false)
  const [savedKb, setSavedKb] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { c } = useTheme()

  // 消息分支视图切换（0=最新主内容，1..n=历史版本）；选中索引持久化
  const versionCount = 1 + (variants?.length || 0)
  const variantKey = msgId ? `lyclaw_variant_idx:${msgId}` : ''
  const [variantIdx, setVariantIdx] = useState(() => {
    try { const v = variantKey ? parseInt(localStorage.getItem(variantKey) || '0', 10) : 0; return isNaN(v) ? 0 : Math.min(Math.max(0, v), versionCount - 1) } catch { return 0 }
  })
  const switchVariant = (next: number) => {
    const clamped = Math.min(Math.max(0, next), versionCount - 1)
    setVariantIdx(clamped)
    try { if (variantKey) localStorage.setItem(variantKey, String(clamped)) } catch { /* ignore */ }
  }
  const shownContent = variantIdx > 0 && variants ? (variants[variantIdx - 1] ?? content) : content

  // 消息聚焦阅读模式
  const [focusOpen, setFocusOpen] = useState(false)
  useEffect(() => {
    if (!focusOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocusOpen(false) }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [focusOpen])

  // 长回复自动折叠：非流式、超过 2500 字默认收起（保留首屏），点击展开
  const LONG_LIMIT = 2500
  const [longCollapsed, setLongCollapsed] = useState(false)
  const isLong = !isStreaming && shownContent.length > LONG_LIMIT
  const displayContent = isLong && longCollapsed ? shownContent.slice(0, 1200) : shownContent
  const prevLongRef = useRef(false)
  useEffect(() => {
    if (isLong && !prevLongRef.current) setLongCollapsed(true)
    prevLongRef.current = isLong
  }, [isLong])

  const LinkRenderer = useCallback((props: any) => {
    const { href, children } = props
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const isExternal = href && !href.startsWith(origin) && !href.startsWith('#') && !href.startsWith('/') && !href.startsWith('file://')
    if (isExternal && onOpenBrowser) {
      return (
        <a href={href} onClick={(e) => { e.preventDefault(); onOpenBrowser(href) }}
          style={{ color: c.accent, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' }}>
          {children}
        </a>
      )
    }
    return <a href={href} style={{ color: c.accent, textDecoration: 'underline', textUnderlineOffset: 3 }}>{children}</a>
  }, [c.accent, onOpenBrowser])

  const copyContent = async () => {
    try { await navigator.clipboard.writeText(shownContent) } catch {
      const ta = document.createElement('textarea'); ta.value = shownContent; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const speakContent = async () => {
    if (speaking) { audioRef.current?.pause(); audioRef.current = null; window.speechSynthesis.cancel(); setSpeaking(false); return }
    setSpeaking(true)
    // 净化 Markdown 后再朗读：代码块/链接/表格符号读出来是灾难
    const spoken = textForSpeech(shownContent)
    let voice = 'zh-CN-XiaoxiaoNeural'
    let speed = '1.0'
    try {
      const raw = localStorage.getItem('lyclaw_settings')
      if (raw) { const s = JSON.parse(raw); voice = s.voiceId || voice; speed = s.ttsSpeed || speed }
    } catch {}
    try {
      const resp = await fetch('/api/edge-tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: spoken, voice, speed: Number(speed) || 1.0 }) })
      if (!resp.ok) throw new Error()
      const blob = await resp.blob()
      const audioUrl = URL.createObjectURL(blob)
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      audio.onended = () => { URL.revokeObjectURL(audioUrl); audioRef.current = null; setSpeaking(false) }
      audio.onerror = () => { URL.revokeObjectURL(audioUrl); audioRef.current = null; setSpeaking(false) }
      await audio.play()
    } catch {
      setSpeaking(false)
      const u = new SpeechSynthesisUtterance(spoken)
      const voices = window.speechSynthesis.getVoices()
      const zhVoice = voices.find(v => v.lang.startsWith('zh')) || voices.find(v => v.lang === 'zh-CN')
      if (zhVoice) u.voice = zhVoice
      u.rate = Number(speed) || 1; u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false)
      setSpeaking(true); window.speechSynthesis.speak(u)
    }
  }

  // ─── 用户消息：右对齐灰底圆角气泡（支持 ✏️ 编辑重发）───
  if (isUser) {
    return (
      <div className="flex justify-end mb-6 animate-fade-in"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setShowRollbackConfirm(false) }}>
        <div className="max-w-[78%] flex flex-col items-end">
          {editing ? (
            <div className="w-full rounded-2xl border p-2" style={{ background: c.surfaceInput, borderColor: c.border }}>
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={Math.min(8, editText.split('\n').length + 1)} autoFocus
                className="w-full bg-transparent outline-none resize-none text-[15px] leading-7" style={{ color: c.text }} />
              <div className="flex justify-end gap-2 mt-1">
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: c.textSecondary }}>取消</button>
                <button onClick={() => { setEditing(false); if (editText.trim() && onEdit) onEdit(editText.trim()) }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: c.textHead, color: c.bg }}>发送</button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-2.5 leading-[1.6] whitespace-pre-wrap break-words"
              style={{ background: c.userBubbleBg, color: c.userBubbleText, borderRadius: 18, fontSize: 'var(--chat-font, 16px)' }}>
              {content}
            </div>
          )}
          {!editing && onRollback && hovered && !isStreaming && (
            <div className="mt-1.5 mr-1 flex items-center gap-1">
              {showRollbackConfirm ? (
                <div className="flex items-center gap-1.5 text-[11.5px]">
                  <span style={{ color: c.textTertiary }}>回滚到这里？</span>
                  <button onClick={() => { setShowRollbackConfirm(false); onRollback() }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: c.toolErr, color: '#fff' }}>确定</button>
                  <button onClick={() => setShowRollbackConfirm(false)}
                    className="px-2.5 py-1 rounded-lg text-xs" style={{ color: c.textTertiary, background: c.surfaceInput }}>取消</button>
                </div>
              ) : (
                <>
                  {onEdit && <IconAction label="编辑并重发" icon="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" onClick={() => { setEditText(content); setEditing(true) }} />}
                  <IconAction label="回滚到此处" icon="M3 3v5h5M3.05 13A9 9 0 106 5.3L3 8" onClick={() => setShowRollbackConfirm(true)} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── AI 消息：全宽无气泡正文（ChatGPT 原生布局）───
  return (
    <div className="mb-7 animate-fade-in group"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="min-w-0">
        {(() => {
          const swarm = typeof swarmProp === 'string' ? (() => { try { return JSON.parse(swarmProp) } catch { return null } })() : swarmProp
          if (!swarm || !swarm.agents?.length) return null
          const total = swarm.agents.length
          const doneCount = swarm.agents.filter((a: any) => a.status === 'done' || a.status === 'error').length
          const allDone = doneCount === total
          const runningIdx = swarm.agents.findIndex((a: any) => a.status === 'running')
          const effExpanded = expandedAgent !== null ? expandedAgent : (runningIdx >= 0 ? runningIdx : -2)
          const pct = allDone ? 100 : runningIdx >= 0 ? Math.round(((runningIdx) / total) * 80) : 100
          return (
            <div className="mb-3 rounded-xl border overflow-hidden" style={{ borderColor: `${c.accent}30`, background: `${c.accent}04` }}>
              <div className="px-3 pt-2.5 pb-2 flex items-center gap-2">
                <svg className={`w-3.5 h-3.5 ${allDone ? '' : 'animate-spin'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.accent }}>
                  {allDone
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    : <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />}
                </svg>
                <span className="text-[11.5px] font-semibold truncate" style={{ color: c.textSecondary }} title={swarm.phase}>{swarm.phase || 'Agent 集群'}</span>
                {!swarm.plan?.length && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `${c.accent}12`, color: c.accent }}>{total} 个协作</span>}
                <span className="ml-auto text-[10px] font-mono shrink-0" style={{ color: c.textTertiary }}>{doneCount}/{total} 完成</span>
              </div>
              <div className="px-3 pb-1">
                <div className="h-1 rounded-full overflow-hidden" style={{ background: c.surfaceInput }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: c.accent }} />
                </div>
              </div>
              {/* 目标清单 + 实时进度（自主模式 update_plan） */}
              {Array.isArray(swarm.plan) && swarm.plan.length > 0 && (() => {
                const doneN = swarm.plan.filter((g: any) => g.status === 'done').length
                const pctN = Math.round((doneN / swarm.plan.length) * 100)
                return (
                  <div className="mx-3 mb-2 rounded-lg border overflow-hidden" style={{ borderColor: c.borderLight, background: c.surfaceCard }}>
                    <div className="flex items-center gap-2 px-2.5 pt-1.5">
                      <span className="text-[10.5px] font-medium" style={{ color: c.textSecondary }}>目标清单</span>
                      <span className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: c.surfaceInput }}>
                        <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${pctN}%`, background: '#34d399' }} />
                      </span>
                      <span className="text-[10px] font-mono shrink-0" style={{ color: doneN === swarm.plan.length ? '#34d399' : c.textTertiary }}>{doneN}/{swarm.plan.length}</span>
                    </div>
                    <ul className="px-2.5 pb-1.5 pt-1 space-y-0.5">
                      {swarm.plan.map((g: any, gi: number) => (
                        <li key={gi} className="flex items-center gap-1.5 text-[11px]">
                          {g.status === 'done' ? (
                            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          ) : g.status === 'active' ? (
                            <svg className="w-3 h-3 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          ) : (
                            <span className="w-3 h-3 shrink-0 rounded-full border" style={{ borderColor: c.border }} />
                          )}
                          <span style={{ color: g.status === 'done' ? c.textMuted : g.status === 'active' ? c.text : c.textTertiary, textDecoration: g.status === 'done' ? 'line-through' : 'none' }}>
                            {g.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })()}
              <div className="px-2 pb-2 space-y-1.5">
                {swarm.agents.map((a: any, i: number) => {
                  const expanded = effExpanded === -2 || effExpanded === i
                  return (
                    <div key={i} className="rounded-xl border overflow-hidden glass" style={{
                      borderColor: a.status === 'error' ? `${c.toolErr}50` : a.status === 'running' ? `${c.accent}50` : a.status === 'done' ? `${c.accent}25` : c.borderLight,
                      opacity: a.status === 'pending' && !expanded ? 0.6 : 1,
                    }}>
                      <button onClick={() => setExpandedAgent(expandedAgent === i ? null : i)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left">
                        {a.status === 'running' ? (
                          <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" style={{ color: c.accent }}>
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : a.status === 'pending' ? (
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textTertiary }}>
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}
                            style={{ color: a.status === 'error' ? c.toolErr : c.toolOk }}>
                            {a.status === 'error'
                              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              : <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />}
                          </svg>
                        )}
                        <span className="text-[11px] font-semibold" style={{ color: c.text }}>{a.name}</span>
                        {a.role && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${c.accent}10`, color: c.accent }}>{a.role}</span>}
                        <span className="ml-auto text-[9px] shrink-0" style={{ color: a.status === 'running' ? c.accent : c.textTertiary }}>
                          {a.status === 'running' ? '执行中' : a.status === 'pending' ? '排队中' : a.status === 'error' ? '失败' : '完成'}
                        </span>
                        <svg className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textTertiary }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {expanded && (
                        <div className="px-3 pb-3 space-y-2 border-t" style={{ borderColor: c.borderLight }}>
                          {a.task && (
                            <div className="flex justify-end">
                              <div className="text-[11px] leading-relaxed px-3 py-1.5 rounded-xl max-w-[88%] whitespace-pre-wrap break-words" style={{ background: c.surfaceInput, color: c.text }}>
                                {a.task}
                              </div>
                            </div>
                          )}
                          {a.messages && a.messages.length > 0 ? (
                            a.messages.map((m: any, j: number) => {
                              if (m.role === 'tool') return null
                              if (m.role === 'user') return null
                              if (m.role === 'thinking') {
                                return (
                                  <details key={j} className="group">
                                    <summary className="cursor-pointer text-[10px] font-medium py-0.5 list-none flex items-center gap-1" style={{ color: c.textTertiary }}>
                                      <svg className="w-2.5 h-2.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                      </svg>
                                      思考过程
                                    </summary>
                                    <div className="pl-3.5 border-l-2 mt-1" style={{ borderColor: c.borderLight }}>
                                      <pre className="text-[10px] whitespace-pre-wrap leading-relaxed" style={{ color: c.textTertiary, fontFamily: 'inherit' }}>{m.content}</pre>
                                    </div>
                                  </details>
                                )
                              }
                              if (m.role === 'assistant') {
                                const cards = Array.isArray(m.tool_calls) && m.tool_calls.length > 0
                                  ? m.tool_calls.map((tc: any) => {
                                      const res = a.messages.find((x: any) => x.role === 'tool' && x.tool_call_id === tc.id)
                                      return (
                                        <ToolCallCard key={tc.id} tool={{
                                          id: tc.id,
                                          name: tc.function?.name,
                                          arguments: tc.function?.arguments,
                                          status: res ? (/^(错误|【安全拦截】)/.test(String(res.content || '')) ? 'error' : 'done') : 'running',
                                          result: res?.content || undefined,
                                        }} />
                                      )
                                    })
                                  : null
                                // 话在前,操作在后:员工先说的话不再被工具卡吞掉
                                if (!m.content) return cards ? <div key={j} className="space-y-1.5">{cards}</div> : null
                                return (
                                  <div key={j} className="space-y-1.5">
                                    <div className="flex justify-start">
                                      <div className="text-[11px] leading-relaxed px-3 py-1.5 rounded-xl max-w-[92%] whitespace-pre-wrap break-words"
                                        style={{ background: 'transparent', border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>
                                        {m.content}
                                      </div>
                                    </div>
                                    {cards}
                                  </div>
                                )
                              }
                              return null
                            })
                          ) : (
                            <div className="text-[10px] pt-1" style={{ color: c.textTertiary }}>
                              {a.output || '等待执行…'}
                            </div>
                          )}
                          {a.status === 'running' && (
                            <div className="flex items-center gap-1.5 pt-1" style={{ color: c.textTertiary }}>
                              <span className="flex gap-0.5">
                                <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: c.accent }} />
                                <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: c.accent, animationDelay: '150ms' }} />
                                <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: c.accent, animationDelay: '300ms' }} />
                              </span>
                              <span className="text-[10px]">正在思考…</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        <ThinkingCard thinking={thinking || ''} isStreaming={!!isStreaming} open={thinkingOpen} onToggle={() => setThinkingOpen(v => !v)} thinkMs={isUser ? null : readThinkMs(msgId)} />
        {(() => {
          const tcs: any[] = toolCalls || []
          const diffFor = (tc: any) => ((tc.name === 'write_file' || tc.name === 'edit_file') && tc.changeId && tc.status !== 'pending')
            ? <DiffCardView key={'d_' + tc.id} tc={tc} c={c} />
            : null
          const Text = ({ v }: { v: string }) => !v ? null : (
            <div className="markdown-body" style={{ color: c.msgBotText, fontSize: 'var(--chat-font, 16px)' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ a: LinkRenderer, pre: CodeBlock as any, table: TableBlock as any }}>
                {v}
              </ReactMarkdown>
            </div>
          )
          // 时序交错:带 preLen 标记(本轮会话产生)→ 文本与工具卡按真实顺序排布,
          // 说在工具前的话在卡片上方,最终输出收尾;历史无标记行 → 文在前卡在后
          if (tcs.some((tc: any) => typeof tc.preLen === 'number')) {
            let last = 0
            const seq: any[] = []
            for (const tc of tcs) {
              const cut = Math.max(last, Math.min(Number(tc.preLen) || 0, shownContent.length))
              if (cut > last) seq.push(<Text key={'t' + seq.length} v={displayContent.slice(last, Math.min(cut, displayContent.length))} />)
              seq.push(<Fragment key={'c' + tc.id}><ToolCallCard tool={tc} />{diffFor(tc)}</Fragment>)
              last = cut
            }
            if (last < displayContent.length) seq.push(<Text key="t-end" v={displayContent.slice(last)} />)
            return seq
          }
          return (
            <>
              {shownContent ? <Text v={displayContent} /> : null}
              {tcs.map(tc => <Fragment key={tc.id}><ToolCallCard tool={tc} />{diffFor(tc)}</Fragment>)}
            </>
          )
        })()}
        {isLong && longCollapsed && (
          <button onClick={() => setLongCollapsed(false)}
            className="mt-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
            style={{ background: c.surfaceInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>
            展开全文（共 {shownContent.length.toLocaleString()} 字）
          </button>
        )}
        {isStreaming && shownContent && <span className="inline-block w-2 h-4 rounded-sm animate-pulse align-middle ml-0.5" style={{ background: c.accent }} />}
        {isStreaming && !shownContent && (!toolCalls || toolCalls.length === 0) && (
          <div className="flex items-center gap-2 py-1">
            <BrandMark size={18} color={c.textTertiary} className="animate-pulse" />
            <span className="text-[13px]" style={{ color: c.textTertiary }}>正在生成…</span>
          </div>
        )}

        {/* 悬停操作栏（含时间戳） */}
        {!isStreaming && shownContent && (
          <div className={`flex items-center gap-0.5 mt-1.5 -ml-2 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}>
            <IconAction label="聚焦阅读" icon="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" onClick={() => setFocusOpen(true)} />
            <IconAction label="引用回复" icon="M3 10h10a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2v-7a2 2 0 012-2zM6 6V4a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2" onClick={() => {
              const q = shownContent.length > 400 ? shownContent.slice(0, 400) + '…' : shownContent
              window.dispatchEvent(new CustomEvent('quote-message', { detail: q }))
            }} />
            <IconAction label={copied ? '已复制' : '复制'} icon={copied ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'} onClick={copyContent} active={copied} />
            <IconAction label={speaking ? '停止朗读' : '朗读'} icon={speaking ? 'M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z' : 'M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14'} onClick={speakContent} active={speaking} />
            <IconAction label="存入知识库" icon="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" onClick={async () => {
              try {
                const r = await fetch('/api/kb/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: shownContent.slice(0, 18).replace(/[#*\n]/g, ' ').trim() || '对话摘录', content: shownContent, tags: ['对话收藏'], source: 'ai' }) })
                const d = await r.json()
                if (!d.error) { setSavedKb(true); setTimeout(() => setSavedKb(false), 2000) }
              } catch { /* ignore */ }
            }} active={savedKb} />
            {onRegenerate && isLast && (
              <IconAction label="重新生成" icon="M4 4v5h5M4.05 13A9 9 0 106 5.3L4 8" onClick={onRegenerate} />
            )}
            {/* 消息分支切换器：‹ 2/3 › */}
            {!isUser && versionCount > 1 && (
              <span className="flex items-center rounded-md ml-1 select-none" style={{ border: `1px solid ${c.border}` }}>
                <button onClick={() => switchVariant(variantIdx - 1)} disabled={variantIdx === 0}
                  className="w-5 h-5 flex items-center justify-center text-[11px] disabled:opacity-30"
                  style={{ color: c.textTertiary }} title="上一个版本">‹</button>
                <span className="text-[10.5px] font-mono px-0.5" style={{ color: c.textSecondary }}>{variantIdx + 1}/{versionCount}</span>
                <button onClick={() => switchVariant(variantIdx + 1)} disabled={variantIdx === versionCount - 1}
                  className="w-5 h-5 flex items-center justify-center text-[11px] disabled:opacity-30"
                  style={{ color: c.textTertiary }} title="下一个版本">›</button>
              </span>
            )}
            <span className="text-[10.5px] font-mono ml-1.5 select-none" style={{ color: c.textMuted }}>
              {(() => { const d = createdAt ? new Date(createdAt) : null; return d && !isNaN(d.getTime()) ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '' })()}
            </span>
          </div>
        )}
      </div>

      {/* 聚焦阅读浮层：全屏渲染本条消息，Esc 关闭 */}
      {focusOpen && (
        <div className="fixed inset-0 z-[90] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={() => setFocusOpen(false)}>
          <div className="max-w-[820px] mx-auto my-10 rounded-2xl px-10 py-8 shadow-2xl glass-strong"
            style={{ border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: isUser ? c.userBubbleBg : c.surfaceInput, color: isUser ? c.userBubbleText : c.textSecondary }}>
                {isUser ? '用户' : '巨天'}
              </span>
              <span className="text-[11px]" style={{ color: c.textMuted }}>{shownContent.length.toLocaleString()} 字</span>
              <span className="flex-1" />
              <button onClick={copyContent} className="px-2.5 py-1 rounded-md text-[11.5px]" style={{ background: c.surfaceInput, color: c.textSecondary }}>复制</button>
              <button onClick={() => setFocusOpen(false)} className="px-2.5 py-1 rounded-md text-[11.5px]" style={{ background: c.surfaceInput, color: c.textSecondary }}>关闭 (Esc)</button>
            </div>
            <div className="markdown-body" style={{ color: c.text, fontSize: '16px' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ a: LinkRenderer, pre: CodeBlock as any, table: TableBlock as any }}>
                {shownContent}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
});

export default MessageBubble;
