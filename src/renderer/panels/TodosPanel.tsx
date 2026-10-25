/**
 * 待办面板（v12.5）
 *
 * todo_write 工具（v12 加入）让模型维护跨轮次待办，但之前只写不读——
 * 用户根本看不见模型记了什么。这个面板把清单摊开：
 *   · 三列状态：待办 / 进行中 / 已完成
 *   · 手动改状态（点条目移到下一态），改动写回 todos.json
 *     ——模型下一次 todo_write 是全量覆盖，所以手改会在模型下次写时被覆盖；
 *       这是该工具"模型是唯一作者"的语义，面板标注了这一点。
 *   · 空态给出引导：这是模型的工作清单，不是你的待办应用
 */
import { useEffect, useState, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { requestJson, post } from '../api'

interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

const NEXT: Record<Todo['status'], Todo['status']> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
}

const COLUMNS: { id: Todo['status']; label: string; labelEn: string }[] = [
  { id: 'pending', label: '待办', labelEn: 'To do' },
  { id: 'in_progress', label: '进行中', labelEn: 'In progress' },
  { id: 'completed', label: '已完成', labelEn: 'Done' },
]

export default function TodosPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const { t } = useLanguage()
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number>(0)

  const load = useCallback(() => {
    requestJson<Todo[]>('/api/todos')
      .then((d) => { setTodos(Array.isArray(d) ? d : []); setUpdatedAt(Date.now()) })
      .catch(() => setTodos([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    // 模型可能在任何会话里更新待办，轮询同步（30s，够轻）
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  const cycle = async (i: number) => {
    const next = todos.map((td, idx) => idx === i ? { ...td, status: NEXT[td.status] } : td)
    setTodos(next)
    await post('/api/todos/write', { todos: next }).catch(() => {})
  }

  const byStatus = (s: Todo['status']) => todos.filter((td) => td.status === s)
  const done = byStatus('completed').length
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>{t('待办清单', 'Todos')}</span>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>
          {t('模型在对话中维护的工作清单', 'Work list maintained by the agent')}
        </span>
        <span className="flex-1" />
        {todos.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: c.borderLight }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: c.accent || '#10a37f' }} />
            </div>
            <span className="text-[10.5px] font-mono" style={{ color: c.textTertiary }}>{done}/{todos.length}</span>
          </div>
        )}
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        {loading ? (
          <div className="text-center text-[11.5px] py-10" style={{ color: c.textTertiary }}>读取中…</div>
        ) : todos.length === 0 ? (
          <div className="text-center py-12 px-6">
            <div className="text-[13px] font-medium mb-2" style={{ color: c.textHead }}>{t('还没有待办', 'No todos yet')}</div>
            <div className="text-[11.5px] leading-relaxed max-w-[340px] mx-auto" style={{ color: c.textTertiary }}>
              {t(
                '这是 AI 在对话中自己维护的清单。让它做多步任务时，它会把步骤记在这里——你随时能看到它打算做什么、做到哪了。试试对一个复杂任务说：「帮我分步骤完成」。',
                'This list is maintained by the agent itself during conversations. Give it a multi-step task and watch it track its own steps here.'
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {COLUMNS.map((col) => {
              const items = byStatus(col.id)
              return (
                <div key={col.id}>
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{
                      background: col.id === 'completed' ? '#10a37f' : col.id === 'in_progress' ? '#f59e0b' : c.border,
                    }} />
                    <span className="text-[11px] font-medium" style={{ color: c.textTertiary }}>{t(col.label, col.labelEn)}</span>
                    <span className="text-[10px] font-mono" style={{ color: c.textMuted }}>{items.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((td) => {
                      const gi = todos.indexOf(td)
                      return (
                        <button key={gi} onClick={() => cycle(gi)}
                          className="w-full text-left px-3 py-2.5 rounded-xl text-[12px] leading-relaxed transition-colors"
                          style={{
                            background: c.bgInput,
                            border: `1px solid ${td.status === 'in_progress' ? 'rgba(245,158,11,.3)' : c.borderLight}`,
                            textDecoration: td.status === 'completed' ? 'line-through' : 'none',
                            opacity: td.status === 'completed' ? 0.55 : 1,
                          }}
                          title={t('点击切换状态', 'Click to change status')}>
                          {td.content}
                        </button>
                      )
                    })}
                    {items.length === 0 && (
                      <div className="px-3 py-4 text-center text-[10.5px] rounded-xl" style={{ color: c.textMuted, border: `1px dashed ${c.borderLight}` }}>
                        —
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {todos.length > 0 && (
        <div className="px-5 py-2 border-t text-[10px]" style={{ borderColor: c.borderLight, color: c.textMuted }}>
          {t('注意：模型下一次 todo_write 会全量覆盖清单（它是这份清单的作者）。手动改动只在模型不写时保留。', 'Note: the agent will overwrite this list on its next todo_write.')}
          {updatedAt > 0 && <span className="ml-2">{new Date(updatedAt).toLocaleTimeString()}</span>}
        </div>
      )}
    </div>
  )
}
