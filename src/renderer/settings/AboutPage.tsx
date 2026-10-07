import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'
import { getAllMemories } from '../store/storage'

/**
 * 关于页(v8.2)—— 苹果「设置 → 通用 → 软件更新」规格:
 * 版本卡 / 更新日志 Markdown / 全屏更新覆盖层(实时进度环) / 诊断导出。
 */

interface UpdateInfo {
  ok: boolean
  available?: boolean
  current?: string
  latest?: string
  notes?: string
  asarUrl?: string | null
  publishedAt?: string
  error?: string
}

interface Prog { stage: string; got?: number; total?: number; pct?: number | null; left?: number; error?: string }

function fmtBytes(n: number) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB' }

export default function AboutPage({ onClose, embedded: _embedded }: { onClose: () => void; embedded?: boolean }) {
  const { c } = useTheme()
  const [stats, setStats] = useState<{ sessions: number; memories: number } | null>(null)
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [prog, setProg] = useState<Prog | null>(null)
  const [lastCheck, setLastCheck] = useState('')
  const progRef = useRef<Prog | null>(null)
  progRef.current = prog

  const api = () => (window as any).electronAPI

  const doCheck = () => {
    const a = api()
    if (!a?.updateCheck) return
    setChecking(true)
    a.updateCheck().then((d: UpdateInfo) => {
      setUpd(d)
      setLastCheck(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    }).catch(() => {}).finally(() => setChecking(false))
  }

  useEffect(() => {
    ;(async () => {
      try {
        const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
        const mem = await getAllMemories().catch(() => ({}))
        setStats({ sessions: Array.isArray(sessions) ? sessions.length : 0, memories: Object.keys(mem || {}).length })
      } catch {}
    })()
    if (api()?.updateCheck) {
      doCheck()
      api().onUpdateProgress((p: Prog) => setProg(p))
    }
  }, [])

  const apply = () => {
    if (!upd?.asarUrl) return
    setProg({ stage: 'download', got: 0, total: 0, pct: 0 })
    api().updateApply(upd.asarUrl).then((r: any) => {
      if (!r?.ok && !r?.started) setProg({ stage: 'error', error: r?.error || '更新失败' })
    }).catch((e: any) => setProg({ stage: 'error', error: String(e?.message || e) }))
  }

  const cancel = () => { api().updateCancel?.(); setProg(null) }

  const exportDiag = () => {
    const info = {
      app: '巨天agent', version: upd?.current || '',
      platform: navigator.userAgent,
      latest: upd?.latest, lastCheck: new Date().toISOString(),
      stats, notes: 'diagnostics only, no keys included',
    }
    const blob = new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'jutian-diagnostics.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const version = upd?.current || '—'
  const hasUpdate = !!upd?.available
  const updating = prog && ['download', 'verify', 'apply', 'restarting'].includes(prog.stage)
  const pct = prog?.stage === 'download' ? (prog.pct ?? null) : (updating ? null : 0)
  const done = prog?.stage === 'done'

  return (
    <PageShell onClose={onClose} title="关于" description="版本信息、组件构成与更新日志" icon="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
      <div className="px-6 pb-6 max-w-lg">
        {/* ── 软件更新卡(苹果规格)── */}
        <div className="py-4" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(16,163,127,.12)' }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#10a37f" strokeWidth={1.8} strokeLinecap="round"><path d="M12 3v18m-7-9h14" /></svg>
              </div>
              <div>
                <div className="text-[14px] font-semibold" style={{ color: c.textHead }}>巨天agent v{version}</div>
                <div className="text-[11px] font-mono" style={{ color: c.textMuted }}>
                  {hasUpdate ? `可更新至 v${upd?.latest}` : upd?.ok ? '已是最新版本' : checking ? '正在检查…' : '已安装版本'}
                  {lastCheck && !hasUpdate && ` · ${lastCheck} 检查`}
                </div>
              </div>
            </div>
            <button onClick={doCheck} disabled={checking}
              className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-50 shrink-0"
              style={{ color: c.textTertiary }}>
              <svg className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          {hasUpdate && upd?.notes && (
            <div className="mt-3 rounded-xl p-3" style={{ background: c.bgInput }}>
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: c.textSecondary }}>更新说明</div>
              <div className="text-[12px] leading-relaxed max-h-40 overflow-auto markdown-body" style={{ color: c.textSecondary }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{upd.notes}</ReactMarkdown>
              </div>
              <button onClick={apply} disabled={!!updating || !upd.asarUrl}
                className="mt-2.5 px-4 h-8 rounded-full text-[12px] font-semibold disabled:opacity-40"
                style={{ background: '#10a37f', color: '#fff' }}>
                一键更新并重启
              </button>
              {!upd.asarUrl && <span className="ml-2 text-[10.5px]" style={{ color: c.textMuted }}>(该版本仅有完整安装包)</span>}
            </div>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-2 py-4" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
            {[
              { label: '会话数', value: stats.sessions },
              { label: '记忆条数', value: stats.memories },
            ].map(s => (
              <div key={s.label} className="px-4 py-3 rounded-xl glass">
                <div className="text-[11px]" style={{ color: c.textMuted }}>{s.label}</div>
                <div className="text-[18px] font-bold mt-1" style={{ color: c.textHead }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        <div className="py-4" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <p className="text-[13px] leading-relaxed" style={{ color: c.textSecondary }}>
            巨天agent 是一款桌面 AI 助手，集成终端操作、文件管理、PPT 生成、代码编辑于一体。用自然语言，操控你的电脑。
          </p>
        </div>

        {/* Tech stack */}
        <div className="py-4" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <span className="text-[12px] font-semibold block mb-3" style={{ color: c.textSecondary }}>技术栈</span>
          <div className="flex flex-wrap gap-2">
            {['Electron', 'React', 'TypeScript', 'Vite', 'TailwindCSS', 'CodeMirror', 'SQLite'].map(tech => (
              <span key={tech} className="px-2.5 py-1 rounded-lg text-[11px]" style={{ background: c.bgInput, color: c.textSecondary }}>{tech}</span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 flex items-center justify-between">
          <span className="text-[11px]" style={{ color: c.textMuted }}>巨天agent. All Rights Reserved.</span>
          <button onClick={exportDiag} className="px-2.5 py-1 rounded-lg text-[10.5px]" style={{ background: c.bgInput, color: c.textMuted }}>导出诊断信息</button>
        </div>
      </div>

      {/* ── 全屏更新覆盖层(下载/校验/替换/重启)── */}
      {updating && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center animate-fade-in"
          style={{ background: 'rgba(247,248,250,.88)', backdropFilter: 'blur(24px)' }}>
          <div className="flex flex-col items-center">
            {/* 进度环 */}
            <div className="relative w-32 h-32 mb-7">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="54" fill="none" stroke={c.border} strokeWidth="5" />
                <circle cx="60" cy="60" r="54" fill="none" stroke="#10a37f" strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 54}
                  strokeDashoffset={2 * Math.PI * 54 * (1 - (pct ?? 0) / 100)}
                  style={{ transition: 'stroke-dashoffset .3s ease' }} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[22px] font-bold font-mono" style={{ color: c.textHead }}>
                  {prog.stage === 'restarting' ? prog.left : pct === null ? '…' : pct + '%'}
                </span>
              </div>
            </div>
            <div className="text-[16px] font-semibold mb-1.5" style={{ color: c.textHead }}>
              {prog.stage === 'restarting' ? '更新完成,应用即将重启'
                : prog.stage === 'apply' ? '正在应用更新…'
                : prog.stage === 'verify' ? '正在校验更新包…'
                : prog.stage === 'download' ? `正在更新巨天agent v${upd?.latest || ''}` : '正在更新…'}
            </div>
            <div className="text-[12px] font-mono" style={{ color: c.textMuted }}>
              {prog.stage === 'download' && (prog.total || 0) > 0
                ? `${fmtBytes(prog.got || 0)} / ${fmtBytes(prog.total || 0)}`
                : prog.stage === 'restarting' ? '倒计时中…' : '更新期间请勿关闭应用'}
            </div>
            {prog.stage === 'download' && (
              <button onClick={cancel} className="mt-6 px-4 h-8 rounded-full text-[12px] font-medium"
                style={{ background: c.bgInput, color: c.textSecondary }}>取消更新</button>
            )}
          </div>
        </div>
      )}
    </PageShell>
  )
}
