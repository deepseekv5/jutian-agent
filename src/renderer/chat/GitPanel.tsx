/**
 * GitPanel —— Git 版本控制面板：检查点历史 / 工作区状态 / 差异预览 / 一键回滚。
 * 每次对话发送前会自动创建检查点；这里可查看全部检查点并撤销到任意一个。
 */
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'

interface Props {
  workDir: string
  onClose?: () => void
  /** 外部刷新信号（对话结束后+1，触发重新加载） */
  refreshSignal?: number
}

interface Checkpoint { hash: string; ts: number; label: string }
interface GitChange { status: string; file: string }

const fmtTime = (ts: number) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`
}

const STATUS_COLORS: Record<string, string> = {
  M: '#d97706', A: '#16a34a', D: '#dc2626', R: '#2563eb', '??': '#8f8f8f',
}

export default function GitPanel({ workDir, onClose, refreshSignal }: Props) {
  const { c } = useTheme()
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [branch, setBranch] = useState('')
  const [changes, setChanges] = useState<GitChange[]>([])
  const [log, setLog] = useState<Checkpoint[]>([])
  const [busy, setBusy] = useState('')
  const [tip, setTip] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [diffText, setDiffText] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!workDir) return
    try {
      const st = await fetch(`/api/git/status?dir=${encodeURIComponent(workDir)}`).then(r => r.json())
      setIsRepo(!!st.isRepo)
      setBranch(st.branch || '')
      setChanges(Array.isArray(st.changes) ? st.changes : [])
      const lg = await fetch(`/api/git/log?dir=${encodeURIComponent(workDir)}&limit=30`).then(r => r.json())
      setLog(Array.isArray(lg.items) ? lg.items : [])
    } catch { /* 服务不可用 */ }
  }, [workDir])

  useEffect(() => { load() }, [load, refreshSignal])

  const flash = (msg: string) => { setTip(msg); setTimeout(() => setTip(''), 2600) }

  const createCheckpoint = async () => {
    if (!workDir || busy) return
    setBusy('checkpoint')
    try {
      const r = await fetch('/api/git/checkpoint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: workDir }) }).then(r => r.json())
      flash(r.skipped ? '无改动，无需检查点' : r.success ? `已创建检查点 ${r.hash}` : (r.error || '创建失败'))
      await load()
    } catch { flash('创建失败') }
    finally { setBusy('') }
  }

  const undoTo = async (cp: Checkpoint) => {
    if (!workDir || busy) return
    if (!confirm(`确定恢复到检查点「${cp.label}」？\n当前未提交的改动会先自动保底提交（可再次撤销找回）。`)) return
    setBusy(cp.hash)
    try {
      const r = await fetch('/api/git/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: workDir, hash: cp.hash }) }).then(r => r.json())
      flash(r.success ? `已恢复到 ${cp.hash}` : (r.error || '恢复失败'))
      await load()
    } catch { flash('恢复失败') }
    finally { setBusy('') }
  }

  const loadDiff = async () => {
    if (!workDir) return
    setShowDiff(v => !v)
    if (!showDiff && !diffText) {
      try {
        const r = await fetch(`/api/git/diff?dir=${encodeURIComponent(workDir)}`).then(r => r.json())
        setDiffText(String(r.diff || r.stat || '（无未提交改动）'))
      } catch { setDiffText('加载失败') }
    }
  }

  if (!workDir) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[12.5px]" style={{ color: c.textTertiary }}>
        <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m-7-9h14" />
        </svg>
        <span>未设置工作目录，无法使用 Git 检查点</span>
        <span className="text-[11px]">在工作区栏点「选择…」指定项目目录后可用</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden glass">
      {/* 头部 */}
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b" style={{ borderColor: c.borderLight }}>
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: c.textSecondary }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m-7-9h14" />
        </svg>
        <span className="text-[12.5px] font-semibold" style={{ color: c.textHead }}>Git 检查点</span>
        {isRepo && branch && (
          <span className="text-[10.5px] px-1.5 py-0.5 rounded-full font-mono" style={{ background: c.surfaceInput, color: c.textTertiary }}>{branch}</span>
        )}
        <span className="flex-1" />
        <button onClick={load} title="刷新" className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ color: c.textTertiary }}
          onMouseEnter={e => { e.currentTarget.style.background = c.surfaceHover }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M4.05 13A9 9 0 106 5.3L4 8" />
          </svg>
        </button>
        {onClose && (
          <button onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center" style={{ color: c.textTertiary }} title="关闭">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* 提示条 */}
      {(tip || isRepo === false) && (
        <div className="px-3 py-1.5 text-[11px] shrink-0" style={{ background: `${c.accent}08`, color: tip ? c.accent : c.textTertiary }}>
          {isRepo === false && !tip ? '该目录还不是 Git 仓库，发送第一条消息时会自动初始化并创建检查点。' : tip}
        </div>
      )}

      {/* 工作区状态 */}
      {isRepo && (
        <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: c.borderLight }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium" style={{ color: c.textSecondary }}>
              工作区{changes.length > 0 ? `（${changes.length} 处改动）` : '（干净）'}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={loadDiff} className="text-[10.5px] px-1.5 py-0.5 rounded-md" style={{ color: c.textTertiary }} title="查看未提交差异">
                {showDiff ? '隐藏差异' : '差异'}
              </button>
              <button onClick={createCheckpoint} disabled={!!busy || changes.length === 0}
                className="text-[10.5px] px-2 py-0.5 rounded-md font-medium disabled:opacity-40"
                style={{ background: c.surfaceInput, color: c.textSecondary }} title="将当前改动保存为一个检查点">
                {busy === 'checkpoint' ? '保存中…' : '存检查点'}
              </button>
            </div>
          </div>
          {changes.length > 0 && (
            <div className="max-h-28 overflow-y-auto scrollbar-thin space-y-0.5">
              {changes.slice(0, 30).map((ch, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="w-4 shrink-0 font-bold" style={{ color: STATUS_COLORS[ch.status] || c.textTertiary }}>{ch.status || '·'}</span>
                  <span className="truncate" style={{ color: c.textSecondary }} title={ch.file}>{ch.file}</span>
                </div>
              ))}
            </div>
          )}
          {showDiff && (
            <pre className="mt-2 max-h-48 overflow-auto scrollbar-thin text-[10.5px] font-mono whitespace-pre rounded-lg p-2"
              style={{ background: c.surfaceInput, color: c.textSecondary }}>{diffText.slice(0, 20000) || '（无未提交改动）'}</pre>
          )}
        </div>
      )}

      {/* 检查点历史 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        <div className="px-1.5 mb-1.5 text-[11px] font-medium" style={{ color: c.textTertiary }}>
          检查点历史（对话发送前自动创建）
        </div>
        {log.length === 0 ? (
          <div className="text-center py-8 text-[11.5px]" style={{ color: c.textMuted }}>
            {isRepo === false ? '尚无仓库' : '尚无检查点'}
          </div>
        ) : log.map((cp, i) => (
          <div key={cp.hash + i}>
            <div className="group flex items-center gap-2 px-1.5 py-1.5 rounded-lg transition-colors"
              style={{ background: expanded === i ? c.surfaceHover : 'transparent' }}
              onMouseEnter={e => { if (expanded !== i) e.currentTarget.style.background = c.surfaceHover }}
              onMouseLeave={e => { if (expanded !== i) e.currentTarget.style.background = 'transparent' }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: i === 0 ? c.accent : c.border }} />
              <button onClick={() => setExpanded(expanded === i ? null : i)} className="flex-1 min-w-0 text-left">
                <div className="text-[11.5px] truncate" style={{ color: c.text }} title={cp.label}>{cp.label}</div>
                <div className="text-[10px] font-mono flex items-center gap-1.5" style={{ color: c.textMuted }}>
                  <span>{cp.hash}</span><span>{fmtTime(cp.ts)}</span>
                </div>
              </button>
              <button onClick={() => undoTo(cp)} disabled={!!busy}
                className="shrink-0 text-[10.5px] px-2 py-1 rounded-lg font-medium opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
                style={{ background: c.surfaceInput, color: c.textSecondary }} title="恢复文件到该检查点（可撤销找回）">
                {busy === cp.hash ? '恢复中…' : '恢复'}
              </button>
            </div>
            {expanded === i && (
              <div className="ml-4 pl-3 py-1 text-[10.5px]" style={{ borderLeft: `1px solid ${c.borderLight}`, color: c.textTertiary }}>
                恢复将把工作区文件回滚到该时刻：之后新增的文件会被移除，被修改的文件恢复原样。恢复前会自动保存当前状态，可再次恢复找回。
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}