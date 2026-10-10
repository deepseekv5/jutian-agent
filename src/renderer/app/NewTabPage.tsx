import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'

// 新建标签页：点 Tab 栏 + 后打开的页面，列出全部工作区入口。
// 布局学 clerkbox 官网三段式：定位语 hero → 徽章亮点 → 分组能力卡；
// 保持应用自身的白色极简 + 液态玻璃审美，不引入外部素材与文案。
const PAGE_DESC: Partial<Record<PageType, string>> = {
  chat: '开始一段新对话',
  persona: '有长期记忆的 AI 角色，免费直接聊',
  files: '浏览与管理工作目录中的文件',
  terminal: '在本地执行 Shell 命令',
  ppt: 'AI 生成演示文稿并在线编辑',
  outputs: '查看所有生成的文件与作品',
  skills: '安装与管理 AI 技能',
  code: 'Agentic 编码：文件 · 终端 · diff 审查',
  memory: '查看与管理长期记忆',
  tasks: '创建定时任务自动运行',
  qqbot: '连接 QQ 机器人',
  settings: '应用设置与数据管理',
  about: '版本信息与更新日志',
  call: '全屏语音对话，可边说边执行任务',
  kb: '文件夹变知识库，对话自动引用',
  freemodels: '免 key 免费模型目录，一键切换',
  diary: '记录每天的工作与生活',
}

const GROUPS: { label: string; labelEn: string; items: PageType[] }[] = [
  { label: '对话与角色', labelEn: 'Chat & Personas', items: ['chat', 'persona', 'call'] },
  { label: '核心工作区', labelEn: 'Workspace', items: ['code', 'terminal', 'files', 'ppt'] },
  { label: '扩展能力', labelEn: 'Extended', items: ['kb', 'skills', 'memory', 'tasks', 'outputs', 'diary', 'freemodels'] },
  { label: 'Agent 集群', labelEn: 'Agent Swarm', items: ['employees'] },
  { label: '集成与配置', labelEn: 'Integration', items: ['qqbot', 'settings', 'about'] },
]

// 徽章亮点：短标题 + 一句话，对应官网「核心能力」区的浓缩版
const HIGHLIGHTS: { zh: string; en: string }[] = [
  { zh: '本地优先 · 数据不出本机', en: 'Local-first · data stays on your machine' },
  { zh: '开源可审计 · MIT 协议', en: 'Open source · MIT licensed' },
  { zh: '免费模型开箱即用 · 免 key', en: 'Free models out of the box · keyless' },
  { zh: '危险命令需你点头', en: 'Dangerous commands need your nod' },
]

interface Props {
  onPick: (type: PageType) => void
}

export default function NewTabPage({ onPick }: Props) {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin glass">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* 定位语 hero */}
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: c.textHead, letterSpacing: '-0.02em' }}>
            {t('一个工作台，装下全部工作流', 'One workspace for every workflow')}
          </h1>
          <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: c.textSecondary }}>
            {t(
              '从一次提问到一次完整交付——搜索、写作、编码、自动化都在同一个本地面板里。',
              'From a single question to a complete delivery — search, writing, coding and automation in one local panel.'
            )}
          </p>
          {/* 徽章亮点 */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {HIGHLIGHTS.map(h => (
              <span key={h.zh} className="text-[10.5px] px-2 py-1 rounded-full"
                style={{ background: c.bgInput, color: c.textTertiary, border: `1px solid ${c.borderLight}` }}>
                {lang === 'en' ? h.en : h.zh}
              </span>
            ))}
          </div>
        </div>

        <div className="mb-5 flex items-center gap-2">
          <span className="text-[11px] font-medium" style={{ color: c.textTertiary }}>{t('工作区入口', 'Workspace')}</span>
          <div className="flex-1 h-px" style={{ background: c.borderLight }} />
          <span className="text-[10.5px]" style={{ color: c.textMuted }}>{t('选择后本标签页自动关闭', 'This tab closes after you pick')}</span>
        </div>

        {GROUPS.map(g => (
          <div key={g.label} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-medium" style={{ color: c.textTertiary }}>{g.label}</span>
              <span className="text-[10px] font-mono" style={{ color: c.textMuted }}>{g.items.length}</span>
              <div className="flex-1 h-px" style={{ background: c.borderLight }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {g.items.map(type => {
                const meta = PAGE_META[type]
                return (
                  <button key={type} onClick={() => onPick(type)}
                    className="group flex items-center gap-3 px-3.5 py-3 rounded-lg text-left transition-colors glass"
                    style={{ border: `1px solid ${c.borderLight}` }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.background = c.bgHover }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = c.borderLight; e.currentTarget.style.background = c.bgCard }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bgInput, color: c.textSecondary }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={meta.icon} />
                      </svg>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium" style={{ color: c.textHead }}>{lang === 'en' && meta.labelEn ? meta.labelEn : meta.label}</span>
                      <span className="block text-[11px] truncate" style={{ color: c.textTertiary }}>{PAGE_DESC[type]}</span>
                    </span>
                    <svg className="w-3.5 h-3.5 shrink-0 opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: c.textMuted }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}