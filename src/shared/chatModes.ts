/**
 * 办公 / 编程 双模式 —— 全站唯一定义处
 *
 * 两个模式必须是两种工作方式，不是同一助手换两行提示词：
 *  - 人格提示词不同（useChat 取 persona）
 *  - 空态引导不同（ChatView 取 welcome + 快捷提示）
 *  - 视觉信号不同（输入框状态条 / 侧栏切换器取 chipColor）
 * 此前这些散落三处、措辞互相矛盾，集中到这里防漂移。
 */

export type ChatMode = 'general' | 'coding'

/* ─── 编程模式人格（原内联在 useChat，迁来集中管理）─── */
export function buildCodingPersona(workDir: string): string {
  return `你是「巨天」的编程形态——一个住在你代码仓库里的工程 Agent，不是聊天问答机器人。

【工作目录边界 — 最高优先级】
- 用户项目目录（你的合法工作区）：${workDir || '未指定（使用系统默认）'}
- 所有文件操作与命令执行限制在该目录内，禁止越界；本应用自身目录禁止读写。

【工作方式 — 与办公形态的根本区别】
1. 你是以动手为主的：能用 edit_file/write_file/shell 落地的改动，绝不只给建议文字。
   用户说"修复这个 bug"= 期望你改完文件并说明改动，不是期望一段教程。
2. 先读后改是铁律：动任何文件前先 read_file 确认上下文；跨文件改动先 search_content 找全引用点。不确定就 list_dir/search，不猜。
3. 修改用 edit_file 精准替换（old→new），保持周围代码风格一致；新建文件用 write_file。每次改动附一句理由，不写长篇说明。
4. 运行与验证优先用 shell：改完能跑就跑（编译/测试/脚本），跑不过就继续修到通过，报告里带真实输出结论。
5. 报错排查路径：读完整栈 → 定位根因 → 最小修复 → 验证。拒绝猜测性乱改与"试试重启"式建议。
6. 代码块标注语言；只在需要解释处解释，代码本身不加废话注释。
7. 破坏性操作（删除/覆盖/reset）执行前一句话说明风险再动手；工作区有未保存改动时优先 Git 检查点。`
}

/* ─── 办公模式补充段：文档/事务为主，代码操作克制 ─── */
export const OFFICE_MODE_SUFFIX = `【办公形态】
你现在处于办公模式：优先处理文档写作、资料整理、检索调研、PPT/表格、日程与文件归类这类事务。
- 产出默认面向"能直接交给别人看"的标准：结构清晰、格式规整、可直接落盘成文件（docx/md/pptx）。
- 终端命令与代码修改只在用户明确要求时做；能做文档的事不动命令行。
- 涉及本机文件操作前先确认目录归属，产出保存到工作目录并告知路径。`

/* ─── 空态引导：两个模式各说各的行话 ─── */
export interface QuickPrompt { label: string; labelEn: string; text: string; textEn: string }

export const WELCOME: Record<ChatMode, {
  title: string; titleEn: string
  subtitle: string; subtitleEn: string
  prompts: QuickPrompt[]
}> = {
  general: {
    title: '今天处理什么？',
    titleEn: 'What shall we get done?',
    subtitle: '写作、整理文档、检索调研、做 PPT、管文件——说人话就行，我来动手。',
    subtitleEn: 'Writing, documents, research, slides, files — just say it plainly, I\'ll do the work.',
    prompts: [
      { label: '写周报', labelEn: 'Weekly report', text: '帮我起草本周工作周报：按「本周完成/进行中/下周计划/需要协调」四段，语气务实，先给我可直接改的初稿', textEn: 'Draft my weekly report: done / in progress / next week / blockers — practical tone, give me an editable first draft' },
      { label: '总结文档', labelEn: 'Summarize', text: '总结一下这份文档的核心要点，输出 5 条以内的行动项式摘要（中文）', textEn: 'Summarize this document into no more than 5 action-item takeaways' },
      { label: '生成 PPT', labelEn: 'Make slides', text: '把「AI 办公自动化趋势」做成一份 8 页的 PPT 大纲，每页给标题、要点和讲稿提示', textEn: 'Turn "AI office automation trends" into an 8-slide deck outline with titles, bullets and speaker notes' },
      { label: '整理文件夹', labelEn: 'Organize files', text: '把我工作目录里的文件按类型和日期归类整理，先给我整理方案再执行', textEn: 'Sort my working directory by type and date — propose the scheme first, then execute' },
      { label: '润色邮件', labelEn: 'Polish email', text: '帮我润色下面这封邮件，改得更专业简洁，语气保留我的立场：', textEn: 'Polish this email to be professional and concise while keeping my stance:' },
      { label: '深度调研', labelEn: 'Deep research', text: '调研「2026 年主流 AI 办公助手」：多路检索、对比功能与隐私策略，产出带引用来源的报告', textEn: 'Research "leading AI office assistants 2026": multi-query search, compare features and privacy, deliver a cited report' },
    ],
  },
  coding: {
    title: '仓库里要动什么？',
    titleEn: 'What are we shipping?',
    subtitle: '读代码、改 bug、跑测试、重构——直接说，我进工作区动手改文件。',
    subtitleEn: 'Read code, fix bugs, run tests, refactor — I edit files in your working directory.',
    prompts: [
      { label: '解释代码', labelEn: 'Explain code', text: '先读相关源码，解释这段代码的作用、数据流和潜在坑，指出值得重构的地方', textEn: 'Read the source, explain what it does, its data flow, pitfalls and what deserves refactoring' },
      { label: '修 bug', labelEn: 'Fix bug', text: '这个报错帮我看：先定位根因，给出最小修复并跑通验证，不要猜测性乱改\n\n【粘贴报错】', textEn: 'Diagnose this error: find the root cause, apply a minimal fix and verify it runs — no guesswork\n\n[paste error]' },
      { label: '写测试', labelEn: 'Write tests', text: '为刚才涉及的模块补单元测试：覆盖主要分支与边界条件，跑给我看结果', textEn: 'Add unit tests for the module we touched: cover main branches and edge cases, then run them' },
      { label: '代码审查', labelEn: 'Code review', text: '审查这个仓库当前的未提交改动（git diff）：找 bug、安全隐患和风格不一致，逐条给出修复', textEn: 'Review uncommitted changes (git diff): bugs, security issues, style inconsistencies — fix each' },
      { label: '重构', labelEn: 'Refactor', text: '找出这个仓库里最该重构的巨型文件/函数，先给拆分方案，确认后再动手，改完保证行为不变', textEn: 'Find the biggest refactor target in this repo, propose the split first, then refactor with behavior preserved' },
      { label: 'Python 脚本', labelEn: 'Python script', text: '用 Python 写一个快速排序：类型标注、边界处理，附一个跑得到的测试', textEn: 'Write quicksort in Python: type hints, edge cases, plus a runnable test' },
    ],
  },
}

/* ─── 视觉信号：两个模式一个色相（状态条/切换器/空态共用）─── */
export const MODE_ACCENT: Record<ChatMode, { zh: string; en: string; color: string }> = {
  general: { zh: '办公模式', en: 'Office', color: '#10a37f' },
  coding: { zh: '编程模式', en: 'Coding', color: '#2563eb' },
}
