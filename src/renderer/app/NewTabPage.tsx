import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'
import { BUILTIN_TOOLS } from '../types'

// 工具数从 schema 派生：新增工具时这里不用跟着改
// （此前硬编码 "39 个工具"，加工具就得记得改文案，必然漂移）
const TOOL_COUNT = BUILTIN_TOOLS.length

// 新建标签页：点 Tab 栏 + 后打开的页面，列出全部工作区入口。
// 学 clerkbox 官网的展示结构：定位语 hero → 徽章亮点 → 分组能力卡；
// 每张卡都带「这是什么 / 能干嘛」介绍，用户不用猜。
// 保持应用自身的白色极简 + 液态玻璃审美，不引入外部素材与文案。

interface Card {
  type: PageType
  /** 一句话介绍：这是什么 */
  desc: string
  descEn: string
  /** 能力标签：进去能干什么 */
  chips: string[]
  chipsEn: string[]
}

const CARDS: Card[] = [
  { type: 'chat', desc: '和 AI 直接对话，一句话让它把活干完', descEn: 'Talk to the agent — it finishes the work, not just answers', chips: [`${TOOL_COUNT} 个工具`, '目标模式'], chipsEn: [`${TOOL_COUNT} tools`, 'Goal mode'] },
  { type: 'persona', desc: '有长期记忆的 AI 角色，免费直接聊', descEn: 'AI personas with long-term memory — free', chips: ['记忆', '朗读', '画画'], chipsEn: ['Memory', 'Voice', 'Paint'] },
  { type: 'research', desc: '多路检索·交叉验证·带引用报告，历史可查', descEn: 'Multi-query search, cross-checked, cited report', chips: ['实时进度', '来源清单', '历史归档'], chipsEn: ['Live progress', 'Sources', 'Archive'] },
  { type: 'call', desc: '全屏语音通话，边说边执行任务', descEn: 'Full-screen voice call that executes as you talk', chips: ['实时对话'], chipsEn: ['Realtime'] },
  { type: 'code', desc: 'AI 编程工作台，文件 · 终端 · diff 一体', descEn: 'Agentic coding: files · terminal · diff in one', chips: ['Git 检查点', '多标签', '语法高亮'], chipsEn: ['Git checkpoints', 'Tabs', 'Highlight'] },
  { type: 'terminal', desc: '在本机终端执行命令，危险操作先问你', descEn: 'Run shell commands locally, ask before danger', chips: ['PowerShell / zsh'], chipsEn: ['PowerShell / zsh'] },
  { type: 'files', desc: '浏览、编辑、管理工作目录里的文件', descEn: 'Browse, edit and manage your working files', chips: ['预览', '编辑'], chipsEn: ['Preview', 'Edit'] },
  { type: 'ppt', desc: 'AI 生成演示文稿，支持在线微调', descEn: 'Generate decks with AI, fine-tune in the editor', chips: ['模板', '图表'], chipsEn: ['Templates', 'Charts'] },
  { type: 'kb', desc: '文件夹变知识库，对话自动引用', descEn: 'Turn folders into a knowledge base, cited in chat', chips: ['双链笔记', '知识图谱'], chipsEn: ['Backlinks', 'Graph'] },
  { type: 'skills', desc: '安装管理 AI 技能，扩展能力边界', descEn: 'Install skills to extend the agent', chips: ['10 内置', 'GitHub'], chipsEn: ['10 built-in', 'GitHub'] },
  { type: 'memory', desc: '查看与管理跨会话的长期记忆', descEn: 'View and manage long-term memory', chips: ['角色记忆', '一键删除'], chipsEn: ['Persona memory', 'Delete'] },
  { type: 'tasks', desc: '创建定时任务，到点自动执行', descEn: 'Scheduled tasks that run on time', chips: ['cron'], chipsEn: ['cron'] },
  { type: 'outputs', desc: '查看所有生成的文件与作品', descEn: 'Everything the agent produced', chips: ['PPT', '文档', '图片'], chipsEn: ['Decks', 'Docs', 'Images'] },
  { type: 'diary', desc: '记录每天的工作与生活', descEn: 'Your daily log', chips: ['时间线'], chipsEn: ['Timeline'] },
  { type: 'employees', desc: 'Agent 集群：总管拆任务，成员互相 @ 接管', descEn: 'Swarm: lead delegates, members relay', chips: ['并行', '自定义员工'], chipsEn: ['Parallel', 'Custom agents'] },
  { type: 'freemodels', desc: '免 key 免费模型目录，一键切换', descEn: 'Keyless free models, one-click switch', chips: ['26 个免费档'], chipsEn: ['26 free tiers'] },
  { type: 'qqbot', desc: '连接 QQ 机器人，聊天里指挥它干活', descEn: 'Connect a QQ bot and command it from chat', chips: ['官方网关'], chipsEn: ['Official gateway'] },
  { type: 'settings', desc: '模型、外观、权限与数据管理', descEn: 'Model, appearance, permissions, data', chips: ['种子色', '协议'], chipsEn: ['Seed color', 'Legal'] },
  { type: 'about', desc: '版本、更新日志与自动更新', descEn: 'Version, changelog, auto-update', chips: ['一键更新'], chipsEn: ['One-click update'] },
]

const GROUPS: { label: string; labelEn: string; items: PageType[] }[] = [
  { label: '对话与角色', labelEn: 'Chat & Personas', items: ['chat', 'persona', 'call'] },
  { label: '研究与产出', labelEn: 'Research & Output', items: ['research', 'ppt', 'outputs'] },
  { label: '核心工作区', labelEn: 'Workspace', items: ['code', 'terminal', 'files'] },
  { label: '扩展能力', labelEn: 'Extended', items: ['kb', 'skills', 'memory', 'tasks', 'diary', 'employees', 'freemodels'] },
  { label: '集成与配置', labelEn: 'Integration', items: ['qqbot', 'settings', 'about'] },
]

// 徽章亮点：短标题 + 一句话
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
  const byType = new Map(CARDS.map(k => [k.type, k]))
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
                const card = byType.get(type)
                return (
                  <button key={type} onClick={() => onPick(type)}
                    className="group flex flex-col p-3.5 rounded-xl text-left transition-all glass"
                    style={{ border: `1px solid ${c.borderLight}` }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = c.borderLight; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bgInput, color: c.textSecondary }}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={meta.icon} />
                        </svg>
                      </span>
                      <span className="text-[13.5px] font-medium" style={{ color: c.textHead }}>{lang === 'en' && meta.labelEn ? meta.labelEn : meta.label}</span>
                    </div>
                    {card && (
                      <>
                        <p className="text-[11.5px] leading-relaxed" style={{ color: c.textSecondary }}>
                          {lang === 'en' ? card.descEn : card.desc}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(lang === 'en' ? card.chipsEn : card.chips).map((chip, ci) => (
                            <span key={ci} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: c.bgInput, color: c.textTertiary }}>
                              {chip}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
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
