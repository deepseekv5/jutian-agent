import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { getSettingsSync, effectiveApiKey } from '../store/storage'
import { fetchCompat } from '../api'
import { ssePayloads } from '../../shared/sse'

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
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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
    try {
      const res = await fetchCompat('/api/llm-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Base': s.apiBaseUrl, 'X-Api-Key': effectiveApiKey(s.apiKey) },
        body: JSON.stringify({
          model: s.model || 'default',
          messages: [...next.map(m => ({ role: m.role, content: m.content }))].slice(-20),
          stream: true, max_tokens: 1024,
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
      setMsgs(prev => [...prev.slice(0, -1), { role: 'assistant', content: t(`对话失败：${String((e as Error)?.message || e)}`, `Chat failed: ${String((e as Error)?.message || e)}`) }])
    } finally {
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
            <div className="pt-16 text-center">
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
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mb-3 jt-msg-in`}>
              <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap"
                style={m.role === 'user'
                  ? { background: 'var(--jt-ink)', color: 'var(--jt-paper)', borderBottomRightRadius: 6 }
                  : { background: 'var(--jt-paper-alt)', color: 'var(--jt-ink)', border: `1px solid var(--jt-hairline-soft)`, borderBottomLeftRadius: 6 }}>
                {m.content || (m.role === 'assistant' && busy ? <span className="jt-thinking-dots" style={{ color: 'var(--jt-ink-3)' }}><i /><i /><i /></span> : '')}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0" style={{ padding: '0 24px 20px' }}>
        <div className="mx-auto w-full" style={{ maxWidth: 780 }}>
          <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5"
            style={{ background: 'var(--jt-paper)', border: '1px solid var(--jt-hairline)', boxShadow: '0 2px 12px rgba(0,0,0,.035)' }}>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              placeholder={t('发消息…', 'Send a message…')}
              className="flex-1 bg-transparent outline-none text-[14px] jt-codex-input" style={{ color: 'var(--jt-ink)' }} />
            <button onClick={() => send(input)} disabled={busy || !input.trim()}
              className="w-8 h-8 rounded-full grid place-items-center transition-all disabled:opacity-40"
              style={{ background: 'var(--jt-ink)', color: 'var(--jt-paper)' }} title={t('发送', 'Send')}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" /></svg>
            </button>
          </div>
          <div className="text-[10px] text-center mt-2" style={{ color: 'var(--jt-ink-4)' }}>
            {t('对话模式 · 内容不保存到会话历史', 'Chat mode · not saved to session history')}
          </div>
        </div>
      </div>
    </div>
  )
}
