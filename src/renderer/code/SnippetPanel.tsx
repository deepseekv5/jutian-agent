// Code snippet library
import { useState, useCallback, useRef, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { Snippet } from '../types/code'

const STORAGE_KEY = 'lyclaw_code_snippets'

const DEFAULT_SNIPPETS: Snippet[] = [
  { id: 's_react_fc', name: 'React FC', language: 'tsx', code: `interface Props {\n  // props\n}\n\nconst Component: React.FC<Props> = ({ }) => {\n  return (\n    <div>\n      \n    </div>\n  )\n}\n\nexport default Component`, description: 'React function component template' },
  { id: 's_use_effect', name: 'useEffect', language: 'tsx', code: `useEffect(() => {\n  \n  return () => {\n    // cleanup\n  }\n}, [])`, description: 'useEffect hook template' },
  { id: 's_use_state', name: 'useState', language: 'tsx', code: `const [state, setState] = useState<Type>(initialValue)`, description: 'useState hook' },
  { id: 's_cl', name: 'console.log', language: 'ts', code: `console.log('', )`, description: 'Console log' },
  { id: 's_fetch', name: 'fetch API', language: 'ts', code: `try {\n  const res = await fetch('', {\n    method: 'GET',\n    headers: { 'Content-Type': 'application/json' },\n  })\n  if (!res.ok) throw new Error(\`HTTP \${res.status}\`)\n  const data = await res.json()\n} catch (err) {\n  console.error(err)\n}`, description: 'Fetch API request template' },
]

interface Props {
  onInsert: (code: string) => void
  onClose: () => void
}

export default function SnippetPanel({ onInsert, onClose }: Props) {
  const { c } = useTheme()
  const [snippets, setSnippets] = useState<Snippet[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : DEFAULT_SNIPPETS
    } catch { return DEFAULT_SNIPPETS }
  })
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLang, setEditLang] = useState('ts')
  const [editCode, setEditCode] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const save = useCallback((list: Snippet[]) => {
    setSnippets(list)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  }, [])

  const handleAdd = useCallback(() => {
    if (!editName.trim() || !editCode.trim()) return
    const s: Snippet = {
      id: 's_' + Date.now().toString(36),
      name: editName.trim(),
      language: editLang,
      code: editCode,
      description: editDesc || undefined,
    }
    save([...snippets, s])
    setShowAdd(false)
    setEditName(''); setEditLang('ts'); setEditCode(''); setEditDesc('')
  }, [editName, editLang, editCode, editDesc, snippets, save])

  const handleEdit = useCallback(() => {
    if (!editing || !editName.trim() || !editCode.trim()) return
    const updated = snippets.map(s => s.id === editing.id ? { ...s, name: editName.trim(), language: editLang, code: editCode, description: editDesc } : s)
    save(updated)
    setEditing(null)
    setEditName(''); setEditLang('ts'); setEditCode(''); setEditDesc('')
  }, [editing, editName, editLang, editCode, editDesc, snippets, save])

  const handleDelete = useCallback((id: string) => {
    save(snippets.filter(s => s.id !== id))
  }, [snippets, save])

  const filtered = search ? snippets.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || (s.description || '').toLowerCase().includes(search.toLowerCase())) : snippets

  const openEdit = useCallback((s: Snippet) => {
    setEditing(s)
    setEditName(s.name)
    setEditLang(s.language)
    setEditCode(s.code)
    setEditDesc(s.description || '')
  }, [])

  return (
    <div className="flex flex-col h-full glass">
      <div className="h-9 flex items-center px-3 border-b gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[11px] font-medium" style={{ color: c.textTertiary }}>Code snippet</span>
        <div className="flex-1" />
        <button onClick={() => { setShowAdd(true); setEditing(null); setEditName(''); setEditLang('ts'); setEditCode(''); setEditDesc('') }} className="w-5 h-5 rounded flex items-center justify-center btn-liquid"
          style={{ color: c.accent }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center btn-liquid"
          style={{ color: c.textMuted }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-2 shrink-0">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索代码片段..."
          className="w-full px-2 py-1 rounded text-[11px] border outline-none"
          style={{ background: c.bgInput, borderColor: c.borderLight, color: c.text }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {(showAdd || editing) && (
          <div className="p-2 border-b" style={{ borderColor: c.borderLight }}>
            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="名称" className="w-full px-2 py-1 rounded text-[11px] border mb-1.5 outline-none"
              style={{ background: c.bgInput, borderColor: c.borderLight, color: c.text }} />
            <div className="flex gap-1.5 mb-1.5">
              <input value={editLang} onChange={e => setEditLang(e.target.value)} placeholder="语言" className="flex-1 px-2 py-1 rounded text-[11px] border outline-none"
                style={{ background: c.bgInput, borderColor: c.borderLight, color: c.text }} />
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="描述" className="flex-[2] px-2 py-1 rounded text-[11px] border outline-none"
                style={{ background: c.bgInput, borderColor: c.borderLight, color: c.text }} />
            </div>
            <textarea value={editCode} onChange={e => setEditCode(e.target.value)} placeholder="代码内容" rows={4}
              className="w-full px-2 py-1 rounded text-[11px] font-mono border outline-none resize-none mb-1.5"
              style={{ background: c.bgInput, borderColor: c.borderLight, color: c.text }} />
            <div className="flex gap-1.5">
              <button onClick={editing ? handleEdit : handleAdd}
                className="px-3 py-1 rounded text-[10px] font-medium" style={{ background: c.accent, color: c.accentText }}>
                {editing ? '保存' : '添加'}
              </button>
              <button onClick={() => { setShowAdd(false); setEditing(null) }}
                className="px-3 py-1 rounded text-[10px]" style={{ color: c.textMuted }}>
                取消
              </button>
            </div>
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="text-center text-[11px] py-6" style={{ color: c.textMuted }}>无代码片段</div>
        ) : (
          filtered.map(s => (
            <div key={s.id} className="px-3 py-2 border-b cursor-pointer transition-colors"
              style={{ borderColor: c.borderLight }}
              onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium" style={{ color: c.text }}>{s.name}</div>
                  {s.description && <div className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>{s.description}</div>}
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button onClick={() => onInsert(s.code)} className="px-2 py-0.5 rounded text-[10px]"
                    style={{ background: c.accent, color: c.accentText }}>Insert</button>
                  <button onClick={() => openEdit(s)} className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{ color: c.textMuted }}>Edit</button>
                  <button onClick={() => handleDelete(s.id)} className="px-1 py-0.5 rounded text-[10px]"
                    style={{ color: c.toolErr }}>Del</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
