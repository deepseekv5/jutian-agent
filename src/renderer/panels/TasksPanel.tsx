import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'

// 长线任务（GitHub Actions 风格）：后台执行、定时任务、长时间运行的 Agent 工作流
interface LongTask {
  id: string
  name: string
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  source: 'schedule' | 'agent' | 'swarm' | 'manual'
  startedAt: string
  finishedAt?: string
  duration?: string
  summary?: string
  steps?: { name: string; status: string; detail?: string }[]
}

function loadLongTasks(): LongTask[] {
  try {
    const raw = localStorage.getItem('lyclaw_long_tasks')
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function saveLongTasks(tasks: LongTask[]) {
  try { localStorage.setItem('lyclaw_long_tasks', JSON.stringify(tasks.slice(-50))) } catch {}
}

const STATUS_STYLE: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  queued:    { dot: '#a1a1aa', text: '#a1a1aa', bg: '#a1a1aa18', label: '排队' },
  running:   { dot: '#f59e0b', text: '#f59e0b', bg: '#f59e0b18', label: '运行中' },
  success:   { dot: '#22c55e', text: '#22c55e', bg: '#22c55e18', label: '成功' },
  failed:    { dot: '#ef4444', text: '#ef4444', bg: '#ef444418', label: '失败' },
  cancelled: { dot: '#a1a1aa', text: '#a1a1aa', bg: '#a1a1aa18', label: '已取消' },
}
const SOURCE_LABEL: Record<string, string> = { schedule: '定时', agent: 'Agent', swarm: '集群', manual: '手动' }

export default function TasksPanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const { c } = useTheme()
  const [tasks, setTasks] = useState<LongTask[]>(() => loadLongTasks())
  const [filter, setFilter] = useState<'all' | 'running' | 'success' | 'failed'>('all')

  useEffect(() => {
    setTasks(loadLongTasks())
    const t = setInterval(() => { if (!document.hidden) setTasks(loadLongTasks()) }, 8000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    if (filter === 'all') return sorted
    if (filter === 'running') return sorted.filter(t => t.status === 'running' || t.status === 'queued')
    return sorted.filter(t => t.status === filter)
  }, [tasks, filter])

  const handleCancel = (id: string) => {
    const updated = tasks.map(t => t.id === id ? { ...t, status: 'cancelled' as const, finishedAt: new Date().toISOString() } : t)
    setTasks(updated); saveLongTasks(updated)
  }

  return (
    <div className={embedded ? 'h-full w-full flex flex-col' : 'fixed inset-0 z-50 flex items-center justify-center'} style={!embedded ? { background: c.modalOverlay } : {}} onClick={embedded ? undefined : onClose}>
      <div className={`${embedded ? 'w-full h-full' : 'rounded-2xl shadow-2xl'} flex flex-col`} style={embedded ? {} : { width: 720, maxHeight: '88vh', background: c.modalBg, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#24292e' }}>
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold" style={{ color: c.textHead }}>长线任务</h2>
            <p className="text-[10.5px]" style={{ color: c.textMuted }}>后台执行 · 定时任务 · Agent 工作流</p>
          </div>
          {!embedded && (
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: c.bgInput, color: c.textTertiary }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 shrink-0">
          {([['all', '全部'], ['running', '运行中'], ['success', '成功'], ['failed', '失败']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
              style={filter === k ? { background: c.accent, color: c.accentText } : { color: c.textTertiary, background: c.bgInput }}>
              {l}
            </button>
          ))}
          <span className="ml-auto text-[10px]" style={{ color: c.textMuted }}>{filtered.length} 个任务</span>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 scrollbar-thin">
          {filtered.length === 0 && (
            <div className="text-center py-16 space-y-3">
              <svg className="w-10 h-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
              </svg>
              <p className="text-[12px]" style={{ color: c.textMuted }}>暂无长线任务</p>
              <p className="text-[10.5px]" style={{ color: c.textMuted }}>创建定时任务或启动 Agent 集群后，会在此显示执行进度</p>
            </div>
          )}
          {filtered.map(task => {
            const st = STATUS_STYLE[task.status]
            return (
              <div key={task.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center" style={{ background: st.bg }}>
                    {task.status === 'running' ? (
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: st.dot }}>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} style={{ color: st.dot }}>
                        {task.status === 'success' ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /> :
                         task.status === 'failed' ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /> :
                         <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5" />}
                      </svg>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium truncate" style={{ color: c.text }}>{task.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>{SOURCE_LABEL[task.source]}</span>
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: c.textTertiary }}>
                      {new Date(task.startedAt).toLocaleString('zh-CN', { hour12: false })}
                      {task.duration ? ` · ${task.duration}` : ''}
                    </div>
                    {task.summary && <div className="text-[10.5px] mt-1 line-clamp-2" style={{ color: c.textSecondary }}>{task.summary}</div>}
                  </div>
                  {(task.status === 'running' || task.status === 'queued') && (
                    <button onClick={() => handleCancel(task.id)} className="text-[10px] px-2 py-1 rounded" style={{ color: c.toolErr, background: `${c.toolErr}15` }}>取消</button>
                  )}
                </div>
                {task.steps && task.steps.length > 0 && (
                  <div className="px-4 pb-3 pt-0.5 space-y-1" style={{ borderTop: `1px solid ${c.borderLight}` }}>
                    {task.steps.map((step, i) => (
                      <div key={i} className="text-[10.5px] flex items-center gap-1.5" style={{ color: c.textTertiary }}>
                        <span style={{ color: step.status === 'done' ? '#22c55e' : step.status === 'error' ? '#ef4444' : '#a1a1aa' }}>
                          {step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : '○'}
                        </span>
                        <span className="truncate">{step.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
