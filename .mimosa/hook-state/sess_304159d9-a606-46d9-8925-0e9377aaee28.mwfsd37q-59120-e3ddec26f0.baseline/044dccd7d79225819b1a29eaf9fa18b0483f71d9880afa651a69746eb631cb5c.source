/**
 * 页面目录（v15.8.4）：全部工作区入口的单一数据源。
 * NewTabPage（手机兜底）与 CodexHome「全部功能」折叠区共用。
 */
import { PAGE_META, type PageType } from './TabBar'

export const TOOL_COUNT = 57

interface Card {
  type: PageType
  desc: string
  descEn: string
  chips: string[]
  chipsEn: string[]
}

export const CARDS: Card[] = [
  { type: 'gongwen', desc: '公文写作台：要素表单 + 红头实时预览 + 一键导出 Word', descEn: 'Official doc desk: fields + red-head live preview + Word export', chips: ['GB/T 9704', '双栏'], chipsEn: ['GB/T 9704', 'Split view'] },
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

export const GROUPS: { label: string; labelEn: string; items: PageType[] }[] = [
  { label: '对话与角色', labelEn: 'Chat & Personas', items: ['chat', 'gongwen', 'persona', 'call'] },
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


export const TOOL_COUNT_FALLBACK = TOOL_COUNT

/** 页面短名（En 优先逻辑与 NewTabPage 一致处调用方自理） */
export function pageLabel(type: PageType, lang: 'zh' | 'en'): string {
  const meta = PAGE_META[type]
  return lang === 'en' && meta?.labelEn ? meta.labelEn : (meta?.label || type)
}
