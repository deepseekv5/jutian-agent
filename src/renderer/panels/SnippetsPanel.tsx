/**
 * 代码片段库面板（v12）
 *
 * 列表 + 新建/编辑 + 变量填充。触发器（如 log）在输入框会被即时展开，
 * 也可以在命令面板搜索插入。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { makeSnippet, searchSnippets, snippetVars, validateTrigger, fillSnippet, type Snippet } from '../../shared/snippets'
import { loadSnippets, saveSnippets } from '../store/snippets'

export default function SnippetsPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [list, setList] = useState<Snippet[]>(loadSnippets)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    const on = () => setList(loadSnippets())
    window.addEventListener('snippets-updated', on)
    return () => window.removeEventListener('snippets-updated', on)
  }, [])

  const shown = useMemo(() => searchSnippets(list, q), [list, q])

  const persist = (next: Snippet[]) => { setList(next); saveSnippets(next) }

  const startNew = () => {
    setErr('')
    setEditing(makeSnippet('新片段', '', {}))
    setValues({})
  }

  const startEdit = (sn: Snippet) => {
    setErr('')
    setEditing({ ...sn })
    setValues({})
  }

  const save = () => {
    if (!editing) return
    const e = validateTrigger(editing.trigger || '', list, editing.id)
    if (e) { setErr(e); return }
    const exists = list.some((s) => s.id === editing.id)
    const next = exists
      ? list.map((s) => (s.id === editing.id ? { ...editing, updatedAt: Date.now() } : s))
      : [...list, { ...editing, createdAt: editing.createdAt || Date.now(), updatedAt: Date.now() }]
    persist(next)
    setEditing(null)
    setErr('')
  }

  const remove = (id: string) => {
    persist(list.filter((s) => s.id !== id))
    if (editing?.id === id) setEditing(null)
  }

  const insert = (sn: Snippet) => {
    const body = Object.keys(values).length ? fillSnippet(sn.body, values) : sn.body
    window.dispatchEvent(new CustomEvent('insert-into-input', { detail: body }))
    // 记录使用次数（用于排序）
    persist(list.map((s) => (s.id === sn.id ? { ...s, uses: (s.uses || 0) + 1 } : s)))
    onClose()
  }

  return (
    <div className="h-full flex min-h-0">
      {/* 列表 */}
      <div className="w-72 shrink-0 border-r flex flex-col min-h-0" style={{ borderColor: c.borderLight }}>
        <div className="p-2.5 border-b flex gap-1.5" style={{ borderColor: c.borderLight }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索片段…"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
            style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
          <button onClick={startNew}
            className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-white shrink-0"
            style={{ background: c.accent || '#10a37f' }}>新建</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-1.5">
          {shown.length === 0 && (
            <div className="px-2 py-8 text-center text-[11px] leading-relaxed" style={{ color: c.textTertiary }}>
              {list.length === 0 ? '还没有片段\n点「新建」存一段常用代码或命令' : '没有匹配的片段'}
            </div>
          )}
          {shown.map((sn) => (
            <button key={sn.id} onClick={() => startEdit(sn)}
              className="w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors"
              style={{ background: editing?.id === sn.id ? c.bgActive || c.bgInput : 'transparent' }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-medium truncate" style={{ color: c.textHead }}>{sn.name}</span>
                {sn.trigger && (
                  <span className="text-[9.5px] px-1 py-0.5 rounded font-mono shrink-0" style={{ background: c.bgInput, color: c.textTertiary }}>{sn.trigger}</span>
                )}
                <span className="flex-1" />
                {!!sn.uses && <span className="text-[9.5px] shrink-0" style={{ color: c.textTertiary }}>{sn.uses}×</span>}
              </div>
              {sn.description && <div className="text-[10.5px] truncate mt-0.5" style={{ color: c.textTertiary }}>{sn.description}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* 编辑区 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {!editing ? (
          <div className="flex-1 grid place-items-center px-8 text-center text-[12px] leading-relaxed" style={{ color: c.textTertiary }}>
            选一个片段编辑，或点「新建」<br />
            <span className="text-[11px]">在输入框里输入 <code className="px-1 rounded" style={{ background: c.bgInput }}>触发器 + 空格</code> 可直接展开</span>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: c.textTertiary }}>名称</label>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
                    style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: c.textTertiary }}>触发器（可选）</label>
                  <input value={editing.trigger || ''} onChange={(e) => setEditing({ ...editing, trigger: e.target.value })}
                    placeholder="log"
                    className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none font-mono"
                    style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: c.textTertiary }}>说明（可选）</label>
                <input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
                  style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: c.textTertiary }}>
                  内容（用 {'{{变量}}'} 占位）
                </label>
                <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  rows={10}
                  className="w-full px-2.5 py-2 rounded-lg text-[12px] outline-none resize-y font-mono leading-relaxed"
                  style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
              </div>

              {snippetVars(editing.body).length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium" style={{ color: c.textTertiary }}>变量</div>
                  {snippetVars(editing.body).map((v) => (
                    <input key={v} value={values[v] || ''} onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
                      placeholder={v}
                      className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none font-mono"
                      style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
                  ))}
                </div>
              )}

              {err && <div className="text-[11px] px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,.1)', color: '#b91c1c' }}>{err}</div>}
            </div>
            <div className="px-4 py-2.5 border-t flex items-center gap-2" style={{ borderColor: c.borderLight }}>
              <button onClick={() => remove(editing.id)}
                className="px-2.5 py-1.5 rounded-lg text-[11.5px]" style={{ color: '#ef4444' }}>删除</button>
              <span className="flex-1" />
              <button onClick={() => { setEditing(null); setErr('') }} className="px-3 py-1.5 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>取消</button>
              <button onClick={save} className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium"
                style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }}>保存</button>
              <button onClick={() => { save(); if (!err) insert(editing) }}
                className="px-3.5 py-1.5 rounded-lg text-[11.5px] font-medium text-white"
                style={{ background: c.accent || '#10a37f' }}>保存并插入</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
