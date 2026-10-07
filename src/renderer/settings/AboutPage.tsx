import { useState, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'
import { getAllMemories } from '../store/storage'

interface UpdateInfo {
  ok: boolean
  available?: boolean
  current?: string
  latest?: string
  notes?: string
  asarUrl?: string | null
  error?: string
}

export default function AboutPage({ onClose, embedded: _embedded }: { onClose: () => void; embedded?: boolean }) {
  const { c } = useTheme()
  const [stats, setStats] = useState<{ sessions: number; memories: number } | null>(null)
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
        const mem = await getAllMemories().catch(() => ({}))
        setStats({ sessions: Array.isArray(sessions) ? sessions.length : 0, memories: Object.keys(mem || {}).length })
      } catch {}
    })()
    // 版本与更新信息(打包态才有)
    const api = (window as any).electronAPI
    if (api?.updateCheck) {
      setChecking(true)
      api.updateCheck().then((d: UpdateInfo) => setUpd(d)).catch(() => {}).finally(() => setChecking(false))
    }
  }, [])

  const apply = async () => {
    if (!upd?.asarUrl) return
    setApplying(true); setApplyMsg('')
    try {
      const r = await (window as any).electronAPI.updateApply(upd.asarUrl)
      if (!r?.ok) { setApplyMsg(r?.error || '更新失败'); setApplying(false) }
      // 成功时主进程会自动重启,这里不恢复按钮
    } catch (e: any) { setApplyMsg(String(e?.message || e)); setApplying(false) }
  }

  const version = upd?.current || '—'
  const hasUpdate = !!upd?.available

  return (
    <PageShell onClose={onClose} title="关于" description="版本信息、组件构成与更新日志" icon="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
      <div className="px-6 pb-6 max-w-lg">
        {/* Version + 更新 */}
        <div className="py-4" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[13px]" style={{ color: c.textSecondary }}>版本</span>
            <span className="text-[13px] font-semibold font-mono" style={{ color: c.textHead }}>v{version}</span>
          </div>
          {hasUpdate && (
            <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(16,163,127,.1)', border: '1px solid rgba(16,163,127,.4)' }}>
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="#10a37f" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                <span className="text-[12.5px] font-bold" style={{ color: '#10a37f' }}>{t2('发现新版本', 'Update available')} v{upd?.latest}</span>
              </div>
              {applying ? (
                <div className="flex items-center gap-2 text-[12px]" style={{ color: c.textSecondary }}>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="#10a37f" strokeWidth="4" /><path className="opacity-75" fill="#10a37f" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  {applyMsg || t2('正在更新,完成后自动重启…', 'Updating — will restart automatically…')}
                </div>
              ) : (
                <button onClick={apply} className="px-4 h-8 rounded-full text-[12px] font-semibold" style={{ background: '#10a37f', color: '#fff' }}>
                  {t2('一键更新并重启', 'Update & restart')}
                </button>
              )}
            </div>
          )}
          {!hasUpdate && upd?.ok && (
            <div className="mt-2 text-[11px]" style={{ color: c.textMuted }}>{t2('已是最新版本 ✓', 'Up to date ✓')}</div>
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
        <div className="pt-4 text-center">
          <span className="text-[11px]" style={{ color: c.textMuted }}>巨天agent. All Rights Reserved.</span>
        </div>
      </div>
    </PageShell>
  )
}

function t2(zh: string, _en?: string) { return zh }
