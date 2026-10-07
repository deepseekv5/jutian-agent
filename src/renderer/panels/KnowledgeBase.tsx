/**
 * 知识库（对标思源笔记，追求高级质感）：
 * 笔记本树 + 文档式 Markdown 编辑台（浮动格式工具条 + [[双向链接]]自动补全 + 精排预览）
 * + 反链面板 + 曲线发光关系图谱 + 文档向量索引。AI 可通过 save_knowledge 工具写入。
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTheme } from '../hooks/useTheme'
import { effectiveApiKey } from '../store/storage'
import PageShell from '../app/PageShell'
import type { KbEntry } from '../types/kb'

type Tab = 'notes' | 'graph' | 'index'

// 设计语言：克制的圆角、极淡描边、柔和阴影
const R = '10px'
const softShadow = '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)'

export default function KnowledgeBase({ onClose }: { onClose: () => void }) {
  const { c, theme } = useTheme()
  const [tab, setTab] = useState<Tab>('notes')
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [status, setStatus] = useState<{ chunks: number; files: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [e, st] = await Promise.all([
        fetch('/api/kb/entries').then(r => r.json()),
        fetch('/api/kb/status').then(r => r.json()),
      ])
      setEntries(Array.isArray(e?.entries) ? e.entries : [])
      if (!st?.error) setStatus({ chunks: st.chunks || 0, files: st.files || 0 })
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries])
  const selected = selectedId ? byId.get(selectedId) || null : null

  const removeEntry = async (id: string) => {
    if (!confirm('删除该笔记及其连线？')) return
    await fetch(`/api/kb/entry/${id}`, { method: 'DELETE' })
    if (selectedId === id) setSelectedId(null)
    refresh()
  }

  return (
    <PageShell
      onClose={onClose}
      title="知识库"
      fill={tab === 'notes'}
      description="像思源一样书写：笔记本分组、Markdown、[[双向链接]]、反链、关系图"
      icon="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      actions={
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: c.bgInput, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.02)' }}>
          {([['notes', '笔记'], ['graph', '图谱'], ['index', '索引']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200"
              style={tab === t
                ? { background: c.bgCard, color: c.textHead, boxShadow: softShadow }
                : { color: c.textTertiary }}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'notes' && (
        <NotesWorkspace
          entries={entries} byId={byId} selectedId={selectedId} selected={selected}
          onSelect={setSelectedId} onChanged={refresh} onRemove={removeEntry} theme={theme}
        />
      )}
      {tab === 'graph' && <GraphTab entries={entries} theme={theme} onSelect={(e) => { if (e) { setTab('notes'); setSelectedId(e.id) } }} />}
      {tab === 'index' && <IndexTab status={status} entries={entries} onChanged={refresh} />}
    </PageShell>
  )
}

// ───────────────────────── 笔记工作区（三栏，高级质感） ─────────────────────────
function NotesWorkspace({ entries, byId, selectedId, selected, onSelect, onChanged, onRemove, theme }: {
  entries: KbEntry[]; byId: Map<string, KbEntry>; selectedId: string | null; selected: KbEntry | null
  onSelect: (id: string | null) => void; onChanged: () => void; onRemove: (id: string) => void; theme: string
}) {
  const { c } = useTheme()
  const [query, setQuery] = useState('')
  const [notebook, setNotebook] = useState<string>('__all__')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [nb, setNb] = useState('')
  const [tagStr, setTagStr] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aiContinue, setAiContinue] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mention, setMention] = useState<{ open: boolean; q: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const dark = theme === 'dark'

  useEffect(() => {
    if (selected) { setTitle(selected.title); setContent(selected.content); setNb(selected.notebook || ''); setTagStr((selected.tags || []).join(', ')); setDirty(false); setPreview(true); setEditing(false) }
    else if (selectedId === null) { setTitle(''); setContent(''); setNb(notebook === '__all__' || notebook === '__none__' ? '' : notebook); setTagStr(''); setDirty(false); setPreview(false); setEditing(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const notebooks = useMemo(() => {
    const set = new Map<string, number>()
    for (const e of entries) { const k = e.notebook || ''; set.set(k, (set.get(k) || 0) + 1) }
    return [...set.entries()].sort((a, b) => b[1] - a[1])
  }, [entries])

  // 标签筛选（列表顶部标签云，选中后列表只显示含该标签的笔记）
  const [tagFilter, setTagFilter] = useState('')
  const allTags = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) for (const t of (e.tags || [])) m.set(t, (m.get(t) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [entries])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(e =>
      (notebook === '__all__' ? true : (e.notebook || '') === (notebook === '__none__' ? '' : notebook)) &&
      (!tagFilter || (e.tags || []).includes(tagFilter)) &&
      (!q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q))
    )
  }, [entries, query, notebook, tagFilter])

  const newNote = () => { onSelect(null); setPreview(false); setEditing(true); setTitle(''); setContent(''); setNb(notebook === '__all__' || notebook === '__none__' ? '' : notebook); setTagStr(''); setDirty(false); setTimeout(() => taRef.current?.focus(), 40) }

  // 每日笔记：存在「YYYY-MM-DD」标题则直接打开，否则在「日记」笔记本新建
  const todayNote = () => {
    const d = new Date()
    const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const exist = entries.find(e => e.title === t)
    if (exist) { onSelect(exist.id); return }
    onSelect(null); setPreview(false); setEditing(true); setTitle(t); setContent(''); setNb('日记'); setTagStr(''); setDirty(false)
    setTimeout(() => taRef.current?.focus(), 40)
  }

  // 笔记模板：按场景预填结构
  const TEMPLATES: { id: string; label: string; notebook: string; tags: string; content: string }[] = [
    { id: 'daily', label: '日记', notebook: '日记', tags: '日记', content: '## 今天做了什么\n\n\n## 收获与思考\n\n\n## 明日计划\n\n' },
    { id: 'meeting', label: '会议纪要', notebook: '工作', tags: '会议', content: '## 时间与参会人\n\n\n## 议题\n\n\n## 结论\n\n\n## 行动项\n- [ ] \n' },
    { id: 'reading', label: '读书笔记', notebook: '学习', tags: '读书', content: '## 书名 / 作者\n\n\n## 核心观点\n\n\n## 摘录\n\n\n## 我的想法\n\n' },
    { id: 'bug', label: '问题排查', notebook: '工作', tags: '排查', content: '## 现象\n\n\n## 根因\n\n\n## 解决方案\n\n\n## 预防\n\n' },
  ]
  const [templateOpen, setTemplateOpen] = useState(false)
  const newFromTemplate = (tpl: typeof TEMPLATES[number]) => {
    setTemplateOpen(false)
    onSelect(null); setPreview(false); setEditing(true)
    setTitle(''); setContent(tpl.content); setNb(tpl.notebook); setTagStr(tpl.tags); setDirty(true)
    setTimeout(() => taRef.current?.focus(), 40)
  }

  // 导出当前笔记为 Markdown 文件
  const exportNote = () => {
    const blob = new Blob([`# ${title || '未命名'}\n\n${content}`], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(title || '未命名').replace(/[\\/:*?"<>|]/g, '_')}.md`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const save = async () => {
    if (!title.trim() && !content.trim()) return
    setSaving(true)
    const body: any = {
      title: title.trim() || '未命名', content, notebook: nb.trim(),
      tags: tagStr.split(/[,，]/).map(t => t.trim()).filter(Boolean),
      pinned: selected?.pinned ? 1 : 0,
    }
    if (selectedId) body.id = selectedId
    await fetch('/api/kb/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false); setDirty(false); setPreview(true); setEditing(false)
    onChanged()
  }

  const togglePin = async () => {
    if (!selected) return
    await fetch('/api/kb/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, title: selected.title, content: selected.content, notebook: selected.notebook, tags: selected.tags, pinned: selected.pinned ? 0 : 1, source: selected.source }) })
    onChanged()
  }

  // 浮动工具条：包裹选区插入 Markdown
  const wrap = (before: string, after = before, placeholder = '文字') => {
    const ta = taRef.current; if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const sel = content.slice(s, e) || placeholder
    const next = content.slice(0, s) + before + sel + after + content.slice(e)
    setContent(next); setDirty(true); setEditing(true)
    requestAnimationFrame(() => { ta.focus(); const start = s + before.length; ta.setSelectionRange(start, start + sel.length) })
  }
  const linePrefix = (p: string) => {
    const ta = taRef.current; if (!ta) return
    const s = ta.selectionStart
    const lineStart = content.lastIndexOf('\n', s - 1) + 1
    const next = content.slice(0, lineStart) + p + content.slice(lineStart)
    setContent(next); setDirty(true); setEditing(true)
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + p.length, s + p.length) })
  }

  // [[ 自动补全
  const detectMention = () => {
    const ta = taRef.current; if (!ta) return
    const upto = ta.value.slice(0, ta.selectionStart)
    const open = upto.lastIndexOf('[['), close = upto.lastIndexOf(']]')
    if (open > close) { const q = upto.slice(open + 2); if (!q.includes('\n')) { setMention({ open: true, q }); return } }
    setMention(null)
  }
  const insertMention = (t: string) => {
    const ta = taRef.current; if (!ta) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos), after = ta.value.slice(pos)
    const open = before.lastIndexOf('[[')
    const rebuilt = before.slice(0, open) + `[[${t}]]`
    setContent(rebuilt + after); setMention(null); setDirty(true)
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(rebuilt.length, rebuilt.length) })
  }
  const mentionOptions = useMemo(() => {
    if (!mention?.open) return []
    const q = mention.q.toLowerCase()
    return entries.filter(e => e.id !== selectedId && (!q || e.title.toLowerCase().includes(q))).slice(0, 7)
  }, [mention, entries, selectedId])

  const backlinks = selected ? entries.filter(e => (e.links || []).includes(selected.id)) : []
  const outLinks = selected ? (selected.links || []).map(id => byId.get(id)).filter(Boolean) as KbEntry[] : []
  const words = content ? content.replace(/\s/g, '').length : 0

  const isDoc = (selected && !editing) || (!selectedId && !title && !content)

  return (
    <div className="flex-1 min-h-0 flex">
      {/* 左：笔记本树 + 列表 */}
      <div className="w-60 shrink-0 border-r flex flex-col glass" style={{ borderColor: dark ? '#26262b' : '#ececf0' }}>
        <div className="p-3">
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.textMuted }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索"
              className="w-full pl-8 pr-2 h-8 rounded-lg text-[12.5px] outline-none transition-shadow"
              style={{ background: dark ? '#1d1d21' : '#fff', color: c.text, border: `1px solid ${dark ? '#2a2a30' : '#e8e8ee'}` }} />
          </div>
          <button onClick={newNote}
            className="mt-2 w-full h-8 rounded-lg text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
            style={{ background: dark ? '#22c55e18' : '#e7f6ee', color: dark ? '#34d399' : '#0b6b4f', border: `1px solid ${dark ? '#22c55e30' : '#cfeadb'}` }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            新建笔记
          </button>
          <button onClick={todayNote}
            className="mt-1.5 w-full h-8 rounded-lg text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
            style={{ background: dark ? '#1d1d21' : '#fff', color: c.textSecondary, border: `1px solid ${dark ? '#2a2a30' : '#e8e8ee'}` }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            今日笔记
          </button>
          {/* 模板新建 */}
          <div className="relative mt-1.5">
            <button onClick={() => setTemplateOpen(v => !v)}
              className="w-full h-8 rounded-lg text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              style={{ background: dark ? '#1d1d21' : '#fff', color: c.textSecondary, border: `1px solid ${dark ? '#2a2a30' : '#e8e8ee'}` }}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              从模板新建
            </button>
            {templateOpen && (
              <div className="absolute left-0 right-0 top-9 z-30 rounded-lg py-1 shadow-lg animate-fade-in"
                style={{ background: dark ? '#1d1d22' : '#fff', border: `1px solid ${dark ? '#2e2e34' : '#e8e8ee'}` }}>
                {TEMPLATES.map(tpl => (
                  <button key={tpl.id} onClick={() => newFromTemplate(tpl)}
                    className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
                    style={{ color: c.text }} onMouseEnter={ev => ev.currentTarget.style.background = dark ? '#26262b' : '#f5f5f7'} onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                    {tpl.label}
                    <span className="ml-1.5 text-[10px]" style={{ color: c.textMuted }}>{tpl.notebook}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-2 pb-1 space-y-0.5">
          <div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: c.textMuted }}>笔记本</div>
          <NbRow active={notebook === '__all__'} icon="▦" label="全部" n={entries.length} onClick={() => setNotebook('__all__')} dark={dark} />
          {notebooks.filter(([k]) => k).map(([k, n]) => (
            <NbRow key={k} active={notebook === k} icon="◈" label={k} n={n} onClick={() => setNotebook(k)} dark={dark} />
          ))}
          {notebooks.some(([k]) => !k) && <NbRow active={notebook === '__none__'} icon="◇" label="未分类" n={notebooks.find(([k]) => !k)?.[1] || 0} onClick={() => setNotebook('__none__')} dark={dark} />}
        </div>
        {/* 标签筛选（选中标签后列表只显示含该标签的笔记） */}
        {allTags.length > 0 && (
          <div className="px-2 pb-2 flex flex-wrap gap-1">
            {allTags.map(([tag, n]) => (
              <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                className="px-1.5 py-0.5 rounded-full text-[10px] transition-colors"
                style={{
                  background: tagFilter === tag ? '#10b981' : (dark ? '#222228' : '#f2f2f5'),
                  color: tagFilter === tag ? '#fff' : c.textMuted,
                }}>
                {tag} {n}
              </button>
            ))}
          </div>
        )}
        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: c.textMuted }}>笔记 · {list.length}</div>
        <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-px">
          {list.map(e => (
            <button key={e.id} onClick={() => onSelect(e.id)}
              className="group relative w-full text-left pl-3 pr-2 py-2 rounded-lg transition-colors"
              style={{ background: e.id === selectedId ? (dark ? '#222228' : '#f0f1f3') : 'transparent' }}>
              {e.id === selectedId && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: '#22c55e' }} />}
              <div className="flex items-center gap-1.5">
                {e.pinned ? <PinGlyph /> : null}
                <span className="text-[13px] truncate flex-1 font-medium" style={{ color: c.textHead }}>{e.title}</span>
              </div>
              <div className="text-[11px] truncate mt-0.5 flex items-center gap-1" style={{ color: c.textMuted }}>
                {e.links?.length ? <span style={{ color: '#0f766e' }}>⤳ {e.links.length}</span> : null}
                <span className="truncate">{e.content.replace(/[#*>`[\]]/g, '').replace(/\s+/g, ' ').slice(0, 30) || '空白笔记'}</span>
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="text-center text-[11.5px] py-8" style={{ color: c.textMuted }}>暂无笔记</div>}
        </div>
      </div>

      {/* 中：文档式编辑台 */}
      <div className="flex-1 min-w-0 flex flex-col glass" style={{ borderColor: 'transparent' }}>
        {/* 面包屑 + 元操作 */}
        <div className="h-11 shrink-0 flex items-center gap-2 px-5 border-b" style={{ borderColor: dark ? '#242428' : '#eeeef2', color: c.textMuted }}>
          <span className="text-[11.5px]">{nb || '未分类'}</span>
          <span className="text-[10px]">/</span>
          <span className="text-[11.5px] truncate max-w-[40%]" style={{ color: c.textSecondary }}>{title || '未命名'}</span>
          <span className="flex-1" />
          {selected && <button onClick={togglePin} className="px-2 py-1 rounded-md text-[11px] transition-colors" style={{ color: selected.pinned ? '#b45309' : c.textMuted }}>{selected.pinned ? '已置顶' : '置顶'}</button>}
          {selected && (title || content) && (
            <>
              <button onClick={exportNote} className="px-2 py-1 rounded-md text-[11px] transition-colors" style={{ color: c.textMuted }} title="导出为 .md 文件">导出</button>
              <button onClick={() => {
                const w = window.open('', '_blank', 'width=860,height=920')
                if (!w) return
                w.document.write(`<html><head><title>${title || '未命名'}</title><style>
                  body{font-family:-apple-system,"PingFang SC",sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111;line-height:1.85}
                  h1{font-size:26px} h2{font-size:19px;margin:1.4em 0 .5em} pre{background:#f5f5f7;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
                  code{background:#f5f5f7;padding:1px 5px;border-radius:4px;font-size:13px} blockquote{border-left:3px solid #ddd;margin:0;padding-left:14px;color:#555}
                  @media print { body{margin:0} }
                </style></head><body><h1>${title || '未命名'}</h1><div id="b"></div><script>window.onload=()=>{}</script></body></html>`)
                w.document.close()
                // 简易 Markdown → HTML（标题/加粗/代码/引用/列表/段落）
                const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                const md = esc(content)
                  .replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`)
                  .replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
                  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>')
                  .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
                  .replace(/^- (.*)$/gm, '<li>$1</li>')
                  .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
                  .replace(/\n{2,}/g, '<br/><br/>')
                const b = w.document.getElementById('b')
                if (b) b.innerHTML = md
                setTimeout(() => w.print(), 350)
              }} className="px-2 py-1 rounded-md text-[11px] transition-colors" style={{ color: c.textMuted }} title="打印 / 存为 PDF">打印</button>
            </>
          )}
          <button onClick={() => { setPreview(v => !v); setEditing(preview) }}
            className="px-3 py-1 rounded-md text-[11.5px] font-medium transition-colors"
            style={{ background: preview ? (dark ? '#26262b' : '#f1f1f3') : 'transparent', color: c.textSecondary }}>
            {preview ? '编辑' : '预览'}
          </button>
        </div>

        {/* 浮动格式工具条（仅编辑态） */}
        {!preview && (
          <div className="flex items-center gap-1 px-5 py-2 border-b" style={{ borderColor: dark ? '#242428' : '#f2f2f5' }}>
            <FBtn title="加粗" onClick={() => wrap('**')}><b>B</b></FBtn>
            <FBtn title="斜体" onClick={() => wrap('*')}><i>I</i></FBtn>
            <FBtn title="删除线" onClick={() => wrap('~~')}><s>S</s></FBtn>
            <span className="mx-1 h-4 w-px" style={{ background: dark ? '#333' : '#e5e5e5' }} />
            <FBtn title="一级标题" onClick={() => linePrefix('# ')}>H1</FBtn>
            <FBtn title="二级标题" onClick={() => linePrefix('## ')}>H2</FBtn>
            <FBtn title="引用" onClick={() => linePrefix('> ')}><span style={{ fontStyle: 'italic', fontFamily: 'serif' }}>❝</span></FBtn>
            <FBtn title="列表" onClick={() => linePrefix('- ')}>•≡</FBtn>
            <FBtn title="代码块" onClick={() => wrap('\n```\n', '\n```\n', 'code')}>{'</>'}</FBtn>
            <span className="mx-1 h-4 w-px" style={{ background: dark ? '#333' : '#e5e5e5' }} />
            {/* AI 续写：把当前内容交给模型接着写，插入文末 */}
            <FBtn title="AI 续写" onClick={async () => {
              if (aiContinue) return
              setAiContinue(true)
              try {
                const s = await fetch('/api/settings').then(r => r.json()).catch(() => null)
                const res = await fetch('/api/llm-proxy', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Target-Base': s?.apiBaseUrl || '', 'X-Api-Key': effectiveApiKey(s?.apiKey) },
                  body: JSON.stringify({
                    model: s?.model || '',
                    messages: [
                      { role: 'system', content: '你是笔记续写助手。基于用户笔记的已有内容自然地接着写（保持原文风格与语言），补充有价值的内容、完善未完成的部分。直接输出续写正文，不要重复已有内容，不要客套。' },
                      { role: 'user', content: (title ? `【标题】${title}\n\n` : '') + (content || '（空笔记，请根据标题写一个开头）') },
                    ],
                    max_tokens: 12000,
                    stream: false,
                  }),
                })
                const data = await res.json()
                let out = String(data?.choices?.[0]?.message?.content || '')
                if (!out && data?.choices?.[0]?.message?.reasoning_content) out = String(data.choices[0].message.reasoning_content)
                if (out) {
                  setContent(prev => (prev ? prev.replace(/\s+$/, '') + '\n\n' : '') + out.trim())
                  setDirty(true); setEditing(true)
                } else { alert('续写失败：模型未返回内容') }
              } catch { alert('续写失败：请求出错') }
              setAiContinue(false)
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: aiContinue ? '#b45309' : undefined }}>{aiContinue ? '…' : 'AI'}</span>
            </FBtn>
            <span className="mx-1 h-4 w-px" style={{ background: dark ? '#333' : '#e5e5e5' }} />
            <FBtn title="双向链接 [[…]]" onClick={() => wrap('[[', ']]', '标题')}><LinkGlyph /></FBtn>
          </div>
        )}

        {/* 文档主体 */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          {preview ? (
            <div key={selectedId ?? 'new'} className="h-full overflow-y-auto animate-fade-in" style={{ paddingTop: 8 }}>
              <div className="max-w-[720px] mx-auto px-8 pt-8 pb-16 kb-doc">
                <h1 className="text-[30px] font-bold tracking-tight leading-tight mb-1" style={{ color: c.textHead }}>{title || '未命名'}</h1>
                <div className="flex flex-wrap items-center gap-2 mb-6 text-[11px]" style={{ color: c.textMuted }}>
                  {(selected?.tags || tagStr.split(/[,，]/).map(t => t.trim()).filter(Boolean)).map((t: string) => (
                    <span key={t} className="px-2 py-0.5 rounded-full" style={{ background: dark ? '#222228' : '#f2f2f5' }}>{t}</span>
                  ))}
                  <span>{words} 字</span>
                </div>
                <WikiMarkdown content={content} onLink={(t) => { const hit = [...byId.values()].find(e => e.title === t); if (hit) onSelect(hit.id) }} />
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="max-w-[720px] mx-auto px-8 pt-6 pb-16">
                <input value={title} onChange={e => { setTitle(e.target.value); setDirty(true) }} placeholder="未命名"
                  className="w-full bg-transparent text-[30px] font-bold tracking-tight outline-none mb-4" style={{ color: c.textHead }} />
                <textarea ref={taRef} value={content} spellCheck={false}
                  onChange={e => { setContent(e.target.value); setDirty(true) }}
                  onKeyUp={detectMention} onClick={detectMention}
                  placeholder={"开始书写… 输入 [[ 可关联其它笔记。Markdown 支持标题、列表、代码、引用、表格。"}
                  className="w-full resize-none outline-none leading-[1.85]"
                  style={{ background: 'transparent', color: c.text, fontSize: 15.5, minHeight: 360, fontFamily: 'ui-sans-serif, -apple-system, "PingFang SC"' }} />
              </div>
            </div>
          )}

          {mention?.open && mentionOptions.length > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[380px] max-w-[90%] rounded-2xl overflow-hidden z-30 animate-fade-in"
              style={{ background: dark ? '#1d1d22' : '#fff', border: `1px solid ${dark ? '#2e2e34' : '#e8e8ee'}`, boxShadow: '0 12px 40px rgba(0,0,0,0.22)' }}>
              <div className="px-4 py-2 text-[10.5px] uppercase tracking-wider" style={{ color: c.textMuted }}>关联笔记</div>
              {mentionOptions.map(o => (
                <button key={o.id} onMouseDown={ev => { ev.preventDefault(); insertMention(o.title) }}
                  className="w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2 transition-colors"
                  style={{ color: c.text }} onMouseEnter={ev => ev.currentTarget.style.background = dark ? '#26262b' : '#f5f5f7'} onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                  <LinkGlyph />{o.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底栏：删除 / 状态 / 保存 */}
        <div className="h-12 shrink-0 flex items-center gap-3 px-5 border-t" style={{ borderColor: dark ? '#242428' : '#eeeef2' }}>
          {selected && <button onClick={() => onRemove(selected.id)} className="text-[12px] transition-opacity hover:opacity-70" style={{ color: c.toolErr }}>删除</button>}
          {isDoc && selectedId && <span className="text-[11px]" style={{ color: c.textMuted }}>{(selected?.backlinkCount ?? backlinks.length)} 条反链 · {outLinks.length} 条出链</span>}
          <span className="text-[11px]" style={{ color: dirty ? '#d97706' : c.textMuted }}>{!title && !content ? '新笔记' : dirty ? '● 未保存' : '已保存'}</span>
          <button onClick={save} disabled={(!title.trim() && !content.trim()) || saving}
            className="ml-auto px-5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: '#10b981', color: '#fff', boxShadow: softShadow }}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* 右：反链 / 出链 */}
      {selected && (
        <div className="w-60 shrink-0 border-l p-4 overflow-y-auto glass" style={{ borderColor: dark ? '#26262b' : '#ececf0' }}>
          <button onClick={() => { navigator.clipboard.writeText(`[[${selected.title}]]`).catch(() => {}) }}
            className="w-full h-7 mb-2 rounded-md text-[11px] flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: dark ? '#1d1d21' : '#fff', color: '#0f766e', border: `1px solid ${dark ? '#2a2a30' : '#e0ece9'}` }}
            title="复制 [[本文标题]] 双链，可粘贴到其它笔记">
            <LinkGlyph /> 复制本文双链
          </button>
          <Section title={`反向链接 ${backlinks.length}`}>
            {backlinks.length === 0 ? <Muted>没有任何笔记链接到这里</Muted> : backlinks.map(b => (
              <LinkChip key={b.id} onClick={() => onSelect(b.id)} color={dark ? '#34d399' : '#0b6b4f'}>{b.title}</LinkChip>
            ))}
          </Section>
          <Section title={`链接到 ${outLinks.length}`}>
            {outLinks.length === 0 ? <Muted>本文没有引用其它笔记</Muted> : outLinks.map(o => (
              <LinkChip key={o.id} onClick={() => onSelect(o.id)} color="#0f766e">{o.title}</LinkChip>
            ))}
          </Section>
          <div className="mt-4 text-[10.5px] font-mono" style={{ color: c.textMuted }}>更新 {selected.updated_at?.slice(5, 16).replace('T', ' ')}</div>
        </div>
      )}

      <style>{`
        @keyframes kb-fade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .animate-fade-in { animation: kb-fade .28s ease }
        .kb-doc h1,.kb-doc h2,.kb-doc h3 { color:${c.textHead}; font-weight:700; line-height:1.3; margin:1.2em 0 .5em }
        .kb-doc h1{font-size:24px}.kb-doc h2{font-size:19px}.kb-doc h3{font-size:16px}
        .kb-doc p { margin:.7em 0; color:${c.text}; line-height:1.85 }
        .kb-doc ul,.kb-doc ol{ margin:.6em 0; padding-left:1.3em } .kb-doc li{ margin:.25em 0; line-height:1.8 }
        .kb-doc blockquote{ border-left:3px solid #22c55e; margin:.9em 0; padding:.2em 0 .2em 1em; color:${c.textSecondary}; font-style:italic }
        .kb-doc code{ background:${dark?'#222228':'#f2f2f5'}; padding:.15em .4em; border-radius:5px; font-size:.9em }
        .kb-doc pre{ background:${dark?'#1b1b1f':'#f7f7f9'}; border:1px solid ${dark?'#2a2a30':'#ececf0'}; border-radius:${R}; padding:14px 16px; overflow:auto; margin:1em 0 }
        .kb-doc pre code{ background:none;padding:0 }
        .kb-doc a{ color:#0f766e } .kb-doc table{ border-collapse:collapse; margin:1em 0; width:100% } .kb-doc th,.kb-doc td{ border:1px solid ${dark?'#2a2a30':'#e8e8ee'}; padding:7px 10px; font-size:13.5px } .kb-doc th{ background:${dark?'#222228':'#f7f7f9'} }
      `}</style>
    </div>
  )
}

function NbRow({ active, icon, label, n, onClick, dark }: { active: boolean; icon: string; label: string; n: number; onClick: () => void; dark: boolean }) {
  const { c } = useTheme()
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors"
      style={{ background: active ? (dark ? '#222228' : '#ececef') : 'transparent', color: active ? c.textHead : c.textSecondary }}>
      <span style={{ color: active ? '#22c55e' : c.textMuted }}>{icon}</span>
      <span className="truncate flex-1 text-left">{label}</span>
      <span className="text-[10px] font-mono px-1.5 rounded-full" style={{ background: dark ? '#26262b' : '#eef0f2', color: c.textMuted }}>{n}</span>
    </button>
  )
}

function FBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  const { c, theme } = useTheme()
  return (
    <button title={title} onClick={onClick}
      className="w-7 h-7 rounded-md flex items-center justify-center text-[12px] font-semibold transition-colors"
      style={{ color: c.textSecondary }}
      onMouseEnter={e => e.currentTarget.style.background = theme === 'dark' ? '#26262b' : '#f1f1f3'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <div className="mb-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: c.textMuted }}>{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
function LinkChip({ children, onClick, color }: { children: React.ReactNode; onClick: () => void; color: string }) {
  const { theme } = useTheme()
  return (
    <button onClick={onClick} className="block w-full text-left text-[12.5px] px-2.5 py-1.5 rounded-lg truncate transition-colors"
      style={{ color, background: theme === 'dark' ? '#1d1d22' : '#f5f5f7' }}
      onMouseEnter={e => e.currentTarget.style.background = theme === 'dark' ? '#26262b' : '#ececef'}
      onMouseLeave={e => e.currentTarget.style.background = theme === 'dark' ? '#1d1d22' : '#f5f5f7'}>
      {children}
    </button>
  )
}
function Muted({ children }: { children: React.ReactNode }) { const { c } = useTheme(); return <div className="text-[11px] pl-1" style={{ color: c.textMuted }}>{children}</div> }

// [[双向链接]] 渲染为可点击 wiki 链接
function WikiMarkdown({ content, onLink }: { content: string; onLink: (title: string) => void }) {
  const processed = content.replace(/\[\[([^\]]+)\]\]/g, function (_m, tt) {
    const label = String(tt).trim()
    return '[' + label + '](wiki:' + encodeURIComponent(label) + ')'
  })
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith('wiki:')) {
            const t = decodeURIComponent(href.slice(5))
            return <a href="#" onClick={(e) => { e.preventDefault(); onLink(t) }} style={{ color: '#0f766e', textDecoration: 'none', borderBottom: '1px solid #0f766e66', cursor: 'pointer' }}>{children}</a>
          }
          return <a href={href} target="_blank" rel="noreferrer" style={{ color: '#0f766e' }}>{children}</a>
        },
      }}
    >{processed}</ReactMarkdown>
  )
}

// ───────────────────────── 索引 tab ─────────────────────────
function IndexTab({ status, entries, onChanged }: { status: { chunks: number; files: number } | null; entries: KbEntry[]; onChanged: () => void }) {
  const { c, theme } = useTheme()
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [reIndexing, setReIndexing] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const dark = theme === 'dark'
  const ingest = async () => {
    if (!folder || busy) return
    setBusy(true); setError(''); setMsg('正在读取文件并生成向量索引…')
    try {
      const r = await fetch('/api/kb/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) })
      const d = await r.json()
      if (d.error) setError(`索引失败：${d.error}`); else { setMsg(`索引完成：${d.files} 个文件，${d.chunks} 个片段`); onChanged() }
    } catch (e: any) { setError(`索引失败：${e?.message}`) } finally { setBusy(false) }
  }
  const card = (label: string, value: React.ReactNode) => (
    <div className="p-5 rounded-2xl" style={{ background: dark ? '#1d1d22' : '#fff', border: `1px solid ${dark ? '#26262b' : '#ececf0'}`, boxShadow: softShadow }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: c.textMuted }}>{label}</div>
      <div className="text-[30px] font-semibold mt-1 font-mono tracking-tight" style={{ color: c.textHead }}>{value}</div>
    </div>
  )
  return (
    <div className="max-w-2xl">
      <div className="grid grid-cols-2 gap-4 mb-6">{card('已索引片段', status?.chunks ?? '—')}{card('笔记总数', entries.length)}</div>
      <div className="p-5 rounded-2xl" style={{ background: dark ? '#1d1d22' : '#fff', border: `1px solid ${dark ? '#26262b' : '#ececf0'}`, boxShadow: softShadow }}>
        <div className="text-[14px] font-semibold mb-1" style={{ color: c.textHead }}>索引范围</div>
        <p className="text-[11px] mb-3" style={{ color: c.textMuted }}>每篇笔记都会**全文切块**自动索引（不只是开头）。下方可重建全部，或额外索引外部文件夹。</p>
        <button onClick={async () => { setReIndexing(true); setError(''); setMsg('正在重建全部笔记索引…'); try { const r = await fetch('/api/kb/reindex', { method: 'POST' }); const d = await r.json(); if (d.error) setError(d.error); else { setMsg(`已重建：${d.notes} 篇笔记 · ${d.chunks} 个片段`); onChanged() } } catch (e: any) { setError(e.message) } finally { setReIndexing(false) } }}
          disabled={reIndexing} className="w-full mb-4 py-2.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-40" style={{ background: '#10b981', color: '#fff' }}>
          {reIndexing ? '重建中…' : '重建全部笔记索引'}
        </button>
        <div className="text-[13px] font-semibold mb-3 pt-1" style={{ color: c.textHead }}>（可选）索引外部文件夹</div>
        <div className="flex items-center gap-2 mb-2">
          <input value={folder} onChange={e => setFolder(e.target.value)} placeholder="选择或输入文件夹路径…"
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-mono outline-none" style={{ background: dark ? '#17171a' : '#fafafa', color: c.text, border: `1px solid ${dark ? '#2a2a30' : '#e8e8ee'}` }} />
          <button onClick={async () => { const api = (window as any).electronAPI; if (!api?.openFolderDialog) return; const dirs = await api.openFolderDialog(); if (dirs?.length) setFolder(dirs[0]) }}
            className="px-3 py-2 rounded-lg text-[12px] font-medium shrink-0" style={{ background: dark ? '#26262b' : '#f1f1f3', color: c.textSecondary }}>选择…</button>
          <button onClick={ingest} disabled={!folder.trim() || busy} className="px-4 py-2 rounded-lg text-[12px] font-semibold shrink-0 disabled:opacity-40" style={{ background: '#10b981', color: '#fff' }}>{busy ? '索引中…' : '开始索引'}</button>
        </div>
        {msg && <p className="text-[11.5px]" style={{ color: c.toolOk }}>{msg}</p>}
        {error && <p className="text-[11.5px]" style={{ color: c.toolErr }}>{error}</p>}
        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: c.textMuted }}>索引为向量片段后，对话会自动检索引用（RAG）。笔记内容也会同步进入索引。</p>
      </div>
    </div>
  )
}

// ───────────────────────── 图谱 tab ─────────────────────────
function GraphTab({ entries, theme, onSelect, focusTitle }: { entries: KbEntry[]; theme: string; onSelect: (e: KbEntry | null) => void; focusTitle?: string }) {
  const { c } = useTheme()
  // 按笔记本过滤图谱节点（__all__ = 全部）
  const [nbFilter, setNbFilter] = useState('__all__')
  const notebooks = useMemo(() => [...new Set(entries.map(e => e.notebook || ''))].filter(Boolean), [entries])
  const filtered = useMemo(() =>
    nbFilter === '__all__' ? entries : entries.filter(e => (e.notebook || '') === nbFilter)
  , [entries, nbFilter])
  if (entries.length === 0) return (
    <div className="rounded-2xl p-12 text-center text-[13px]" style={{ border: `1px dashed ${c.border}`, color: c.textMuted }}>
      还没有笔记。在「笔记」中新建，或在对话里让 AI「记到知识库」，条目会自动连线成图。
    </div>
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px]" style={{ color: c.textMuted }}>笔记本</span>
        <select value={nbFilter} onChange={e => setNbFilter(e.target.value)}
          className="h-7 px-2 rounded-lg text-[12px] outline-none cursor-pointer"
          style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }}>
          <option value="__all__">全部（{entries.length}）</option>
          {notebooks.map(k => (
            <option key={k} value={k}>{k}（{entries.filter(e => (e.notebook || '') === k).length}）</option>
          ))}
        </select>
        {/* 节点搜索定位：输入标题回车 → 通知图谱居中该节点 */}
        <GraphLocator entries={filtered} onSelect={onSelect} />
        {focusTitle && <span className="text-[10.5px]" style={{ color: c.textMuted }}>当前：{focusTitle}</span>}
      </div>
      <KnowledgeGraph entries={filtered} theme={theme} onSelect={onSelect} />
    </div>
  )
}

// 图谱节点定位：下拉选笔记 → 把视图平移到该节点
function GraphLocator({ entries, onSelect }: { entries: KbEntry[]; onSelect: (e: KbEntry | null) => void }) {
  const { c } = useTheme()
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return entries.filter(e => e.title.toLowerCase().includes(query)).slice(0, 6)
  }, [q, entries])
  return (
    <div className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="定位节点…"
        className="h-7 pl-2 pr-2 rounded-lg text-[12px] outline-none w-40"
        style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }} />
      {hits.length > 0 && (
        <div className="absolute left-0 top-8 z-30 rounded-lg py-1 shadow-lg w-56 animate-fade-in glass-strong"
          style={{ border: `1px solid ${c.border}` }}>
          {hits.map(h => (
            <button key={h.id} onClick={() => {
              onSelect(null)
              window.dispatchEvent(new CustomEvent('kb-graph-focus', { detail: h.id }))
              setQ('')
            }}
              className="w-full text-left px-3 py-1.5 text-[12px] truncate transition-colors"
              style={{ color: c.text }} onMouseEnter={ev => ev.currentTarget.style.background = c.bgHover} onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
              {h.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface GNode { id: string; title: string; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number; source: string; deg: number }

function KnowledgeGraph({ entries, theme, onSelect }: { entries: KbEntry[]; theme: string; onSelect: (e: KbEntry | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef<GNode[]>([])
  const edgesRef = useRef<[number, number][]>([])
  const dragRef = useRef<{ i: number; moved: boolean } | null>(null)
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const [zoomLabel, setZoomLabel] = useState(100)
  const settledRef = useRef(0)
  const hoverRef = useRef<number>(-1)
  const rafRef = useRef<number | null>(null)

  useMemo(() => {
    settledRef.current = 0
    const idx = new Map(entries.map((e, i) => [e.id, i]))
    const deg: number[] = entries.map(() => 0)
    const edges: [number, number][] = []
    for (let i = 0; i < entries.length; i++) for (const lid of entries[i].links) {
      const j = idx.get(lid)
      if (j !== undefined && j !== i) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (!edges.some(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`) === key)) { edges.push([i, j]); deg[i]++; deg[j]++ }
      }
    }
    edgesRef.current = edges
    const byId = new Map(nodesRef.current.map(n => [n.id, n]))
    nodesRef.current = entries.map((e, i) => {
      const old = byId.get(e.id)
      if (old) { old.title = e.title; old.source = e.source; old.deg = deg[i]; return old }
      const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 120
      return { id: e.id, title: e.title, source: e.source, deg: deg[i], x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 }
    })
  }, [entries])

  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current
    if (!cv || !wrap) return
    const fit = () => { cv.width = wrap.clientWidth * 2; cv.height = wrap.clientHeight * 2; cv.style.width = `${wrap.clientWidth}px`; cv.style.height = `${wrap.clientHeight}px` }
    fit(); window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit); if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const DARK = theme === 'dark'
  const bgCol = DARK ? '#101014' : '#fbfbfd'
  const lineCol = DARK ? 'rgba(130,150,180,0.32)' : 'rgba(100,120,150,0.28)'
  const hlCol = '#34d399', aiCol = DARK ? '#f59e0b' : '#b45309', userCol = DARK ? '#34d399' : '#059669'
  const textCol = DARK ? 'rgba(255,255,255,0.88)' : 'rgba(18,22,30,0.88)'

  // 节点定位：把指定 id 的节点平移到视图中心
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent).detail as string
      const n = nodesRef.current.find(x => x.id === id)
      if (!n) return
      const v = viewRef.current
      v.tx = -n.x; v.ty = -n.y
      settledRef.current = 0
    }
    window.addEventListener('kb-graph-focus', h)
    return () => window.removeEventListener('kb-graph-focus', h)
  }, [])

  useEffect(() => {
    const cv = canvasRef.current; const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      if (document.hidden) return
      const nodes = nodesRef.current, edges = edgesRef.current
      const W = cv.width, H = cv.height
      let energy = 0; for (const n of nodes) energy += n.vx * n.vx + n.vy * n.vy
      const physics = dragRef.current !== null || hoverRef.current >= 0 || energy > 0.05 || nodes.length <= 1
      if (!physics) { settledRef.current++; if (settledRef.current > 90) return } else settledRef.current = 0
      for (let iter = 0; iter < 2; iter++) {
        for (let i = 0; i < nodes.length; i++) { const a = nodes[i]; if (a.fx !== undefined) continue
          for (let j = i + 1; j < nodes.length; j++) { const b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
            const d = Math.sqrt(d2), f = 3200 / d2; a.vx += (dx / d) * f; a.vy += (dy / d) * f
            if (b.fx === undefined) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f } } }
        for (const [i, j] of edges) { const a = nodes[i], b = nodes[j]; if (!a || !b) continue
          const dx = b.x - a.x, dy = b.y - a.y; const d = Math.max(1, Math.sqrt(dx * dx + dy * dy)); const f = (d - 180) * 0.02
          a.vx += (dx / d) * f; a.vy += (dy / d) * f; if (b.fx === undefined) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f } }
        for (const n of nodes) { if (n.fx !== undefined && n.fy !== undefined) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue }
          n.vx -= n.x * 0.0014; n.vy -= n.y * 0.0014; n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy } }
      // 绘制
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = bgCol; ctx.fillRect(0, 0, W, H)
      // 网格背景（随平移缩放移动，增强空间感）
      {
        const v = viewRef.current
        ctx.strokeStyle = DARK ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.035)'; ctx.lineWidth = 1
        const offX = ((W / 2 + v.tx * 2) % 40 + 40) % 40, offY = ((H / 2 + v.ty * 2) % 40 + 40) % 40
        for (let gx = offX; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
        for (let gy = offY; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }
      }
      {
        const v = viewRef.current
        ctx.setTransform(2 * v.scale, 0, 0, 2 * v.scale, W / 2 + v.tx * 2, H / 2 + v.ty * 2)
      }
      const hover = hoverRef.current; const adj = new Set<number>()
      if (hover >= 0) for (const [i, j] of edges) { if (i === hover) adj.add(j); if (j === hover) adj.add(i) }
      // 曲线发光边
      for (const [i, j] of edges) { const a = nodes[i], b = nodes[j]; if (!a || !b) continue
        const lit = hover === i || hover === j
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const dx = b.x - a.x, dy = b.y - a.y; const cx = mx - dy * 0.12, cy = my + dx * 0.12
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y)
        if (lit) { ctx.strokeStyle = hlCol; ctx.shadowColor = hlCol; ctx.shadowBlur = 8; ctx.lineWidth = 1.8 }
        else { ctx.strokeStyle = lineCol; ctx.shadowBlur = 0; ctx.lineWidth = 1 }
        ctx.stroke(); ctx.shadowBlur = 0 }
      // 节点（外环 + 实心 + 高光）
      for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; const isHover = i === hover; const dimmed = hover >= 0 && !isHover && !adj.has(i)
        const base = n.source === 'ai' ? aiCol : userCol
        const r = 6 + Math.min(9, n.deg * 1.8) + (isHover ? 3 : 0)
        ctx.globalAlpha = dimmed ? 0.32 : 1
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2); ctx.strokeStyle = base; ctx.globalAlpha *= dimmed ? 0.3 : 0.25; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = dimmed ? 0.32 : 1
        const g = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, r * 0.2, n.x, n.y, r)
        g.addColorStop(0, isHover ? '#fff' : base); g.addColorStop(1, base)
        ctx.beginPath(); ctx.fillStyle = g as any; ctx.shadowColor = base; ctx.shadowBlur = isHover ? 22 : 10; ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
        if (!dimmed) { ctx.fillStyle = textCol; ctx.font = `${isHover ? '700 ' : ''}11px -apple-system, "PingFang SC", sans-serif`
          ctx.shadowColor = DARK ? '#000' : '#fff'; ctx.shadowBlur = 4
          ctx.fillText(n.title.length > 14 ? n.title.slice(0, 14) + '…' : n.title, n.x + r + 6, n.y + 4); ctx.shadowBlur = 0 }
        ctx.globalAlpha = 1 }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    tick()
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [bgCol, lineCol, textCol])

  // 屏幕 → 图谱世界坐标（含缩放/平移）
  const toWorld = useCallback((clientX: number, clientY: number): [number, number] => {
    const cv = canvasRef.current; if (!cv) return [0, 0]
    const rect = cv.getBoundingClientRect()
    const v = viewRef.current
    return [((clientX - rect.left) * 2 - cv.width / 2 - v.tx * 2) / (2 * v.scale), ((clientY - rect.top) * 2 - cv.height / 2 - v.ty * 2) / (2 * v.scale)]
  }, [])

  const pick = useCallback((e: React.MouseEvent): number => {
    const [x, y] = toWorld(e.clientX, e.clientY)
    let best = -1, bestD = 1000
    nodesRef.current.forEach((n, i) => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bestD) { bestD = d; best = i } })
    return best
  }, [toWorld])

  return (
    <div ref={wrapRef} className="relative rounded-2xl overflow-hidden" style={{ height: 520, border: `1px solid ${DARK ? '#26262b' : '#ececf0'}`, boxShadow: softShadow }}>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ cursor: panRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={e => { const i = pick(e); if (i >= 0) { dragRef.current = { i, moved: false }; nodesRef.current[i].fx = nodesRef.current[i].x; nodesRef.current[i].fy = nodesRef.current[i].y } else { panRef.current = { x: e.clientX, y: e.clientY } } }}
        onMouseMove={e => { hoverRef.current = pick(e); if (dragRef.current) { dragRef.current.moved = true; const [x, y] = toWorld(e.clientX, e.clientY); nodesRef.current[dragRef.current.i].fx = x; nodesRef.current[dragRef.current.i].fy = y } else if (panRef.current) { const v = viewRef.current; v.tx += (e.clientX - panRef.current.x); v.ty += (e.clientY - panRef.current.y); panRef.current = { x: e.clientX, y: e.clientY }; settledRef.current = 0 } }}
        onMouseUp={e => { if (dragRef.current && !dragRef.current.moved) { const i = pick(e); if (i >= 0) onSelect(entries[i]) } if (dragRef.current) { const n = nodesRef.current[dragRef.current.i]; if (n) { n.fx = undefined; n.fy = undefined } } dragRef.current = null; panRef.current = null }}
        onMouseLeave={() => { hoverRef.current = -1; dragRef.current = null; panRef.current = null }}
        onWheel={e => { e.preventDefault(); const v = viewRef.current; const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12; v.scale = Math.min(3, Math.max(0.3, v.scale * factor)); setZoomLabel(Math.round(v.scale * 100)); settledRef.current = 0 }}
        onDoubleClick={() => { viewRef.current = { scale: 1, tx: 0, ty: 0 }; setZoomLabel(100); settledRef.current = 0 }} />
      <div className="absolute top-3 left-4 flex items-center gap-3 text-[10.5px]" style={{ color: DARK ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }}>
        <span><i style={{ color: userCol }}>●</i> 手动</span><span><i style={{ color: aiCol }}>●</i> AI 沉淀</span>
      </div>
      <div className="absolute top-2.5 right-3 flex items-center gap-1 rounded-lg px-1 py-0.5" style={{ background: DARK ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
        <button onClick={() => { const v = viewRef.current; v.scale = Math.max(0.3, v.scale / 1.2); setZoomLabel(Math.round(v.scale * 100)); settledRef.current = 0 }}
          className="w-5 h-5 flex items-center justify-center text-[13px]" style={{ color: DARK ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }} title="缩小">−</button>
        <span className="text-[10px] font-mono w-9 text-center" style={{ color: DARK ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)' }}>{zoomLabel}%</span>
        <button onClick={() => { const v = viewRef.current; v.scale = Math.min(3, v.scale * 1.2); setZoomLabel(Math.round(v.scale * 100)); settledRef.current = 0 }}
          className="w-5 h-5 flex items-center justify-center text-[13px]" style={{ color: DARK ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }} title="放大">＋</button>
        <button onClick={() => { viewRef.current = { scale: 1, tx: 0, ty: 0 }; setZoomLabel(100); settledRef.current = 0 }}
          className="w-5 h-5 flex items-center justify-center text-[10px]" style={{ color: DARK ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }} title="复位视图">⌂</button>
      </div>
      <div className="absolute bottom-3 left-4 text-[10.5px]" style={{ color: DARK ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>拖拽节点 · 空白拖拽平移 · 滚轮缩放 · 双击复位 · 点击打开笔记</div>
    </div>
  )
}

function LinkGlyph() {
  const { c } = useTheme()
  return (
    <svg className="w-3.5 h-3.5" style={{ color: '#0f766e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
    </svg>
  )
}
function PinGlyph() {
  const { c } = useTheme()
  return (
    <svg className="w-3 h-3 shrink-0" style={{ color: '#b45309' }} fill="currentColor" viewBox="0 0 24 24">
      <path d="M16 3l5 5-5.5 1.5L13 14l-6 6-1.5-1.5 4-4-2.5-2.5L14 6.5 12 4l4-1zM6.5 14.5" />
    </svg>
  )
}
