/**
 * 欢迎首页 —— ChatGPT/Codex 风格：居中问候 + 建议胶囊 + 紧凑分段控件。
 * 场景切换 / 换一批收进一个控件行；页面快捷入口已移除（侧边栏与标签栏已有，不重复占画面）。
 */
import { useMemo, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { summarizeUsage } from '../store/usage'
import { fmtTokens } from '../utils/tokens'

interface Props {
  onPick: (prompt: string) => void
}

interface CaseItem { title: string; titleEn?: string; desc: string; descEn?: string; prompt: string; promptEn?: string; icon: string }

const CASES: Record<string, { label: string; labelEn?: string; items: CaseItem[] }> = {
  office: {
    label: '日常办公', labelEn: 'Office',
    items: [
      { title: '会议纪要整理', titleEn: 'Meeting notes', desc: '录音要点 → 规范纪要 + 待办清单', descEn: 'Raw points → notes + action items', prompt: '帮我把以下会议要点整理成规范的会议纪要，包含决议事项和待办清单：\n', promptEn: 'Turn these meeting points into formal minutes with decisions and action items:\n', icon: 'M9 12h6m-6 4h6M8 4h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z' },
      { title: '周报生成', titleEn: 'Weekly report', desc: '零散工作记录 → 结构化周报', descEn: 'Scattered notes → structured report', prompt: '根据我本周完成的工作要点，生成一份结构清晰的周报：\n', promptEn: 'Based on my work notes this week, draft a structured weekly report:\n', icon: 'M9 17v-6m4 6V7m4 10v-3M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z' },
      { title: '邮件润色', titleEn: 'Polish email', desc: '语气、格式、分寸感', descEn: 'Tone, format, tact', prompt: '帮我润色这封邮件回复，语气专业得体：\n', promptEn: 'Polish this email reply — professional and tactful:\n', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
      { title: '数据整理', titleEn: 'Clean data', desc: '清洗、透视、可视化建议', descEn: 'Clean, pivot, visualize', prompt: '我有一份数据需要清洗和整理，需求如下：\n', promptEn: 'I have a dataset to clean and organize:\n', icon: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    ],
  },
  code: {
    label: '代码开发', labelEn: 'Coding',
    items: [
      { title: '定位修复 Bug', titleEn: 'Fix a bug', desc: '先分析根因，再给修复方案', descEn: 'Root cause first, then fix', prompt: '帮我定位并修复这个 bug，先分析根因再给出修复方案：\n', promptEn: 'Locate and fix this bug — analyze the root cause first:\n', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      { title: '补充单元测试', titleEn: 'Unit tests', desc: '主要分支 + 边界情况', descEn: 'Main branches + edge cases', prompt: '为以下代码编写单元测试，覆盖主要分支和边界情况：\n', promptEn: 'Write unit tests covering main branches and edge cases:\n', icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
      { title: '代码审查', titleEn: 'Code review', desc: '潜在问题 + 性能建议', descEn: 'Issues + perf suggestions', prompt: '请审查这段代码，找出潜在问题并给出性能优化建议：\n', promptEn: 'Review this code for issues and performance improvements:\n', icon: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4' },
      { title: '项目结构解析', titleEn: 'Project map', desc: '架构、模块职责、依赖关系', descEn: 'Architecture, modules, deps', prompt: '帮我分析这个项目的整体架构和模块职责：\n', promptEn: 'Analyze this project\'s architecture and module responsibilities:\n', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
    ],
  },
  writing: {
    label: '写作创意', labelEn: 'Writing',
    items: [
      { title: '幻灯片大纲', titleEn: 'Slide outline', desc: '主题 → 分页结构与讲稿', descEn: 'Topic → structure + script', prompt: '帮我生成一份 PPT 大纲，主题与受众：', promptEn: 'Draft a slide outline. Topic and audience:', icon: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2h-2m-6 0h6a2 2 0 012 2v1a2 2 0 01-2 2h-6a2 2 0 01-2-2v-1a2 2 0 012-2z' },
      { title: '种草文案', titleEn: 'Social post', desc: '小红书风格，带话题标签', descEn: 'RED style, with hashtags', prompt: '帮我写一篇小红书风格的种草文案，主题：', promptEn: 'Write a social media post in RED style. Topic:', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
      { title: '品牌命名', titleEn: 'Brand naming', desc: '头脑风暴 + 可用性初筛', descEn: 'Brainstorm + shortlist', prompt: '帮我头脑风暴品牌命名，产品定位：', promptEn: 'Brainstorm brand names. Positioning:', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
      { title: '长文缩写', titleEn: 'Summarize long doc', desc: '报告 → 一页摘要', descEn: 'Report → one-pager', prompt: '帮我把以下长文压缩成一篇摘要，保留关键结论：\n', promptEn: 'Compress this long document into a one-page summary keeping key conclusions:\n', icon: 'M4 6h16M4 12h10m-10 6h7' },
    ],
  },
}

const CAT_KEYS = Object.keys(CASES)

export default function WelcomeHero({ onPick }: Props) {
  const { lang } = useLanguage()
  const [cat, setCat] = useState(CAT_KEYS[0])
  const [offset, setOffset] = useState(0)
  const { c } = useTheme()
  const usage = summarizeUsage(1).today
  const _h = new Date().getHours()
  const greeting = lang === 'en'
    ? (_h < 12 ? 'Good morning' : _h < 18 ? 'Good afternoon' : 'Good evening')
    : (_h < 6 ? '夜深了' : _h < 11 ? '早上好' : _h < 14 ? '中午好' : _h < 18 ? '下午好' : '晚上好')

  const items = useMemo(() => {
    const list = CASES[cat].items
    const k = offset % list.length
    return list.slice(k).concat(list.slice(0, k))
  }, [cat, offset])

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto scrollbar-thin px-6 py-10">
      <div className="w-full max-w-2xl flex flex-col items-center m-auto">
        {/* 问候 —— ChatGPT 居中大字 */}
        <h1 className="text-[28px] font-semibold tracking-tight text-center" style={{ color: c.textHead, letterSpacing: '-0.02em' }}>
          {lang === 'en' ? `${greeting}. What can I do for you?` : `${greeting}，有什么可以帮忙的？`}
        </h1>

        {/* 建议胶囊 —— ChatGPT 风格的一行建议 */}
        <div className="mt-8 mb-6 flex flex-wrap justify-center gap-2.5">
          {items.map(item => (
            <button key={item.title} onClick={() => onPick(lang === 'en' ? (item.promptEn || item.prompt) : item.prompt)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[13.5px] transition-all glass"
              style={{ border: `1px solid ${c.border}`, color: c.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c.borderFocus; e.currentTarget.style.color = c.text }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.color = c.textSecondary }}
              title={lang === 'en' ? (item.descEn || item.desc) : item.desc}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} style={{ color: c.textTertiary }}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {lang === 'en' ? (item.titleEn || item.title) : item.title}
            </button>
          ))}
        </div>

        {/* 场景分段控件 + 换一批 —— 单一控件行，替代旧的多链接行 */}
        <div className="mb-8 flex items-center gap-2">
          <div className="inline-flex items-center p-0.5 rounded-full" style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
            {CAT_KEYS.map(key => (
              <button key={key} onClick={() => { setCat(key); setOffset(0) }}
                className="px-3 h-7 rounded-full text-[12px] transition-colors"
                style={{ background: cat === key ? c.bg : 'transparent', color: cat === key ? c.textHead : c.textTertiary, fontWeight: cat === key ? 500 : 400, boxShadow: cat === key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}>
                {lang === 'en' ? (CASES[key].labelEn || CASES[key].label) : CASES[key].label}
              </button>
            ))}
          </div>
          <button onClick={() => setOffset(o => o + 1)} title={lang === 'en' ? 'Shuffle' : '换一批'}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
            style={{ border: `1px solid ${c.borderLight}`, color: c.textTertiary }}
            onMouseEnter={e => { e.currentTarget.style.color = c.text; e.currentTarget.style.borderColor = c.border }}
            onMouseLeave={e => { e.currentTarget.style.color = c.textTertiary; e.currentTarget.style.borderColor = c.borderLight }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* 今日用量 —— 极轻量页脚 */}
        <div className="text-[11px] font-mono" style={{ color: c.textMuted }}>
          今日 {usage.msgs} 轮 · {fmtTokens(usage.prompt + usage.completion)} tokens
        </div>
      </div>
    </div>
  )
}