/**
 * AI 角色聊天标签页
 *
 * 合规要点（依据《人工智能拟人化互动服务管理暂行办法》与《生成合成内容标识办法》）：
 * - 首次进入强制告知与同意（第十二条：年龄/紧急联系人；第十八条：AI 身份提示）
 * - 每条 AI 回复带「AI 生成」角标（标识办法第四条）
 * - 导出内容自动嵌入显式标识（标识办法第四条第二款）
 * - 危机情境强制干预、退出不挽留（第十三/十九条）
 * - 会话与记忆可一键删除（第十六条、PIPL 第四十七条）
 *
 * UI 借鉴 ClerkBox 的交互模式（流式打字机、思考耗时、composer 状态条、停止按钮），
 * 视觉沿用应用自身的亮色液态玻璃，不引入深色与外部素材。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import PageShell from '../../app/PageShell'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Settings } from '../../types'
import type { Persona, PersonaMemory } from '../../../shared/personas'
import { DISCLAIMER } from '../../../shared/personas'
import {
  AI_LABEL, EXPORT_LABEL_HEADER, EXPORT_LABEL_FOOTER,
  usageReminderText, USAGE_REMIND_MS,
} from '../../../shared/personaSafety'
import {
  sendPersonaTurn, loadSession, saveMessage, clearSession,
  loadMemories, fetchPersonas, deletePersona, type PersonaMsg,
} from '../../../shared/personaChat'
import PersonaConsent, { loadIdentity, saveIdentity } from './PersonaConsent'
import PersonaMemoryPanel from './PersonaMemoryPanel'
import PersonaEditor from './PersonaEditor'

type View = 'chat' | 'memory' | 'disclaimer' | 'create' | 'edit'

const PERSONA_ICON = 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z'

export default function PersonaChatTab({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const { c } = useTheme()
  const [identity, setIdentity] = useState(() => loadIdentity())
  const [personas, setPersonas] = useState<Persona[]>([])
  const [active, setActive] = useState<Persona | null>(null)
  const [msgs, setMsgs] = useState<PersonaMsg[]>([])
  const [memories, setMemories] = useState<PersonaMemory[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<View>('chat')
  const [usageTip, setUsageTip] = useState(false)
  // 流式：当前正在逐字生成的回复 + 思考耗时
  const [streamText, setStreamText] = useState('')
  const [thinkingMs, setThinkingMs] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startedAt = useRef<number>(Date.now())
  const remindedAt = useRef<number>(0)

  const needConsent = !identity.consentedAt || !identity.age

  useEffect(() => { fetchPersonas().then(list => { if (list.length) setPersonas(list) }) }, [])

  // 连续使用每满 2 小时提醒一次（第十八条）
  useEffect(() => {
    const t = setInterval(() => {
      const elapsed = Date.now() - startedAt.current
      if (elapsed >= USAGE_REMIND_MS && elapsed - remindedAt.current >= USAGE_REMIND_MS) {
        remindedAt.current = elapsed
        setUsageTip(true)
      }
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length, streamText, busy])

  const openPersona = useCallback(async (p: Persona) => {
    setActive(p); setView('chat'); setNotice(''); setMsgs([]); setStreamText(''); setThinkingMs(null)
    const [s, m] = await Promise.all([loadSession(p.id), loadMemories(p.id)])
    setMsgs(s); setMemories(m)
  }, [])

  const stop = useCallback(() => { abortRef.current?.abort() }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !active || busy) return
    setInput(''); setBusy(true); setThinkingMs(null); setStreamText('')
    const userMsg: PersonaMsg = { role: 'user', content: text, ts: Date.now() }
    const base = [...msgs, userMsg]
    setMsgs(base)
    saveMessage(active.id, userMsg)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await sendPersonaTurn(active, memories, base, text, identity, {
        apiBaseUrl: settings.apiBaseUrl, apiKey: settings.apiKey, model: settings.model,
      }, {
        signal: ctrl.signal,
        onTiming: (ms) => setThinkingMs(ms),
        onDelta: (chunk) => setStreamText(prev => prev + chunk),
      })
      const reply = res.msgs[res.msgs.length - 1]
      if (res.notice) setNotice(res.notice)
      setMsgs(res.msgs)
      setStreamText('')
      if (reply.role === 'assistant') saveMessage(active.id, reply)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [active, busy, identity, input, memories, msgs, settings])

  const doExport = () => {
    if (!active || msgs.length === 0) return
    const lines = [
      EXPORT_LABEL_HEADER,
      `角色：${active.name}（${active.tagline}）`,
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
      '='.repeat(40),
      '',
      ...msgs.map((m) => (m.role === 'user' ? `【我】${m.content}` : `【${active.name} · ${AI_LABEL}】${m.content}`)),
      EXPORT_LABEL_FOOTER,
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${active.name}-对话-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const doClear = async () => {
    if (!active) return
    if (!confirm(`清空与「${active.name}」的全部对话记录？此操作不可恢复。`)) return
    await clearSession(active.id)
    setMsgs([])
  }

  const doDeletePersona = async (p: Persona) => {
    if (!confirm(`删除角色「${p.name}」？\n该角色的对话记录与长期记忆会一并移除，不可恢复。`)) return
    await deletePersona(p.id)
    await clearSession(p.id)
    setPersonas(prev => prev.filter(x => x.id !== p.id))
  }

  const reloadPersonas = useCallback(async () => {
    const list = await fetchPersonas()
    setPersonas(list)
  }, [])

  // ── 首次告知与同意 ──
  if (needConsent) {
    return (
      <PageShell onClose={onClose} fill icon={PERSONA_ICON}>
        <PersonaConsent onAgree={id => { saveIdentity(id); setIdentity(id) }} />
      </PageShell>
    )
  }

  // ── 新建 / 编辑角色 ──
  if (view === 'create' || view === 'edit') {
    return (
      <PageShell onClose={onClose} fill icon={PERSONA_ICON}
        title={view === 'create' ? '新建角色' : `编辑「${active?.name || ''}」`}>
        <PersonaEditor
          persona={view === 'edit' ? active : null}
          onCancel={() => {
            // 新建取消 → 回角色选择；编辑取消 → 回对话
            if (view === 'create') { setActive(null); setView('chat') }
            else setView('chat')
          }}
          onSaved={async (saved) => {
            await reloadPersonas()
            setView('chat')
            setActive(saved)
            const [s, m] = await Promise.all([loadSession(saved.id), loadMemories(saved.id)])
            setMsgs(s); setMemories(m)
          }}
        />
      </PageShell>
    )
  }

  // ── 角色选择 ──
  if (!active) {
    return (
      <PageShell onClose={onClose} title="AI 角色" description="选择角色开始对话，所有内容均为 AI 生成"
        icon={PERSONA_ICON}
        actions={
          <button onClick={() => { setActive(null); setView('create') }} className="h-8 px-3.5 rounded-lg text-[12.5px] font-medium"
            style={{ background: c.textHead, color: c.bg }}>+ 新建角色</button>
        }>
        <div className="px-5 py-5">
          <div className="max-w-2xl mb-5 px-3.5 py-2.5 rounded-lg text-[11.5px] leading-relaxed"
            style={{ background: c.bgInput, border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>
            你正在与 <strong style={{ color: c.textHead }}>AI 虚构角色</strong> 互动，不是真人。所有回复由 AI 生成，
            可能存在错误。角色不会提供医疗、心理、法律、财务等专业意见。
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-3xl">
            {/* 新建角色卡 */}
            <button onClick={() => { setActive(null); setView('create') }}
              className="flex items-center gap-3 p-4 rounded-xl text-left transition-colors"
              style={{ border: `1px dashed ${c.border}`, color: c.textTertiary }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c.borderFocus; e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.background = 'transparent' }}>
              <span className="w-11 h-11 rounded-xl flex items-center justify-center text-[22px] shrink-0" style={{ background: c.bgInput }}>+</span>
              <span>
                <span className="block text-[13.5px] font-medium" style={{ color: c.textHead }}>新建角色</span>
                <span className="block text-[11.5px] mt-0.5">自定义人设 · 长期记忆</span>
              </span>
            </button>

            {personas.map(p => (
              <div key={p.id} className="group relative flex items-start gap-3 p-4 rounded-xl transition-colors glass"
                style={{ border: `1px solid ${c.borderLight}` }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = c.border }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = c.borderLight }}>
                <button onClick={() => openPersona(p)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                  <span className="w-11 h-11 rounded-xl flex items-center justify-center text-[20px] shrink-0"
                    style={{ background: c.bgInput }}>{p.avatar}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold" style={{ color: c.textHead }}>{p.name}</span>
                      {p.isPreset ? <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textMuted }}>预置</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textMuted }}>自建</span>}
                    </span>
                    <span className="block text-[11.5px] mt-0.5" style={{ color: c.textSecondary }}>{p.tagline}</span>
                  </span>
                </button>
                {/* hover 操作：编辑 / 删除 */}
                <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setActive(p); setView('edit') }} title="编辑"
                    className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: c.bg, border: `1px solid ${c.borderLight}`, color: c.textTertiary }}>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" /></svg>
                  </button>
                  {!p.isPreset && (
                    <button onClick={() => doDeletePersona(p)} title="删除"
                      className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: c.bg, border: `1px solid ${c.borderLight}`, color: c.toolErr }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="max-w-3xl mt-6 pt-4 border-t" style={{ borderColor: c.borderLight }}>
            <button onClick={() => setView(view === 'disclaimer' ? 'chat' : 'disclaimer')}
              className="text-[11.5px] underline" style={{ color: c.textTertiary }}>
              查看完整免责说明与合规依据
            </button>
            {view === 'disclaimer' && (
              <div className="mt-3 space-y-3 text-[11.5px] leading-relaxed" style={{ color: c.textSecondary }}>
                <div>
                  <div className="font-medium mb-1" style={{ color: c.textHead }}>使用须知</div>
                  <ul className="list-disc pl-4 space-y-1">{DISCLAIMER.disclaimer.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
                <div>
                  <div className="font-medium mb-1" style={{ color: c.textHead }}>隐私说明</div>
                  <ul className="list-disc pl-4 space-y-1">{DISCLAIMER.privacy.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
                <div>
                  <div className="font-medium mb-1" style={{ color: c.textHead }}>合规依据</div>
                  <ul className="list-disc pl-4 space-y-0.5" style={{ color: c.textTertiary }}>
                    {DISCLAIMER.basis.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageShell>
    )
  }

  // ── 对话视图 ──
  const modelLabel = settings.model || '免费模型'
  const isFree = !settings.apiBaseUrl
  return (
    <PageShell onClose={onClose} fill icon={PERSONA_ICON}
      title={`${active.avatar} ${active.name}`}
      description={active.tagline}
      actions={
        <div className="flex items-center gap-1.5">
          <button onClick={() => setView(view === 'chat' ? 'memory' : 'chat')} className="h-8 px-3 rounded-lg text-[12px]"
            style={{ background: view === 'memory' ? c.bgInput : 'transparent', color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>
            记忆 {memories.length > 0 ? `(${memories.length})` : ''}
          </button>
          <button onClick={doExport} disabled={msgs.length === 0} className="h-8 px-3 rounded-lg text-[12px] disabled:opacity-30"
            style={{ border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>导出</button>
          <button onClick={doClear} disabled={msgs.length === 0} className="h-8 px-3 rounded-lg text-[12px] disabled:opacity-30"
            style={{ border: `1px solid ${c.borderLight}`, color: c.toolErr }}>清空</button>
          <button onClick={() => { setActive(null); setView('chat') }} className="h-8 px-3 rounded-lg text-[12px]"
            style={{ border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>切换角色</button>
        </div>
      }>
      {view === 'memory' ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <PersonaMemoryPanel persona={active} memories={memories} onChange={setMemories} />
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
            <div className="max-w-2xl mx-auto mb-4 px-3 py-1.5 rounded-lg text-[11px] text-center"
              style={{ background: c.bgInput, color: c.textTertiary }}>
              你正在与 AI 虚构角色「{active.name}」互动，非真人 · 内容由 AI 生成
            </div>

            {usageTip && (
              <div className="max-w-2xl mx-auto mb-3 px-3 py-2 rounded-lg text-[11.5px] flex items-start gap-2"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#b45309' }}>
                <span className="flex-1">{usageReminderText()}</span>
                <button onClick={() => setUsageTip(false)} className="underline shrink-0">知道了</button>
              </div>
            )}

            <div className="max-w-2xl mx-auto space-y-3">
              {msgs.length === 0 && !busy && (
                <div className="py-16 text-center">
                  <div className="text-[40px] mb-3">{active.avatar}</div>
                  <p className="text-[13px] leading-relaxed" style={{ color: c.textSecondary }}>
                    {active.opening || '你好，想聊点什么？'}
                  </p>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[86%] ${m.role === 'user' ? '' : 'min-w-0'}`}>
                    <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${m.role === 'user' ? 'whitespace-pre-wrap break-words' : ''}`}
                      style={m.role === 'user'
                        ? { background: c.bgInput, color: c.text }
                        : {
                            background: m.crisis ? 'rgba(239,68,68,0.06)' : 'transparent',
                            border: `1px solid ${m.crisis ? 'rgba(239,68,68,0.25)' : c.borderLight}`,
                            color: c.textSecondary,
                          }}>
                      {m.role === 'assistant'
                        ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        : m.content}
                    </div>
                    {m.role === 'assistant' && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textMuted }}>{AI_LABEL}</span>
                        {m.crisis && <span className="text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>安全提醒</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* 流式生成中：思考指示 + 打字机气泡 */}
              {busy && (
                <div className="flex justify-start">
                  <div className="max-w-[86%] min-w-0">
                    {thinkingMs === null && !streamText && (
                      <div className="px-3.5 py-2.5 rounded-2xl flex items-center gap-2 text-[12px]"
                        style={{ border: `1px solid ${c.borderLight}`, color: c.textTertiary }}>
                        <span className="flex gap-1">
                          {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: c.textMuted, animationDelay: `${i * 0.15}s` }} />)}
                        </span>
                        {active.name} 正在思考…
                      </div>
                    )}
                    {streamText && (
                      <>
                        <div className="px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed"
                          style={{ border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                          <span className="inline-block w-1.5 h-4 align-text-bottom ml-0.5 animate-pulse" style={{ background: c.textMuted }} />
                        </div>
                        {thinkingMs !== null && (
                          <div className="mt-1 text-[10.5px]" style={{ color: c.textMuted }}>想了 {(thinkingMs / 1000).toFixed(1)} 秒</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 输入区 + 状态条（学 ClerkBox composer：模型/权限/停止） */}
          <div className="shrink-0 border-t px-5 py-3" style={{ borderColor: c.borderLight }}>
            <div className="max-w-2xl mx-auto">
              {/* 状态条 */}
              <div className="flex items-center gap-2 mb-2 text-[10.5px]" style={{ color: c.textMuted }}>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: c.bgInput }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                  {modelLabel}
                </span>
                {isFree && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}>免费 · 免 key</span>}
                {memories.length > 0 && <span className="px-1.5 py-0.5 rounded" style={{ background: c.bgInput }}>记忆 {memories.length} 条</span>}
                {identity.age && identity.age !== 'adult' && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#b45309' }}>未成年人模式</span>}
                <div className="flex-1" />
                {busy && (
                  <button onClick={stop} className="px-2 py-0.5 rounded font-medium" style={{ border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>停止</button>
                )}
              </div>

              {notice && <div className="mb-2 text-[10.5px]" style={{ color: c.textMuted }}>{notice}</div>}

              <div className="flex items-end gap-2">
                <textarea value={input} onChange={e => setInput(e.target.value)} rows={1}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder={`和${active.name}说点什么…（Enter 发送 · Shift+Enter 换行）`}
                  className="flex-1 px-3.5 py-2.5 rounded-xl text-[13px] outline-none resize-none scrollbar-thin"
                  style={{ border: `1px solid ${c.borderLight}`, background: c.bgInput, color: c.text, maxHeight: 120 }} />
                {busy ? (
                  <button onClick={stop} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: c.toolErr, color: '#fff' }} title="停止生成">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
                  </button>
                ) : (
                  <button onClick={send} disabled={!input.trim()} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30"
                    style={{ background: c.textHead, color: c.bg }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}