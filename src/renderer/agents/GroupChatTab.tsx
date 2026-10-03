/**
 * 群组群聊标签页
 * - 用户 @ 某成员 → 只有被点名的人回答
 * - 用户没 @ → 老板先接话；老板在回复里 @ 指派成员 → 被指派者接着干（可多层）
 * - 每条回复带成员头像/姓名/职责，一眼分清是谁在说话
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import {
  loadEmployees, loadGroups, saveGroups, groupMembers, groupBoss, createGroup,
  type Employee, type Group,
} from '../../shared/employees'
import type { Settings } from '../types'
import {
  AgentAvatar, AgentMarkdown, AgentComposer, TypingDots,
  agentMsgId, agentMsgKey, loadAgentMsgs, saveAgentMsgs, clearAgentMsgs,
  buildAgentSystemPrompt, parseMentions, ensureAgentCss, useStickBottom, type AgentMsg,
} from './agent/AgentKit'
import { runAgent, type AgentToolLine } from './agent/agentRun'

export default function GroupChatTab({ groupId, settings, onClose }: {
  groupId: string
  settings: Settings
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [employees, setEmployees] = useState<Employee[]>(() => loadEmployees())
  const [groups, setGroups] = useState<Group[]>(() => loadGroups())
  const group = useMemo(() => groups.find(g => g.id === groupId) || null, [groups, groupId])
  const members = useMemo(() => (group ? groupMembers(group, employees) : []), [group, employees])
  const boss = useMemo(() => (group ? groupBoss(group, employees) : null), [group, employees])

  const key = agentMsgKey('grp', groupId)
  const [msgs, setMsgs] = useState<AgentMsg[]>(() => loadAgentMsgs(key))
  const [speaking, setSpeaking] = useState<{ emp: Employee; text: string; tools: AgentToolLine[] } | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [error, setError] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useStickBottom(msgs.length + (speaking ? 1 : 0))

  useEffect(() => { ensureAgentCss() }, [])
  useEffect(() => { saveAgentMsgs(key, msgs) }, [key, msgs])
  useEffect(() => {
    const h = () => { setEmployees(loadEmployees()); setGroups(loadGroups()) }
    window.addEventListener('employees-changed', h)
    window.addEventListener('groups-changed', h)
    return () => { window.removeEventListener('employees-changed', h); window.removeEventListener('groups-changed', h) }
  }, [])

  const busy = speaking !== null || queue.length > 0

  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setQueue([]) }

  /* ─── 发送：串行跑完一整条接力链 ─── */
  const send = useCallback(async (text: string) => {
    if (!group || members.length === 0 || !text.trim()) return
    setError('')
    const userMsg: AgentMsg = { id: agentMsgId(), kind: 'user', content: text.trim(), ts: Date.now() }
    const base = [...msgs, userMsg]
    setMsgs(base)
    setQueue([])

    const mentioned = parseMentions(text, members)
    // 没 @ 任何人 → 老板先接话（没设老板则第一名成员）
    const first = mentioned.length ? mentioned : (boss ? [boss] : members.slice(0, 1))
    const done = new Set<string>()

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      for (const emp of first) {
        if (ctrl.signal.aborted) break
        await speak(emp, base, ctrl, done)
      }
      // 老板指派链：老板回复里 @ 了谁，就接着让谁干（已说过的不重复）
      let idx = 0
      while (idx < first.length) {
        const emp = first[idx]
        const replyText = lastReplyRef.current.get(emp.id) || ''
        const delegated = parseMentions(replyText, members).filter(m => !done.has(m.id))
        for (const d of delegated) {
          if (ctrl.signal.aborted) break
          first.push(d)
          await speak(d, base, ctrl, done)
        }
        idx += 1
      }
    } finally {
      abortRef.current = null
      setQueue([])
      setSpeaking(null)
    }
  }, [group, members, boss, msgs, employees, settings])

  // 记录每个成员本轮最后一条回复（用于解析老板的 @ 指派）
  const lastReplyRef = useRef<Map<string, string>>(new Map())

  const speak = useCallback(async (
    emp: Employee,
    base: AgentMsg[],
    ctrl: AbortController,
    done: Set<string>,
  ) => {
    setSpeaking({ emp, text: '', tools: [] })
    setQueue(q => [...q, emp.id])

    const others = members.filter(m => m.id !== emp.id)
    const extra = [
      `你在群聊「${group?.name || '群组'}」里，群里共有 ${members.length} 名成员：${members.map(m => `${m.name}（${m.role}）`).join('、')}。`,
      boss ? `本群老板是「${boss.name}」：用户没有点名时由老板接话并分派；老板 #指派 的成员必须执行。` : '本群未指定老板。',
      others.length ? `你可以 @${others.map(m => m.name).join(' @')} 把子任务交给对应同事，对方会接着干；只在自己确实需要协作时才指派。` : '',
      '直接给你的专业产出，不要说客套话；如果是被指派干活，干完简单汇报结果。',
    ].filter(Boolean).join('\n')

    const history = buildGroupHistory(base)
    try {
      const r = await runAgent({
        settings: { ...settings, model: emp.model || settings.model },
        system: buildAgentSystemPrompt(emp, settings, extra),
        history,
        signal: ctrl.signal,
        onDelta: d => setSpeaking(s => (s && s.emp.id === emp.id ? { ...s, text: s.text + d } : s)),
        onTool: t => setSpeaking(s => (s && s.emp.id === emp.id ? { ...s, tools: [...s.tools, t] } : s)),
      })
      lastReplyRef.current.set(emp.id, r.text || '')
      setMsgs(prev => [...prev, {
        id: agentMsgId(), kind: 'agent', empId: emp.id, name: emp.name, role: emp.role,
        content: (r.text || '').trim() || (r.error ? `（出错）${r.error}` : '（无回复）'),
        tools: r.tools.length ? r.tools : undefined, ts: Date.now(),
      }])
      if (r.error) setError(r.error)
    } finally {
      done.add(emp.id)
      setQueue(q => q.filter(id => id !== emp.id))
    }
  }, [group, members, boss, settings])

  /* ─── 群设置 ─── */
  const patch = (p: Partial<Group>) => {
    if (!group) return
    const next = groups.map(g => g.id === group.id ? { ...g, ...p } : g)
    setGroups(next); saveGroups(next)
  }
  const toggleMember = (id: string) => {
    if (!group) return
    const has = group.memberIds.includes(id)
    const memberIds = has ? group.memberIds.filter(m => m !== id) : [...group.memberIds, id]
    // 老板被移出群 → 自动顺位给第一名成员
    patch({ memberIds, bossId: memberIds.includes(group.bossId || '') ? group.bossId : (memberIds[0] ?? null) })
  }

  if (!group) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: c.textTertiary }}>
        <div className="text-[15px]">{t('该群组已被删除', 'This group was removed')}</div>
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-[13px]" style={{ background: c.surfaceHover, color: c.textSecondary }}>{t('关闭标签页', 'Close tab')}</button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ─── 头部 ─── */}
      <header className="shrink-0 border-b glass" style={{ borderColor: c.border }}>
        <div className="flex items-center gap-3 px-5 h-[62px]">
          {/* 叠层头像 */}
          <div className="relative w-[42px] h-[38px] shrink-0">
            {members.slice(0, 3).map((m, i) => (
              <div key={m.id} className="absolute" style={{ left: i * 13, top: i === 1 ? 4 : 0, zIndex: 3 - i }}>
                <AgentAvatar emp={m} size={i === 1 ? 30 : 34} />
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-bold truncate" style={{ color: c.textHead }}>{group.name}</span>
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: c.accentBg, color: c.accent }}>
                {members.length} {t('名成员', 'members')}
              </span>
            </div>
            <div className="text-[11.5px] truncate" style={{ color: c.textTertiary }}>
              {group.desc || '群聊'} · {boss ? `${t('老板', 'Boss')}: ${boss.name}` : t('未指定老板', 'No boss set')}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium" style={{ background: c.bgInput, color: c.textSecondary }} title="指定老板：用户没 @ 人时由老板先接话并分派">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3l4.5 9L5 21h14l-4.5-9L19 3z" /></svg>
              老板
              <select
                value={group.bossId || ''}
                onChange={e => patch({ bossId: e.target.value || null })}
                className="bg-transparent outline-none text-[12px] font-semibold cursor-pointer max-w-[92px]"
                style={{ color: c.textHead }}>
                <option value="">未指定</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <button onClick={() => setShowMembers(true)}
              className="px-2.5 h-8 rounded-lg text-[12px] font-medium transition-colors" style={{ background: c.bgInput, color: c.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
              onMouseLeave={e => { e.currentTarget.style.background = c.bgInput }}
              title="管理群成员">{t('成员', 'Members')}</button>
            {msgs.length > 0 && (
              <button onClick={() => { clearAgentMsgs(key); setMsgs([]) }}
                className="px-2.5 h-8 rounded-lg text-[12px] font-medium" style={{ background: c.bgInput, color: c.textSecondary }} title="清空群聊记录">{t('清空', 'Clear')}</button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: c.bgInput, color: c.textSecondary }} title="关闭标签页">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        {/* 成员条 */}
        <div className="flex items-center gap-1.5 px-5 pb-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {members.map(m => (
            <button key={m.id} onClick={() => send(`@${m.name} `)}
              className="group flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full shrink-0 transition-transform hover:-translate-y-0.5"
              style={{ background: c.surfaceCard, border: `1px solid ${c.border}` }}
              title={`点名 ${m.name} 发言`}>
              <AgentAvatar emp={m} size={20} />
              <span className="text-[11.5px] font-semibold" style={{ color: c.textSecondary }}>{m.name}</span>
              {group.bossId === m.id && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" className="shrink-0"><path d="M5 3l4.5 9L5 21h14l-4.5-9L19 3z" /></svg>
              )}
            </button>
          ))}
          <button onClick={() => setShowMembers(true)}
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: c.bgInput, color: c.textTertiary }} title="添加成员">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
      </header>

      {/* ─── 消息区 ─── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-[860px] mx-auto px-6 py-7 flex flex-col gap-5">
          {msgs.length === 0 && !busy && (
            <div className="flex flex-col items-center text-center gap-4 py-12 agent-msg-in">
              <div className="flex -space-x-3">
                {members.slice(0, 4).map(m => <AgentAvatar key={m.id} emp={m} size={46} ring />)}
              </div>
              <div>
                <div className="text-[24px] font-black" style={{ color: c.textHead }}>{group.name}</div>
                <div className="text-[13px] mt-1" style={{ color: c.textTertiary }}>
                  {boss ? `${boss.name} 是老板 · ` : ''}@ 点名某位成员，或直接说，让团队一起上
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {GROUP_SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium transition-transform hover:-translate-y-0.5"
                    style={{ background: c.surfaceCard, border: `1px solid ${c.border}`, color: c.textSecondary }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {msgs.map(m => m.kind === 'user'
            ? <UserBubble key={m.id} text={m.content} c={c} />
            : <AgentBubble key={m.id} msg={m} c={c} isBoss={!!boss && m.empId === boss.id} />)}

          {speaking && (
            <div className="flex gap-3 agent-msg-in">
              <AgentAvatar emp={speaking.emp} size={30} ring />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{speaking.emp.name}</span>
                  <span className="text-[11px]" style={{ color: c.textTertiary }}>{speaking.emp.role}</span>
                  {boss && speaking.emp.id === boss.id && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,.16)', color: '#f59e0b' }}>老板</span>}
                  <span className="text-[11px]" style={{ color: c.textTertiary }}>正在输入…</span>
                </div>
                {speaking.tools.length > 0 && <ToolLines tools={speaking.tools} c={c} />}
                {speaking.text ? <AgentMarkdown text={speaking.text} /> : <div className="py-1"><TypingDots /></div>}
              </div>
            </div>
          )}

          {queue.length > 1 && (
            <div className="flex items-center gap-2 text-[11.5px]" style={{ color: c.textTertiary }}>
              <span className="flex gap-1">
                {queue.map(id => {
                  const m = members.find(x => x.id === id)
                  return m ? <AgentAvatar key={id} emp={m} size={16} /> : null
                })}
              </span>
              {queue.length} {t('位成员正在接力', 'members working')}
            </div>
          )}

          {error && <div className="text-[12px] px-3 py-2 rounded-xl" style={{ background: 'rgba(239,68,68,.12)', color: '#ef4444' }}>{error}</div>}
        </div>
      </div>

      {/* ─── 输入 ─── */}
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-[860px] mx-auto relative">
          <AgentComposer onSend={send} disabled={busy} placeholder={`在「${group.name}」里说点什么…（@ 点名成员，不点名则由${boss ? boss.name : '成员'}先接话）`} pool={members} />
          <div className="flex items-center justify-center gap-3 mt-2">
            <span className="text-[10.5px]" style={{ color: c.textTertiary }}>Enter 发送 · @ 点名 · 老板可在回复里 @ 指派同事</span>
            {busy && (
              <button onClick={stop} className="text-[10.5px] px-2 py-0.5 rounded-md" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}>停止</button>
            )}
          </div>
        </div>
      </div>

      {/* ─── 成员管理 ─── */}
      {showMembers && (
        <MemberModal
          employees={employees} group={group} c={c}
          onToggle={toggleMember}
          onClose={() => setShowMembers(false)}
          onCreateGroup={(name, ids, bossId) => {
            const g = createGroup(name, ids, bossId)
            const next = [...groups, g]
            setGroups(next); saveGroups(next)
          }}
        />
      )}
    </div>
  )
}

const GROUP_SUGGESTIONS = ['@产品 @开发 一起做个登录页方案', '帮我把这份日志分析一下，要有结论', '全员：总结一下这个项目目前的风险点']

function buildGroupHistory(msgs: AgentMsg[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = []
  for (const m of msgs.slice(-24)) {
    if (m.kind === 'user') out.push({ role: 'user', content: m.content })
    else if (m.content) out.push({ role: 'assistant', content: `【${m.name || '成员'}】${m.content}` })
  }
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

function AgentBubble({ msg, c, isBoss }: { msg: AgentMsg; c: any; isBoss?: boolean }) {
  const emp: Employee = { id: msg.empId || 'x', name: msg.name || 'AI', role: msg.role || '', prompt: '' }
  return (
    <div className="flex gap-3 agent-msg-in">
      <div className="relative shrink-0">
        <AgentAvatar emp={emp} size={30} ring={isBoss} />
        {isBoss && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" className="absolute -top-1.5 -right-1.5 drop-shadow"><path d="M5 3l4.5 9L5 21h14l-4.5-9L19 3z" /></svg>
        )}
      </div>
      <div className="min-w-0 flex-1" style={{ borderLeft: `2px solid ${isBoss ? 'rgba(245,158,11,.5)' : 'transparent'}`, paddingLeft: isBoss ? 10 : 0 }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{msg.name}</span>
          {msg.role && <span className="text-[11px]" style={{ color: c.textTertiary }}>{msg.role}</span>}
          {isBoss && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,.16)', color: '#f59e0b' }}>老板</span>}
        </div>
        {msg.tools && msg.tools.length > 0 && <ToolLines tools={msg.tools} c={c} />}
        <AgentMarkdown text={msg.content} />
      </div>
    </div>
  )
}

function MemberModal({ employees, group, c, onToggle, onClose, onCreateGroup }: {
  employees: Employee[]
  group: Group
  c: any
  onToggle: (id: string) => void
  onClose: () => void
  onCreateGroup: (name: string, ids: string[], bossId: string | null) => void
}) {
  const [tab, setTab] = useState<'members' | 'new'>('members')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [newBoss, setNewBoss] = useState<string>('')

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="w-[440px] max-h-[76vh] overflow-hidden rounded-3xl flex flex-col" style={{ background: c.surfaceCard, border: `1px solid ${c.border}`, boxShadow: '0 30px 80px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 h-14 border-b shrink-0" style={{ borderColor: c.border }}>
          <span className="text-[15px] font-bold" style={{ color: c.textHead }}>群成员</span>
          <div className="ml-auto flex items-center gap-1 p-0.5 rounded-lg" style={{ background: c.bgInput }}>
            {([['members', `本群（${group.memberIds.length}）`], ['new', '新建群组']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className="px-2.5 py-1 rounded-md text-[11.5px] font-semibold transition-colors"
                style={{ background: tab === k ? c.surfaceActive : 'transparent', color: tab === k ? c.textHead : c.textTertiary }}>{label}</button>
            ))}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center ml-1" style={{ background: c.bgInput, color: c.textSecondary }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {tab === 'members' ? (
          <div className="overflow-y-auto p-3 flex flex-col gap-1.5">
            {employees.map(e => {
              const inGroup = group.memberIds.includes(e.id)
              return (
                <button key={e.id} onClick={() => onToggle(e.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-colors"
                  style={{ background: inGroup ? c.accentBg : 'transparent' }}
                  onMouseEnter={ev => { if (!inGroup) ev.currentTarget.style.background = c.surfaceHover }}
                  onMouseLeave={ev => { if (!inGroup) ev.currentTarget.style.background = 'transparent' }}>
                  <AgentAvatar emp={e} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold truncate" style={{ color: c.textHead }}>{e.name}</div>
                    <div className="text-[11px] truncate" style={{ color: c.textTertiary }}>{e.role}</div>
                  </div>
                  {group.bossId === e.id && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,.16)', color: '#f59e0b' }}>老板</span>}
                  <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: inGroup ? c.accent : 'transparent', border: `1.5px solid ${inGroup ? c.accent : c.border}` }}>
                    {inGroup && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </span>
                </button>
              )
            })}
            <div className="text-[11px] px-3 py-2" style={{ color: c.textTertiary }}>新员工请在「集群」页创建，建好后这里就能勾选入群。</div>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3 overflow-y-auto">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="群组名称，如：官网改版小组"
              className="w-full h-10 px-3.5 rounded-xl text-[13.5px] outline-none"
              style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textHead }} />
            <div className="text-[11.5px] font-semibold" style={{ color: c.textSecondary }}>选择成员（可多选）</div>
            <div className="flex flex-col gap-1.5">
              {employees.map(e => {
                const on = picked.includes(e.id)
                return (
                  <button key={e.id} onClick={() => setPicked(p => on ? p.filter(x => x !== e.id) : [...p, e.id])}
                    className="flex items-center gap-3 px-3 py-2 rounded-2xl text-left"
                    style={{ background: on ? c.accentBg : 'transparent' }}>
                    <AgentAvatar emp={e} size={30} />
                    <span className="text-[13px] font-semibold flex-1" style={{ color: c.textHead }}>{e.name}</span>
                    <span className="text-[11px]" style={{ color: c.textTertiary }}>{e.role}</span>
                    <span className="w-[18px] h-[18px] rounded-md flex items-center justify-center"
                      style={{ background: on ? c.accent : 'transparent', border: `1.5px solid ${on ? c.accent : c.border}` }}>
                      {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="text-[11.5px] font-semibold" style={{ color: c.textSecondary }}>指定老板</div>
            <select value={newBoss} onChange={e => setNewBoss(e.target.value)}
              className="w-full h-10 px-3 rounded-xl text-[13px] outline-none"
              style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textHead }}>
              <option value="">未指定（默认第一位成员）</option>
              {picked.map(id => { const e = employees.find(x => x.id === id); return e ? <option key={id} value={id}>{e.name} · {e.role}</option> : null })}
            </select>
            <button
              disabled={!name.trim() || picked.length === 0}
              onClick={() => { onCreateGroup(name.trim(), picked, newBoss || null); setName(''); setPicked([]); setNewBoss(''); setTab('members') }}
              className="h-10 rounded-xl text-[13.5px] font-bold disabled:opacity-40"
              style={{ background: c.accent, color: c.accentText }}>创建群组</button>
          </div>
        )}
      </div>
    </div>
  )
}
