import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { PAGE_META, type PageType } from './TabBar'
import { BUILTIN_TOOLS } from '../types'
import { useEffect, useState } from 'react'
import { getRegisteredExts, subscribeExts, extType } from './extensions'
import NewTabSearch from './NewTabSearch'
import { festivalBanner, nextTapCount } from '../../shared/festival1024'
import { loadFavorites, type Favorite } from '../store/favorites'
import FestivalEgg from './FestivalEgg'
import FestivalHome from './FestivalHome'

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
  { type: 'workflow', desc: '多步骤自动化编排，上一步结果喂给下一步', descEn: 'Multi-step automation with chained outputs', chips: ['AI 生成', '示例模板'], chipsEn: ['AI draft', 'Examples'] },
  { type: 'export', desc: '会话导出 Markdown / HTML / PDF', descEn: 'Export chats as Markdown / HTML / PDF', chips: ['多选合并', '按关键词筛'], chipsEn: ['Merge', 'Filter'] },
  { type: 'backup', desc: '数据备份与恢复，选范围导出导入', descEn: 'Backup and restore, pick a scope', chips: ['密钥不进备份'], chipsEn: ['No keys'] },
  { type: 'usage', desc: 'Token 用量与花费趋势，按模型统计', descEn: 'Token usage and spend by model', chips: ['趋势图'], chipsEn: ['Trend'] },
  { type: 'diagnostics', desc: '一键环境自检，生成可复制报告', descEn: 'One-click self-check with a report', chips: ['服务 / 密钥 / 目录'], chipsEn: ['Service / Key / Dir'] },
  { type: 'shortcuts', desc: '查看全部快捷键', descEn: 'All keyboard shortcuts', chips: ['Cmd+K 等'], chipsEn: ['Cmd+K etc.'] },
  { type: 'templates', desc: '可复用提示词模板库，填参数直接用', descEn: 'Reusable prompt templates', chips: ['10 模板'], chipsEn: ['10 templates'] },
  { type: 'snippets', desc: '代码片段库，触发器一键展开', descEn: 'Code snippets with triggers', chips: ['触发词'], chipsEn: ['Trigger'] },
  { type: 'todos', desc: 'AI 维护的任务清单', descEn: 'Todo list the agent maintains', chips: ['实时同步'], chipsEn: ['Live sync'] },
  { type: 'compare', desc: '同一问题让多个模型并行回答，并排对比', descEn: 'Ask several models at once, compare side by side', chips: ['多模型'], chipsEn: ['Multi-model'] },
  { type: 'extensions', desc: 'AI 生成的界面面板，批准后可启用/禁用', descEn: 'AI-created panels, approve to enable', chips: ['用户层', '更新不覆盖'], chipsEn: ['User layer', 'Survives updates'] },
  { type: 'harness', desc: '嵌入 the agent harness 的 WebUI（独立服务，需本机启动）', descEn: 'Embed the agent harness WebUI (standalone local service)', chips: ['外部内核', '实验性'], chipsEn: ['External', 'Experimental'] },
]

const GROUPS: { label: string; labelEn: string; items: PageType[] }[] = [
  { label: '对话与角色', labelEn: 'Chat & Personas', items: ['chat', 'persona', 'call'] },
  { label: '研究与产出', labelEn: 'Research & Output', items: ['research', 'ppt', 'outputs'] },
  { label: '核心工作区', labelEn: 'Workspace', items: ['code', 'terminal', 'files'] },
  { label: '扩展能力', labelEn: 'Extended', items: ['kb', 'skills', 'memory', 'tasks', 'diary', 'employees', 'freemodels'] },
  { label: '自动化与流水线', labelEn: 'Automation', items: ['workflow'] },
  { label: '数据与诊断', labelEn: 'Data & Diagnostics', items: ['export', 'backup', 'usage', 'diagnostics', 'todos', 'compare'] },
  { label: '效率工具', labelEn: 'Productivity', items: ['templates', 'snippets', 'shortcuts'] },
  { label: '集成与配置', labelEn: 'Integration', items: ['qqbot', 'settings', 'about', 'extensions', 'harness'] },
]

/**
 * 新标签页（v15.2.0 重写为 Codex 风默认布局）
 *
 * 视觉：大留白、一句大字、底部一行输入框、纯文字列表——没有卡片/徽章/图标行/促销块。
 * 功能一个不少：31 个工作区入口（按 8 组）、全局搜索、收藏（展开/导出/空态引导）、
 * 概览统计、最近会话、写公文、内核切换、我的扩展、1024 彩蛋、节日主页。
 * 全部以文字呈现，纵向堆叠，从根上消除窄屏按钮重叠。
 */
export default function NewTabPage({ onPick, sessions = [] }: { onPick: (t: PageType) => void; sessions?: { id: string; title?: string; updated_at?: string; created_at?: string }[] }) {
  const [exts, setExts] = useState(getRegisteredExts)
  useEffect(() => subscribeExts(() => setExts(getRegisteredExts())), [])
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const byType = new Map(CARDS.map(k => [k.type, k]))
  const now = new Date()
  const festivalNow = now.getMonth() === 9 && now.getDate() >= 20 && now.getDate() <= 28
  const [eggOpen, setEggOpen] = useState(false)
  const [tap, setTap] = useState({ count: 0, lastAt: 0 })
  const [askText, setAskText] = useState('')
  const submitAsk = () => {
    const v = askText.trim()
    if (!v) return
    // App 接此事件：新建会话 → 会话挂载后把文字填进 composer
    window.dispatchEvent(new CustomEvent('jutian-minimal-ask', { detail: v }))
    setAskText('')
  }
  const banner = festivalBanner()
  const onBadgeTap = () => {
    const r = nextTapCount(tap)
    setTap({ count: r.count, lastAt: r.lastAt })
    if (r.fired) { setEggOpen(true); setTap({ count: 0, lastAt: 0 }) }
  }
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const todaySessions = sessions.filter(x => String(x.updated_at || x.created_at || '') >= dayStart.toISOString()).length
  const [favs, setFavs] = useState<Favorite[]>(loadFavorites)
  const [showAllFavs, setShowAllFavs] = useState(false)
  const [favHintClosed, setFavHintClosed] = useState(() => { try { return localStorage.getItem('lyclaw_fav_hint_done') === '1' } catch { return false } })
  useEffect(() => {
    const h = () => setFavs(loadFavorites())
    window.addEventListener('favorites-changed', h)
    return () => window.removeEventListener('favorites-changed', h)
  }, [])

  if (festivalNow) return <FestivalHome onPick={onPick} />

  const label = (type: PageType) => {
    const meta = PAGE_META[type] || { label: '扩展', labelEn: 'Extension' }
    return lang === 'en' && meta.labelEn ? meta.labelEn : meta.label
  }
  const muted = { color: c.textMuted, fontSize: 10.5 }
  const sec = { color: c.textTertiary, fontSize: 11, fontWeight: 500 } as const

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto px-8" style={{ maxWidth: 720, paddingTop: 80, paddingBottom: 72 }}>

        {/* 一句大字 */}
        <h1 className="text-center font-medium tracking-tight"
          style={{ color: c.textHead, fontSize: 32, letterSpacing: '-0.035em', lineHeight: 1.35 }}>
          {t('今天想做点什么？', 'What should we build?')}
        </h1>

        {/* 唯一输入框：新建对话并把文字带进 composer */}
        <div className="mt-8 rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: c.bgInput, border: `1px solid ${c.borderLight}` }}>
          <input
            value={askText}
            onChange={e => setAskText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAsk() } }}
            placeholder={t('输入一句话开始，回车新建对话…', 'Type to start a new chat…')}
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{ color: c.text }}
            aria-label={t('新建对话', 'New chat')}
          />
          <button onClick={submitAsk} className="w-7 h-7 rounded-lg grid place-items-center shrink-0 transition-colors"
            style={{ background: askText.trim() ? c.accent : c.bgHover, color: askText.trim() ? '#fff' : c.textTertiary }}
            title={t('新建对话', 'New chat')} aria-label={t('新建对话', 'New chat')}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6l6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* 概览：纯文字一行（统计一个不少） */}
        <div className="mt-5 flex items-center justify-center gap-6" style={muted}>
          <span>{t('今日会话', 'Chats today')} {todaySessions}</span>
          <span>{t('收藏', 'Favorites')} {favs.length}</span>
          <span>{t('速记', 'Quick notes')} {sessions.filter(x => x.title === '速记').length}</span>
          <span style={{ color: c.textTertiary }}>{lang === 'en' ? 'Have a productive day.' : '今天也请多指教。'}</span>
        </div>

        {/* 全局搜索（页面/扩展/会话/消息，回车打开） */}
        <div className="mt-12 jt-codex-search">
          <NewTabSearch cards={CARDS} onPickPage={onPick} />
        </div>

        {/* 最近会话：纯文字列表，点击直达 */}
        {sessions.length > 0 && (
          <section className="mt-9">
            <div className="mb-2" style={sec}>{t('最近', 'Recents')}</div>
            {(showAllFavs ? sessions.slice(0, 30) : sessions.slice(0, 6)).map(s => (
              <button key={s.id} onClick={() => window.dispatchEvent(new CustomEvent('newtab-open-session', { detail: { sessionId: s.id } }))}
                className="w-full text-left py-1.5 text-[12.5px] truncate transition-colors jt-text-row"
                style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                {s.title || t('新对话', 'New chat')}
              </button>
            ))}
            {sessions.length > 6 && (
              <button onClick={() => setShowAllFavs(v => !v)} className="text-[10.5px] mt-1" style={{ color: c.textTertiary, background: 'transparent', border: 'none' }}>
                {showAllFavs ? t('收起', 'Less') : `${t('全部', 'All')} (${sessions.length})`}
              </button>
            )}
          </section>
        )}

        {/* 收藏：文字列表 + 展开/收起/导出/空态引导（能力全保留） */}
        <section className="mt-9">
          <div className="flex items-center gap-3 mb-2">
            <span style={sec}>{t('收藏的消息', 'Favorites')}</span>
            <span style={muted}>{favs.length}</span>
            {favs.length > 0 && (
              <>
                {favs.length > 5 && (
                  <button onClick={() => setShowAllFavs(v => !v)} className="text-[10.5px]" style={{ color: c.textTertiary, background: 'transparent', border: 'none' }}>
                    {showAllFavs ? t('收起', 'Less') : t('全部', 'All')}
                  </button>
                )}
                <button onClick={() => {
                  const md = favs.map(f => `- [${f.role === 'user' ? '问' : '答'}] ${f.excerpt.replace(/\n/g, ' ')}`).join('\n')
                  const blob = new Blob([`# 收藏的消息\n\n${md}\n`], { type: 'text/markdown' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `jutian-favorites-${new Date().toISOString().slice(0, 10)}.md`
                  a.click(); URL.revokeObjectURL(a.href)
                }} className="text-[10.5px]" style={{ color: c.accent, background: 'transparent', border: 'none' }}>{t('导出', 'Export')}</button>
              </>
            )}
            {favs.length === 0 && !favHintClosed && (
              <button onClick={() => { setFavHintClosed(true); try { localStorage.setItem('lyclaw_fav_hint_done', '1') } catch {} }}
                className="text-[10.5px]" style={{ color: c.textTertiary, background: 'transparent', border: 'none' }}>{t('知道了', 'Got it')}</button>
            )}
          </div>
          {favs.length === 0 ? (
            !favHintClosed && <div className="text-[11.5px]" style={{ color: c.textTertiary }}>{t('聊天时点消息下方的 ★ 即可收藏，收藏会显示在这里。', 'Tap ★ under any message to keep it here.')}</div>
          ) : (
            <div>
              {(showAllFavs ? favs : favs.slice(0, 5)).map(f => (
                <button key={f.id} onClick={() => window.dispatchEvent(new CustomEvent('jutian-open-favorite', { detail: f }))}
                  className="w-full flex items-center gap-2 py-1.5 text-left jt-text-row"
                  style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                  <span className="text-[12px] truncate flex-1">{f.excerpt}</span>
                  <span className="text-[10px] shrink-0" style={muted}>{sessions.find(x => x.id === f.sessionId)?.title?.slice(0, 10) || (f.role === 'user' ? '问' : '答')}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 全部工作区入口：8 组纯文字列表（31 项一个不少，纵向堆叠不重叠） */}
        <section className="mt-9">
          <div className="flex items-center gap-3 mb-2">
            <span style={sec}>{t('工作区入口', 'Workspace')}</span>
            <span style={muted}>{CARDS.length}</span>
            <div className="flex-1 h-px" style={{ background: c.borderLight }} />
            <span style={muted}>{t('点击直达', 'Click to open')}</span>
          </div>
          {GROUPS.map(g => (
            <div key={g.label} className="mt-4">
              <div className="mb-1.5" style={muted}>{lang === 'en' ? g.labelEn : g.label}</div>
              <div>
                {g.items.map(type => {
                  const card = byType.get(type)
                  return (
                    <button key={type} onClick={() => onPick(type)}
                      className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
                      style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                      <span className="text-[12.5px] shrink-0">{label(type)}</span>
                      {card && <span className="text-[10.5px] truncate" style={muted}>{lang === 'en' ? card.descEn : card.desc}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>

        {/* 写公文 / 内核切换：纯文字行，能力不变 */}
        <section className="mt-9">
          <div className="mb-1.5" style={muted}>{t('快捷', 'Quick actions')}</div>
          <button onClick={() => window.dispatchEvent(new CustomEvent('jutian-gongwen-new'))}
            className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
            style={{ color: '#c7000b', background: 'transparent', border: 'none' }}>
            <span className="text-[12.5px] shrink-0">{t('写公文', 'Write official documents')}</span>
            <span className="text-[10.5px] truncate" style={muted}>{t('通知 · 请示 · 报告 · 批复 · 函 · 纪要 — GB/T 9704', 'Notices · Requests · Reports — GB/T 9704')}</span>
          </button>
          <button onClick={() => {
            try {
              const raw = localStorage.getItem('lyclaw_settings'); const st = raw ? JSON.parse(raw) : {}
              const next = (st.agentEngine || 'vercel') === 'ultra' ? 'server' : 'ultra'
              st.agentEngine = next
              localStorage.setItem('lyclaw_settings', JSON.stringify(st))
              fetch('/api/agent/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: next }) }).catch(() => {})
              window.dispatchEvent(new CustomEvent('settings-updated', { detail: st }))
            } catch {}
          }} className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
            style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
            <span className="text-[12.5px] shrink-0">{t('切换内核', 'Switch kernel')}</span>
            <span className="text-[10.5px] truncate" style={muted}>{t('JT Core Pro+ / Ultra（composer 状态条、命令面板也可切换）', 'JT Core Pro+ / Ultra')}</span>
          </button>
          <button onClick={() => onPick('plugins')} className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
            style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
            <span className="text-[12.5px] shrink-0">{t('插件市场', 'Plugin market')}</span>
            <span className="text-[10.5px]" style={muted}>{t('LY HARNESS 插件中心', 'LY HARNESS')}</span>
          </button>
        </section>

        {/* 我的扩展：纯文字列表 */}
        {exts.length > 0 && (
          <section className="mt-9">
            <div className="mb-1.5" style={muted}>{t('我的扩展', 'My extensions')} · {exts.length}</div>
            {exts.map(e => (
              <button key={e.id} onClick={() => onPick(extType(e.id) as PageType)}
                className="w-full flex items-baseline gap-3 py-1 text-left jt-text-row"
                style={{ color: c.textSecondary, background: 'transparent', border: 'none' }}>
                <span className="text-[12.5px] shrink-0">{e.name || e.id}</span>
                {e.description && <span className="text-[10.5px] truncate" style={muted}>{e.description}</span>}
              </button>
            ))}
          </section>
        )}

        {/* 1024 彩蛋入口：低调一行文字，功能保留 */}
        {banner && (
          <button onClick={banner.active ? onBadgeTap : () => setEggOpen(true)}
            className="w-full text-center text-[10.5px] mt-12 py-2"
            style={{ color: c.textMuted, background: 'transparent', border: 'none' }}>
            {banner.title} · {banner.subtitle}
          </button>
        )}
      </div>
      {eggOpen && <FestivalEgg onClose={() => setEggOpen(false)} />}
    </div>
  )
}
