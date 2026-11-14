/**
 * 首次进入告知与同意 —— 《人工智能拟人化互动服务管理暂行办法》第十二条
 * 要求提供用户年龄、监护人或紧急联系人等必要信息；第十八条要求提示用户
 * 正在与 AI 而非自然人互动。此处一次性收集，存本机 localStorage。
 */
import { useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import { DISCLAIMER } from '../../../shared/personas'
import { NO_TRAINING_NOTICE, MINOR_NOTICE } from '../../../shared/personaSafety'
import type { PersonaIdentity } from '../../../shared/personaSafety'

const KEY = 'lyclaw_persona_identity_v1'

export function loadIdentity(): PersonaIdentity {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* 读取失败则重新收集 */ }
  return { age: null, emergencyContact: '', consentedAt: null }
}

export function saveIdentity(id: PersonaIdentity) {
  try { localStorage.setItem(KEY, JSON.stringify(id)) } catch {}
}

interface Props {
  onAgree: (id: PersonaIdentity) => void
}

const AGES: { v: PersonaIdentity['age']; label: string; desc: string }[] = [
  { v: 'under14', label: '不满 14 周岁', desc: '需监护人同意后方可使用其他拟人化互动' },
  { v: '14to17', label: '14 - 17 周岁', desc: '将启用未成年人模式' },
  { v: 'adult', label: '已满 18 周岁', desc: '按标准模式使用' },
]

export default function PersonaConsent({ onAgree }: Props) {
  const { c } = useTheme()
  const [age, setAge] = useState<PersonaIdentity['age']>(null)
  const [contact, setContact] = useState('')
  const [agree, setAgree] = useState(false)
  const [showFull, setShowFull] = useState(false)

  const minorBlocked = age === 'under14' || age === '14to17'

  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto scrollbar-thin px-6 py-10">
      <div className="w-full max-w-2xl" style={{ border: `1px solid ${c.borderLight}`, borderRadius: 16 }}>
        {/* 顶部醒目 AI 身份告知（第十八条：有效措施） */}
        <div className="px-6 pt-6 pb-5" style={{ background: c.bgInput, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: c.bg, border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold" style={{ color: c.textHead }}>你正在与 AI 角色互动，而不是真人</h2>
              <p className="text-[12px] mt-1 leading-relaxed" style={{ color: c.textSecondary }}>
                本功能的所有角色均为<strong>虚构人物</strong>，回复由大语言模型自动生成，可能存在错误。
                请勿将其作为医疗、法律、财务等专业意见的依据。
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 年龄（第十二条：必要信息） */}
          <div>
            <div className="text-[12.5px] font-medium mb-2" style={{ color: c.textHead }}>你的年龄</div>
            <div className="grid grid-cols-3 gap-2">
              {AGES.map(a => (
                <button key={a.v} onClick={() => setAge(a.v)}
                  className="px-3 py-2.5 rounded-lg text-left text-[12px] transition-colors"
                  style={{
                    border: `1px solid ${age === a.v ? c.borderFocus : c.borderLight}`,
                    background: age === a.v ? c.bgInput : 'transparent',
                    color: age === a.v ? c.textHead : c.textSecondary,
                  }}>
                  <div className="font-medium">{a.label}</div>
                  <div className="text-[10.5px] mt-0.5" style={{ color: c.textTertiary }}>{a.desc}</div>
                </button>
              ))}
            </div>
            {minorBlocked && (
              <div className="mt-2 px-3 py-2 rounded-lg text-[11.5px] leading-relaxed"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#b45309' }}>
                {MINOR_NOTICE}未满 14 周岁使用需监护人同意。确认后将启用未成年人模式，自动屏蔽虚拟亲密关系内容并定期提醒现实生活。
              </div>
            )}
          </div>

          {/* 紧急联系人（第十二条 / 第十三条） */}
          <div>
            <div className="text-[12.5px] font-medium mb-1" style={{ color: c.textHead }}>紧急联系人（可选）</div>
            <p className="text-[11px] mb-2" style={{ color: c.textTertiary }}>
              仅保存在你的电脑上。当对话中出现可能危及生命健康的情况时，应用会在回复中提示你联系身边的人。
            </p>
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="姓名与电话，例如：张三 138xxxx"
              className="w-full px-3 h-9 rounded-lg text-[12.5px] outline-none"
              style={{ border: `1px solid ${c.borderLight}`, background: c.bgInput, color: c.text }} />
          </div>

          {/* 数据说明 */}
          <div className="px-3 py-2.5 rounded-lg text-[11.5px] leading-relaxed"
            style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>
            <div className="font-medium mb-1" style={{ color: c.textHead }}>数据如何处理</div>
            {NO_TRAINING_NOTICE}
            <div className="mt-1">对话记录、角色设定与角色记忆全部存于本机 <code style={{ fontSize: 10.5 }}>~/.lyclaw</code>，你可随时一键删除。</div>
          </div>

          {showFull && (
            <div className="space-y-3 text-[11.5px] leading-relaxed" style={{ color: c.textSecondary }}>
              <div>
                <div className="font-medium mb-1" style={{ color: c.textHead }}>使用须知</div>
                <ul className="list-disc pl-4 space-y-1">
                  {DISCLAIMER.disclaimer.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
              <div>
                <div className="font-medium mb-1" style={{ color: c.textHead }}>合规依据</div>
                <ul className="list-disc pl-4 space-y-0.5" style={{ color: c.textTertiary }}>
                  {DISCLAIMER.basis.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)}
              className="mt-0.5 shrink-0" style={{ accentColor: c.accent }} />
            <span className="text-[11.5px] leading-relaxed" style={{ color: c.textSecondary }}>
              我已阅读并同意上述说明，理解本功能由 AI 生成内容、不构成专业意见，且不用于冒充他人或任何违法违规用途。
            </span>
          </label>
        </div>

        <div className="px-6 py-4 flex items-center gap-3" style={{ borderTop: `1px solid ${c.borderLight}` }}>
          <button onClick={() => setShowFull(v => !v)} className="text-[12px] underline" style={{ color: c.textTertiary }}>
            {showFull ? '收起完整说明' : '查看完整免责与合规依据'}
          </button>
          <div className="flex-1" />
          <button onClick={() => age && agree && onAgree({ age, emergencyContact: contact.trim(), consentedAt: new Date().toISOString() })}
            disabled={!age || !agree}
            className="px-5 h-9 rounded-lg text-[13px] font-medium disabled:opacity-30"
            style={{ background: c.textHead, color: c.bg }}>
            开始使用
          </button>
        </div>
      </div>
    </div>
  )
}