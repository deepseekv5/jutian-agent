import { useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { fetchCompat } from '../api'
import { wrapGongwenDocument, markdownToHtml } from '../../shared/exportHtml'
import { GONGWEN_PROMPT } from '../../shared/chatModes'

/**
 * 公文写作台（v15.5.0）
 *
 * 以前「写公文」只是往聊天里塞一段提示词，模型会把思考、草稿、解释一起吐出来，
 * 用户看到的不是一份公文。这里改成独立工作台：
 *   左：要素表单（文种/发文机关/主送/标题/正文/附件/落款）+ AI 起草（只取正文）
 *   右：iframe srcDoc 实时红头预览（复用 wrapGongwenDocument 的 GB/T 9704 版式）
 *   导出：.doc（HTML-Word）/ .html / 打印，所见即所得。
 * 与聊天里那个公文开关并存，入口统一收拢到这里。
 */

const DOC_TYPES = ['通知', '请示', '报告', '批复', '函', '纪要', '意见', '决定'] as const
type DocType = typeof DOC_TYPES[number]

const ENDINGS: Record<DocType, string> = {
  通知: '特此通知。', 请示: '妥否，请批示。', 报告: '专此报告。',
  批复: '此复。', 函: '特此函告。', 纪要: '特此纪要。',
  意见: '以上意见，请予研究采纳。', 决定: '本决定自印发之日起施行。',
}

const SEEDS: Record<DocType, string> = {
  通知: `一、总体要求\n（一）提高认识\n1. 各单位要充分认识本次工作的重要性。\n（1）加强组织领导，明确责任分工。\n\n二、主要任务\n（一）抓好落实\n1. 按时间节点推进各项工作。\n（1）确保任务到人、责任到岗。`,
  请示: `一、请示事由\n（一）基本情况\n1. 当前工作进展\n（1）有关事项亟需上级审定。\n\n二、请示事项\n（一）拟请批准内容\n1. 具体方案\n（1）妥否，请批示。`,
  报告: `一、基本情况\n（一）工作推进\n1. 主要做法\n（1）各项任务按计划实施。\n\n二、下一步安排\n（一）工作打算\n1. 持续推进\n（1）专此报告。`,
  批复: `一、关于请示事项的答复\n（一）原则同意\n1. 有关要求\n（1）请遵照执行。`,
  函: `一、商洽事项\n（一）主要内容\n1. 具体情况\n（1）请予支持为盼。`,
  纪要: `一、会议基本情况\n（一）时间与人员\n1. 议定事项\n（1）请各单位遵照执行。`,
  意见: `一、总体思路\n（一）指导思想\n1. 主要举措\n（1）请结合实际贯彻落实。`,
  决定: `一、决定事项\n（一）主要内容\n1. 有关要求\n（1）本决定自印发之日起施行。`,
}

interface Fields {
  docType: DocType
  issuer: string
  recipient: string
  title: string
  basis: string
  body: string
  attachment: string
  date: string
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const escapeHtmlText = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))

const initial = (): Fields => ({
  docType: '通知', issuer: '××市人民政府办公室', recipient: '各有关单位',
  title: '关于加强公文管理工作的通知', basis: '根据《关于加强公文管理工作的通知》（×办发〔2025〕12号）有关要求',
  body: SEEDS['通知'], attachment: '', date: today(),
})

function buildDraft(f: Fields): string {
  const lines: string[] = []
  if (f.recipient) lines.push(`${f.recipient}：`)
  lines.push('')
  if (f.basis) {
    const verb = f.docType === '通知' ? '通知' : f.docType === '请示' ? '请示' : '报告'
    lines.push(`${f.basis}，现将有关事项${verb}如下：`)
  }
  lines.push('')
  lines.push(f.body.trim())
  lines.push('')
  const ending = ENDINGS[f.docType]
  if (ending) lines.push(ending)
  if (f.attachment.trim()) lines.push('', `附件：${f.attachment.trim()}`, '')
  lines.push('', f.issuer, f.date)
  return lines.join('\n')
}

export default function GongwenDesk() {
  const { c } = useTheme()
  const [f, setF] = useState<Fields>(initial)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF(prev => ({ ...prev, [k]: v }))

  const draft = useMemo(() => buildDraft(f), [f])
  const title = f.title.trim() || `${f.issuer}关于有关事项的${f.docType}`
  // 公文层级「1.」是第三层序号，不是 markdown 有序列表：
  // 换成全角点，避免 markdownToHtml 把它渲染成 <ol><li>（聊天导出那边保持原样）。
  const previewMd = useMemo(() => draft.split('\n').map(l => l.replace(/^(\s*)(\d+)\.\s+/, '$1$2． ')).join('\n'), [draft])
  const html = useMemo(() => {
    // 落款（发文机关 + 成文日期）从正文里摘出来单独右对齐，符合 GB/T 9704
    const lines = previewMd.replace(/\s+$/, '').split('\n')
    let body = previewMd
    let sign = ''
    if (lines.length >= 2) {
      const last = lines[lines.length - 1].trim()
      const prev = lines[lines.length - 2].trim()
      if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(last)) {
        body = lines.slice(0, -2).join('\n')
        sign = `<p style="text-align:right;text-indent:0;margin-top:36px">${escapeHtmlText(prev)}<br>${escapeHtmlText(last)}</p>`
      }
    }
    // 主送机关顶格（不缩进），其余段落保持公文首行缩进 2 字符
    let bodyHtml = markdownToHtml(body)
    const recipientLine = escapeHtmlText(`${f.recipient}：`)
    bodyHtml = bodyHtml.replace(`<p>${recipientLine}</p>`, `<p style="text-indent:0">${recipientLine}</p>`)
    return wrapGongwenDocument(title, bodyHtml + sign, `${f.issuer} · ${f.date}`)
  }, [title, previewMd, f.issuer, f.date])

  const aiDraft = async () => {
    if (aiBusy) return
    setAiBusy(true); setAiErr('')
    try {
      const topic = f.title.trim() || '有关工作事项'
      const brief = [
        `文种：${f.docType}`,
        `发文机关：${f.issuer}`,
        `主送机关：${f.recipient}`,
        `事由：${topic}`,
        `依据：${f.basis}`,
        `要点：${f.body.slice(0, 600)}`,
      ].join('\n')
      const res = await fetchCompat('/api/llm-proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: (() => { try { return JSON.parse(localStorage.getItem('lyclaw_settings') || '{}').model || '' } catch { return '' } })(),
          messages: [
            { role: 'system', content: `${GONGWEN_PROMPT}\n\n【额外约束】只输出公文正文（从主送机关开始到落款结束），不要输出思考过程、不要解释、不要复述本指令、不要写「以上模板供参考」。正文段落之间用空行分隔，结构层次严格按一、（一）1.（1）。` },
            { role: 'user', content: brief },
          ],
          stream: false, max_tokens: 1600,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => null)
      let text = String(data?.choices?.[0]?.message?.content || '').trim()
      if (!text) throw new Error('模型返回为空')
      // 剥掉模型常见的解释性外壳：只保留从主送机关/引据开始的正文
      const fence = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/)
      if (fence) text = fence[1].trim()
      const start = text.search(/(?:^|\n)[^\n]{2,40}：|^\s*根据|^\s*为[^\n]{2,30}，|^\s*一、/)
      if (start > 0) text = text.slice(start).trim()
      text = text.replace(/^(?:好的|以下是|根据您的要求)[^\n]*\n+/, '').trim()
      // AI 输出塞进 body，但主送/落款仍由表单控制，预览保持一致
      const bodyOnly = text
        .replace(/\n{0,2}[^\n]{2,30}：\s*\n/, '\n')  // 去掉它可能自带的主送行
        .replace(/\n{0,2}\d{4}年\d{1,2}月\d{1,2}日\s*$/, '')
        .trim()
      setF(prev => ({ ...prev, body: bodyOnly || text }))
      setPreviewKey(k => k + 1)
    } catch (e) {
      setAiErr(`起草失败：${String((e as Error)?.message || e)}。请检查设置里的模型与密钥，或直接在左侧编辑。`)
    } finally { setAiBusy(false) }
  }

  const download = (ext: 'doc' | 'html') => {
    const blob = new Blob([html], { type: ext === 'doc' ? 'application/msword' : 'text/html;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const label = 'block text-[11px] font-medium mb-1'
  const input = 'w-full px-2.5 py-1.5 rounded-lg text-[12.5px] outline-none'
  const inputStyle = { background: c.bgInput, border: `1px solid ${c.borderLight}`, color: c.text }
  const btn = 'text-[11.5px] px-3 py-1.5 rounded-lg font-medium transition-colors'

  return (
    <div className="flex-1 h-full flex min-h-0" style={{ background: 'transparent' }}>
      {/* 左：要素编辑 */}
      <div className="w-[46%] min-w-[320px] shrink-0 overflow-y-auto scrollbar-thin px-6 py-5" style={{ borderRight: `1px solid ${c.borderLight}` }}>
        <div className="mb-5">
          <div className="text-[16px] font-semibold" style={{ color: c.textHead }}>公文写作台</div>
          <div className="text-[11px] mt-1" style={{ color: c.textTertiary }}>填要素 → 右侧实时红头预览 → 导出 Word。GB/T 9704 版式。</div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={label} style={{ color: c.textTertiary }}>文种</label>
            <select value={f.docType} onChange={e => { const dt = e.target.value as DocType; setF(prev => ({ ...prev, docType: dt, body: prev.body.trim() === SEEDS[prev.docType].trim() ? SEEDS[dt] : prev.body })) }}
              className={input} style={inputStyle}>
              {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={label} style={{ color: c.textTertiary }}>成文日期</label>
            <input value={f.date} onChange={e => set('date', e.target.value)} className={input} style={inputStyle} />
          </div>
        </div>
        <div className="mb-3">
          <label className={label} style={{ color: c.textTertiary }}>发文机关（红头落款）</label>
          <input value={f.issuer} onChange={e => set('issuer', e.target.value)} className={input} style={inputStyle} />
        </div>
        <div className="mb-3">
          <label className={label} style={{ color: c.textTertiary }}>主送机关（顶格，自动补全角冒号）</label>
          <input value={f.recipient} onChange={e => set('recipient', e.target.value)} className={input} style={inputStyle} />
        </div>
        <div className="mb-3">
          <label className={label} style={{ color: c.textTertiary }}>标题（发文机关 + 事由 + 文种）</label>
          <input value={f.title} onChange={e => set('title', e.target.value)} className={input} style={inputStyle} />
        </div>
        <div className="mb-3">
          <label className={label} style={{ color: c.textTertiary }}>开头引据（依据 / 目的）</label>
          <input value={f.basis} onChange={e => set('basis', e.target.value)} className={input} style={inputStyle} />
        </div>
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium" style={{ color: c.textTertiary }}>正文（一、→（一）→ 1. →（1））</label>
            <button onClick={() => { setF(prev => ({ ...prev, body: SEEDS[prev.docType] })); setPreviewKey(k => k + 1) }}
              className="text-[10.5px]" style={{ color: c.textMuted, background: 'transparent', border: 'none' }}>重置为示例</button>
          </div>
          <textarea value={f.body} onChange={e => set('body', e.target.value)} rows={14}
            className="w-full px-2.5 py-2 rounded-lg text-[12.5px] outline-none resize-y font-mono leading-[1.7]"
            style={{ ...inputStyle, minHeight: 220 }} />
        </div>
        <div className="mb-5">
          <label className={label} style={{ color: c.textTertiary }}>附件（可选，多个用顿号分隔）</label>
          <input value={f.attachment} onChange={e => set('attachment', e.target.value)} placeholder="如：1.任务清单 2.进度表" className={input} style={inputStyle} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={aiDraft} disabled={aiBusy} className={btn}
            style={{ background: '#c7000b', color: '#fff', opacity: aiBusy ? .6 : 1 }}>
            {aiBusy ? '起草中…' : 'AI 起草正文'}
          </button>
          <button onClick={() => setPreviewKey(k => k + 1)} className={btn}
            style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>刷新预览</button>
          <button onClick={() => download('doc')} className={btn}
            style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>导出红头 Word</button>
          <button onClick={() => download('html')} className={btn}
            style={{ background: c.bgInput, color: c.textSecondary, border: `1px solid ${c.borderLight}` }}>导出 HTML</button>
        </div>
        {aiErr && <div className="mt-3 text-[11px] leading-relaxed" style={{ color: '#c7000b' }}>{aiErr}</div>}
      </div>

      {/* 右：实时红头预览（iframe 隔离整页 CSS，sandbox 不给 allow-same-origin） */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ background: '#eae5da' }}>
        <div className="flex items-center justify-between px-4 py-2 shrink-0" style={{ borderBottom: `1px solid ${c.borderLight}`, background: '#f5f1e8' }}>
          <span className="text-[11px] font-medium" style={{ color: c.textSecondary }}>红头预览 · 与导出一致</span>
          <span className="text-[10.5px]" style={{ color: c.textMuted }}>A4 · 3.7cm 天头 · 仿宋 16pt</span>
        </div>
        <iframe key={previewKey} title="公文红头预览" sandbox="allow-scripts" srcDoc={html}
          style={{ display: 'block', width: '100%', flex: 1, border: 0, background: '#eae5da' }} />
      </div>
    </div>
  )
}
