/**
 * 角色长期记忆面板 —— 可查看 / 编辑 / 删除 / 一键清空。
 * 对应《拟人化办法》第十六条（交互数据复制/删除）与 PIPL 第四十七条（删除权）。
 */
import { useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import type { Persona, PersonaMemory } from '../../../shared/personas'
import { deleteMemory, purgeMemories, writeMemory } from '../../../shared/personaChat'

interface Props {
  persona: Persona
  memories: PersonaMemory[]
  onChange: (next: PersonaMemory[]) => void
}

export default function PersonaMemoryPanel({ persona, memories, onChange }: Props) {
  const { c } = useTheme()
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const handleAdd = async () => {
    const k = key.trim()
    if (!k || !value.trim()) return
    setBusy(true)
    const ok = await writeMemory(persona.id, k, value.trim())
    setBusy(false)
    if (ok) {
      onChange([{ key: k, value: value.trim(), updatedAt: '' }, ...memories.filter((m) => m.key !== k)])
      setKey(''); setValue(''); setAdding(false)
    }
  }

  const handleEdit = async (m: PersonaMemory, v: string) => {
    await writeMemory(persona.id, m.key, v)
    onChange(memories.map((x) => (x.key === m.key ? { ...x, value: v } : x)))
  }

  const handleDelete = async (m: PersonaMemory) => {
    await deleteMemory(persona.id, m.key)
    onChange(memories.filter((x) => x.key !== m.key))
  }

  const handlePurge = async () => {
    if (!confirm(`确定清空「${persona.name}」的全部长期记忆？\n此操作不可恢复。`)) return
    await purgeMemories(persona.id)
    onChange([])
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-5 py-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-semibold" style={{ color: c.textHead }}>长期记忆</h3>
          <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: c.textTertiary }}>
            角色会在对话中读到这些内容。仅保存在本机，可随时修改或删除。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {memories.length > 0 && (
            <button onClick={handlePurge} className="h-8 px-3 rounded-lg text-[11.5px]"
              style={{ border: `1px solid ${c.borderLight}`, color: c.toolErr }}>
              全部清空
            </button>
          )}
          <button onClick={() => setAdding(v => !v)} className="h-8 px-3 rounded-lg text-[11.5px] font-medium"
            style={{ background: c.textHead, color: c.bg }}>
            {adding ? '取消' : '添加记忆'}
          </button>
        </div>
      </div>

      {adding && (
        <div className="p-3 rounded-xl space-y-2" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="记忆名，如：作息 / 偏好 / 正在做的事"
            className="w-full px-3 h-9 rounded-lg text-[12.5px] outline-none"
            style={{ border: `1px solid ${c.borderLight}`, background: c.bg, color: c.text }} />
          <textarea value={value} onChange={e => setValue(e.target.value)} rows={3} placeholder="记忆内容"
            className="w-full px-3 py-2 rounded-lg text-[12.5px] outline-none resize-none"
            style={{ border: `1px solid ${c.borderLight}`, background: c.bg, color: c.text }} />
          <div className="flex justify-end">
            <button onClick={handleAdd} disabled={busy || !key.trim() || !value.trim()}
              className="px-4 h-8 rounded-lg text-[12px] font-medium disabled:opacity-30"
              style={{ background: c.textHead, color: c.bg }}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {memories.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[12.5px]" style={{ color: c.textMuted }}>还没有长期记忆</p>
          <p className="text-[11px] mt-1" style={{ color: c.textTertiary }}>记录角色的偏好与背景，回复会更有针对性</p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map(m => (
            <div key={m.key} className="p-3 rounded-xl group"
              style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[12px] font-medium" style={{ color: c.textHead }}>{m.key}</span>
                <div className="flex-1" />
                <button onClick={() => handleDelete(m)} className="text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: c.toolErr }}>删除</button>
              </div>
              <textarea defaultValue={m.value} rows={2} onBlur={e => { if (e.target.value !== m.value) handleEdit(m, e.target.value) }}
                className="w-full px-2.5 py-2 rounded-lg text-[12px] leading-relaxed outline-none resize-none"
                style={{ border: `1px solid ${c.borderLight}`, background: c.bg, color: c.textSecondary }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}