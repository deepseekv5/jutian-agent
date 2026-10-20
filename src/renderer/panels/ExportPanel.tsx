/**
 * 导出面板（v12.1）—— 多会话合并导出 + 筛选
 *
 * 复用 shared/exportSessions 的纯逻辑（筛选/统计/文件名清洗），
 * 这里只负责选会话、选筛选条件、触发下载。
 */
import { useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { buildMultiExport, collectStats, exportFileName, type ExportFilter, type ExportSession } from '../../shared/exportSessions'
import type { Session } from '../types'

interface Props {
  sessions: Session[]
  /** 打开某会话的 loader：拿消息内容（面板本身不持有全部消息） */
  loadMessages: (sid: string) => Promise<{ role: string; content: string; created_at?: string; tool_calls?: any[]; thinking?: string }[]>
  onClose: () => void
}

export default function ExportPanel({ sessions, loadMessages, onClose }: Props) {
  const { c } = useTheme()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [roles, setRoles] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [onlyCode, setOnlyCode] = useState(false)
  const [includeTools, setIncludeTools] = useState(false)
  const [includeThinking, setIncludeThinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const filter: ExportFilter = useMemo(() => ({
    roles: roles.length ? roles : undefined,
    keyword: keyword.trim() || undefined,
    onlyCode,
    includeTools,
    includeThinking,
  }), [roles, keyword, onlyCode, includeTools, includeThinking])

  const toggle = (id: string) => setPicked((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const run = async () => {
    if (!picked.size) { setMsg('先选至少一个会话'); return }
    setBusy(true); setMsg('')
    try {
      const list: ExportSession[] = []
      for (const sid of picked) {
        const s = sessions.find((x) => x.id === sid)
        const messages = await loadMessages(sid)
        list.push({
          id: sid,
          title: typeof s?.title === 'string' ? s.title : '未命名会话',
          project: s?.project || undefined,
          created_at: s?.created_at,
          messages,
        })
      }
      const md = buildMultiExport(list, filter)
      const stats = collectStats(list)
      const name = exportFileName(picked.size === 1 ? (list[0].title || '会话') : '会话合集', 'md')
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      setMsg(`已导出 ${stats.sessions} 个会话 / ${stats.messages} 条消息 → ${name}`)
    } catch (e) {
      setMsg(`导出失败：${(e as Error)?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[14px] font-bold" style={{ color: c.textHead }}>导出会话</span>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>Markdown · 可多选合并</span>
        <span className="flex-1" />
        <button onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11.5px]" style={{ color: c.textTertiary }}>关闭</button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
        {/* 会话选择 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold tracking-wider" style={{ color: c.textTertiary }}>
              选择会话（已选 {picked.size}）
            </span>
            <span className="flex-1" />
            <button onClick={() => setPicked(new Set(sessions.map((s) => s.id)))}
              className="text-[10.5px]" style={{ color: c.accent }}>全选</button>
            <button onClick={() => setPicked(new Set())}
              className="text-[10.5px]" style={{ color: c.textTertiary }}>清空</button>
          </div>
          <div className="max-h-56 overflow-y-auto scrollbar-thin space-y-0.5 rounded-xl p-1.5" style={{ background: c.bgInput }}>
            {sessions.map((s) => {
              const on = picked.has(s.id)
              return (
                <button key={s.id} onClick={() => toggle(s.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors"
                  style={{ background: on ? c.bgActive || 'rgba(16,163,127,.1)' : 'transparent' }}>
                  <span className="w-3.5 h-3.5 rounded border shrink-0 grid place-items-center"
                    style={{ borderColor: on ? c.accent : c.border, background: on ? c.accent : 'transparent' }}>
                    {on && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={4}><path d="M20 6L9 17l-5-5" /></svg>}
                  </span>
                  <span className="text-[12px] truncate flex-1" style={{ color: c.textHead }}>
                    {typeof s.title === 'string' && s.title.trim() ? s.title : '新对话'}
                  </span>
                </button>
              )
            })}
            {sessions.length === 0 && <div className="px-2 py-4 text-center text-[11px]" style={{ color: c.textTertiary }}>还没有会话</div>}
          </div>
        </div>

        {/* 筛选 */}
        <div className="space-y-2.5">
          <div className="text-[11px] font-bold tracking-wider" style={{ color: c.textTertiary }}>筛选</div>
          <div className="flex flex-wrap gap-1.5">
            {[['user', '只要我的提问'], ['assistant', '只要 AI 回复']].map(([v, label]) => {
              const on = roles.includes(v)
              return (
                <button key={v}
                  onClick={() => setRoles((prev) => on ? prev.filter((x) => x !== v) : [...prev, v])}
                  className="px-2.5 py-1 rounded-full text-[11px] transition-colors"
                  style={on ? { background: `${c.accent}15`, color: c.accent, border: `1px solid ${c.accent}40` }
                    : { background: c.bgInput, color: c.textTertiary, border: `1px solid ${c.border}` }}>
                  {label}
                </button>
              )
            })}
            <button onClick={() => setOnlyCode((v) => !v)}
              className="px-2.5 py-1 rounded-full text-[11px] transition-colors"
              style={onlyCode ? { background: `${c.accent}15`, color: c.accent, border: `1px solid ${c.accent}40` }
                : { background: c.bgInput, color: c.textTertiary, border: `1px solid ${c.border}` }}>
              只导含代码的
            </button>
            <button onClick={() => setIncludeTools((v) => !v)}
              className="px-2.5 py-1 rounded-full text-[11px] transition-colors"
              style={includeTools ? { background: `${c.accent}15`, color: c.accent, border: `1px solid ${c.accent}40` }
                : { background: c.bgInput, color: c.textTertiary, border: `1px solid ${c.border}` }}>
              包含工具调用
            </button>
            <button onClick={() => setIncludeThinking((v) => !v)}
              className="px-2.5 py-1 rounded-full text-[11px] transition-colors"
              style={includeThinking ? { background: `${c.accent}15`, color: c.accent, border: `1px solid ${c.accent}40` }
                : { background: c.bgInput, color: c.textTertiary, border: `1px solid ${c.border}` }}>
              包含思考过程
            </button>
          </div>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="只导出包含关键词的消息（留空为全部）"
            className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
            style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.border}` }} />
        </div>

        {msg && <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: c.bgInput, color: c.textSecondary || c.textTertiary }}>{msg}</div>}
      </div>

      <div className="px-5 py-3 border-t flex items-center gap-2" style={{ borderColor: c.borderLight }}>
        <span className="text-[10.5px]" style={{ color: c.textTertiary }}>导出为 .md，可直接进知识库或发给同事</span>
        <span className="flex-1" />
        <button onClick={run} disabled={busy || !picked.size}
          className="px-4 py-1.5 rounded-lg text-[12px] font-medium text-white disabled:opacity-40"
          style={{ background: c.accent || '#10a37f' }}>
          {busy ? '导出中…' : '导出'}
        </button>
      </div>
    </div>
  )
}
