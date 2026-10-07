import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'

interface ScheduledTask { id: string; title: string; type: 'once' | 'daily' | 'weekly'; content: string; nextRun: string; enabled: boolean; createdAt: string; cron?: string }

function loadTasks(): ScheduledTask[] { try { const raw = localStorage.getItem('lyclaw_scheduled_tasks'); return raw ? JSON.parse(raw) : [] } catch { return [] } }
function saveTasks(tasks: ScheduledTask[]) { localStorage.setItem('lyclaw_scheduled_tasks', JSON.stringify(tasks)) }

const TYPE_LABELS: Record<string, string> = { once: '一次性', daily: '每天', weekly: '每周' }

export default function ScheduledTasksPanel({ onClose, embedded: _embedded }: { onClose: () => void; embedded?: boolean }) {
  const { c } = useTheme()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<'once' | 'daily' | 'weekly'>('once')
  const [newSchedule, setNewSchedule] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => { setTasks(loadTasks()) }, [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t) }, [refresh])

  const handleCreate = async () => {
    if (!newTitle.trim() || !newSchedule.trim()) return
    setCreating(true)
    try {
      const body: any = { title: newTitle.trim(), content: newContent.trim(), type: newType, enabled: true }
      if (newType === 'once') body.delayMinutes = Math.max(1, parseInt(newSchedule) || 60)
      else body.cron = newSchedule
      const res = await fetch('/api/scheduled-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.ok && data.task) { const updated = [...tasks, data.task]; setTasks(updated); saveTasks(updated); setShowNewForm(false); setNewTitle(''); setNewContent(''); setNewSchedule('') }
    } catch {}
    finally { setCreating(false) }
  }

  const handleToggle = async (task: ScheduledTask) => {
    const updated = tasks.map(t => t.id === task.id ? { ...t, enabled: !t.enabled } : t)
    setTasks(updated); saveTasks(updated)
    try { await fetch(`/api/scheduled-tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !task.enabled }) }) } catch {}
  }
  const handleDelete = async (id: string) => {
    const updated = tasks.filter(t => t.id !== id); setTasks(updated); saveTasks(updated); setConfirmDeleteId(null)
    try { await fetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE' }) } catch {}
  }

  return (
    <PageShell onClose={onClose} title="定时任务" description="周期性自动执行的任务计划与管理" icon="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z">
      {/* New task button */}
      <div className="px-4 pt-3 pb-2">
        <button onClick={() => setShowNewForm(true)} className="h-9 px-4 rounded-lg text-[13px] font-medium flex items-center gap-1.5" style={{ background: c.textHead, color: c.bg }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          新建任务
        </button>
      </div>

      {/* Task list */}
      <div className="px-4 pb-4">
        {tasks.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[13px]" style={{ color: c.textMuted }}>暂无定时任务</p>
            <button onClick={() => setShowNewForm(true)} className="text-[12px] font-medium mt-1" style={{ color: c.accent }}>创建第一个</button>
          </div>
        ) : (
          <div className="space-y-1">
            {tasks.map(task => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-xl glass" style={{ border: `1px solid ${c.borderLight}` }}>
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: task.enabled ? c.accent : c.textMuted }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium truncate" style={{ color: c.text }}>{task.title}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: task.enabled ? '#34d39922' : c.bgInput, color: task.enabled ? '#059669' : c.textMuted }}>
                      {task.enabled ? '运行中' : '已暂停'}
                    </span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>
                    {TYPE_LABELS[task.type] || task.type} · {task.nextRun}
                  </div>
                </div>
                <button onClick={() => handleToggle(task)} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-medium" style={{ background: task.enabled ? '#34d39922' : c.bgInput, color: task.enabled ? '#059669' : c.textMuted }}>
                  {task.enabled ? 'ON' : 'OFF'}
                </button>
                <button onClick={() => setConfirmDeleteId(task.id)} className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ color: c.toolErr }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New task modal */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setShowNewForm(false)}>
          <div className="rounded-xl p-5 space-y-4 glass-strong" style={{ width: 440, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold" style={{ color: c.textHead }}>新建定时任务</h3>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="任务标题" autoFocus
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="任务内容（AI 指令）" rows={3}
              className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            <div className="flex gap-2">
              <select value={newType} onChange={e => setNewType(e.target.value as any)} className="flex-1 px-3 py-2 rounded-lg text-xs outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }}>
                <option value="once">一次性</option><option value="daily">每天</option><option value="weekly">每周</option>
              </select>
              <input type="text" value={newSchedule} onChange={e => setNewSchedule(e.target.value)} placeholder={newType === 'once' ? '延迟分钟数' : 'Cron 表达式'}
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewForm(false)} className="px-4 py-2 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
              <button onClick={handleCreate} disabled={creating} className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30" style={{ background: c.textHead, color: c.bg }}>{creating ? '创建中...' : '创建'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
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
