/**
 * 首次启动强制同意门（v11.0.3）
 *
 * 依据《个人信息保护法》第十四条（处理个人信息应取得个人同意）与
 * 《人工智能拟人化互动服务管理暂行办法》第十二条（应与用户签订服务协议）：
 * 首次进入应用必须展示《用户协议》与《隐私政策》并取得同意，不同意则无法使用。
 *
 * 同意记录存 localStorage（随协议版本更新后重新征求）。
 */
import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { USER_AGREEMENT, PRIVACY_POLICY, LEGAL_VERSION } from '../../shared/legal'

const KEY = 'lyclaw_legal_consent'

export function hasLegalConsent(): boolean {
  try { return localStorage.getItem(KEY) === LEGAL_VERSION } catch { return false }
}
export function grantLegalConsent() {
  try { localStorage.setItem(KEY, LEGAL_VERSION) } catch { /* ignore */ }
}

export default function LegalGate({ onAgree }: { onAgree: () => void }) {
  const { c } = useTheme()
  const [tab, setTab] = useState<'agreement' | 'privacy'>('agreement')
  const [checked, setChecked] = useState(false)
  const [exitConfirm, setExitConfirm] = useState(false)
  const doc = tab === 'agreement' ? USER_AGREEMENT : PRIVACY_POLICY

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: 'rgba(247,248,250,.92)', backdropFilter: 'blur(28px)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden glass-strong"
        style={{ border: `1px solid ${c.border}`, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        {/* 头部 */}
        <div className="px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16,163,127,.12)' }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#10a37f" strokeWidth={1.8} strokeLinecap="round">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </span>
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: c.textHead }}>用户协议与隐私政策</h2>
              <p className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>请阅读并同意后使用 · 版本 {LEGAL_VERSION}</p>
            </div>
          </div>
          <div className="flex gap-1.5 mt-4">
            {([['agreement', '用户协议'], ['privacy', '隐私政策']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className="h-8 px-4 rounded-lg text-[12.5px] font-medium"
                style={{ background: tab === id ? c.bgInput : 'transparent', color: tab === id ? c.textHead : c.textTertiary, border: `1px solid ${tab === id ? c.border : c.borderLight}` }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 协议正文 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          <p className="text-[12.5px] leading-relaxed px-4 py-3 rounded-xl mb-4"
            style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>
            {doc.intro}
          </p>
          <div className="space-y-4">
            {doc.sections.map((sec, i) => (
              <div key={i}>
                <h3 className="text-[13px] font-semibold mb-1.5" style={{ color: c.textHead }}>{sec.heading}</h3>
                <ul className="space-y-1">
                  {sec.items.map((it, j) => (
                    <li key={j} className="flex items-start gap-2 text-[12px] leading-relaxed" style={{ color: c.textSecondary }}>
                      <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full" style={{ background: c.accent }} />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 底部：勾选 + 进入 */}
        <div className="px-6 py-4 shrink-0" style={{ borderTop: `1px solid ${c.borderLight}` }}>
          <label className="flex items-start gap-2.5 cursor-pointer mb-3">
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}
              className="mt-0.5 shrink-0" style={{ accentColor: '#10a37f' }} />
            <span className="text-[12px] leading-relaxed" style={{ color: c.textSecondary }}>
              我已阅读并同意《用户协议》与《隐私政策》，并理解 AI 生成内容需自行核实、不得删除 AI 标识、不得用于违法违规用途。
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button onClick={() => setExitConfirm(true)} className="px-3 h-9 rounded-lg text-[12px]"
              style={{ color: c.textTertiary }}>退出应用</button>
            <div className="flex-1" />
            <button onClick={() => { grantLegalConsent(); onAgree() }} disabled={!checked}
              className="px-6 h-9 rounded-lg text-[13px] font-semibold disabled:opacity-30"
              style={{ background: '#10a37f', color: '#fff' }}>
              同意并进入
            </button>
          </div>
          {exitConfirm && (
            <div className="fixed inset-0 z-[1001] flex items-center justify-center" style={{ background: 'rgba(0,0,0,.4)' }}
              onClick={() => setExitConfirm(false)}>
              <div className="rounded-xl p-5 w-72" style={{ background: c.bgCard, border: `1px solid ${c.border}` }} onClick={e => e.stopPropagation()}>
                <p className="text-[13px] mb-4" style={{ color: c.text }}>需先同意用户协议与隐私政策方可使用。确定退出应用？</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setExitConfirm(false)} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textSecondary }}>取消</button>
                  <button onClick={() => { const q = (window.electronAPI as { quitApp?: () => void } | undefined); q?.quitApp?.() }} className="px-3 py-1.5 rounded-lg text-[12px] font-medium" style={{ background: c.toolErr, color: '#fff' }}>退出</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
