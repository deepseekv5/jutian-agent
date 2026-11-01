/**
 * ScheduledTasksPanel — 定时任务（v14 重写）
 *
 * 修掉两个真实故障：
 *   1. 面板读写的是 localStorage，而调度器读的是服务端 scheduled_tasks.json——
 *      用户在界面里创建的任务服务端根本看不到（反之亦然）
 *   2. 服务端创建任务时不计算 nextRun，任务创建后永远不会触发
 * 新增：
 *   - 执行模式：纯文本 / 带工具执行（agent 模式会真的读写文件、跑命令）
 *   - 标准 5 段 cron（含校验与「下次触发」预览）
 *   - 立即执行一次（验证配置，不必等到点）
 */
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import PageShell from '../app/PageShell'
import { fetchCompat } from '../api'

interface ScheduledTask {
  id: string
  title: string
  type: 'once' | 'daily' | 'weekly'
  content: string
  nextRun: string
  enabled: boolean
  createdAt: string
  cron?: string
  mode?: 'text' | 'agent' | 'workflow'
  workflowId?: string
  status?: string
  lastResult?: string
  lastRun?: string
  delayMinutes?: number
  history?: { ts: number; status: string; summary: string }[]
}

const TYPE_LABELS: Record<string, string> = { once: '一次性', daily: '每天', weekly: '每周' }

function fmtTime(iso?: string): string {
  if (!iso) return '未排期'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未排期'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ScheduledTasksPanel({ onClose, embedded: _embedded }: { onClose: () => void; embedded?: boolean }) {
  const { tt } = useLanguage()
  const { c } = useTheme()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<'once' | 'daily' | 'weekly'>('once')
  const [newSchedule, setNewSchedule] = useState('')
  const [newMode, setNewMode] = useState<'text' | 'agent' | 'workflow'>('text')
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([])
  const [newWorkflowId, setNewWorkflowId] = useState('')
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetchCompat('/api/scheduled-tasks').then(x => x.json())
      setTasks(Array.isArray(r?.tasks) ? r.tasks : [])
    } catch { /* 服务不可用时保留上次列表 */ }
  }, [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t) }, [refresh])
  useEffect(() => {
    fetchCompat('/api/workflows').then(r => r.json())
      .then(j => setWorkflows(Array.isArray(j?.workflows) ? j.workflows.map((w: any) => ({ id: w.id, name: w.name })) : []))
      .catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!newTitle.trim()) { setErr('请填写任务标题'); return }
    if (!newContent.trim()) { setErr('请填写任务内容（AI 指令）'); return }
    if (!newSchedule.trim()) { setErr(newType === 'once' ? '请填写延迟分钟数' : '请填写 cron 表达式'); return }
    setCreating(true); setErr('')
    try {
      const body: Record<string, unknown> = {
        title: newTitle.trim(), content: newContent.trim(), type: newType, mode: newMode, enabled: true,
      }
      if (newMode === 'workflow') {
        if (!newWorkflowId) { setErr('请选择要运行的工作流'); return }
        body.workflowId = newWorkflowId
      }
      if (newType === 'once') body.delayMinutes = Math.max(1, parseInt(newSchedule, 10) || 60)
      else body.cron = newSchedule.trim()
      const res = await fetchCompat('/api/scheduled-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) { setErr(data.error); return }
      if (data.ok) {
        setShowNewForm(false); setNewTitle(''); setNewContent(''); setNewSchedule('')
        await refresh()
      }
    } catch (e: any) { setErr(String(e.message || e)) }
    finally { setCreating(false) }
  }

  const handleToggle = async (task: ScheduledTask) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, enabled: !t.enabled } : t))
    try {
      await fetchCompat(`/api/scheduled-tasks/${task.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !task.enabled }),
      })
    } catch { /* 失败时下次刷新会纠正 */ }
  }
  const handleDelete = async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id)); setConfirmDeleteId(null)
    try { await fetchCompat(`/api/scheduled-tasks/${id}`, { method: 'DELETE' }) } catch {}
  }
  const handleRun = async (task: ScheduledTask) => {
    setRunningId(task.id); setErr('')
    try {
      const r = await fetchCompat(`/api/scheduled-tasks/${task.id}/run`, { method: 'POST' }).then(x => x.json())
      if (r.error) setErr(r.error)
      await refresh()
      setExpandedId(task.id)
    } catch (e: any) { setErr(String(e.message || e)) }
    finally { setRunningId(null) }
  }

  return (
    <PageShell onClose={onClose} title="定时任务" description="周期性自动执行的任务计划与管理" icon="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <button onClick={() => { setShowNewForm(true); setErr('') }} className="h-9 px-4 rounded-lg text-[13px] font-medium flex items-center gap-1.5" style={{ background: c.textHead, color: c.bg }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          新建任务
        </button>
        <span className="text-[11px]" style={{ color: c.textMuted }}>
          调度器每 30 秒检查一次；带工具模式会真实读写文件/执行命令
        </span>
      </div>
      {err && <div className="px-4 pb-2 text-[11.5px]" style={{ color: c.toolErr }}>{err}</div>}

      <div className="px-4 pb-4">
        {tasks.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[13px]" style={{ color: c.textMuted }}>{tt('tasks.empty')}</p>
            <button onClick={() => setShowNewForm(true)} className="text-[12px] font-medium mt-1" style={{ color: c.accent }}>创建第一个</button>
          </div>
        ) : (
          <div className="space-y-1">
            {tasks.map(task => {
              const expanded = expandedId === task.id
              return (
                <div key={task.id} className="rounded-xl glass" style={{ border: `1px solid ${c.borderLight}` }}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: task.enabled ? c.accent : c.textMuted }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium truncate" style={{ color: c.text }}>{task.title}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: task.enabled ? '#34d39922' : c.bgInput, color: task.enabled ? '#059669' : c.textMuted }}>
                          {task.enabled ? '运行中' : '已暂停'}
                        </span>
                        {task.mode === 'workflow' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: `${c.accent}18`, color: c.accent }}>工作流</span>
                        )}
                        {task.mode === 'agent' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: `${c.accent}18`, color: c.accent }}>带工具</span>
                        )}
                        {task.status === 'error' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: '#ef444422', color: '#ef4444' }}>上次失败</span>
                        )}
                      </div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: c.textTertiary }}>
                        {TYPE_LABELS[task.type] || task.type}
                        {task.cron ? ` · ${task.cron}` : ''}
                        {task.type === 'once' && task.delayMinutes ? ` · ${task.delayMinutes} 分钟后` : ''}
                        {' · 下次 '}{fmtTime(task.nextRun)}
                      </div>
                    </div>
                    <button onClick={() => handleRun(task)} disabled={runningId === task.id}
                      className="shrink-0 h-7 px-2 rounded-lg text-[10.5px] font-medium disabled:opacity-50"
                      style={{ background: c.bgInput, color: c.textSecondary }}>
                      {runningId === task.id ? '执行中…' : '立即执行'}
                    </button>
                    <button onClick={() => setExpandedId(expanded ? null : task.id)} className="shrink-0 w-7 h-7 rounded-lg text-[10.5px]" style={{ color: c.textMuted }}>
                      {expanded ? '▾' : '▸'}
                    </button>
                    <button onClick={() => handleToggle(task)} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-medium" style={{ background: task.enabled ? '#34d39922' : c.bgInput, color: task.enabled ? '#059669' : c.textMuted }}>
                      {task.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button onClick={() => setConfirmDeleteId(task.id)} className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ color: c.toolErr }}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  {expanded && (
                    <div className="px-4 pb-3 space-y-1.5 border-t pt-2" style={{ borderColor: c.borderLight }}>
                      <div className="text-[11px]" style={{ color: c.textSecondary }}>
                        <span style={{ color: c.textTertiary }}>任务内容：</span>{task.content}
                      </div>
                      <div className="text-[11px]" style={{ color: c.textTertiary }}>
                        上次执行：{fmtTime(task.lastRun)} · 状态：{task.status || '未执行'}
                      </div>
                      {(task.history || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(task.history || []).slice(0, 10).map((h, i) => (
                            <span key={i} className="text-[9.5px] px-1.5 py-0.5 rounded"
                              style={{ background: h.status === 'error' ? '#ef444415' : c.bgInput, color: h.status === 'error' ? c.toolErr : c.textTertiary }}
                              title={h.summary}>
                              {new Date(h.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              {h.status === 'error' ? ' 失败' : ' 成功'}
                            </span>
                          ))}
                        </div>
                      )}
                      {task.lastResult && (
                        <pre className="text-[10.5px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto scrollbar-thin px-2 py-1.5 rounded-lg"
                          style={{ background: c.bgInput, color: c.textSecondary }}>{task.lastResult}</pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setShowNewForm(false)}>
          <div className="rounded-xl p-5 space-y-3 glass-strong" style={{ width: 460, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold" style={{ color: c.textHead }}>新建定时任务</h3>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="任务标题" autoFocus
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="任务内容（AI 指令，例如：总结 ~/Downloads 里今天新增的文件并列出清单）" rows={3}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />

            {/* 执行模式 */}
            <div className="flex items-center gap-2">
              <span className="text-[11.5px]" style={{ color: c.textTertiary }}>执行模式</span>
              <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${c.borderLight}` }}>
                {([['text', '纯文本'], ['agent', '带工具执行'], ['workflow', '跑工作流']] as const).map(([v, zh]) => (
                  <button key={v} onClick={() => setNewMode(v)} className="px-2.5 h-7 text-[11px]"
                    style={{ background: newMode === v ? c.accent : 'transparent', color: newMode === v ? '#fff' : c.textTertiary }}>
                    {zh}
                  </button>
                ))}
              </div>
              <span className="text-[10.5px]" style={{ color: c.textMuted }}>
                {newMode === 'agent' ? '可读写文件、执行命令、联网（最多 6 轮）'
                  : newMode === 'workflow' ? '按编排好的步骤依次执行' : '只生成文字，不操作系统'}
              </span>
            </div>
            {newMode === 'workflow' && (
              <div className="flex items-center gap-2">
                <span className="text-[11.5px]" style={{ color: c.textTertiary }}>工作流</span>
                <select value={newWorkflowId} onChange={e => setNewWorkflowId(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg text-[12px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }}>
                  <option value="">（选择工作流）</option>
                  {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {workflows.length === 0 && <span className="text-[10.5px]" style={{ color: c.textMuted }}>先在「工作流」里创建</span>}
              </div>
            )}

            <div className="flex gap-2">
              <select value={newType} onChange={e => setNewType(e.target.value as 'once' | 'daily' | 'weekly')} className="px-3 py-2 rounded-lg text-xs outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }}>
                <option value="once">一次性</option><option value="daily">每天</option><option value="weekly">每周</option>
              </select>
              <input type="text" value={newSchedule} onChange={e => setNewSchedule(e.target.value)}
                placeholder={newType === 'once' ? '延迟分钟数，如 30' : 'cron：0 9 * * 1-5（工作日 9 点）'}
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none font-mono" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            </div>
            {newType !== 'once' && (
              <div className="text-[10.5px] leading-relaxed" style={{ color: c.textMuted }}>
                cron 5 段：分 时 日 月 周 · 例：<code>0 9 * * *</code> 每天 9:00 · <code>*/30 * * * *</code> 每 30 分钟 · <code>0 18 * * 5</code> 每周五 18:00
              </div>
            )}
            {err && <div className="text-[11px]" style={{ color: c.toolErr }}>{err}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewForm(false)} className="px-4 py-2 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
              <button onClick={handleCreate} disabled={creating} className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30" style={{ background: c.textHead, color: c.bg }}>{creating ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setConfirmDeleteId(null)}>
          <div className="rounded-xl p-6 text-center space-y-4" style={{ width: 360, background: c.modalBg, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#f59e0b' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm" style={{ color: c.text }}>确定删除此任务?</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg text-[12px]" style={{ color: c.textSecondary, background: c.bgInput }}>取消</button>
              <button onClick={() => handleDelete(confirmDeleteId)} className="px-4 py-2 rounded-lg text-[12px] font-medium text-white" style={{ background: '#ef4444' }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
