/**
 * 提示词模板库面板（v12）
 *
 * 左侧分类 → 中间模板列表 → 右侧变量填写 + 预览。
 * 点「填入输入框」后把渲染好的文本通过事件交给聊天输入框，
 * 不直接持有输入框状态，避免与 MessageInput 耦合。
 */
import { useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { PROMPT_CATEGORIES, PROMPT_TEMPLATES, fillTemplate, missingVars, searchTemplates, type PromptTemplate } from '../../shared/promptTemplates'

export default function TemplatesPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [cat, setCat] = useState<'all' | PromptTemplate['category']>('all')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<PromptTemplate | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})

  const list = useMemo(() => {
    const base = q.trim() ? searchTemplates(q, PROMPT_TEMPLATES) : PROMPT_TEMPLATES
    return cat === 'all' ? base : base.filter((t) => t.category === cat)
  }, [q, cat])

  const missing = picked ? missingVars(picked, values) : []
  const preview = picked ? fillTemplate(picked.body, values) : ''

  const use = () => {
    if (!picked) return
    window.dispatchEvent(new CustomEvent('insert-into-input', { detail: preview }))
    onClose()
  }

  return (
    <div className="flex h-full min-h-0" style={{ background: 'transparent' }}>
      {/* 分类 */}
      <div className="w-36 shrink-0 border-r flex flex-col gap-0.5 p-2" style={{ borderColor: c.borderLight }}>
        <div className="text-[10px] font-bold px-2 py-1 tracking-wider" style={{ color: c.textTertiary }}>分类</div>
        {([{ id: 'all', label: '全部' }, ...PROMPT_CATEGORIES] as const).map((it) => (
          <button key={it.id} onClick={() => setCat(it.id as any)}
            className="text-left px-2 py-1.5 rounded-lg text-[12px] transition-colors"
            style={{ background: cat === it.id ? c.bgActive || c.bgInput : 'transparent', color: cat === it.id ? c.textHead : c.textTertiary }}>
            {it.label}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="w-64 shrink-0 border-r flex flex-col min-h-0" style={{ borderColor: c.borderLight }}>
        <div className="p-2 border-b" style={{ borderColor: c.borderLight }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索模板…"
            className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
            style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-1.5">
          {list.length === 0 && <div className="px-2 py-6 text-center text-[11px]" style={{ color: c.textTertiary }}>没有匹配的模板</div>}
          {list.map((t) => (
            <button key={t.id} onClick={() => { setPicked(t); setValues({}) }}
              className="w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors"
              style={{ background: picked?.id === t.id ? c.bgActive || c.bgInput : 'transparent' }}>
              <div className="text-[12.5px] font-medium truncate" style={{ color: c.textHead }}>{t.name}</div>
              <div className="text-[10.5px] truncate" style={{ color: c.textTertiary }}>{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 填写区 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {!picked ? (
          <div className="flex-1 grid place-items-center text-[12px]" style={{ color: c.textTertiary }}>
            选一个模板开始
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: c.borderLight }}>
              <span className="text-[13px] font-bold" style={{ color: c.textHead }}>{picked.name}</span>
              <span className="text-[10.5px]" style={{ color: c.textTertiary }}>{picked.description}</span>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              {picked.vars.map((v) => (
                <div key={v.key}>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: c.textSecondary || c.textTertiary }}>{v.label}</label>
                  {v.multiline ? (
                    <textarea value={values[v.key] || ''} onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                      placeholder={v.placeholder || ''} rows={5}
                      className="w-full px-2.5 py-2 rounded-lg text-[12px] outline-none resize-y font-mono"
                      style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
                  ) : (
                    <input value={values[v.key] || ''} onChange={(e) => setValues((s) => ({ ...s, [v.key]: e.target.value }))}
                      placeholder={v.placeholder || ''}
                      className="w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none"
                      style={{ background: c.bgInput, color: c.textHead, border: `1px solid ${c.borderLight}` }} />
                  )}
                </div>
              ))}
              <div>
                <div className="text-[11px] font-medium mb-1" style={{ color: c.textSecondary || c.textTertiary }}>预览</div>
                <pre className="whitespace-pre-wrap break-words px-3 py-2.5 rounded-lg text-[11.5px] font-mono leading-relaxed max-h-64 overflow-y-auto scrollbar-thin"
                  style={{ background: c.bgInput, color: c.textSecondary || c.textTertiary, border: `1px solid ${c.borderLight}` }}>{preview}</pre>
              </div>
            </div>
            <div className="px-4 py-2.5 border-t flex items-center gap-2" style={{ borderColor: c.borderLight }}>
              {missing.length > 0 && (
                <span className="text-[10.5px]" style={{ color: c.textTertiary }}>还有 {missing.length} 项没填（未填的占位符会原样保留）</span>
              )}
              <span className="flex-1" />
              <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textTertiary }}>取消</button>
              <button onClick={use}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: c.accent || '#10a37f' }}>
                填入输入框
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
