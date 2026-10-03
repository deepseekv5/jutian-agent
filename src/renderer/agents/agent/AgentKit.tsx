/**
 * 员工群聊 UI 套件（共享基础件）
 * - 员工头像（渐变 + 首字 / 图标）
 * - 消息持久化（localStorage，按 emp:<id> / grp:<id> 分桶）
 * - 人设系统提示词（工具环境 + 群聊上下文）
 * - 输入胶囊（@ 成员菜单）
 * - 消息列表（Markdown + 代码块 + 工具调用）
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Employee } from '../../../shared/employees'
import type { Settings } from '../../types'

/* ─── 配色（每位员工固定一个渐变，群聊里可一眼分辨） ─── */
export const AGENT_GRADIENTS: [string, string][] = [
  ['#10a37f', '#0b7a5e'], ['#f59e0b', '#d97706'], ['#3b82f6', '#1d4ed8'],
  ['#a855f7', '#7c3aed'], ['#ec4899', '#be185d'], ['#14b8a6', '#0d9488'],
  ['#ef4444', '#b91c1c'], ['#6366f1', '#4338ca'],
]
export function agentGradient(id: string): [string, string] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973
  return AGENT_GRADIENTS[h % AGENT_GRADIENTS.length]
}

export function agentInitial(emp: Employee): string {
  const n = (emp.name || '').trim()
  if (!n) return 'AI'
  // 中文名取首字，英文名取前两个字母大写
  return /[\u4e00-\u9fa5]/.test(n[0]) ? n[0] : n.slice(0, 2).toUpperCase()
}

export function AgentAvatar({ emp, size = 34, ring }: { emp: Employee; size?: number; ring?: boolean }) {
  const [g1, g2] = agentGradient(emp.id)
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-[30%] font-bold select-none"
      style={{
        width: size, height: size, fontSize: size * 0.46, color: '#fff',
        background: `linear-gradient(145deg,${g1},${g2})`,
        boxShadow: ring ? `0 0 0 2px ${g1}55, 0 6px 18px ${g1}40` : `0 4px 14px ${g1}38`,
        letterSpacing: '-0.02em',
      }}
      title={`${emp.name} · ${emp.role}`}
    >
      {emp.icon
        ? <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} style={{ width: size * 0.55, height: size * 0.55 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d={emp.icon} />
          </svg>
        : agentInitial(emp)}
    </div>
  )
}

/* ─── 消息持久化 ─── */
export interface AgentMsg {
  id: string
  kind: 'user' | 'agent'
  empId?: string
  name?: string
  role?: string
  content: string
  thinking?: string
  tools?: { name: string; args?: string; ok?: boolean }[]
  ts: number
}

export function agentMsgKey(kind: 'emp' | 'grp', id: string): string {
  return `jutian.agent.msgs.${kind}.${id}`
}
export function loadAgentMsgs(key: string): AgentMsg[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(m => m && m.id && m.content !== undefined) : []
  } catch { return [] }
}
export function saveAgentMsgs(key: string, msgs: AgentMsg[]): void {
  try { localStorage.setItem(key, JSON.stringify(msgs.slice(-120))) } catch { /* ignore */ }
}
export function clearAgentMsgs(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}
let _seq = 0
export function agentMsgId(): string {
  _seq += 1
  return Date.now().toString(36) + _seq.toString(36) + Math.random().toString(36).slice(2, 6)
}

/* ─── 人设系统提示词 ─── */
export function buildAgentSystemPrompt(emp: Employee, settings: Settings, extra?: string): string {
  const isWin = /Win/i.test(navigator.platform || '')
  const osName = isWin ? 'Windows' : 'macOS'
  const workDir = settings.workDir || ''
  return `${emp.prompt || `你是「${emp.name}」，${emp.role || '团队成员'}。`}

【你的身份】
- 姓名：${emp.name}
- 职责：${emp.role || '团队成员'}
- 风格：专业、直接、结论先行；不说客套话

【运行环境】
- 系统：${osName}
- 工作目录：${workDir || '用户主目录'}
- 你拥有完整工具能力（读写文件、执行命令、联网搜索等），需要时直接调用，不要只说不做
- 用中文交流${extra ? `

【当前场景】
${extra}` : ''}`
}

/* ─── @  mention 解析 ─── */
export function parseMentions(text: string, pool: Employee[]): Employee[] {
  const hits: Employee[] = []
  const seen = new Set<string>()
  // 长名优先，避免「开发」抢先匹配「开发组长」
  const sorted = [...pool].sort((a, b) => b.name.length - a.name.length)
  for (const e of sorted) {
    if (!e.name || seen.has(e.id)) continue
    if (text.includes('@' + e.name)) { hits.push(e); seen.add(e.id) }
  }
  return hits
}

/* ─── Markdown 渲染 ─── */
export function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-md text-[15.5px] leading-[1.72] break-words" style={{ wordBreak: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          p: ({ children }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: '4px 0 10px', paddingLeft: 20, listStyleType: 'disc' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: '4px 0 10px', paddingLeft: 20, listStyleType: 'decimal' }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
          h1: ({ children }) => <div style={{ fontSize: 18, fontWeight: 800, margin: '10px 0 6px' }}>{children}</div>,
          h2: ({ children }) => <div style={{ fontSize: 17, fontWeight: 800, margin: '10px 0 6px' }}>{children}</div>,
          h3: ({ children }) => <div style={{ fontSize: 15.5, fontWeight: 700, margin: '8px 0 4px' }}>{children}</div>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: '#10a37f', textDecoration: 'underline' }}>{children}</a>,
          blockquote: ({ children }) => <blockquote style={{ margin: '6px 0', paddingLeft: 12, borderLeft: '2px solid rgba(128,128,128,.4)', opacity: 0.85 }}>{children}</blockquote>,
          code: ({ className, children, ...rest }: any) => {
            const isBlock = /language-/.test(className || '')
            if (isBlock) {
              return (
                <div className="relative group/code my-2">
                  <pre className="overflow-x-auto rounded-xl p-3 pr-12 text-[13px] leading-[1.6]" style={{ background: 'rgba(127,127,127,.12)', margin: 0 }}>
                    <code className={className} {...rest}>{children}</code>
                  </pre>
                  <button
                    onClick={() => { try { navigator.clipboard.writeText(String(children).replace(/\n$/, '')) } catch { /* ignore */ } }}
                    className="absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-medium opacity-0 group-hover/code:opacity-100 transition-opacity"
                    style={{ background: 'rgba(127,127,127,.2)' }}
                  >复制</button>
                </div>
              )
            }
            return <code className="px-1 py-0.5 rounded text-[13.5px]" style={{ background: 'rgba(127,127,127,.16)' }} {...rest}>{children}</code>
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-2"><table className="text-[13.5px]" style={{ borderCollapse: 'collapse' }}>{children}</table></div>
          ),
          th: ({ children }) => <th style={{ border: '1px solid rgba(127,127,127,.3)', padding: '5px 10px', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
          td: ({ children }) => <td style={{ border: '1px solid rgba(127,127,127,.3)', padding: '5px 10px' }}>{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/* ─── 打字指示器 ─── */
export function TypingDots({ color }: { color?: string }) {
  return (
    <span className="inline-flex items-center gap-1" style={{ height: 18 }}>
      {[0, 1, 2].map(i => (
        <span key={i} className="rounded-full" style={{
          width: 6, height: 6, background: color || '#10a37f',
          animation: `agentBounce 1.15s ${i * 0.14}s ease-in-out infinite`,
        }} />
      ))}
    </span>
  )
}

/* ─── 输入胶囊（@ 成员菜单） ─── */
export function AgentComposer({
  onSend, disabled, placeholder, pool, accent = '#10a37f',
}: {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  pool: Employee[]
  accent?: string
}) {
  const [value, setValue] = useState('')
  const [menu, setMenu] = useState<{ from: number; q: string } | null>(null)
  const [sel, setSel] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const onChange = (v: string) => {
    setValue(v)
    const pos = taRef.current?.selectionStart ?? v.length
    // 找到光标前最后一个 @，且其后没有空白 → 处于提及输入中
    const upto = v.slice(0, pos)
    const at = upto.lastIndexOf('@')
    if (at >= 0) {
      const q = upto.slice(at + 1)
      if (!/\s/.test(q)) { setMenu({ from: at, q }); setSel(0); return }
    }
    setMenu(null)
  }

  const matched = useMemo(() => {
    if (!menu) return []
    const q = menu.q.toLowerCase()
    return pool.filter(e => !q || e.name.toLowerCase().includes(q)).slice(0, 6)
  }, [menu, pool])

  const insert = (e: Employee) => {
    if (!menu) return
    const pos = taRef.current?.selectionStart ?? value.length
    const next = `${value.slice(0, menu.from)}@${e.name} ${value.slice(pos)}`
    setValue(next)
    setMenu(null)
    requestAnimationFrame(() => {
      const p = menu.from + e.name.length + 2
      taRef.current?.focus()
      taRef.current?.setSelectionRange(p, p)
    })
  }

  const submit = () => {
    const t = value.trim()
    if (!t || disabled) return
    onSend(t)
    setValue('')
    setMenu(null)
  }

  // 自适应高度
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 168) + 'px'
  }, [value])

  return (
    <div className="relative">
      {menu && matched.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-[300px] max-h-[240px] overflow-y-auto rounded-2xl p-1.5 z-30"
          style={{ background: 'rgba(20,22,28,.92)', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 20px 50px rgba(0,0,0,.45)', backdropFilter: 'blur(14px)' }}>
          <div className="px-2.5 py-1 text-[10.5px] font-semibold tracking-wider" style={{ color: 'rgba(255,255,255,.4)' }}>提及成员</div>
          {matched.map((e, i) => (
            <button key={e.id}
              onMouseDown={ev => { ev.preventDefault(); insert(e) }}
              onMouseEnter={() => setSel(i)}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-colors"
              style={{ background: i === sel ? 'rgba(255,255,255,.09)' : 'transparent' }}>
              <AgentAvatar emp={e} size={26} />
              <span className="text-[13.5px] font-semibold" style={{ color: '#fff' }}>{e.name}</span>
              <span className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,.45)' }}>{e.role}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-[26px] px-4 py-2.5 transition-shadow"
        style={{ background: 'var(--glass-bg, rgba(255,255,255,.06))', border: '1px solid var(--glass-line, rgba(255,255,255,.12))', boxShadow: '0 8px 30px rgba(0,0,0,.18)' }}>
        <button
          onMouseDown={ev => { ev.preventDefault(); onChange(value.slice(0, taRef.current?.selectionStart ?? value.length) + '@' + value.slice(taRef.current?.selectionStart ?? value.length)); requestAnimationFrame(() => { const p = (taRef.current?.selectionStart ?? 0) + 1; taRef.current?.focus(); taRef.current?.setSelectionRange(p, p); onChange((taRef.current?.value || value)) }) }}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{ background: 'rgba(127,127,127,.16)', color: 'var(--text-secondary, #8f8f8f)' }}
          title="提及成员（@）">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0c0 1.657 1.343 3 3 3s3-1.343 3-3-1.343-3-3-3m-8 0c0 1.657-1.343 3-3 3s-1.343 3-3-3 1.343-3 3-3" />
          </svg>
        </button>
        <textarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (menu && matched.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % matched.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (s - 1 + matched.length) % matched.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matched[sel]); return }
              if (e.key === 'Escape') { setMenu(null); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
          rows={1}
          placeholder={placeholder || '说点什么…（@ 提及成员）'}
          className="flex-1 bg-transparent outline-none resize-none text-[15px] leading-[1.55] py-1.5 max-h-[168px]"
          style={{ color: 'var(--text-head, #fff)' }}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-35"
          style={{ background: accent, color: '#fff' }}
          title="发送（Enter）">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4}>
            <path strokeLinecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/* ─── 滚动容器（贴底 + 用户上滚时保持） ─── */
export function useStickBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90 }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

/* 全局动画 keyframes（只注入一次） */
let _cssInjected = false
export function ensureAgentCss() {
  if (_cssInjected || typeof document === 'undefined') return
  _cssInjected = true
  const st = document.createElement('style')
  st.textContent = `@keyframes agentBounce{0%,100%{transform:translateY(0);opacity:.45}50%{transform:translateY(-4px);opacity:1}}
@keyframes agentIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.agent-msg-in{animation:agentIn .38s cubic-bezier(.16,1,.3,1) both}
.agent-md pre code.hljs{background:transparent;padding:0}
.agent-md .hljs{color:inherit}`
  document.head.appendChild(st)
}
