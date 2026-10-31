import { useState, useRef, useCallback, useEffect, memo, Fragment, lazy, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { ToolCall } from '../types'
import { useTheme } from '../hooks/useTheme'
import { textForSpeech } from '../utils/tts'
import { hasMathSyntax, normalizeMathDelimiters, useMathPlugins } from './useMathPlugins'
import { extractCodeText, isMermaidLang, isPreviewableHtml } from '../utils/richCode'
import BrandMark from '../app/BrandMark'
import DiffCardView from '../app/DiffCardView'
import { hhmm } from '../utils/datetime'
import { drawShareCard, downloadDataUrl } from '../utils/shareCard'
import { fetchCompat } from '../api'

export function ToolCallCard({ tool }: { tool: ToolCall }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const isRunning = tool.status === 'running' || tool.status === 'pending'
  // 运行中每秒跳动的"已调用 Ns"——慢工具（如 opencode 线路、长命令）不再像卡死
  const [, bumpTick] = useState(0)
  useEffect(() => {
    if (!isRunning) return
    const t = setInterval(() => bumpTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [isRunning])
  const runningSec = isRunning && tool.started_at
    ? Math.max(0, Math.round((Date.now() - new Date(tool.started_at).getTime()) / 1000))
    : null
  const isError = tool.status === 'error'
  const isDone = tool.status === 'done'

  let args: Record<string, unknown> = {}
  try { args = JSON.parse(tool.arguments || '{}') } catch { /* 解析失败按空参处理 */ }

  // 按工具类型生成紧凑摘要（学 ClerkBox「写入 96 行 index.html +96」形态）
  const lineCount = (v: unknown) => typeof v === 'string' ? v.split('\n').length : 0
  const fileName = (p: unknown) => typeof p === 'string' ? (p.split(/[\\/]/).pop() || p) : ''
  let summary = ''
  let diffCount: number | null = null
  let diffPath = ''
  switch (tool.name) {
    case 'write_file': {
      const n = lineCount(args.content); const p = fileName(args.path)
      summary = `写入 ${n} 行`; diffCount = n; diffPath = p; break
    }
    case 'edit_file':
      summary = '编辑文件'; diffPath = fileName(args.path); break
    case 'read_file':
      summary = fileName(args.path); break
    case 'list_dir':
      summary = typeof args.path === 'string' ? args.path : ''; break
    case 'shell':
      summary = typeof args.command === 'string' ? args.command.replace(/\s+/g, ' ').slice(0, 80) : ''; break
    case 'web_search':
    case 'search_content':
      summary = typeof args.query === 'string' ? args.query.slice(0, 60) : ''; break
    case 'web_fetch':
      summary = typeof args.url === 'string' ? args.url.slice(0, 80) : ''; break
    default:
      try {
        summary = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60)}`).join(' · ')
      } catch { summary = (tool.arguments || '').slice(0, 100) }
  }

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
        <span className="text-[12.5px] font-medium shrink-0" style={{ color: c.textSecondary }}>
          {displayName}{tool.status === 'pending' ? ' · 参数生成中' : isRunning ? '…' : ''}{runningSec !== null ? ` · ${runningSec}s` : ''}
        </span>
        {summary && <span className="text-[11.5px] truncate flex-1 min-w-0 font-mono" style={{ color: c.textTertiary }} title={summary}>{summary}</span>}
        {diffPath && (
          <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded shrink-0 max-w-[30%] truncate" style={{ background: c.bgInput, color: c.textSecondary }} title={diffPath}>
            {diffPath}
          </span>
        )}
        {diffCount !== null && (
          <span className="text-[11px] font-mono shrink-0" style={{ color: c.toolOk }}>+{diffCount}</span>
        )}
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

/** 读取消息的「目标」侧车标记（useChat 在目标模式发送时写入），返回目标文本或 null */
function readGoalMsg(msgId?: string): string | null {
  if (!msgId) return null
  try {
    const map = JSON.parse(localStorage.getItem('lyclaw_msg_goal') || '{}')
    const v = map[msgId]
    return typeof v === 'string' && v ? v : null
  } catch { return null }
}

function fmtThink(ms: number): string {
  return ms < 60000 ? `思考了 ${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒` : `思考了 ${Math.round(ms / 60000)} 分钟`
}

function ThinkingCard({ thinking, isStreaming, open, onToggle, thinkMs }: { thinking: string; isStreaming: boolean; open: boolean; onToggle: () => void; thinkMs?: number | null }) {
  const { c } = useTheme()
  const bodyRef = useRef<HTMLDivElement>(null)
  // 流式期间自动滚到底：思考是持续追加的，不跟到底部就只能看到开头
  useEffect(() => {
    if (isStreaming && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [thinking, isStreaming, open])
  // 生成结束后自动收起：长思考（推理模型动辄几千字）全展开会把正文
  // 挤到屏幕外。只在用户没手动开合过时收，避免跟用户操作打架。
  const userToggled = useRef(false)
  useEffect(() => {
    if (!isStreaming && thinking && !userToggled.current && open) onToggle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming])
  if (!thinking && !isStreaming && !thinkMs) return null
  const label = isStreaming ? '思考中…' : (thinkMs ? fmtThink(thinkMs) : '已深度思考')
  const collapsible = !!thinking || isStreaming
  return (
    <div className="thinking-card my-2">
      <div className="thinking-header" onClick={collapsible ? () => { userToggled.current = true; onToggle() } : undefined} style={collapsible ? undefined : { cursor: 'default' }}>
        {collapsible && (
          <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textTertiary }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        <span>{label}</span>
      </div>
      {open && collapsible && (
        <div className="thinking-content" ref={bodyRef}>
          {thinking || (isStreaming ? '思考中…' : '')}
        </div>
      )}
    </div>
  )
}

/** 单段思考块：多轮「思考→执行→思考」时，每段思考独立显示、独立展开。
 *  与顶部 ThinkingCard 的区别：ThinkingCard 把整条消息的思考堆在一起，
 *  而工具循环里模型会「想一段→做个动作→再想一段」，这里按动作边界切开，
 *  让阅读顺序跟真实推理顺序一致。
 *  展开状态自管理：流式进行中默认展开（让人看到它在想），
 *  结束后自动收起——否则长思考会把正文和工具卡全挤到屏幕外。 */
function ThinkingBlock({ text, label, streaming }: { text: string; label: string; streaming?: boolean }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(true)
  const touched = useRef(false)   // 用户手动开合过就不再自动收
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (streaming && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [text, streaming, open])
  useEffect(() => {
    if (!streaming && !touched.current) setOpen(false)
  }, [streaming])
  if (!text || !text.trim()) return null
  return (
    <div className="thinking-card my-2">
      <div className="thinking-header" onClick={() => { touched.current = true; setOpen(v => !v) }}>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textTertiary }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>{label}</span>
      </div>
      {open && <div className="thinking-content" ref={bodyRef}>{text}</div>}
    </div>
  )
}

/** Mermaid 图表块：整体留在按需 chunk（组件和 mermaid 都只在出现图表时才加载） */
const MermaidBlock = lazy(() => import('./MermaidBlock'))

/** 代码块：语言栏 + 复制按钮（ChatGPT 风格）；mermaid 渲染成图，完整 HTML 文档给预览页签 */
function CodeBlock({ children }: { children?: any }) {
  const { c } = useTheme()
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<'code' | 'preview'>('code')
  const codeEl = Array.isArray(children) ? children[0] : children
  const className: string = codeEl?.props?.className || ''
  const lang = (/language-([\w-]+)/.exec(className)?.[1]) || 'text'
  const raw = extractCodeText(codeEl?.props?.children).replace(/\n$/, '')

  if (isMermaidLang(lang)) {
    return (
      <Suspense fallback={<div className="code-block"><div className="code-block-head"><span>mermaid</span></div><pre><code>{raw}</code></pre></div>}>
        <MermaidBlock code={raw} />
      </Suspense>
    )
  }
  const htmlPreview = isPreviewableHtml(lang, raw)

  const copy = () => {
    navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{lang}</span>
        <div className="flex items-center gap-1">
          {htmlPreview && (
            <div className="flex mr-1 rounded-md overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
              <button onClick={() => setView('code')} className="px-2 py-0.5 text-[11px]"
                style={{ background: view === 'code' ? c.bgInput : 'transparent', color: view === 'code' ? c.text : c.textTertiary }}>代码</button>
              <button onClick={() => setView('preview')} className="px-2 py-0.5 text-[11px]"
                style={{ background: view === 'preview' ? c.bgInput : 'transparent', color: view === 'preview' ? c.text : c.textTertiary }}>预览</button>
            </div>
          )}
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
      </div>
      {htmlPreview && view === 'preview' ? (
        // Artifacts 式预览：allow-scripts 且刻意不给 allow-same-origin——
        // 页面脚本碰不到父窗口的 localStorage/cookie，注入风险被沙箱隔断
        <iframe
          title="HTML 预览"
          sandbox="allow-scripts"
          srcDoc={raw}
          style={{ display: 'block', width: '100%', height: 440, border: 0, borderRadius: '0 0 12px 12px', background: '#fff' }}
        />
      ) : (
        <pre>{children}</pre>
      )}
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
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={!!active}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
      style={{ color: active ? c.accent : c.textTertiary }}
      onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
    </button>
  )
}

// 回调签名统一带 index：父层因此可以传稳定函数引用（不必为每条消息
// 新建闭包），memo 才能真正生效——否则流式每 50ms 一次的全量重渲染
// 会让每条气泡连 ReactMarkdown 都重新解析一遍
const MessageBubble = memo(function MessageBubble({ content, thinking, role, isStreaming, toolCalls, isLast, index, onRegenerate, onOpenBrowser, onRollback, onEdit, onBranch, createdAt, variants, msgId, swarm: swarmProp }: {
  content: string; thinking?: string; role: 'user' | 'assistant'; isStreaming?: boolean;
  toolCalls?: ToolCall[]; isLast?: boolean; index: number;
  onRegenerate?: (index: number) => void;
  onOpenBrowser?: (url: string) => void; onRollback?: (index: number) => void;
  onEdit?: (index: number, newContent: string) => void;
  onBranch?: (index: number) => void;
  createdAt?: string;
  /** 消息分支：旧回答版本（重新生成时归档），0 号即主内容 */
  variants?: string[];
  msgId?: string;
  swarm?: any
}) {
  const isUser = role === 'user'
  const [copied, setCopied] = useState(false)
  const [savedKb, setSavedKb] = useState(false)
  const [sharedImg, setSharedImg] = useState(false)
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

  // KaTeX 公式：只在消息真有公式语法时才懒加载（全局单例，整会话只加载一次）
  const math = useMathPlugins(hasMathSyntax(shownContent) || hasMathSyntax(content || '') || hasMathSyntax(thinking || ''))
  const mdRemark = math ? [remarkGfm, math.remarkMath] : [remarkGfm]
  const mdRehype = math ? [rehypeHighlight, math.rehypeKatex] : [rehypeHighlight]

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

  // 分享卡：这条消息画成品牌卡片导出 PNG（微信/朋友圈可发）
  const shareAsImage = () => {
    const dataUrl = drawShareCard({
      role, content: shownContent,
      dateText: new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      accent: c.accent,
    })
    if (dataUrl) {
      downloadDataUrl(dataUrl, `巨天分享卡-${Date.now()}.png`)
      setSharedImg(true); setTimeout(() => setSharedImg(false), 2000)
    }
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
      const resp = await fetchCompat('/api/edge-tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: spoken, voice, speed: Number(speed) || 1.0 }) })
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
      <div className="msg-cv flex justify-end mb-6 animate-fade-in"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setShowRollbackConfirm(false) }}>
        <div className="bubble-user max-w-[78%] flex flex-col items-end">
          {editing ? (
            <div className="w-full rounded-2xl border p-2" style={{ background: c.surfaceInput, borderColor: c.border }}>
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={Math.min(8, editText.split('\n').length + 1)} autoFocus
                className="w-full bg-transparent outline-none resize-none text-[15px] leading-7" style={{ color: c.text }} />
              <div className="flex justify-end gap-2 mt-1">
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: c.textSecondary }}>取消</button>
                <button onClick={() => { setEditing(false); if (editText.trim() && onEdit) onEdit(index, editText.trim()) }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: c.textHead, color: c.bg }}>发送</button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-2.5 leading-[1.6] whitespace-pre-wrap break-words"
              style={{ background: c.userBubbleBg, color: c.userBubbleText, borderRadius: 18, fontSize: 'var(--chat-font, 16px)' }}>
              {(() => { const g = readGoalMsg(msgId); return g ? (
                <span className="mb-1.5 flex items-center gap-1 text-[11px] font-medium" style={{ color: c.userBubbleText, opacity: 0.75 }}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.75" fill="currentColor" /></svg>
                  Goal
                </span>
              ) : null })()}
              {content}
            </div>
          )}
          {!editing && onRollback && hovered && !isStreaming && (
            <div className="mt-1.5 mr-1 flex items-center gap-1">
              {showRollbackConfirm ? (
                <div className="flex items-center gap-1.5 text-[11.5px]">
                  <span style={{ color: c.textTertiary }}>回滚到这里？</span>
                  <button onClick={() => { setShowRollbackConfirm(false); onRollback(index) }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: c.toolErr, color: '#fff' }}>确定</button>
                  <button onClick={() => setShowRollbackConfirm(false)}
                    className="px-2.5 py-1 rounded-lg text-xs" style={{ color: c.textTertiary, background: c.surfaceInput }}>取消</button>
                </div>
              ) : (
                <>
                  {onEdit && <IconAction label="编辑并重发" icon="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" onClick={() => { setEditText(content); setEditing(true) }} />}
                  <IconAction label="回滚到此处" icon="M3 3v5h5M3.05 13A9 9 0 106 5.3L3 8" onClick={() => setShowRollbackConfirm(true)} />
                  {/* 分叉（v12.1）：保留原对话，同时从这条消息另开一个分支继续 */}
                  {onBranch && <IconAction label="从这里分叉" icon="M6 3v12M6 21v-6M18 9v12M6 9h12" onClick={() => onBranch(index)} />}
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
    <div className="msg-cv mb-7 animate-fade-in group"
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

        {/* 顶部思考卡：仅在没有 thinkLen 分块信息时显示（历史无标记消息、
            或流式进行中尚未落库）。有分块时思考被切进下方时间线，不再堆顶。 */}
        {!(toolCalls || []).some((tc: any) => typeof tc.thinkLen === 'number') && (
          <ThinkingCard thinking={thinking || ''} isStreaming={!!isStreaming} open={thinkingOpen} onToggle={() => setThinkingOpen(v => !v)} thinkMs={isUser ? null : readThinkMs(msgId)} />
        )}
        {(() => {
          const tcs: any[] = toolCalls || []
          const diffFor = (tc: any) => ((tc.name === 'write_file' || tc.name === 'edit_file') && tc.changeId && tc.status !== 'pending')
            ? <DiffCardView key={'d_' + tc.id} tc={tc} c={c} />
            : null
          const Text = ({ v }: { v: string }) => !v ? null : (
            <div className="markdown-body" style={{ color: c.msgBotText, fontSize: 'var(--chat-font, 16px)' }}>
              <ReactMarkdown
                remarkPlugins={mdRemark as any}
                rehypePlugins={mdRehype as any}
                components={{ a: LinkRenderer, pre: CodeBlock as any, table: TableBlock as any }}>
                {normalizeMathDelimiters(v)}
              </ReactMarkdown>
            </div>
          )
          // 时序交错:带 preLen 标记(本轮会话产生)→ 文本与工具卡按真实顺序排布,
          // 说在工具前的话在卡片上方,最终输出收尾;历史无标记行 → 文在前卡在后
          const hasPre = tcs.some((tc: any) => typeof tc.preLen === 'number')
          // 带 thinkLen → 把整段 thinking 按工具边界切成「思考→执行→思考」多块，
          // 每块独立折叠，阅读顺序与真实推理顺序一致
          const hasThink = tcs.some((tc: any) => typeof tc.thinkLen === 'number')
          const thinkStr = thinking || ''
          // 首块标签带耗时（"思考了 8 秒"），后续块"继续思考"——时间信息不丢
          const thinkMs = isUser ? null : readThinkMs(msgId)
          const firstLabel = thinkMs ? fmtThink(thinkMs) : '思考'
          if (hasPre || hasThink) {
            let last = 0
            let tLast = 0
            let thinkBlock = 0
            const seq: any[] = []
            for (const tc of tcs) {
              // 该工具之前的思考段
              if (hasThink) {
                const tCut = Math.max(tLast, Math.min(Number(tc.thinkLen) || 0, thinkStr.length))
                if (tCut > tLast) {
                  seq.push(<ThinkingBlock key={'th' + seq.length} text={thinkStr.slice(tLast, tCut)} label={thinkBlock === 0 ? firstLabel : '继续思考'} streaming={!!isStreaming} />)
                  thinkBlock++
                }
                tLast = tCut
              }
              const cut = Math.max(last, Math.min(Number(tc.preLen) || 0, shownContent.length))
              if (cut > last) seq.push(<Text key={'t' + seq.length} v={displayContent.slice(last, Math.min(cut, displayContent.length))} />)
              seq.push(<Fragment key={'c' + tc.id}><ToolCallCard tool={tc} />{diffFor(tc)}</Fragment>)
              last = cut
            }
            // 收尾：最后一段思考 + 最终正文
            if (hasThink && thinkStr.length > tLast) {
              seq.push(<ThinkingBlock key="th-end" text={thinkStr.slice(tLast)} label={thinkBlock === 0 ? firstLabel : '继续思考'} streaming={!!isStreaming} />)
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
            <IconAction label={sharedImg ? '已导出' : '分享图'} icon={sharedImg ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'} onClick={shareAsImage} active={sharedImg} />
            <IconAction label={speaking ? '停止朗读' : '朗读'} icon={speaking ? 'M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z' : 'M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14'} onClick={speakContent} active={speaking} />
            <IconAction label="存入知识库" icon="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" onClick={async () => {
              try {
                const r = await fetchCompat('/api/kb/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: shownContent.slice(0, 18).replace(/[#*\n]/g, ' ').trim() || '对话摘录', content: shownContent, tags: ['对话收藏'], source: 'ai' }) })
                const d = await r.json()
                if (!d.error) { setSavedKb(true); setTimeout(() => setSavedKb(false), 2000) }
              } catch { /* ignore */ }
            }} active={savedKb} />
            {onRegenerate && isLast && (
              <IconAction label="重新生成" icon="M4 4v5h5M4.05 13A9 9 0 106 5.3L4 8" onClick={() => onRegenerate(index)} />
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
              {(() => { const d = createdAt ? new Date(createdAt) : null; return d && !isNaN(d.getTime()) ? hhmm(d) : '' })()}
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
              <ReactMarkdown remarkPlugins={mdRemark as any} rehypePlugins={mdRehype as any} components={{ a: LinkRenderer, pre: CodeBlock as any, table: TableBlock as any }}>
                {normalizeMathDelimiters(shownContent)}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
});

export default MessageBubble;
