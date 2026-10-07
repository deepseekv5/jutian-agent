import { useState, useEffect, useCallback } from 'react'
import { getAllMemories, setMemory, deleteMemory } from '../store/storage'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'

interface Props { onClose: () => void; embedded?: boolean }

export default function MemoryPanel({ onClose }: Props) {
  const { c } = useTheme()
  const [memories, setMemories] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const loadMemories = useCallback(async () => {
    setLoading(true)
    try { setMemories(await getAllMemories()) } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadMemories() }, [loadMemories])

  const handleSave = async (key: string, value: string) => {
    await setMemory(key, value)
    setMemories(prev => ({ ...prev, [key]: value }))
    setEditingKey(null)
  }
  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return
    await setMemory(newKey.trim(), newValue)
    setMemories(prev => ({ ...prev, [newKey.trim()]: newValue }))
    setNewKey(''); setNewValue(''); setShowAdd(false)
  }

  const entries = Object.entries(memories).filter(([k]) => !k.startsWith('ctx_summary_')).filter(([k, v]) => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return k.toLowerCase().includes(s) || v.toLowerCase().includes(s)
  })

  return (
    <PageShell onClose={onClose} title="长期记忆" description="跨会话的长期记忆，AI 对话时自动召回" icon="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z">
      {/* Search + Add */}
      <div className="px-4 py-3 flex gap-2">
        <div className="flex-1 relative">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索记忆..."
            className="w-full pl-9 pr-3 h-9 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, background: c.bgInput, color: c.text }} />
        </div>
        <button onClick={() => setShowAdd(v => !v)} className="h-9 px-4 rounded-lg text-[13px] font-medium flex items-center gap-1.5 shrink-0" style={{ background: c.textHead, color: c.bg }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          添加
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mx-4 mb-3 p-4 rounded-xl space-y-3 glass-strong" style={{ border: `1px solid ${c.border}` }}>
          <input type="text" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="记忆键名 (如: user_name)"
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={{ border: `1px solid ${c.border}`, color: c.text, background: c.bg }} autoFocus />
          <textarea value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="记忆内容..." rows={2}
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none" style={{ border: `1px solid ${c.border}`, color: c.text, background: c.bg }} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
            <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim()} className="px-4 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-30" style={{ background: c.textHead, color: c.bg }}>保存</button>
          </div>
        </div>
      )}

      {/* Memory list */}
      <div className="px-4 pb-4">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-5 h-5 mx-auto mb-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: c.accent, borderTopColor: 'transparent' }} />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <p className="text-[13px]" style={{ color: c.textMuted }}>{search ? '未找到匹配的记忆' : '暂无长期记忆'}</p>
            <p className="text-[11px] mt-1" style={{ color: c.textMuted }}>点击上方「添加」创建第一条记忆</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-xl overflow-hidden glass" style={{ border: `1px solid ${c.borderLight}` }}>
                {editingKey === key ? (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono px-2 py-1 rounded-md" style={{ color: c.accent, background: c.bgInput }}>{key}</span>
                    </div>
                    <textarea value={editValue} onChange={e => setEditValue(e.target.value)} rows={3}
                      className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none" style={{ border: `1px solid ${c.border}`, color: c.text, background: c.bg }} autoFocus />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingKey(null)} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
                      <button onClick={() => handleSave(key, editValue)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium" style={{ background: c.textHead, color: c.bg }}>保存</button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md" style={{ color: c.accent, background: c.bgInput }}>{key}</span>
                      </div>
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: c.textSecondary }}>{value}</p>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => { setEditingKey(key); setEditValue(value) }} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: c.textMuted }} title="编辑">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button onClick={() => { if (confirm(`删除记忆 "${key}"?`)) { deleteMemory(key); setMemories(p => { const n = { ...p }; delete n[key]; return n }) } }} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: c.toolErr }} title="删除">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
