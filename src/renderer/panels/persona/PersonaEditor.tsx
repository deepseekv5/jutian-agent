/**
 * 角色创建 / 编辑表单 —— 自建虚构角色。
 * 合规：表单里强制带"非真人"边界（不可删），与预置角色同一套红线。
 */
import { useState } from 'react'
import { useTheme } from '../../hooks/useTheme'
import type { Persona } from '../../../shared/personas'
import { savePersona } from '../../../shared/personaChat'

const REQUIRED_BOUNDARY = '你是虚构的 AI 角色，不是真人，不声称有真实生活经历'

interface Props {
  /** 传入已有角色 = 编辑；不传 = 新建 */
  persona?: Persona | null
  onSaved: (p: Persona) => void
  onCancel: () => void
}

const AVATARS = ['🎭', '', '🐱', '🌙', '', '', '', '🌊', '🔮', '🍵', '📚', '🎸']

export default function PersonaEditor({ persona, onSaved, onCancel }: Props) {
  const { c } = useTheme()
  const editing = !!persona
  const [name, setName] = useState(persona?.name || '')
  const [avatar, setAvatar] = useState(persona?.avatar || '🎭')
  const [tagline, setTagline] = useState(persona?.tagline || '')
  const [personaText, setPersonaText] = useState(persona?.persona || '')
  const [style, setStyle] = useState(persona?.style || '')
  const [boundaries, setBoundaries] = useState<string[]>((persona?.boundaries || []).filter(b => b !== REQUIRED_BOUNDARY))
  const [opening, setOpening] = useState(persona?.opening || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canSave = name.trim() && personaText.trim() && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true); setError('')
    const res = await savePersona({
      ...(editing ? { id: persona!.id } : {}),
      name: name.trim(), avatar, tagline: tagline.trim(),
      persona: personaText.trim(), style: style.trim(),
      boundaries: [REQUIRED_BOUNDARY, ...boundaries.map(b => b.trim()).filter(Boolean)],
      opening: opening.trim(),
    })
    setSaving(false)
    if (!res.ok) { setError(res.error || '保存失败'); return }
    // 重新拉列表拿完整对象
    const list = await fetch('/api/personas').then(r => r.json()).catch(() => null)
    const saved = (list?.items || []).find((p: Persona) => p.name === name.trim())
    if (saved) onSaved(saved)
  }

  const field = (label: string, hint?: string) => (
    <div>
      <div className="text-[12px] font-medium mb-1" style={{ color: c.textHead }}>{label}
        {hint && <span className="ml-1.5 text-[10.5px] font-normal" style={{ color: c.textMuted }}>{hint}</span>}
      </div>
    </div>
  )
  const inputCls = "w-full px-3 rounded-lg text-[12.5px] outline-none"
  const inputStyle = { border: `1px solid ${c.borderLight}`, background: c.bgInput, color: c.text }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5">
      <div className="max-w-xl mx-auto space-y-4">
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: c.textHead }}>{editing ? `编辑「${persona!.name}」` : '新建角色'}</h3>
          <p className="text-[11.5px] mt-0.5" style={{ color: c.textTertiary }}>角色是虚构人物，设定不能冒充真实存在的人</p>
        </div>

        <div className="space-y-1.5">
          {field('头像')}
          <div className="flex flex-wrap gap-1.5">
            {AVATARS.map(a => (
              <button key={a} onClick={() => setAvatar(a)}
                className="w-9 h-9 rounded-lg text-[17px] flex items-center justify-center"
                style={{ border: `1px solid ${avatar === a ? c.borderFocus : c.borderLight}`, background: avatar === a ? c.bgInput : 'transparent' }}>
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            {field('角色名')}
            <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="例如：阿澜" className={`${inputCls} h-9`} style={inputStyle} />
          </div>
          <div className="space-y-1.5">
            {field('一句话标签')}
            <input value={tagline} onChange={e => setTagline(e.target.value)} maxLength={80} placeholder="例如：冷静克制的复盘教练" className={`${inputCls} h-9`} style={inputStyle} />
          </div>
        </div>

        <div className="space-y-1.5">
          {field('角色设定', 'TA 是谁、什么性格、关注什么')}
          <textarea value={personaText} onChange={e => setPersonaText(e.target.value)} rows={5}
            placeholder={'你叫阿澜，是一位冷静的复盘教练。\n你习惯把混乱的经历拆成可执行的经验。\n你不灌鸡汤，只帮对方看清下一步。'}
            className={`${inputCls} px-3 py-2 leading-relaxed resize-none`} style={inputStyle} />
        </div>

        <div className="space-y-1.5">
          {field('说话风格', '可选')}
          <input value={style} onChange={e => setStyle(e.target.value)} placeholder="例如：短句、直接、偶尔毒舌但善意" className={`${inputCls} h-9`} style={inputStyle} />
        </div>

        <div className="space-y-1.5">
          {field('开场白', '可选 · 新会话第一句')}
          <input value={opening} onChange={e => setOpening(e.target.value)} placeholder="例如：又见面了。这次想复盘什么？" className={`${inputCls} h-9`} style={inputStyle} />
        </div>

        <div className="space-y-1.5">
          {field('额外边界', '每行一条 · 这个角色绝不做什么')}
          <textarea value={boundaries.join('\n')} onChange={e => setBoundaries(e.target.value.split('\n').slice(0, 9))} rows={2}
            placeholder={'不给医疗、法律建议\n不讨论政治立场'}
            className={`${inputCls} px-3 py-2 leading-relaxed resize-none`} style={inputStyle} />
          <div className="text-[10.5px] px-2.5 py-1.5 rounded-lg" style={{ background: c.bgInput, color: c.textMuted }}>
            固定红线（自动附加，不可移除）：{REQUIRED_BOUNDARY}；不诱导依赖、不阻碍退出
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-lg text-[11.5px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>{error}</div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={onCancel} className="h-9 px-4 rounded-lg text-[12.5px]" style={{ border: `1px solid ${c.borderLight}`, color: c.textSecondary }}>取消</button>
          <div className="flex-1" />
          <button onClick={submit} disabled={!canSave} className="h-9 px-5 rounded-lg text-[12.5px] font-medium disabled:opacity-30"
            style={{ background: c.textHead, color: c.bg }}>
            {saving ? '保存中...' : editing ? '保存修改' : '创建角色'}
          </button>
        </div>
      </div>
    </div>
  )
}