// Code 模式 AI 对话面板 — 控制台风格，跟随主题 + 完整功能
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { EditorTab, AICompletionEvent, FollowTarget, FileChangeInfo } from '../types/code'
import { useTheme } from '../hooks/useTheme'
import DiffCardView from '../app/DiffCardView'
import type { FileNode } from '../types/code'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Settings, ToolCall, ToolDef, AttachedFile } from '../types'
import { streamChat, type StreamCallbacks } from '../engine/stream'
import { executeTool } from '../engine/tools'
import { buildChatSystemPrompt } from '../engine/chatPrompt'
import { estimateTokens, guessModelContext } from '../utils/tokens'
import ContextGauge, { type ContextPart } from '../chat/ContextGauge'

const CODE_TOOLS: ToolDef[] = [
  { name: 'read_file', description: '读取项目中的文本文件内容。', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } },
  { name: 'write_file', description: '写入/创建文本文件。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: '精确编辑文件中的指定内容。', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } },
  { name: 'list_dir', description: '列出目录下的文件和子目录。', parameters: { type: 'object', properties: { path: { type: 'string' }, showHidden: { type: 'boolean' } }, required: [] } },
  { name: 'search_files', description: '按文件名模式搜索文件。', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'search_content', description: '在文件内容中搜索文本。', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'shell', description: '在项目目录中执行终端命令。', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
]

interface ChatMsg { id: string; role: 'user' | 'assistant' | 'tool'; content: string; thinking?: string; tool_calls?: ToolCall[]; tool_call_id?: string; created_at: string }

interface Props {
  activeTab: EditorTab | null
  projectName: string
  projectRoot: string
  settings: Settings
  aiCompletionEvents: AICompletionEvent[]
  followMode: boolean
  onFollowTarget: (target: FollowTarget) => void
  onFileChanged: (info: FileChangeInfo) => void
  onFileMutated?: (path: string) => void
}

const THINK = [
  { id: 'none', label: '关闭', pct: 0 },
  { id: 'low', label: '低', pct: 25 },
  { id: 'medium', label: '中', pct: 50 },
  { id: 'high', label: '高', pct: 75 },
  { id: 'max', label: '最大', pct: 100 },
]

// 审批模式（Codex 风格）：只读建议 / 自动编辑 / 完全访问
const APPROVAL_MODES = [
  { id: 'ask', label: '建议', desc: '只读分析，AI 通过对话建议修改' },
  { id: 'auto', label: '自动编辑', desc: '自动改文件，命令执行需确认' },
  { id: 'full', label: '完全访问', desc: '文件与命令均自动执行' },
] as const
type ApprovalMode = typeof APPROVAL_MODES[number]['id']

// 任务清单工具（客户端处理，不落服务端）
const PLAN_TOOL: ToolDef = {
  name: 'update_plan',
  description: '维护当前任务清单。多步任务必须先调用本工具列出步骤，每完成一步更新状态。status 取值：pending / in_progress / completed。',
  parameters: {
    type: 'object',
    properties: {
      explanation: { type: 'string', description: '一句话说明当前进展' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['steps'],
  },
}

const READONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'search_content'])
const EDIT_TOOLS = new Set(['write_file', 'edit_file'])

function toolsForMode(mode: ApprovalMode): ToolDef[] {
  let list: ToolDef[]
  if (mode === 'full') list = CODE_TOOLS
  else if (mode === 'auto') list = CODE_TOOLS.filter(t => READONLY_TOOLS.has(t.name) || EDIT_TOOLS.has(t.name))
  else list = CODE_TOOLS.filter(t => READONLY_TOOLS.has(t.name))
  return [...list, PLAN_TOOL]
}

interface PlanStep { title: string; status: 'pending' | 'in_progress' | 'completed' }

// 计算简易 unified diff 行（edit_file: oldText → newText）
function diffLines(oldText: string, newText: string): { type: 'ctx' | 'del' | 'add'; text: string }[] {
  const a = oldText.split('\n'), b = newText.split('\n')
  const out: { type: 'ctx' | 'del' | 'add'; text: string }[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i++; j++ }
    else if (j + 1 < b.length && a[i] === b[j + 1]) { out.push({ type: 'add', text: b[j] }); j++ }
    else if (i + 1 < a.length && a[i + 1] === b[j]) { out.push({ type: 'del', text: a[i] }); i++ }
    else {
      // 找到下一个公共点，中间全部 del/add
      let ni = -1, nj = -1
      for (let k = 0; k < 6 && i + k < a.length; k++) for (let m = 0; m < 6 && j + m < b.length; m++) {
        if (a[i + k] === b[j + m] && (k + m) > 0 && (ni === -1 || k + m < ni + nj)) { ni = i + k; nj = j + m }
      }
      if (ni === -1) { a.slice(i).forEach(t => out.push({ type: 'del', text: t })); b.slice(j).forEach(t => out.push({ type: 'add', text: t })); return out }
      while (i < ni) { out.push({ type: 'del', text: a[i++] }) }
      while (j < nj) { out.push({ type: 'add', text: b[j++] }) }
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })
  return out
}

/**
 * Code 控制台配色：固定深色（不随主题切换），近似 Codex 终端风格。
 * 定义在模块作用域，供主组件与 ToolLine / RenderContent 共用。
 */
const CONSOLE_BG = '#111113'
const CONSOLE_BORDER = '#232326'
const CONSOLE_TEXT = '#e2e2e6'
const CONSOLE_TEXT_SECONDARY = '#a1a1aa'
const CONSOLE_TEXT_MUTED = '#4a4a4e'
const CONSOLE_INPUT_BG = '#1c1c1f'
const CONSOLE_OK = '#06b6d4'
const CONSOLE_ERR = '#ef4444'
const CONSOLE_ACCENT = '#f5b301'

const SLASH_ITEMS = [
  { cmd: '/help', desc: '显示帮助' },
  { cmd: '/init', desc: '扫描项目生成 AGENTS.md' },
  { cmd: '/diff', desc: '查看未提交变更' },
  { cmd: '/compact', desc: '压缩对话历史释放上下文' },
  { cmd: '/export', desc: '导出为 Markdown 到项目根目录' },
  { cmd: '/status', desc: '模型 / 项目 / 审批 / 上下文占用' },
  { cmd: '/clear', desc: '清空当前对话历史' },
]
function flattenFilePaths(nodes: FileNode[], acc: string[] = []): string[] {
  for (const nd of nodes || []) {
    if (nd.type === 'file') acc.push(nd.path)
    if (nd.children?.length) flattenFilePaths(nd.children, acc)
  }
  return acc
}

export default function ChatPanel({ activeTab, projectName, projectRoot, settings, followMode, onFollowTarget, onFileChanged, onFileMutated, fileTree }: Props & { fileTree?: FileNode[] }) {
  const { c, theme } = useTheme()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCall[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [thinking, setThinking] = useState('low')
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => {
    try { const v = localStorage.getItem('jutian_code_approval'); return (v === 'ask' || v === 'auto' || v === 'full') ? v : 'auto' } catch { return 'auto' }
  })
  const [agentsMd, setAgentsMd] = useState('')
  // 任务清单（AI 通过 update_plan 工具维护）
  const [plan, setPlan] = useState<{ explanation?: string; steps: PlanStep[] } | null>(null)
  const planKey = `jutian_code_plan_${projectRoot}`
  useEffect(() => {
    try { setPlan(JSON.parse(localStorage.getItem(planKey) || 'null')) } catch { setPlan(null) }
  }, [planKey])
  const applyPlan = useCallback((argsJson: string): string => {
    try {
      const a = JSON.parse(argsJson || '{}')
      const steps = (a.steps || []).map((s: any) => ({ title: String(s.title || ''), status: ['pending', 'in_progress', 'completed'].includes(s.status) ? s.status : 'pending' }))
      if (!steps.length) return '{"ok":false,"error":"steps 为空"}'
      const p = { explanation: a.explanation ? String(a.explanation) : undefined, steps }
      setPlan(p)
      try { localStorage.setItem(planKey, JSON.stringify(p)) } catch {}
      return '{"ok":true}'
    } catch { return '{"ok":false,"error":"参数解析失败"}' }
  }, [planKey])
  const clearPlan = useCallback(() => {
    setPlan(null)
    try { localStorage.removeItem(planKey) } catch {}
  }, [])
  // 读取项目 AGENTS.md（Codex 风格项目指令），失败静默
  useEffect(() => {
    let cancelled = false
    setAgentsMd('')
    if (!projectRoot) return
    executeTool({ name: 'read_file', args: { path: `${projectRoot}/AGENTS.md` } }, projectRoot)
      .then(r => { if (!cancelled && r.success && r.output.trim()) setAgentsMd(r.output.trim()) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectRoot])
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamingRef = useRef(false)
  const userScrolledUp = useRef(false)
  const allToolCallsRef = useRef<ToolCall[]>([])
  // 时序交错:工具调用开始时正文已流出的长度,渲染按真实顺序排布
  const chunkLenRef = useRef(0)
  const toolPreLenRef = useRef<Record<string, number>>({})
  const followModeRef = useRef(followMode)
  const onFollowTargetRef = useRef(onFollowTarget)
  const onFileChangedRef = useRef(onFileChanged)
  followModeRef.current = followMode
  onFollowTargetRef.current = onFollowTarget
  onFileChangedRef.current = onFileChanged

  const thinkLevel = THINK.find(l => l.id === thinking) || THINK[1]
  const onThinkSlider = (pct: number) => {
    let best = THINK[0]
    for (const l of THINK) { if (Math.abs(pct - l.pct) <= Math.abs(pct - best.pct)) best = l }
    setThinking(best.id)
  }
  const switchApproval = (m: ApprovalMode) => {
    setApprovalMode(m)
    try { localStorage.setItem('jutian_code_approval', m) } catch {}
  }

  // 聊天历史持久化（按项目根目录）
  const chatStorageKey = `lyclaw_code_chat_${projectRoot}`
  useEffect(() => {
    try { setMessages(JSON.parse(localStorage.getItem(chatStorageKey) || '[]') || []) } catch { setMessages([]) }
  }, [projectRoot])
  useEffect(() => {
    try { if (messages.length > 0) localStorage.setItem(chatStorageKey, JSON.stringify(messages.slice(-100))); else localStorage.removeItem(chatStorageKey) } catch {}
  }, [messages])

  const scrollToBottom = (smooth = false) => {
    if (!messagesContainerRef.current) return
    if (smooth) messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: 'smooth' })
    else messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
  }

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const onScroll = () => { userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight > 100 }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => { if (!userScrolledUp.current) scrollToBottom() }, [messages, streamContent])

  // 上下文估算
  const contextParts: ContextPart[] = useMemo(() => {
    const parts: ContextPart[] = []
    if (settings) parts.push({ label: '系统提示', tokens: estimateTokens(buildChatSystemPrompt(settings)), color: '#8b8794' })
    try { parts.push({ label: '工具定义', tokens: estimateTokens(JSON.stringify(CODE_TOOLS)), color: '#06b6d4' }) } catch {}
    if (messages.length > 0) {
      const history = messages.reduce((s, m) => s + estimateTokens(m.content) + estimateTokens((m as any).thinking), 0)
      parts.push({ label: '历史消息', tokens: history, color: '#3b82f6' })
    }
    parts.push({ label: '当前输入', tokens: estimateTokens(input), color: '#f59e0b' })
    return parts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, input, settings])

  const pushLocalMsg = useCallback((content: string, role: 'user' | 'assistant' = 'assistant') => {
    setMessages(prev => [...prev, { id: `${role}_${Date.now()}`, role, content, created_at: new Date().toISOString() }])
    requestAnimationFrame(() => scrollToBottom(true))
  }, [])

  // 压缩历史：AI 摘要替换全部消息，返回摘要消息（失败返回 null）
  const compactHistory = useCallback(async (history: ChatMsg[]): Promise<ChatMsg | null> => {
    if (history.length === 0) return null
    const transcript = history.map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 800)}`).join('\n')
    setStreaming(true); streamingRef.current = true; setStreamContent(''); setStreamThinking(''); setStreamToolCalls([])
    const controller = new AbortController()
    let summaryMsg: ChatMsg | null = null
    try {
      await streamChat(settings, [
        { role: 'system', content: '将对话历史压缩为要点摘要，保留：任务目标、关键决定、修改过的文件、未完成事项。用简洁的列表输出，不超过 400 字。' },
        { role: 'user', content: transcript.slice(-24000) },
      ], {
        onChunk: (delta) => setStreamContent(prev => prev + delta),
        onThinking: () => {}, onToolStart: () => {}, onToolEnd: () => {},
        onDone: (summary) => {
          summaryMsg = { id: `a_${Date.now()}`, role: 'assistant', content: `【已压缩历史】\n${summary}`, created_at: new Date().toISOString() }
          setMessages([summaryMsg])
          setStreaming(false); streamingRef.current = false
          setStreamContent(''); setStreamThinking(''); setStreamToolCalls([])
        },
        onError: (err) => { setError(err); setStreaming(false); streamingRef.current = false; setStreamContent('') },
      }, controller.signal, [])
    } catch { setStreaming(false); streamingRef.current = false }
    return summaryMsg
  }, [settings])

  // 斜杠命令（Codex 风格）：返回 true 表示已消费，不进入正常对话流
  const handleSlashCommand = useCallback(async (raw: string): Promise<boolean> => {
    const text = raw.trim()
    if (!text.startsWith('/')) return false
    const [cmd, ...rest] = text.split(/\s+/)
    const arg = rest.join(' ')

    if (cmd === '/help') {
      pushLocalMsg([
        '可用命令：',
        '  /help     显示本帮助',
        '  /init     扫描项目并生成 AGENTS.md 项目指令',
        '  /diff     查看当前 git 未提交变更',
        '  /compact  压缩对话历史（保留要点，释放上下文）',
        '  /export   导出对话为 Markdown 文件到项目根目录',
        '  /model    查看或切换模型（/model <名称>）',
        '  /status   显示模型 / 项目 / 审批模式 / 上下文占用',
        '  /clear    清空当前项目对话历史',
      ].join('\n'))
      return true
    }

    if (cmd === '/clear') {
      setMessages([])
      try { localStorage.removeItem(chatStorageKey) } catch {}
      pushLocalMsg('对话历史已清空。')
      return true
    }

    if (cmd === '/status') {
      const used = messages.reduce((s, m) => s + estimateTokens(m.content), 0)
      const modeLabel = APPROVAL_MODES.find(m => m.id === approvalMode)?.label || approvalMode
      pushLocalMsg([
        `项目：${projectName}`,
        `根目录：${projectRoot}`,
        `模型：${settings.model || 'default'}（${settings.provider === 'local' ? '本地' : settings.providerName || 'api'}）`,
        `审批模式：${modeLabel}`,
        `思考等级：${thinkLevel.label}`,
        `AGENTS.md：${agentsMd ? `已加载（${estimateTokens(agentsMd)} tokens）` : '未找到'}`,
        `历史消息：${messages.length} 条（约 ${used} tokens）`,
      ].join('\n'))
      return true
    }

    if (cmd === '/diff') {
      const r = await executeTool({ name: 'shell', args: { command: 'git --no-pager diff HEAD --stat && git --no-pager diff HEAD' } }, projectRoot)
      pushLocalMsg(r.success && r.output.trim() ? `$ git diff HEAD\n\n${r.output.slice(0, 6000)}` : `没有可显示的变更。${r.error ? `\n${r.error}` : ''}`)
      return true
    }

    if (cmd === '/init') {
      pushLocalMsg('请扫描本项目结构（list_dir、read_file），然后生成一份 AGENTS.md 写入项目根目录：包含项目概述、目录结构、构建/运行命令、代码风格约定。使用 write_file 工具保存。', 'user')
      return false // 继续走正常对话流，让模型执行
    }

    if (cmd === '/compact') {
      if (messages.length === 0) { pushLocalMsg('没有可压缩的历史。'); return true }
      await compactHistory(messages)
      return true
    }

    if (cmd === '/export') {
      if (messages.length === 0) { pushLocalMsg('没有可导出的对话。'); return true }
      const md = [
        `# ${projectName} — Code 对话记录`,
        `> 导出时间：${new Date().toLocaleString()}\u3000模型：${settings.model || 'default'}`,
        '',
        ...messages.map(m => m.role === 'user'
          ? `## ❯ 用户\n\n${m.content.split('\n--- 附加文件 ---\n')[0]}\n`
          : `## ● AI\n\n${m.content}\n`),
      ].join('\n')
      const path = `${projectRoot}/chat-export-${new Date().toISOString().slice(0, 10)}.md`
      const r = await executeTool({ name: 'write_file', args: { path, content: md } }, projectRoot)
      pushLocalMsg(r.success ? `已导出到 ${path}` : `导出失败：${r.error || '未知错误'}`)
      return true
    }

    if (cmd === '/model') {
      const modelList: string[] = (() => { try { const m = JSON.parse((settings as any).models || '[]'); return Array.isArray(m) ? m : [] } catch { return [] } })()
      if (!arg.trim()) {
        pushLocalMsg([
          `当前模型：${settings.model || 'default'}`,
          modelList.length ? `可用模型（/model <名称> 切换）：\n  ${modelList.join('\n  ')}` : '（设置中没有候选模型列表）',
        ].join('\n'))
        return true
      }
      const target = arg.trim()
      await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'model', value: target }) }).catch(() => {})
      try {
        const local = JSON.parse(localStorage.getItem('lyclaw_settings') || '{}')
        local.model = target
        localStorage.setItem('lyclaw_settings', JSON.stringify(local))
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: local }))
      } catch {}
      pushLocalMsg(`模型已切换为 ${target}（下一条消息生效）`)
      return true
    }

    pushLocalMsg(`未知命令 ${cmd}，输入 /help 查看可用命令。`)
    return true
  }, [messages, projectName, projectRoot, settings, approvalMode, thinkLevel, agentsMd, pushLocalMsg, chatStorageKey, compactHistory])

  // Codex 交互：输入历史（持久化，↑↓ 导航）、斜杠菜单、@文件引用
  const [slashIdx, setSlashIdx] = useState(0)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [histIdx, setHistIdx] = useState(-1)
  const histRef = useRef<string[]>([])
  useEffect(() => { try { histRef.current = JSON.parse(localStorage.getItem(`lyclaw_code_hist_${projectRoot}`) || '[]') || [] } catch { histRef.current = [] } }, [projectRoot])
  const slashOpen = input.startsWith('/') && !input.includes(' ') && !streaming
  const slashItems = SLASH_ITEMS.filter(i => i.cmd.startsWith(input))
  const mentionMatch = input.match(/(?:^|\s)@([^\s@]*)$/)
  const mentionOpen = !!mentionMatch && !streaming
  const mentionFiles = useMemo(() => {
    if (!mentionMatch) return [] as string[]
    const q = mentionMatch[1].toLowerCase()
    const all = flattenFilePaths(Array.isArray(fileTree) ? fileTree : [])
    return (q ? all.filter(p => p.toLowerCase().includes(q)) : all).slice(0, 8)
  }, [mentionMatch, fileTree])
  const insertMention = (p: string) => {
    setInput(prev => prev.replace(/(?:^|\s)@([^\s@]*)$/, (m: string) => m.replace(/@[^\s@]*$/, '@' + p)))
    inputRef.current?.focus()
  }

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streamingRef.current) return
    setInput('')
    setError(null)
    userScrolledUp.current = false

    // 输入历史（斜杠命令不记录）
    if (!text.startsWith('/')) {
      try {
        const h = histRef.current.filter(x => x !== text)
        h.unshift(text)
        histRef.current = h.slice(0, 50)
        localStorage.setItem(`lyclaw_code_hist_${projectRoot}`, JSON.stringify(histRef.current))
        setHistIdx(-1)
      } catch {}
    }

    // 斜杠命令优先
    if (await handleSlashCommand(text)) return

    let userContent = text
    if (attachedFiles.length > 0) {
      const fileList = attachedFiles.map(f => `- [${f.name}](file://${f.path})`).join('\n')
      userContent = `${text}\n\n--- 附加文件 ---\n${fileList}`
    }

    // 自动压缩：历史接近上下文窗口阈值（设置可调，默认 70%）时先压缩再发送
    let baseMessages = messages
    const cfgCtx = (settings as any).contextWindow
    const ctxWindow = (cfgCtx && cfgCtx >= 4000 && cfgCtx !== 1000000) ? cfgCtx : guessModelContext(settings.model)
    const compactPct = Math.min(Math.max((settings as any).autoCompactPct ?? 70, 30), 95) / 100
    const histTokens = messages.reduce((s, m) => s + estimateTokens(m.content) + estimateTokens((m as any).thinking), 0)
    if (histTokens + estimateTokens(text) > ctxWindow * compactPct) {
      const summary = await compactHistory(messages)
      if (summary) baseMessages = [summary]
    }

    const userMsg: ChatMsg = { id: `u_${Date.now()}`, role: 'user', content: userContent, created_at: new Date().toISOString() }
    const msgs = [...baseMessages, userMsg]
    setMessages(msgs)
    requestAnimationFrame(() => scrollToBottom(true))

    const thinkText: Record<string, string> = {
      none: '【思考程度：关闭】直接作答，不要长篇推理。',
      low: '【思考程度：低】简短思考后作答。',
      medium: '【思考程度：中】适度思考后作答。',
      high: '【思考程度：高】深入思考、考虑多种方案后作答。',
      max: '【思考程度：最大】进行最深入、最全面的思考，穷举关键细节后再作答。',
    }
    const modeDesc = APPROVAL_MODES.find(m => m.id === approvalMode)?.desc || ''
    const systemPrompt = `你是一个专业的代码助手，正在帮助用户开发项目"${projectName}"。\n\n【工作目录边界 — 最高优先级】\n- 用户项目目录（你的合法工作区）：${projectRoot}\n- 本应用自身项目目录禁止读取、修改、删除或访问。\n- 所有文件操作自动限制在用户项目目录 ${projectRoot} 内。\n\n当前审批模式：${approvalMode}（${modeDesc}）。若工具不可用，请以建议形式给出修改方案。\n\n${agentsMd ? `【项目指令 AGENTS.md】\n${agentsMd}\n\n` : ''}你拥有以下工具能力：${toolsForMode(approvalMode).map(t => t.name).join(', ')}。\n\n规则：\n1. 所有文件操作仅限用户项目目录 ${projectRoot}\n2. 回答简洁专业、直击要点\n3. 修改代码时说明理由并用 edit_file 或 write_file 执行\n4. 不确定时先 read_file 或 list_dir 了解上下文\n5. 建议运行命令时使用 shell 工具\n6. 如需用户确认（如删除文件），先说明理由再执行\n7. 多步任务（≥3 步）必须先用 update_plan 工具列出步骤清单，每完成一步更新对应状态\n\n${thinkText[thinking] || ''}`

    const apiMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...msgs.map(m => {
        const base: any = { role: m.role }
        if (m.content) base.content = m.content
        if (m.tool_calls?.length) base.tool_calls = m.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }))
        if (m.tool_call_id) base.tool_call_id = m.tool_call_id
        return base
      }),
    ]

    allToolCallsRef.current = []
    setStreaming(true)
    streamingRef.current = true
    setStreamContent('')
    setStreamThinking('')
    setStreamToolCalls([])

    const callbacks: StreamCallbacks = {
      onChunk: (delta) => { chunkLenRef.current += delta.length; setStreamContent(prev => prev + delta) },
      onThinking: (delta) => setStreamThinking(prev => prev + delta),
      onToolStart: (tc) => { toolPreLenRef.current[tc.id] = chunkLenRef.current; setStreamToolCalls(prev => prev.some(t => t.id === tc.id) ? prev : [...prev, { ...tc, status: 'running' as const, preLen: chunkLenRef.current }]) },
      onToolEnd: (tc) => {
        allToolCallsRef.current.push({ ...tc, preLen: toolPreLenRef.current[tc.id] ?? 0 })
        setStreamToolCalls(prev => prev.map(t => t.id === tc.id ? tc : t))
        // AGENTS.md 被改写后自动重载项目指令
        try {
          if (tc.status === 'done' && tc.name === 'write_file' && String(JSON.parse(tc.arguments || '{}').path || '').endsWith('AGENTS.md')) {
            executeTool({ name: 'read_file', args: { path: `${projectRoot}/AGENTS.md` } }, projectRoot)
              .then(r => { if (r.success && r.output.trim()) setAgentsMd(r.output.trim()) }).catch(() => {})
          }
        } catch {}
      },
      onClientTool: (tc) => tc.name === 'update_plan' ? applyPlan(tc.arguments) : '{"ok":true}',
      onDone: (full, tcs, thinkingText) => {
        const assistantMsg: ChatMsg = { id: `a_${Date.now()}`, role: 'assistant', content: full, thinking: thinkingText, tool_calls: tcs.length > 0 ? tcs : undefined, created_at: new Date().toISOString() }
        setMessages(prev => [...prev, assistantMsg])
        setStreaming(false)
        streamingRef.current = false
        setStreamContent(''); setStreamThinking(''); setStreamToolCalls([])
        requestAnimationFrame(() => { if (!userScrolledUp.current) scrollToBottom(true) })
      },
      onError: (err) => { setError(err); setStreaming(false); streamingRef.current = false; setStreamContent(''); setStreamThinking(''); setStreamToolCalls([]) },
    }

    const controller = new AbortController()
    try {
      await streamChat(settings, apiMessages, callbacks, controller.signal, toolsForMode(approvalMode))
    } finally {
      if (controller.signal.aborted) { setStreaming(false); streamingRef.current = false }
    }
  }, [input, streaming, messages, attachedFiles, settings, projectName, projectRoot, thinking, approvalMode, agentsMd, handleSlashCommand, compactHistory])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (slashOpen && slashItems.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % slashItems.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => (i - 1 + slashItems.length) % slashItems.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); setInput(slashItems[slashIdx].cmd + ' '); return }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); setSlashIdx(0); return }
    }
    if (mentionOpen && mentionFiles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % mentionFiles.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + mentionFiles.length) % mentionFiles.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionFiles[mentionIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setInput(prev => prev.replace(/([^@]*)$/, '')); return }
    }
    if (!input && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const h = histRef.current
      if (h.length === 0) return
      const next = e.key === 'ArrowUp' ? Math.min(histIdx < 0 ? 0 : histIdx + 1, h.length - 1) : Math.max(histIdx - 1, -1)
      setHistIdx(next)
      setInput(next >= 0 ? h[next] : '')
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const ne = e.nativeEvent as any
      if (ne.isComposing || ne.keyCode === 229) return
      e.preventDefault(); handleSend()
    }
  }, [handleSend, slashOpen, slashItems, slashIdx, mentionOpen, mentionFiles, mentionIdx, input, histIdx])

  const abort = useCallback(() => { streamingRef.current = false }, [])
  const clearError = () => setError(null)

  const handleFileUpload = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api?.openFileDialog) {
      try {
        const paths: string[] = await api.openFileDialog()
        if (paths?.length) setAttachedFiles(prev => { const existing = new Set(prev.map(f => f.path)); return [...prev, ...paths.map(p => ({ path: p, name: p.split('/').pop() || p, size: 0 })).filter(f => !existing.has(f.path))] })
      } catch {}
    }
  }, [])

  // 局部别名（取自模块级控制台配色）
  // 对话区跟随应用主题（浅色不再黑底）；深色调仍保持终端质感
  const dark = theme === 'dark'
  const bg = dark ? CONSOLE_BG : c.bg
  const borderColor = dark ? CONSOLE_BORDER : c.border
  const textPrimary = dark ? CONSOLE_TEXT : c.textHead
  const textSecondary = dark ? CONSOLE_TEXT_SECONDARY : c.textSecondary
  const textMuted = dark ? CONSOLE_TEXT_MUTED : c.textMuted
  const inputBg = dark ? CONSOLE_INPUT_BG : c.bgInput
  const toolOk = dark ? CONSOLE_OK : c.toolOk
  const toolErr = dark ? CONSOLE_ERR : c.toolErr
  const accent = dark ? CONSOLE_ACCENT : c.accent

  return (
    <div className="flex flex-col h-full border-l glass" style={{ borderColor: borderColor }}>
      {/* 面板头：极简（AI 助手 + 项目名） */}
      <div className="h-9 flex items-center gap-2 px-3 shrink-0 border-b" style={{ borderColor }}>
        <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: accent }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        </span>
        <span className="text-[11.5px] font-medium shrink-0" style={{ color: textPrimary }}>AI 助手</span>
        <span className="text-[10px] font-mono truncate max-w-[45%]" style={{ color: textMuted }}>{projectName}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0" title={projectRoot}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: toolOk, boxShadow: `0 0 6px ${toolOk}` }} />
          <span className="text-[9px] font-mono truncate max-w-[40%]" style={{ color: textMuted }}>{projectRoot}</span>
        </span>
      </div>

      {/* 任务清单（AI 通过 update_plan 维护） */}
      {plan && plan.steps.length > 0 && (
        <div className="mx-3 mt-2 mb-1 rounded border shrink-0" style={{ borderColor, background: inputBg }}>
          <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: `1px solid ${borderColor}` }}>
            <span className="text-[9.5px] font-mono" style={{ color: accent }}>PLAN</span>
            <span className="text-[9.5px] font-mono truncate flex-1" style={{ color: textMuted }}>{plan.explanation || `${plan.steps.filter(s => s.status === 'completed').length}/${plan.steps.length} 完成`}</span>
            <button onClick={clearPlan} className="text-[9.5px] shrink-0" style={{ color: textMuted }} title="清除清单">×</button>
          </div>
          <div className="px-2 py-1 space-y-0.5">
            {plan.steps.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] leading-4">
                <span className="shrink-0 mt-[1px]" style={{ color: s.status === 'completed' ? toolOk : s.status === 'in_progress' ? accent : textMuted }}>
                  {s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '✻' : '○'}
                </span>
                <span style={{ color: s.status === 'completed' ? textMuted : textPrimary, textDecoration: s.status === 'completed' ? 'line-through' : 'none' }}>{s.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 消息流 */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-3 px-3 font-mono scrollbar-thin">
        {messages.length === 0 && !streaming && (
          <div className="text-center py-8 text-[11px]" style={{ color: textMuted }}>
            AI 可以读取项目文件、编写代码、执行命令
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="mb-2.5">
            {msg.role === 'tool' ? (
              <div className="text-[10.5px] pl-3 whitespace-pre-wrap break-words" style={{ color: textMuted }}>{msg.content}</div>
            ) : msg.role === 'user' ? (
              <div className="flex justify-end mb-3.5">
                <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
                  style={{ background: c.bgInput, color: c.text, borderRadius: '16px 16px 4px 16px' }}>
                  {msg.content.split('\n--- 附加文件 ---\n')[0]}
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mb-3.5">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: c.accent }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke={c.accentText} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed">
                {(() => {
                  const tcs = msg.tool_calls || []
                  const diffFor = (tc: any) => (tc.status === 'done') && (tc.name === 'edit_file' || tc.name === 'write_file')
                    ? <DiffCardView key={`d_${tc.id}`} tc={tc} c={c} onFileMutated={onFileMutated} /> : null
                  // 时序交错:话在前,工具调用随后,最终输出收尾
                  if (tcs.some((tc: any) => typeof tc.preLen === 'number')) {
                    let last = 0
                    const seq: any[] = []
                    for (const tc of tcs) {
                      const cut = Math.max(last, Math.min(Number(tc.preLen) || 0, msg.content.length))
                      if (cut > last) seq.push(<RenderContent key={'t' + seq.length} content={msg.content.slice(last, cut)} inputBg={inputBg} borderColor={borderColor} textMuted={textMuted} />)
                      seq.push(<div key={'c' + tc.id} className="mt-1"><ToolLine tc={tc} textMuted={textMuted} c={c} />{diffFor(tc)}</div>)
                      last = cut
                    }
                    if (last < msg.content.length) seq.push(<RenderContent key="t-end" content={msg.content.slice(last)} inputBg={inputBg} borderColor={borderColor} textMuted={textMuted} />)
                    return seq
                  }
                  return (
                    <>
                      <RenderContent content={msg.content} inputBg={inputBg} borderColor={borderColor} textMuted={textMuted} />
                      {tcs.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {tcs.map((tc: any) => <ToolLine key={tc.id} tc={tc} textMuted={textMuted} c={c} />)}
                          {tcs.filter((tc: any) => (tc.status === 'done') && (tc.name === 'edit_file' || tc.name === 'write_file')).map((tc: any) => (
                            <DiffCardView key={`d_${tc.id}`} tc={tc} c={c} onFileMutated={onFileMutated} />
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
                </div>
              </div>
            )}
          </div>
        ))}
        {streaming && (
          <div className="mb-2.5">
            {streamThinking && <div className="text-[10.5px] mb-1" style={{ color: accent }}>✻ {streamThinking}</div>}
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: c.accent }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke={c.accentText} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed">
                {(() => {
                  const tcs = streamToolCalls
                  if (tcs.some((tc: any) => typeof tc.preLen === 'number')) {
                    let last = 0
                    const seq: any[] = []
                    for (const tc of tcs) {
                      const cut = Math.max(last, Math.min(Number(tc.preLen) || 0, streamContent.length))
                      if (cut > last) seq.push(<RenderContent key={'t' + seq.length} content={streamContent.slice(last, cut)} inputBg={inputBg} borderColor={borderColor} textMuted={textMuted} />)
                      seq.push(<div key={'c' + tc.id} className="mt-1"><ToolLine tc={tc} textMuted={textMuted} /></div>)
                      last = cut
                    }
                    if (last < streamContent.length) seq.push(<RenderContent key="t-end" content={streamContent.slice(last)} inputBg={inputBg} borderColor={borderColor} textMuted={textMuted} />)
                    return seq
                  }
                  return (
                    <>
                      <RenderContent content={streamContent} inputBg={inputBg} borderColor={borderColor} textMuted={textMuted} />
                      {!streamContent && !streamThinking && <span className="typing-cursor" />}
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="mb-2 text-[10.5px] font-mono cursor-pointer" style={{ color: toolErr }} onClick={clearError}>
            ✗ {error} <span style={{ color: textMuted }}>(点击关闭)</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 附件 + 思考等级工具栏(常驻,附件区按需显示) */}
      {(
        <div className="px-3 py-1.5 flex items-center gap-2 border-t" style={{ borderColor }}>
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachedFiles.map(f => (
                <span key={f.path} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]" style={{ background: '#232326', color: textSecondary }}>
                  附件 · {f.name}
                  <button onClick={() => setAttachedFiles(prev => prev.filter(x => x.path !== f.path))} className="hover:opacity-70">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex-1" />
          {/* 审批模式（Codex 风格） */}
          <select value={approvalMode} onChange={e => switchApproval(e.target.value as ApprovalMode)}
            className="text-[10px] rounded px-1 py-0.5 outline-none cursor-pointer font-mono shrink-0"
            style={{ background: inputBg, color: approvalMode === 'full' ? toolErr : approvalMode === 'ask' ? accent : textPrimary, border: `1px solid ${borderColor}` }}
            title="审批模式">
            {APPROVAL_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {/* 思考等级 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] whitespace-nowrap" style={{ color: thinking === 'max' ? accent : textMuted }}>思考:{thinkLevel.label}</span>
            <input type="range" min={0} max={100} step={25} value={thinkLevel.pct}
              onChange={e => onThinkSlider(Number(e.target.value))}
              className="think-slider w-20"
              style={{ '--pct': `${thinkLevel.pct}%`, '--slider-fill': thinking === 'max' ? accent : textPrimary, '--slider-track': borderColor } as React.CSSProperties} />
          </div>
        </div>
      )}

      {/* 输入区（relative 供浮层定位） */}
      <div className="p-2.5 border-t relative" style={{ borderColor }}>
          {/* 斜杠命令菜单（Codex 风格） */}
          {slashOpen && slashItems.length > 0 && (
            <div className="absolute bottom-full left-2.5 right-2.5 mb-2 rounded-xl border glass-strong shadow-lg overflow-hidden animate-fade-in z-30" style={{ borderColor: borderColor, background: c.surfaceCard }}>
              {slashItems.map((it, i) => (
                <button key={it.cmd}
                  onClick={() => { setInput(it.cmd + ' '); inputRef.current?.focus() }}
                  onMouseEnter={() => setSlashIdx(i)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
                  style={{ background: i === slashIdx ? c.bgHover : 'transparent' }}>
                  <code className="text-[12px] font-mono font-semibold shrink-0" style={{ color: c.accent }}>{it.cmd}</code>
                  <span className="text-[11.5px] truncate" style={{ color: c.textSecondary }}>{it.desc}</span>
                </button>
              ))}
            </div>
          )}
          {/* @ 文件引用（Codex 风格） */}
          {mentionOpen && mentionFiles.length > 0 && (
            <div className="absolute bottom-full left-2.5 right-2.5 mb-2 rounded-xl border glass-strong shadow-lg overflow-hidden animate-fade-in z-30 max-h-52 overflow-y-auto scrollbar-thin" style={{ borderColor: borderColor, background: c.surfaceCard }}>
              {mentionFiles.map((p, i) => (
                <button key={p} onClick={() => insertMention(p)} onMouseEnter={() => setMentionIdx(i)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  style={{ background: i === mentionIdx ? c.bgHover : 'transparent' }}>
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} style={{ color: c.textTertiary }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[12px] font-mono truncate" style={{ color: c.text }}>{p}</span>
                </button>
              ))}
            </div>
          )}
        <div className="flex items-end gap-1.5 rounded-2xl border p-1.5 transition-colors"
          style={{ borderColor: borderColor, background: c.bgInput }}>
          <button onClick={handleFileUpload} className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors" style={{ color: c.textTertiary }} title="上传文件"
            onMouseEnter={e => e.currentTarget.style.background = c.bgHover}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={'描述任务…（/ 命令 · @ 引用文件 · ↑ 历史）'} rows={1}
            className="flex-1 resize-none px-2 py-1.5 text-[12.5px] outline-none bg-transparent"
            style={{ color: textPrimary, minHeight: 32, maxHeight: 120 }} />
          {streaming ? (
            <button onClick={abort} className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ color: toolErr, background: `${toolErr}15` }} title="停止">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()}
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
              style={{ background: input.trim() ? c.accent : 'transparent', color: input.trim() ? c.accentText : c.textMuted }} title="发送">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" />
              </svg>
            </button>
          )}
        </div>
        {/* 上下文仪表 */}
        <div className="mt-1.5 flex justify-center">
          <ContextGauge parts={contextParts} compact />
        </div>
      </div>
    </div>
  )
}

/** diff 审查卡片：AI 完成文件修改后展示变更内容（Codex 风格） */
function ToolLine({ tc, textMuted }: { tc: ToolCall; textMuted: string; c?: any }) {
  let brief = ''
  try { const a = JSON.parse(tc.arguments || '{}'); brief = Object.values(a).filter((v: any) => typeof v === 'string' && v.length < 60).join(' ') || JSON.stringify(a).slice(0, 80) } catch { brief = (tc.arguments || '').slice(0, 80) }
  const done = tc.status === 'done', err = tc.status === 'error'
  return (
    <div className="text-[10.5px] flex items-start gap-1.5" style={{ color: err ? CONSOLE_ERR : done ? CONSOLE_OK : CONSOLE_ACCENT }}>
      <span className="shrink-0">{done ? '✓' : err ? '✗' : '✻'}</span>
      <span className="shrink-0 font-medium">{tc.name}</span>
      {brief && <span className="truncate" style={{ color: textMuted }}>{brief}</span>}
    </div>
  )
}

function RenderContent({ content }: { content: string; inputBg?: string; borderColor?: string; textMuted?: string }) {
  if (!content) return null
  return (
    <div className="markdown-body" style={{ fontSize: 12, lineHeight: 1.65 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
    </div>
  )
}
