/**
 * SwarmConsole —— 集群指挥室（超高级单页）
 * 员工卡片墙（含单独对话入口）· 群组管理（建群/指定老板/成员）· 实时运行状态镜像
 * CODE-SPEC v1.0：复用 code/ui 基元 + 主题令牌。
 */
import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import {
  loadEmployees, saveEmployees, exportEmployees, importEmployees,
  loadGroups, saveGroups, groupMembers, groupBoss, createGroup,
  type Employee, type Group,
} from '../../shared/employees'
import { CMEmpty, CMPrimaryBtn, CMInput, CMBtn } from '../code/ui'
import { AgentAvatar } from './agent/AgentKit'

const uid = () => 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

interface LiveState { running: boolean; phase: string; plan: any[] }

const BOSS_ICON = 'M5 3l4.5 9L5 21h14l-4.5-9L19 3z'

export default function EmployeesPanel({ onClose, onOpenTab }: {
  onClose: () => void
  onOpenTab?: (type: any, opts?: { refId?: string; title?: string; iconPath?: string }) => void
}) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [employees, setEmployees] = useState<Employee[]>(loadEmployees)
  const [groups, setGroups] = useState<Group[]>(loadGroups)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [groupModal, setGroupModal] = useState<null | { mode: 'new' } | { mode: 'edit'; group: Group }>(null)
  const [live, setLive] = useState<LiveState>({ running: false, phase: '', plan: [] })
  const [toast, setToast] = useState('')

  // 实时镜像集群运行状态（任意会话的集群任务）
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail || null
      setLive({ running: !!d?.running, phase: String(d?.phase || ''), plan: Array.isArray(d?.plan) ? d.plan : [] })
    }
    window.addEventListener('autonomy-progress', h)
    return () => window.removeEventListener('autonomy-progress', h)
  }, [])

  useEffect(() => {
    const h = () => setEmployees(loadEmployees())
    const g = () => setGroups(loadGroups())
    window.addEventListener('employees-changed', h)
    window.addEventListener('groups-changed', g)
    return () => { window.removeEventListener('employees-changed', h); window.removeEventListener('groups-changed', g) }
  }, [])

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1800) }

  const create = () => setEditing({ id: uid(), name: '', role: '', prompt: '你是「新员工」，负责……完成后 @同事 接力或 @总管 交付。' })
  const save = () => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) { flash('请填写姓名'); return }
    const exists = employees.some(e => e.id === editing.id)
    const next = exists ? employees.map(e => e.id === editing.id ? { ...editing, name } : e) : [...employees, { ...editing, name }]
    setEmployees(next); saveEmployees(next); setEditing(null); flash('已保存')
  }
  const remove = (id: string) => {
    const e = employees.find(x => x.id === id)
    if (e?.builtin) { flash('内置员工不可删除'); return }
    if (!confirm(`删除员工「${e?.name}」？`)) return
    const next = employees.filter(x => x.id !== id); setEmployees(next); saveEmployees(next)
  }

  const openEmployeeChat = (e: Employee) => {
    onOpenTab?.('employee', { refId: e.id, title: e.name, iconPath: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z' })
    flash(`已打开与 ${e.name} 的对话`)
  }
  const openGroupChat = (g: Group) => {
    onOpenTab?.('group', { refId: g.id, title: g.name, iconPath: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z' })
    flash(`已打开群聊「${g.name}」`)
  }
  const setBoss = (g: Group, bossId: string | null) => {
    const next = groups.map(x => x.id === g.id ? { ...x, bossId } : x)
    setGroups(next); saveGroups(next)
  }
  const delGroup = (g: Group) => {
    if (!confirm(`删除群组「${g.name}」？群聊记录会保留，重新建同名群可继续看。`)) return
    const next = groups.filter(x => x.id !== g.id)
    setGroups(next); saveGroups(next); flash('已删除群组')
  }

  // 快捷发起集群任务：主输入框自动进入 集群+员工模式
  const launchSwarm = () => {
    window.dispatchEvent(new CustomEvent('swarm-preset', { detail: { team: 'employees' } }))
    flash('已切到集群模式，去对话输入目标')
  }

  const liveDone = useMemo(() => (live.plan || []).filter((g: any) => g.status === 'done').length, [live.plan])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: c.bg }}>
      {/* ── 指挥室 Hero ── */}
      <div className="shrink-0 border-b" style={{ borderColor: c.border, background: c.bgInput }}>
        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: c.accent }}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={c.accentText} strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <div>
                  <h1 className="text-[18px] font-bold tracking-tight" style={{ color: c.textHead }}>t('集群指挥室', 'Swarm Console')</h1>
                  <p className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>t('员工可单独对话，也能拉成群聊；群内可指定老板，支持 @ 点名与老板指派', 'Chat 1:1, group them up, pick a boss. @-mention and boss delegation supported.')</p>
                </div>
              </div>
            </div>

            {/* 运行状态镜像 */}
            {live.running && (
              <div className="rounded-xl border px-4 py-2 min-w-[220px] animate-fade-in" style={{ borderColor: c.accent, background: `${c.accent}10` }}>
                <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: c.accent }}>
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: c.accent }} />
                  运行中
                </div>
                <div className="text-[11px] mt-0.5 truncate" style={{ color: c.textSecondary }} title={live.phase}>{live.phase || '…'}</div>
                {live.plan.length > 0 && <div className="text-[10.5px] font-mono mt-0.5" style={{ color: c.textTertiary }}>目标 {liveDone}/{live.plan.length}</div>}
              </div>
            )}
          </div>

          {/* 操作区 */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button onClick={launchSwarm} className="h-8 px-3.5 rounded-lg text-[12px] font-medium" style={{ background: c.accent, color: c.accentText }}>{'🚀 ' + t('发起集群任务', 'New swarm task')}</button>
            <button onClick={() => setGroupModal({ mode: 'new' })} className="h-8 px-3.5 rounded-lg text-[12px] font-medium" style={{ background: c.surfaceCard, color: c.textSecondary, border: `1px solid ${c.border}` }}>{'+ ' + t('新建群组', 'New group')}</button>
            <button onClick={create} className="h-8 px-3.5 rounded-lg text-[12px] font-medium" style={{ background: c.surfaceCard, color: c.textSecondary, border: `1px solid ${c.border}` }}>{'+ ' + t('新员工', 'New member')}</button>
            <button onClick={() => { try { navigator.clipboard?.writeText(exportEmployees(employees)); flash('已复制员工 JSON') } catch { flash('复制失败') } }} className="h-8 px-3 rounded-lg text-[12px]" style={{ background: c.surfaceCard, color: c.textSecondary, border: `1px solid ${c.border}` }}>{t('导出', 'Export')}</button>
            <button onClick={() => {
              const json = prompt('粘贴员工配置 JSON：')
              if (!json) return
              const next = importEmployees(employees, json); setEmployees(next); saveEmployees(next); flash('已导入')
            }} className="h-8 px-3 rounded-lg text-[12px]" style={{ background: c.surfaceCard, color: c.textSecondary, border: `1px solid ${c.border}` }}>{t('导入', 'Import')}</button>
            {toast && <span className="text-[11.5px]" style={{ color: c.accent }}>{toast}</span>}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 flex flex-col gap-6">
        {/* ── 群组区 ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-[13px] font-bold tracking-tight" style={{ color: c.textHead }}>{t('群组', 'Groups')}</h2>
            <span className="text-[11px]" style={{ color: c.textTertiary }}>{groups.length} 个 · 在群里 @ 成员，或让老板分派</span>
            <div className="flex-1" />
            <button onClick={() => setGroupModal({ mode: 'new' })} className="h-7 px-2.5 rounded-lg text-[11px] font-medium" style={{ background: c.bgInput, color: c.textSecondary }}>+ 新建</button>
          </div>
          {groups.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: c.border }}>
              <div className="text-[12.5px] font-medium" style={{ color: c.textSecondary }}>还没有群组</div>
              <div className="text-[11px] mt-1" style={{ color: c.textTertiary }}>把多名员工拉进一个群，指定老板，就能群聊协作</div>
              <div className="mt-3"><CMPrimaryBtn c={c} onClick={() => setGroupModal({ mode: 'new' })}>新建群组</CMPrimaryBtn></div>
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {groups.map(g => {
                const members = groupMembers(g, employees)
                const boss = groupBoss(g, employees)
                return (
                  <div key={g.id} className="rounded-xl border p-4 transition-all" style={{ borderColor: c.borderLight, background: c.surfaceCard }}
                    onMouseEnter={ev => { ev.currentTarget.style.borderColor = c.accent; ev.currentTarget.style.transform = 'translateY(-2px)'; ev.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)' }}
                    onMouseLeave={ev => { ev.currentTarget.style.borderColor = c.borderLight; ev.currentTarget.style.transform = 'none'; ev.currentTarget.style.boxShadow = 'none' }}>
                    <div className="flex items-center gap-3">
                      {/* 叠层头像 */}
                      <div className="relative w-[46px] h-[34px] shrink-0">
                        {members.slice(0, 3).map((m, i) => (
                          <div key={m.id} className="absolute" style={{ left: i * 12, top: i === 1 ? 3 : 0, zIndex: 3 - i }}>
                            <AgentAvatar emp={m} size={i === 1 ? 26 : 30} />
                          </div>
                        ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-bold truncate" style={{ color: c.textHead }}>{g.name}</div>
                        <div className="text-[11px] truncate" style={{ color: c.textTertiary }}>
                          {members.length} 名成员{boss ? ` · 老板 ${boss.name}` : ' · 未指定老板'}
                        </div>
                      </div>
                    </div>

                    {/* 成员条 */}
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {members.map(m => (
                        <span key={m.id} className="inline-flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full" style={{ background: c.bgInput }} title={`${m.name} · ${m.role}`}>
                          <AgentAvatar emp={m} size={16} />
                          <span className="text-[10.5px] font-semibold" style={{ color: c.textSecondary }}>{m.name}</span>
                          {g.bossId === m.id && <svg width="9" height="9" viewBox="0 0 24 24" fill="#f59e0b"><path d={BOSS_ICON} /></svg>}
                        </span>
                      ))}
                    </div>

                    {/* 操作 */}
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => openGroupChat(g)} className="h-7 px-2.5 rounded-lg text-[11px] font-medium" style={{ background: c.accent, color: c.accentText }}>{t('进入群聊', 'Open group')}</button>
                      <button onClick={() => setGroupModal({ mode: 'edit', group: g })} className="h-7 px-2.5 rounded-lg text-[11px] font-medium" style={{ background: c.bgInput, color: c.textSecondary }}>{t('管理成员', 'Members')}</button>
                      <label className="flex items-center gap-1 h-7 px-2 rounded-lg text-[11px]" style={{ background: c.bgInput, color: c.textSecondary }} title="指定老板：用户没 @ 人时由老板先接话并分派">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b"><path d={BOSS_ICON} /></svg>
                        <select value={g.bossId || ''} onChange={e => setBoss(g, e.target.value || null)}
                          className="bg-transparent outline-none text-[11px] font-semibold cursor-pointer max-w-[84px]" style={{ color: c.textHead }}>
                          <option value="">老板:无</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </label>
                      <div className="flex-1" />
                      <button onClick={() => delGroup(g)} className="h-7 px-2 rounded-lg text-[11px]" style={{ background: `${c.toolErr}12`, color: c.toolErr }}>{t('删除', 'Delete')}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── 员工卡片墙 ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-[13px] font-bold tracking-tight" style={{ color: c.textHead }}>{t('员工', 'Members')}</h2>
            <span className="text-[11px]" style={{ color: c.textTertiary }}>{employees.length} 名 · 点「聊天」开单独对话标签页</span>
          </div>
          {employees.length === 0 ? (
            <CMEmpty c={c} icon="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283M7 20H2v-2a3 3 0 015.356-1.857" title="还没有员工" desc="创建第一位员工，开始你的集群协作" action={<CMPrimaryBtn c={c} onClick={create}>新建员工</CMPrimaryBtn>} />
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {employees.map(e => (
                <div key={e.id} className="rounded-xl border p-4 transition-all" style={{ borderColor: c.borderLight, background: c.surfaceCard }}
                  onMouseEnter={ev => { ev.currentTarget.style.borderColor = c.accent; ev.currentTarget.style.transform = 'translateY(-2px)'; ev.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)' }}
                  onMouseLeave={ev => { ev.currentTarget.style.borderColor = c.borderLight; ev.currentTarget.style.transform = 'none'; ev.currentTarget.style.boxShadow = 'none' }}>
                  <div className="flex items-start gap-3">
                    <AgentAvatar emp={e} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate" style={{ color: c.textHead }}>{e.name}</div>
                      <div className="text-[11px] px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: c.bgInput, color: c.textSecondary }}>{e.role || '未设职责'}</div>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed mt-2.5 line-clamp-3" style={{ color: c.textTertiary, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {e.prompt || '（无提示词）'}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => openEmployeeChat(e)} className="h-7 px-2.5 rounded-lg text-[11px] font-medium" style={{ background: c.accent, color: c.accentText }}>{t('聊天', 'Chat')}</button>
                    <button onClick={() => setEditing({ ...e })} className="h-7 px-2.5 rounded-lg text-[11px] font-medium" style={{ background: c.bgInput, color: c.textSecondary }}>{t('编辑', 'Edit')}</button>
                    {!e.builtin && (
                      <button onClick={() => remove(e.id)} className="h-7 px-2.5 rounded-lg text-[11px] font-medium" style={{ background: `${c.toolErr}15`, color: c.toolErr }}>{t('删除', 'Delete')}</button>
                    )}
                    {e.builtin && <span className="text-[10px]" style={{ color: c.textMuted }}>内置</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── 员工编辑弹窗 ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in" style={{ background: c.modalOverlay }} onClick={() => setEditing(null)}>
          <div className="w-[520px] rounded-2xl border glass-strong shadow-2xl animate-scale-in" style={{ borderColor: c.border, background: c.surfaceCard }} onClick={e => e.stopPropagation()}>
            <div className="h-12 flex items-center gap-2.5 px-5 border-b" style={{ borderColor: c.borderLight }}>
              <span className="text-[14px] font-semibold tracking-tight" style={{ color: c.textHead }}>{employees.some(x => x.id === editing.id) ? '编辑员工' : '新建员工'}</span>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: c.textSecondary }}>姓名</label>
                  <CMInput value={editing.name} onChange={v => setEditing({ ...editing, name: v })} placeholder="如：前端" c={c} />
                </div>
                <div>
                  <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: c.textSecondary }}>职责</label>
                  <CMInput value={editing.role} onChange={v => setEditing({ ...editing, role: v })} placeholder="如：前端开发" c={c} />
                </div>
              </div>
              <div>
                <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: c.textSecondary }}>系统提示词</label>
                <textarea value={editing.prompt} onChange={e2 => setEditing({ ...editing, prompt: e2.target.value })} rows={9}
                  placeholder="你是「xx」，负责……完成后 @同事 接力。"
                  className="w-full resize-none px-3 py-2.5 rounded-lg text-[12.5px] leading-relaxed outline-none"
                  style={{ background: c.surfaceInput, border: `1px solid ${c.border}`, color: c.text, fontFamily: 'inherit' }} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: c.borderLight }}>
              <button onClick={() => setEditing(null)} className="h-9 px-4 rounded-lg text-[12.5px]" style={{ color: c.textSecondary }}>取消</button>
              <CMPrimaryBtn c={c} onClick={save}>保存</CMPrimaryBtn>
            </div>
          </div>
        </div>
      )}

      {/* ── 群组建群/管理弹窗 ── */}
      {groupModal && (
        <GroupModal
          c={c} employees={employees} group={groupModal.mode === 'edit' ? groupModal.group : null}
          onClose={() => setGroupModal(null)}
          onCommit={(name, memberIds, bossId) => {
            if (groupModal.mode === 'edit') {
              const g = groupModal.group
              const members = memberIds.length ? memberIds : g.memberIds
              const next = groups.map(x => x.id === g.id ? { ...x, name: name.trim() || g.name, memberIds: members, bossId: (bossId && members.includes(bossId)) ? bossId : (members.includes(x.bossId || '') ? x.bossId : members[0] ?? null) } : x)
              setGroups(next); saveGroups(next); flash('已更新群组')
            } else {
              const g = createGroup(name, memberIds, bossId)
              const next = [...groups, g]
              setGroups(next); saveGroups(next); flash('群组已创建，去群里说句话吧')
            }
            setGroupModal(null)
          }}
        />
      )}
    </div>
  )
}

/* ── 群组建群 / 管理弹窗 ── */
function GroupModal({ c, employees, group, onClose, onCommit }: {
  c: any
  employees: Employee[]
  group: Group | null
  onClose: () => void
  onCommit: (name: string, memberIds: string[], bossId: string | null) => void
}) {
  const [name, setName] = useState(group?.name || '')
  const [picked, setPicked] = useState<string[]>(group ? [...group.memberIds] : [])
  const [bossId, setBossId] = useState<string>(group?.bossId || '')

  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const ok = name.trim().length > 0 && picked.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in" style={{ background: c.modalOverlay }} onClick={onClose}>
      <div className="w-[480px] max-h-[80vh] rounded-2xl border glass-strong shadow-2xl animate-scale-in flex flex-col overflow-hidden" style={{ borderColor: c.border, background: c.surfaceCard }} onClick={e => e.stopPropagation()}>
        <div className="h-12 flex items-center px-5 border-b shrink-0" style={{ borderColor: c.borderLight }}>
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: c.textHead }}>{group ? `管理「${group.name}」` : '新建群组'}</span>
        </div>
        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          <div>
            <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: c.textSecondary }}>群组名称</label>
            <CMInput value={name} onChange={setName} placeholder="如：官网改版小组" c={c} />
          </div>
          <div>
            <div className="flex items-center mb-1.5">
              <label className="text-[11.5px] font-medium" style={{ color: c.textSecondary }}>成员（{picked.length}）</label>
              <div className="flex-1" />
              <button onClick={() => setPicked(picked.length === employees.length ? [] : employees.map(e => e.id))} className="text-[11px]" style={{ color: c.accent }}>{picked.length === employees.length ? '全不选' : '全选'}</button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {employees.map(e => {
                const on = picked.includes(e.id)
                return (
                  <button key={e.id} onClick={() => toggle(e.id)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-colors"
                    style={{ background: on ? c.accentBg : 'transparent', border: `1px solid ${on ? c.accent : c.borderLight}` }}>
                    <AgentAvatar emp={e} size={26} />
                    <span className="text-[12px] font-semibold truncate flex-1" style={{ color: c.textHead }}>{e.name}</span>
                    <span className="w-[16px] h-[16px] rounded flex items-center justify-center shrink-0"
                      style={{ background: on ? c.accent : 'transparent', border: `1.5px solid ${on ? c.accent : c.border}` }}>
                      {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.6}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-medium block mb-1.5" style={{ color: c.textSecondary }}>指定老板</label>
            <div className="flex items-center gap-2 h-9 px-3 rounded-lg" style={{ background: c.surfaceInput, border: `1px solid ${c.border}` }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b"><path d={BOSS_ICON} /></svg>
              <select value={bossId} onChange={e => setBossId(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[12.5px] cursor-pointer" style={{ color: c.textHead }}>
                <option value="">未指定（默认第一位成员先接话）</option>
                {picked.map(id => { const e = employees.find(x => x.id === id); return e ? <option key={id} value={id}>{e.name} · {e.role}</option> : null })}
              </select>
            </div>
            <p className="text-[10.5px] mt-1.5 leading-relaxed" style={{ color: c.textTertiary }}>
              用户没 @ 任何人时，由老板先接话并分派；老板可在回复里 @ 成员把活派出去，被指派者会接着干。
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0" style={{ borderColor: c.borderLight }}>
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px]" style={{ color: c.textSecondary }}>取消</button>
          <CMPrimaryBtn c={c} onClick={() => onCommit(name, picked, bossId || null)}>{group ? '保存' : '创建群组'}</CMPrimaryBtn>
        </div>
      </div>
    </div>
  )
}
