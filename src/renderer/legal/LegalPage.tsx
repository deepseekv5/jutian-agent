/**
 * 用户协议与隐私政策展示页（v11.0.3）
 * 从 设置 → 关于 打开；tab 切换两份文档。
 */
import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import PageShell from '../app/PageShell'
import { USER_AGREEMENT, PRIVACY_POLICY, type LegalDoc } from '../../shared/legal'

type Tab = 'agreement' | 'privacy'

export default function LegalPage({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [tab, setTab] = useState<Tab>('agreement')
  const docs: Record<Tab, LegalDoc> = { agreement: USER_AGREEMENT, privacy: PRIVACY_POLICY }
  const doc = docs[tab]

  return (
    <PageShell onClose={onClose} fill
      title="用户协议与隐私政策"
      description={`版本 ${doc.updated} · 适用于巨天agent 全部功能`}
      icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253">
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
        <div className="max-w-2xl mx-auto">
          {/* tab 切换 */}
          <div className="flex gap-1.5 mb-5 sticky top-0 z-10 py-2" style={{ background: c.bg }}>
            {([['agreement', '用户协议'], ['privacy', '隐私政策']] as [Tab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className="h-8 px-4 rounded-lg text-[12.5px] font-medium transition-colors"
                style={{ background: tab === id ? c.bgInput : 'transparent', color: tab === id ? c.textHead : c.textTertiary, border: `1px solid ${tab === id ? c.border : c.borderLight}` }}>
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <span className="text-[10.5px] font-mono self-center" style={{ color: c.textMuted }}>更新：{doc.updated}</span>
          </div>

          {/* 引言 */}
          <p className="text-[12.5px] leading-relaxed px-4 py-3 rounded-xl mb-5"
            style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>
            {doc.intro}
          </p>

          {/* 章节 */}
          <div className="space-y-5 pb-8">
            {doc.sections.map((sec, i) => (
              <div key={i}>
                <h3 className="text-[13.5px] font-semibold mb-2" style={{ color: c.textHead }}>{sec.heading}</h3>
                <ul className="space-y-1.5">
                  {sec.items.map((it, j) => (
                    <li key={j} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: c.textSecondary }}>
                      <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full" style={{ background: c.accent }} />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  )
}
