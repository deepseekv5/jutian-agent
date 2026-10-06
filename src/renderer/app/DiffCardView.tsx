/**
 * DiffCardView — 可编辑 diff 卡片（v7.0 共享组件）
 * 服务端留底（/api/diff/changes/:id）→ 真实旧→新 diff → 撤销 / 编辑后应用。
 * 使用方：代码模式 ChatPanel、主对话 MessageBubble。
 * 变更留底存于 serve.cjs 内存（重启清空），撤销/应用后回调 onFileMutated(path) 刷新编辑器。
 */
import { useState, useRef } from 'react'
import type { ToolCall } from '../types'

const TEXT_SECONDARY = '#a1a1aa'
const TEXT_MUTED = '#5b5b60'
const ERR = '#ef4444'

function diffLines(oldText: string, newText: string): { type: 'ctx' | 'del' | 'add'; text: string }[] {
  const a = oldText.split('\n'), b = newText.split('\n')
  const out: { type: 'ctx' | 'del' | 'add'; text: string }[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i++; j++ }
    else if (j + 1 < b.length && a[i] === b[j + 1]) { out.push({ type: 'add', text: b[j] }); j++ }
    else if (i + 1 < a.length && a[i + 1] === b[j]) { out.push({ type: 'del', text: a[i] }); i++ }
    else {
      let ni = -1, nj = -1
      for (let k = 0; k < 6 && i + k < a.length; k++) for (let m = 0; m < 6 && j + m < b.length; m++) {
        if (a[i + k] === b[j + m] && (k + m) > 0 && (ni === -1 || k + m < ni + nj)) { ni = i + k; nj = j + m }
      }
      if (ni === -1) { out.push({ type: 'del', text: a[i] }); i++ }
      else { while (i < ni) out.push({ type: 'del', text: a[i++] }); while (j < nj) out.push({ type: 'add', text: b[j++] }) }
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })
  return out
}

export default function DiffCardView({ tc, c, onFileMutated }: {
  tc: ToolCall
  c: any
  onFileMutated?: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const preRef = useRef<HTMLPreElement | null>(null)
  const [blockCursor, setBlockCursor] = useState(0)
  const [chg, setChg] = useState<{ old: string; new: string } | null>(null)
  const [state, setState] = useState<'applied' | 'undone' | 'editing'>('applied')
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)
  const [opErr, setOpErr] = useState('')
  let path = '', rows: { type: 'ctx' | 'del' | 'add'; text: string }[] = [], added = 0, removed = 0
  try {
    const a = JSON.parse(tc.arguments || '{}')
    path = a.path || ''
    const changeId = (tc as any).changeId as string | undefined
    if (changeId && open && !chg) {
      fetch('/api/diff/changes/' + changeId).then(r => r.json()).then(d => {
        if (d && d.path) setChg({ old: String(d.old || ''), new: String(d.new || '') })
      }).catch(() => {})
    }
    if (tc.name === 'edit_file') rows = diffLines(String(a.oldText || ''), String(a.newText || ''))
    else if (chg) rows = diffLines(chg.old, chg.new)
    else if (tc.name === 'write_file') rows = String(a.content || '').split('\n').map((t: string) => ({ type: 'add' as const, text: t }))
    added = rows.filter(r => r.type === 'add').length
    removed = rows.filter(r => r.type === 'del').length
  } catch { return null }
  if (!path) return null
  const changeId = (tc as any).changeId as string | undefined
  const shown = open ? rows : rows.slice(0, 0)
  const blockIdxs = rows.map((r, i) => r.type !== 'ctx' ? i : -1).filter(i => i >= 0)
  const jumpBlock = (dir: 1 | -1) => {
    if (blockIdxs.length === 0) return
    const next = (blockCursor + dir + blockIdxs.length) % blockIdxs.length
    setBlockCursor(next)
    const el = preRef.current?.querySelector(`[data-row="${blockIdxs[next]}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const undo = async () => {
    if (!changeId || busy) return
    setBusy(true); setOpErr('')
    try {
      const r = await fetch('/api/diff/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: changeId }) })
      const d = await r.json().catch(() => ({} as any))
      if (r.ok && d.ok) { setState('undone'); onFileMutated?.(path) }
      else setOpErr(d.error || `撤销失败 (HTTP ${r.status})`)
    } catch (e: any) { setOpErr(String(e?.message || e)) }
    setBusy(false)
  }
  const applyEdit = async () => {
    if (!changeId || busy) return
    setBusy(true); setOpErr('')
    try {
      const r = await fetch('/api/diff/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: changeId, content: editText }) })
      const d = await r.json().catch(() => ({} as any))
      if (r.ok && d.ok) { setState('applied'); setChg({ old: chg?.old || '', new: editText }); onFileMutated?.(path) }
      else setOpErr(d.error || `应用失败 (HTTP ${r.status})`)
    } catch (e: any) { setOpErr(String(e?.message || e)) }
    setBusy(false)
  }
  const isWrite = tc.name === 'write_file' || tc.name === 'edit_file'
  return (
    <div className="mt-1 rounded-lg border overflow-hidden" style={{ borderColor: c.borderLight, background: c.bgInput, opacity: state === 'undone' ? 0.55 : 1 }}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-1.5 px-2 py-1 text-left font-mono" style={{ color: TEXT_SECONDARY }}>
        <svg className={`w-2.5 h-2.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span style={{ color: c.accent }}>diff</span>
        <span className="truncate">{path.split('/').pop()}</span>
        <span className="shrink-0" style={{ color: '#4ade80' }}>+{added}</span>
        <span className="shrink-0" style={{ color: ERR }}>-{removed}</span>
        {state === 'undone' && <span className="shrink-0" style={{ color: ERR }}>已撤销</span>}
        {opErr && <span className="shrink-0 max-w-[55%] truncate" style={{ color: ERR }} title={opErr}>⚠ {opErr}</span>}
        {!open && <span className="ml-auto shrink-0" style={{ color: TEXT_MUTED }}>点击查看</span>}
      </button>
      {open && blockIdxs.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b" style={{ borderColor: c.borderLight }}>
          <span className="text-[9.5px] font-mono" style={{ color: TEXT_MUTED }}>{blockCursor + 1}/{blockIdxs.length} 块</span>
          <span className="flex-1" />
          <button onClick={() => jumpBlock(-1)} className="w-5 h-5 rounded flex items-center justify-center text-[11px] hover:opacity-70" style={{ color: TEXT_SECONDARY }} title="上一块">↑</button>
          <button onClick={() => jumpBlock(1)} className="w-5 h-5 rounded flex items-center justify-center text-[11px] hover:opacity-70" style={{ color: TEXT_SECONDARY }} title="下一块">↓</button>
        </div>
      )}
      {open && (
        <pre ref={preRef} className="text-[10px] font-mono leading-[1.5] overflow-x-auto px-2 py-1.5 max-h-64 overflow-y-auto scrollbar-thin">
          {shown.map((r, i) => (
            <div key={i} data-row={i} style={{
              color: r.type === 'add' ? '#4ade80' : r.type === 'del' ? ERR : TEXT_MUTED,
              background: r.type === 'add' ? 'rgba(74,222,128,0.07)' : r.type === 'del' ? 'rgba(239,68,68,0.07)' : 'transparent',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  '}{r.text}</div>
          ))}
        </pre>
      )}
      {open && isWrite && changeId && state !== 'undone' && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-t" style={{ borderColor: c.borderLight }}>
          {state === 'editing' ? (
            <>
              <span className="text-[10px] font-mono" style={{ color: TEXT_MUTED }}>编辑新内容 ↓</span>
              <span className="flex-1" />
              <button onClick={() => setState('applied')} className="px-2 py-0.5 rounded text-[10px]" style={{ background: c.bgInput, color: TEXT_SECONDARY }}>取消</button>
            </>
          ) : (
            <>
              <button onClick={undo} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50" style={{ background: 'rgba(239,68,68,.12)', color: ERR }}>撤销此改动</button>
              <button onClick={() => { try { setEditText(JSON.parse(tc.arguments || '{}').content || '') } catch { setEditText('') } setState('editing') }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50" style={{ background: c.bgInput, color: TEXT_SECONDARY }}>编辑后应用</button>
              <span className="ml-auto text-[9.5px]" style={{ color: TEXT_MUTED }}>改动已生效 · 可撤销</span>
            </>
          )}
        </div>
      )}
      {open && state === 'editing' && (
        <textarea
          value={editText}
          onChange={e => setEditText(e.target.value)}
          spellCheck={false}
          className="w-full text-[10.5px] font-mono leading-[1.6] px-2 py-1.5 outline-none resize-y border-t"
          style={{ background: '#05070d', color: '#dbe4ee', borderColor: c.borderLight, minHeight: 120, maxHeight: 320 }}
        />
      )}
      {open && state === 'editing' && (
        <div className="px-2 py-1.5 border-t" style={{ borderColor: c.borderLight }}>
          <button onClick={applyEdit} disabled={busy} className="px-3 py-1 rounded text-[10.5px] font-semibold disabled:opacity-50" style={{ background: c.accent, color: c.accentText }}>应用修改到文件</button>
        </div>
      )}
    </div>
  )
}
