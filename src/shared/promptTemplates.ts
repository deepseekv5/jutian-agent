/**
 * 提示词模板库（v12 新功能 1-6）
 *
 * 纯数据 + 纯函数，UI 只负责渲染。模板带变量占位符 {{var}}，
 * 填充时只替换已知变量，未知变量原样保留（避免把 {{}} 吞掉导致用户困惑）。
 */

export interface PromptVar {
  key: string
  label: string
  placeholder?: string
  /** 多行文本（textarea）而不是单行 */
  multiline?: boolean
}

export interface PromptTemplate {
  id: string
  name: string
  category: 'writing' | 'code' | 'analysis' | 'office' | 'study'
  description: string
  body: string
  vars: PromptVar[]
  /** 中文/英文标签，方便双语界面 */
  nameEn?: string
}

export const PROMPT_CATEGORIES: { id: PromptTemplate['category']; label: string; labelEn: string }[] = [
  { id: 'writing', label: '写作', labelEn: 'Writing' },
  { id: 'code', label: '编程', labelEn: 'Code' },
  { id: 'analysis', label: '分析', labelEn: 'Analysis' },
  { id: 'office', label: '办公', labelEn: 'Office' },
  { id: 'study', label: '学习', labelEn: 'Study' },
]

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'code-review',
    name: '代码审查',
    nameEn: 'Code review',
    category: 'code',
    description: '按 bug / 安全 / 可维护性三层审查改动',
    body: `请审查下面的代码/改动，按三层输出，每条给出文件:行号与具体修复建议：

1. **正确性**：边界条件、空值、并发、错误处理是否有漏洞
2. **安全**：注入、越权、密钥泄露、路径穿越
3. **可维护性**：命名、重复逻辑、过长函数

只报真实问题，不确定的标注"待确认"，不要凑数。

【代码/改动】
{{code}}`,
    vars: [{ key: 'code', label: '代码或 diff', multiline: true, placeholder: '粘贴代码或 git diff' }],
  },
  {
    id: 'bug-diagnose',
    name: '报错诊断',
    nameEn: 'Diagnose error',
    category: 'code',
    description: '从报错反查根因，给最小修复',
    body: `这个报错帮我定位：先读相关源码确认上下文，再给根因和最小修复，不要猜测性乱改。

【报错】
{{error}}

【相关文件/目录】
{{files}}`,
    vars: [
      { key: 'error', label: '完整报错', multiline: true },
      { key: 'files', label: '相关文件（可选）', placeholder: 'src/foo.ts' },
    ],
  },
  {
    id: 'weekly-report',
    name: '周报',
    category: 'office',
    description: '四段式周报，可直接发出去',
    body: `帮我写本周周报，按「本周完成 / 进行中 / 下周计划 / 需要协调」四段。语气务实，不写空话，每条一句话说清结果。

【本周做的事】
{{work}}`,
    vars: [{ key: 'work', label: '本周做的事', multiline: true }],
  },
  {
    id: 'meeting-notes',
    name: '会议纪要',
    category: 'office',
    description: '从流水记录提炼结论与待办',
    body: `把下面的会议记录整理成纪要：结论先行，然后按「决策 / 待办（负责人+截止）/ 待确认」三类归纳。信息不足的标"待确认"，不要编。

【会议记录】
{{raw}}`,
    vars: [{ key: 'raw', label: '会议记录', multiline: true }],
  },
  {
    id: 'summarize',
    name: '长文摘要',
    category: 'writing',
    description: '三档长度可选的结构化摘要',
    body: `总结下面内容，输出：

- **一句话结论**
- **5 条以内要点**（每条不超过 30 字）
- **可直接执行的行动项**（没有就写"无"）

【内容】
{{text}}`,
    vars: [{ key: 'text', label: '原文', multiline: true }],
  },
  {
    id: 'email-polish',
    name: '邮件润色',
    category: 'writing',
    description: '保留立场，改得更专业简洁',
    body: `润色下面这封邮件：保留我的立场和事实，改得更专业简洁。先给润色版，再用三条说明改了什么。

【邮件原文】
{{email}}`,
    vars: [{ key: 'email', label: '邮件原文', multiline: true }],
  },
  {
    id: 'sql-explain',
    name: 'SQL 优化',
    category: 'analysis',
    description: '看懂慢查询并给索引建议',
    body: `分析这条 SQL：说明它在做什么、慢在哪、建议加什么索引。给出改写后的版本并说明差异。

【SQL】
{{sql}}

【表结构（可选）】
{{schema}}`,
    vars: [
      { key: 'sql', label: 'SQL', multiline: true },
      { key: 'schema', label: '表结构', multiline: true },
    ],
  },
  {
    id: 'data-insight',
    name: '数据洞察',
    category: 'analysis',
    description: '从数据里找异常与原因',
    body: `基于下面的数据给出分析：先列关键数字，再指出异常点，最后给 3 条可执行建议。所有结论必须能追溯到具体数字，不要臆测。

【数据】
{{data}}`,
    vars: [{ key: 'data', label: '数据（CSV/表格/文字）', multiline: true }],
  },
  {
    id: 'explain-code',
    name: '代码讲解',
    category: 'study',
    description: '讲清数据流与坑，不逐行翻译',
    body: `讲解这段代码：它解决什么问题、数据怎么流动、有哪些容易踩的坑。不要逐行翻译，重点讲设计意图。

【代码】
{{code}}`,
    vars: [{ key: 'code', label: '代码', multiline: true }],
  },
  {
    id: 'learn-plan',
    name: '学习计划',
    category: 'study',
    description: '按周拆解、可验收',
    body: `帮我制定学习计划：目标是「{{goal}}」，周期 {{weeks}} 周，每周 3-5 小时。按周给主题、练习和验收标准，不要泛泛而谈。`,
    vars: [
      { key: 'goal', label: '学习目标' },
      { key: 'weeks', label: '周期（周）' },
    ],
  },
]

/** 用变量值填充模板；未提供的变量原样保留（不吞掉用户可见的占位符） */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return String(body).replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const v = values[key]
    return typeof v === 'string' && v.trim() ? v : whole
  })
}

/** 模板还缺哪些必填变量（用于"生成"按钮置灰） */
export function missingVars(tpl: PromptTemplate, values: Record<string, string>): PromptVar[] {
  return tpl.vars.filter((v) => !String(values[v.key] || '').trim())
}

export function searchTemplates(query: string, list: PromptTemplate[] = PROMPT_TEMPLATES): PromptTemplate[] {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return list
  return list.filter((t) =>
    [t.name, t.nameEn || '', t.description, t.body].some((s) => s.toLowerCase().includes(q))
  )
}
