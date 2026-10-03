/**
 * 员工单独对话标签页
 * 每个员工一个独立标签页 + 独立记忆（localStorage），人设即员工的 prompt，
 * 复用主对话的流式引擎与全部 37 个内置工具。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { loadEmployees, type Employee } from '../../shared/employees'
import type { Settings } from '../types'
import {
  AgentAvatar, AgentMarkdown, AgentComposer, TypingDots,
  agentMsgId, agentMsgKey, loadAgentMsgs, saveAgentMsgs, clearAgentMsgs,
  buildAgentSystemPrompt, parseMentions, ensureAgentCss, useStickBottom, type AgentMsg,
} from './agent/AgentKit'
import { runAgent, type AgentToolLine } from './agent/agentRun'

export default function EmployeeChatTab({ empId, settings, onClose }: {
  empId: string
  settings: Settings
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [employees, setEmployees] = useState<Employee[]>(() => loadEmployees())
  const emp = useMemo(() => employees.find(e => e.id === empId) || null, [employees, empId])
  const key = agentMsgKey('emp', empId)
  const [msgs, setMsgs] = useState<AgentMsg[]>(() => loadAgentMsgs(key))
  const [streamText, setStreamText] = useState('')
  const [streamTools, setStreamTools] = useState<AgentToolLine[]>([])
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useStickBottom(msgs.length + (streamText ? 1 : 0))

  useEffect(() => { ensureAgentCss() }, [])
  useEffect(() => { saveAgentMsgs(key, msgs) }, [key, msgs])
  useEffect(() => {
    const h = () => setEmployees(loadEmployees())
    window.addEventListener('employees-changed', h)
    return () => window.removeEventListener('employees-changed', h)
  }, [])

  const busy = streamText !== '' || abortRef.current !== null

  const send = useCallback(async (text: string) => {
    if (!emp || !text.trim()) return
    setError('')
    const userMsg: AgentMsg = { id: agentMsgId(), kind: 'user', content: text.trim(), ts: Date.now() }
    const next = [...msgs, userMsg]
    setMsgs(next)
    setStreamText('')
    setStreamTools([])

    const ctrl = new AbortController()
    abortRef.current = ctrl
    const mentioned = parseMentions(text, employees)
    const extra = mentioned.length
      ? `用户在消息里 @ 了${mentioned.map(m => `「${m.name}」`).join('、')}。如果你判断需要同事协作，就在回复里 @对方 说明要让对方做什么；否则自己完成。`
      : '用户在单独和你对话，直接给出你的专业产出。'

    const history = buildHistory(next)
    try {
      const r = await runAgent({
        settings: { ...settings, model: emp.model || settings.model },
        system: buildAgentSystemPrompt(emp, settings, extra),
        history,
        signal: ctrl.signal,
        onDelta: d => setStreamText(t => t + d),
        onTool: t => setStreamTools(prev => [...prev, t]),
      })
      const finalText = (r.text || '').trim()
      setMsgs(prev => [...prev, {
        id: agentMsgId(), kind: 'agent', empId: emp.id, name: emp.name, role: emp.role,
        content: finalText || (r.error ? `（出错）${r.error}` : '（无回复）'),
        tools: r.tools.length ? r.tools : undefined, ts: Date.now(),
      }])
      if (r.error) setError(r.error)
    } finally {
      abortRef.current = null
      setStreamText('')
      setStreamTools([])
    }
  }, [emp, msgs, employees, settings])

  if (!emp) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: c.textTertiary }}>
        <div className="text-[15px]">{t('该员工已被删除', 'This member was removed')}</div>
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px]" style={{ background: c.surfaceHover, color: c.textSecondary }}>{t('关闭标签页', 'Close tab')}</button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ─── 头部 ─── */}
      <header className="shrink-0 flex items-center gap-3 px-5 h-[62px] border-b glass" style={{ borderColor: c.border }}>
        <AgentAvatar emp={emp} size={38} ring />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold truncate" style={{ color: c.textHead }}>{emp.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: c.accentBg, color: c.accentText === '#ffffff' ? c.accent : c.accent }}>{emp.role}</span>
          </div>
          <div className="text-[11.5px] truncate" style={{ color: c.textTertiary }}>
            {t('单独对话', 'Direct chat')} · {emp.model || settings.model || '默认模型'} · 37 tools
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {msgs.length > 0 && (
            <button onClick={() => { clearAgentMsgs(key); setMsgs([]) }}
              className="px-2.5 h-8 rounded-lg text-[12px] font-medium transition-colors"
              style={{ background: c.bgInput, color: c.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
              onMouseLeave={e => { e.currentTarget.style.background = c.bgInput }}
              title="清空与该员工的全部对话">{t('清空', 'Clear')}</button>
          )}
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: c.bgInput, color: c.textSecondary }} title="关闭标签页">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </header>

      {/* ─── 消息区 ─── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-[840px] mx-auto px-6 py-7 flex flex-col gap-5">
          {msgs.length === 0 && !busy && (
            <div className="flex flex-col items-center text-center gap-4 py-14 agent-msg-in">
              <AgentAvatar emp={emp} size={72} ring />
              <div>
                <div className="text-[24px] font-black" style={{ color: c.textHead }}>{emp.name}</div>
                <div className="text-[13px] mt-1" style={{ color: c.textTertiary }}>{emp.role} · {t('随时待命', 'ready')}</div>
              </div>
              <p className="text-[13.5px] leading-[1.75] max-w-[520px] whitespace-pre-wrap" style={{ color: c.textSecondary }}>
                {(emp.prompt || '').split('\n').filter(l => l.trim() && !l.startsWith('规则') && !/^\d\./.test(l)).slice(0, 3).join('\n')}
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium transition-transform hover:-translate-y-0.5"
                    style={{ background: c.surfaceCard, border: `1px solid ${c.border}`, color: c.textSecondary }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {msgs.map(m => m.kind === 'user'
            ? <UserBubble key={m.id} text={m.content} c={c} />
            : <AgentBubble key={m.id} msg={m} c={c} />)}

          {busy && (
            <div className="flex gap-3 agent-msg-in">
              <AgentAvatar emp={emp} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{emp.name}</span>
                  {streamTools.length > 0 && <span className="text-[11px]" style={{ color: c.textTertiary }}>调用工具…</span>}
                </div>
                {streamTools.length > 0 && <ToolLines tools={streamTools} c={c} />}
                {streamText
                  ? <AgentMarkdown text={streamText} />
                  : <div className="py-1"><TypingDots /></div>}
              </div>
            </div>
          )}

          {error && <div className="text-[12px] px-3 py-2 rounded-xl" style={{ background: 'rgba(239,68,68,.12)', color: '#ef4444' }}>{error}</div>}
        </div>
      </div>

      {/* ─── 输入 ─── */}
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-[840px] mx-auto">
          <AgentComposer onSend={send} disabled={busy} placeholder={t(`对 ${emp.name} 说点什么…（@ 可点名其他同事）`, `Message ${emp.name}… (@ to mention others)`)} pool={employees} />
          <div className="text-center text-[10.5px] mt-2" style={{ color: c.textTertiary }}>Enter 发送 · Shift+Enter 换行 · @ 提及同事</div>
        </div>
      </div>
    </div>
  )
}

const SUGGESTIONS = ['先看一下你的职责，然后帮我列个今日计划', '帮我review这段代码的思路', '把刚才的结论整理成三条要点']

function buildHistory(msgs: AgentMsg[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = []
  for (const m of msgs.slice(-24)) {
    if (m.kind === 'user') out.push({ role: 'user', content: m.content })
    else if (m.content) out.push({ role: 'assistant', content: m.content })
  }
  // 保证首条是 user（部分本地模型对 assistant 开头敏感）
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function UserBubble({ text, c }: { text: string; c: any }) {
  return (
    <div className="flex justify-end agent-msg-in">
      <div className="max-w-[76%] px-4 py-2.5 rounded-[20px] rounded-br-[6px] text-[15px] leading-[1.65] whitespace-pre-wrap break-words"
        style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }}>{text}</div>
    </div>
  )
}

function ToolLines({ tools, c }: { tools: AgentToolLine[]; c: any }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {tools.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10.5px] font-mono"
          style={{ background: 'rgba(127,127,127,.14)', color: c.textSecondary }}>
          <span style={{ color: t.ok === false ? '#ef4444' : '#10a37f' }}>{t.ok === false ? '✕' : '⚙'}</span>{t.name}
          {t.args && <span style={{ color: c.textTertiary }}>{t.args}</span>}
        </span>
      ))}
    </div>
  )
}

function AgentBubble({ msg, c }: { msg: AgentMsg; c: any }) {
  const emp: Employee = { id: msg.empId || 'x', name: msg.name || 'AI', role: msg.role || '', prompt: '' }
  return (
    <div className="flex gap-3 agent-msg-in">
      <AgentAvatar emp={emp} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{msg.name}</span>
          {msg.role && <span className="text-[11px]" style={{ color: c.textTertiary }}>{msg.role}</span>}
        </div>
        {msg.tools && msg.tools.length > 0 && <ToolLines tools={msg.tools} c={c} />}
        <AgentMarkdown text={msg.content} />
      </div>
    </div>
  )
}
