import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { getSettingsSync, effectiveApiKey } from '../store/storage'
import { fetchCompat } from '../api'
import { ssePayloads } from '../../shared/sse'
import { MdInner } from '../chat/MessageBubble'
import { useMathPlugins, hasMathSyntax } from '../chat/useMathPlugins'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

/**
 * 主界面独立对话（v16.3.0）：工作台首页的「对话」模式。
 * 纯多轮聊天（消息流 + 流式回复），不建会话、不挂工具——就是聊天本身。
 * 与 ChatTab 的 agent 循环互补：这里轻、快、即开即聊。
 */

interface Msg { role: 'user' | 'assistant'; content: string }

const QUICK = [
  { zh: '给我讲讲量子计算', en: 'Explain quantum computing' },
  { zh: '用三句话解释区块链', en: 'Explain blockchain in 3 sentences' },
  { zh: '帮我列个周末计划', en: 'Help me plan a weekend' },
]

export default function ChatHome() {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  // v16.3.1：历史持久化（localStorage，最多 200 条）+ 工作/编程模式 + TTS 朗读
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { const raw = localStorage.getItem('lyclaw_chathome_msgs'); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr.slice(-200) : [] } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [chatMode, setChatMode] = useState<'general' | 'coding'>(() => {
    try {
      if (localStorage.getItem('lyclaw_chat_mode') === 'chat') {
        return localStorage.getItem('lyclaw_chathome_persona') === 'coding' ? 'coding' : 'general'
      }
      return localStorage.getItem('lyclaw_chat_mode') === 'coding' ? 'coding' : 'general'
    } catch { return 'general' }
  })
  const [ttsBusy, setTtsBusy] = useState(false)
  const ttsStopRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // v16.4.0 大厂标配：停止生成 + 多行输入 + 复制消息
  const abortRef = useRef<AbortController | null>(null)
  const stopGen = () => { abortRef.current?.abort(); abortRef.current = null; setBusy(false) }
  useEffect(() => { try { localStorage.setItem('lyclaw_chathome_msgs', JSON.stringify(msgs.slice(-200))) } catch { /* 超限截断 */ } }, [msgs])
  // v16.3.2：对话内的模式 tab 只微调 persona——写 localStorage 供下次进入读取，
  // 派独立事件（chat-persona-changed），不触发主界面退出对话（那是侧栏三选切换器的职责）
  const switchMode = (m: 'general' | 'coding') => {
    setChatMode(m)
    try {
      const cur = localStorage.getItem('lyclaw_chat_mode')
      if (cur === 'chat') localStorage.setItem('lyclaw_chathome_persona', m)
      else localStorage.setItem('lyclaw_chat_mode', m)
    } catch {}
    window.dispatchEvent(new Event('chat-persona-changed'))
  }
  // v16.4.0：复制消息（复制成功短暂反馈）
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const copyMsg = async (text: string, i: number) => {
    try { await navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
    }
    setCopiedIdx(i); setTimeout(() => setCopiedIdx(c => (c === i ? null : c)), 1500)
  }
  // 朗读：剥代码块/标记，逐条经 /api/edge-tts
  const speak = async (text: string) => {
    if (ttsBusy) { ttsStopRef.current = true; audioRef.current?.pause(); setTtsBusy(false); return }
    const spoken = String(text || '').replace(/```[\s\S]*?```/g, '（代码已省略）').replace(/[*_#>|]/g, '').slice(0, 1500)
    if (!spoken.trim()) return
    setTtsBusy(true); ttsStopRef.current = false
    try {
      const s = getSettingsSync()
      const r = await fetchCompat('/api/edge-tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: spoken, voice: s.voiceId || 'zh-CN-XiaoxiaoNeural', speed: Number(s.ttsSpeed) || 1.0 }) })
      if (!r.ok) throw new Error('tts fail')
      const b = await r.blob()
      await new Promise<void>((resolve) => {
        const a = new Audio(URL.createObjectURL(b))
        audioRef.current = a
        a.onended = () => resolve(); a.onerror = () => resolve()
        a.play().catch(() => resolve())
      })
    } catch { /* 静默 */ } finally { setTtsBusy(false) }
  }
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const send = async (text: string) => {
    const v = text.trim()
    if (!v || busy) return
    const s = getSettingsSync()
    if (!s.apiBaseUrl || !s.apiKey) {
      setMsgs(prev => [...prev, { role: 'user', content: v }, { role: 'assistant', content: t('请先在「设置 → 推理」配置模型与密钥，或使用一键免费模型。', 'Configure a model in Settings → Inference first, or enable free models.') }])
      return
    }
    const next = [...msgs, { role: 'user' as const, content: v }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    const reply: Msg = { role: 'assistant', content: '' }
    setMsgs([...next, reply])
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetchCompat('/api/llm-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Base': s.apiBaseUrl, 'X-Api-Key': effectiveApiKey(s.apiKey) },
        signal: ac.signal,
        body: JSON.stringify({
          model: s.model || 'default',
          messages: [
            { role: 'system', content: chatMode === 'coding'
              ? '你是「巨天」的编程形态：工程 Agent，直接给出可运行代码与最小改动；代码块标注语言；解释从简。'
              : '你是「巨天」的办公形态：直接高效，先结论后细节；需要时给出结构化 Markdown（标题/列表/表格/代码块）。' },
            ...next.map(m => ({ role: m.role, content: m.content })),
          ].slice(-21),
          stream: true, max_tokens: 4096,
        }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      for await (const payload of ssePayloads(res.body)) {
        if (payload === '[DONE]') break
        let ev: any
        try { ev = JSON.parse(payload) } catch { continue }
        const delta = ev?.choices?.[0]?.delta
        const piece = String(delta?.content || delta?.reasoning_content || '')
        if (piece) {
          reply.content += piece
          setMsgs(prev => [...prev.slice(0, -1), { ...reply }])
        }
      }
      if (!reply.content.trim()) setMsgs(prev => [...prev.slice(0, -1), { role: 'assistant', content: t('（模型没有返回内容，请检查密钥/模型配置）', '(Empty response — check model/key settings)') }])
    } catch (e) {
      // 用户主动停止：保留已生成的部分，不算错误。
      // fetchCompat abort 抛 ApiError('abort')（message「请求已取消」），流中途断开才是原生 AbortError——两者都按停止处理
      const err = e as Error
      const stopped = err?.name === 'AbortError' || abortRef.current?.signal.aborted || String(err?.message || '').includes('取消')
      if (stopped) {
        if (!reply.content.trim()) setMsgs(prev => prev.slice(0, -1))
      } else {
        setMsgs(prev => [...prev.slice(0, -1), { role: 'assistant', content: t(`对话失败：${String((e as Error)?.message || e)}`, `Chat failed: ${String((e as Error)?.message || e)}`) }])
      }
    } finally {
      abortRef.current = null
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col" style={{ background: 'var(--jt-paper)' }}>
      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full" style={{ maxWidth: 780, padding: '32px 24px 16px' }}>
          {msgs.length === 0 && (
            <div className="pt-12 text-center">
              {/* 工作 / 编程模式切换（与侧栏同源：localStorage + chat-mode-changed 事件） */}
              <div className="flex items-center justify-center gap-1 mb-6">
                {([['general', t('工作', 'Work')], ['coding', t('编程', 'Coding')]] as const).map(([m, label]) => (
                  <button key={m} onClick={() => switchMode(m)}
                    className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                    style={{ background: chatMode === m ? 'var(--brand, #10a37f)' : 'var(--jt-paper-alt)', color: chatMode === m ? '#fff' : 'var(--jt-ink-3)', border: `1px solid ${chatMode === m ? 'transparent' : 'var(--jt-hairline-soft)'}` }}>
                    {label}
                  </button>
                ))}
              </div>
              <h2 className="font-medium" style={{ fontSize: 26, letterSpacing: '-.03em', color: 'var(--jt-ink)' }}>
                {t('有什么想聊的？', 'What is on your mind?')}
              </h2>
              <p className="text-[12px] mt-2" style={{ color: 'var(--jt-ink-3)' }}>
                {t('纯对话模式：不建会话、不动文件，即开即聊。', 'Plain chat: no session, no files — just talk.')}
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {QUICK.map(q => (
                  <button key={q.zh} onClick={() => send(q.zh)}
                    className="px-3 py-2 rounded-full text-[12px] transition-colors"
                    style={{ background: 'var(--jt-paper-alt)', color: 'var(--jt-ink-2)', border: `1px solid var(--jt-hairline-soft)` }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--jt-ink)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--jt-ink-2)' }}>
                    {lang === 'en' ? q.en : q.zh}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mb-4 jt-msg-in`}>
              {/* v16.4.0：assistant 无气泡全宽（ChatGPT 式），user 保留右对齐气泡——层级更清晰 */}
              <div className={m.role === 'user'
                ? 'max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed'
                : 'w-full text-[13.5px] leading-relaxed'}
                style={m.role === 'user'
                  ? { background: 'var(--jt-ink)', color: 'var(--jt-paper)', borderBottomRightRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
                  : { color: 'var(--jt-ink)' }}>
                {m.role === 'assistant' && m.content
                  ? <MdText text={m.content} />
                  : (m.role === 'assistant' && busy ? <span className="jt-thinking-dots" style={{ color: 'var(--jt-ink-3)' }}><i /><i /><i /></span> : m.content)}
                {/* 流式尾部光标：生成中最后一帧的实时感知 */}
                {m.role === 'assistant' && m.content && busy && i === msgs.length - 1 && (
                  <span className="inline-block w-[7px] h-[15px] align-[-2px] ml-0.5 rounded-[1px]" style={{ background: 'var(--jt-ink)', opacity: .75, animation: 'typing-cursor 1s steps(2) infinite' }} />
                )}
                {m.role === 'assistant' && m.content && !busy && (
                  <div className="mt-1.5 pt-1.5 flex items-center gap-3" style={{ borderTop: '1px dashed var(--jt-hairline-soft)' }}>
                    <button onClick={() => copyMsg(m.content, i)} className="text-[10.5px] flex items-center gap-1 transition-colors hover:opacity-70"
                      style={{ color: copiedIdx === i ? 'var(--brand, #10a37f)' : 'var(--jt-ink-3)' }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>{copiedIdx === i
                        ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></>}</svg>
                      {copiedIdx === i ? t('已复制', 'Copied') : t('复制', 'Copy')}
                    </button>
                    <button onClick={() => speak(m.content)} className="text-[10.5px] flex items-center gap-1 transition-colors hover:opacity-70"
                      style={{ color: ttsBusy ? 'var(--brand, #10a37f)' : 'var(--jt-ink-3)' }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a4 4 0 010 7m-3-7v7m-6-4.5v3a2 2 0 002 2h1l4 3V6l-4 3h-1a2 2 0 00-2 2z" /></svg>
                      {ttsBusy ? t('停止', 'Stop') : t('朗读', 'Speak')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区（v16.4.0：多行 textarea 自动增高 + 停止生成，对齐大厂聊天输入） */}
      <div className="shrink-0" style={{ padding: '0 24px 20px' }}>
        <div className="mx-auto w-full" style={{ maxWidth: 780 }}>
          <div className="flex items-end gap-2 rounded-2xl px-3 py-2.5 transition-shadow"
            style={{ background: 'var(--jt-paper)', border: '1px solid var(--jt-hairline)', boxShadow: '0 2px 12px rgba(0,0,0,.035)' }}>
            <textarea ref={inputRef} value={input} rows={1}
              onChange={e => {
                setInput(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 200) + 'px'
              }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); const el = e.currentTarget; setTimeout(() => { el.style.height = 'auto' }, 0) } }}
              placeholder={t('发消息，Shift+Enter 换行…', 'Send a message, Shift+Enter for newline…')}
              className="flex-1 bg-transparent outline-none text-[14px] jt-codex-input resize-none leading-relaxed"
              style={{ color: 'var(--jt-ink)', maxHeight: 200 }} />
            {busy ? (
              <button onClick={stopGen} className="w-8 h-8 rounded-full grid place-items-center shrink-0 transition-transform active:scale-95"
                style={{ background: 'var(--jt-ink)', color: 'var(--jt-paper)' }} title={t('停止生成', 'Stop generating')}>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            ) : (
              <button onClick={() => send(input)} disabled={!input.trim()}
                className="w-8 h-8 rounded-full grid place-items-center shrink-0 transition-all disabled:opacity-30 active:scale-95"
                style={{ background: 'var(--jt-ink)', color: 'var(--jt-paper)' }} title={t('发送', 'Send')}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" /></svg>
              </button>
            )}
          </div>
          <div className="text-[10px] text-center mt-2" style={{ color: 'var(--jt-ink-4)' }}>
            {t('对话模式 · 内容不保存到会话历史', 'Chat mode · not saved to session history')}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 单条消息的 Markdown 渲染：math 插件按内容懒加载（与 MessageBubble 同策略） */
function MdText({ text }: { text: string }) {
  const math = useMathPlugins(hasMathSyntax(text))
  const mdRemark = useMemo(() => (math ? [remarkGfm, math.remarkMath] : [remarkGfm]), [math])
  const mdRehype = useMemo(() => (math ? [rehypeHighlight, math.rehypeKatex] : [rehypeHighlight]), [math])
  return (
    <div className="markdown-body" style={{ color: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' }}>
      <MdInner text={text} remark={mdRemark} rehype={mdRehype} link={LinkRenderer} math />
    </div>
  )
}

/** 链接渲染：target=_blank + rel，样式继承气泡 */
function LinkRenderer(props: any) {
  return <a href={props.href} target="_blank" rel="noreferrer" style={{ color: 'var(--brand, #10a37f)', textDecoration: 'underline' }}>{props.children}</a>
}
