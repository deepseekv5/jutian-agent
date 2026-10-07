import { useState, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'
import { getAllMemories } from '../store/storage'

export default function AboutPage({ onClose, embedded: _embedded }: { onClose: () => void; embedded?: boolean }) {
  const { c } = useTheme()
  const [stats, setStats] = useState<{ sessions: number; memories: number } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => [])
        const mem = await getAllMemories().catch(() => ({}))
        setStats({ sessions: Array.isArray(sessions) ? sessions.length : 0, memories: Object.keys(mem || {}).length })
      } catch {}
    })()
  }, [])

  return (
    <PageShell onClose={onClose} title="关于" description="版本信息、组件构成与更新日志" icon="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z">
      <div className="px-6 pb-6 max-w-lg">
        {/* Version */}
        <div className="flex items-center justify-between py-4" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <span className="text-[13px]" style={{ color: c.textSecondary }}>版本</span>
          <span className="text-[13px] font-semibold font-mono" style={{ color: c.textHead }}>v4.1.0</span>
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
