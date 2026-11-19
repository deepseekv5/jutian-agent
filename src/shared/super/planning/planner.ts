/**
 * 任务规划器实现（模块 B: planning / TaskPlanner）
 *
 * 职责：把 TaskAnalysis + TaskSignals 翻译成可执行的 ExecutionPlan：
 *   - 为每个 TaskDomain 提供专门的步骤模板库（每类 5-10 步，含工具、依赖、难度）；
 *   - 对多步骤任务，从 rawText 的编号列表/步骤词解析真实步骤并替换模板骨架；
 *   - 计算分层拓扑、加权关键路径与估算轮次；
 *   - 保证步骤 id 唯一、依赖合法（只引用存在的前置，不成环）。
 *
 * 设计原则：
 *   1. 计划是"建议"不是"命令"：步骤只是给执行层（superCore）的阶段提示，
 *      因此即便模板不完全贴合，执行层也能安全忽略某些步骤。
 *   2. 可解释：每个模板都带 description/expectedOutput，诊断面板可直接展示。
 *   3. 稳定：同样的输入必须得到同样的计划（id 生成确定性、排序稳定），
 *      否则缓存/测试/回放都会抖。
 */

import type {
  TaskAnalysis,
  TaskSignals,
  TaskDomain,
  PlanStep,
  ExecutionPlan,
  TaskPlanner,
} from '../types'
import { buildConcreteDependencyGraph as buildDependencyGraph } from './dependencyGraph'

/* ─────────────────────────────────────────────────────────────
 * 模板库
 * ───────────────────────────────────────────────────────────── */

/**
 * 模板定义：相对模板，不写死 id 和 dependsOn。
 * key 为模板内部短名（用于生成依赖），planner 组装时统一分配真实 id。
 */
interface StepTemplate {
  /** 模板内部短名，例如 'scan'、'design' */
  key: string
  title: string
  description: string
  /** 依赖的模板 key 列表（组装时映射到真实 id） */
  deps: string[]
  tools: string[]
  expectedOutput: string
  estimatedDifficulty: number
  parallelizable: boolean
}

/**
 * 各领域步骤模板库。
 * 每类 5-10 个步骤，覆盖"理解 -> 执行 -> 验证 -> 收尾"的完整链路。
 */
const DOMAIN_TEMPLATES: Record<TaskDomain, StepTemplate[]> = {
  /* ── code：写代码/改代码 ───────────────────────────────── */
  code: [
    {
      key: 'understand', title: '理解代码需求与上下文',
      description: '解析用户意图，确认目标函数/模块、输入输出约束与验收标准。',
      deps: [], tools: ['read_file', 'grep'],
      expectedOutput: '需求要点清单与涉及文件列表', estimatedDifficulty: 25, parallelizable: false,
    },
    {
      key: 'scan', title: '扫描相关代码结构',
      description: '读取目标文件及其依赖，识别现有实现风格、接口与测试覆盖。',
      deps: ['understand'], tools: ['read_file', 'list_dir', 'grep'],
      expectedOutput: '代码结构图与关键调用点', estimatedDifficulty: 40, parallelizable: true,
    },
    {
      key: 'design', title: '设计实现方案',
      description: '确定改动范围、数据结构与边界处理，评估对现有接口的影响。',
      deps: ['scan'], tools: [],
      expectedOutput: '分步实现方案与风险点', estimatedDifficulty: 55, parallelizable: false,
    },
    {
      key: 'implement', title: '编写/修改代码',
      description: '按方案落地代码改动，保持命名与风格一致，补充必要注释。',
      deps: ['design'], tools: ['write_file', 'edit_file'],
      expectedOutput: '可运行的代码改动', estimatedDifficulty: 70, parallelizable: false,
    },
    {
      key: 'lint', title: '静态检查与类型校验',
      description: '运行 lint/类型检查，修正格式、未使用变量与类型错误。',
      deps: ['implement'], tools: ['shell', 'read_file'],
      expectedOutput: '无 lint/类型错误的改动', estimatedDifficulty: 35, parallelizable: true,
    },
    {
      key: 'test', title: '编写并运行测试',
      description: '覆盖正常路径与边界条件，运行相关测试确保无回归。',
      deps: ['implement'], tools: ['write_file', 'shell'],
      expectedOutput: '通过的测试用例与覆盖率说明', estimatedDifficulty: 60, parallelizable: true,
    },
    {
      key: 'review', title: '自检与收尾',
      description: '复查 diff，确认无意外改动，汇总改动说明与使用提示。',
      deps: ['lint', 'test'], tools: ['shell', 'read_file'],
      expectedOutput: '最终 diff 摘要与交付说明', estimatedDifficulty: 30, parallelizable: false,
    },
  ],

  /* ── file：文件读写/整理 ───────────────────────────────── */
  file: [
    {
      key: 'locate', title: '定位目标文件',
      description: '根据路径或关键词确认待操作文件的位置与范围。',
      deps: [], tools: ['list_dir', 'glob', 'grep'],
      expectedOutput: '目标文件路径清单', estimatedDifficulty: 25, parallelizable: true,
    },
    {
      key: 'inspect', title: '检查文件内容与状态',
      description: '读取目标文件，确认编码、结构与当前内容，评估冲突风险。',
      deps: ['locate'], tools: ['read_file'],
      expectedOutput: '文件内容摘要与风险提示', estimatedDifficulty: 30, parallelizable: true,
    },
    {
      key: 'backup', title: '备份关键文件',
      description: '对高价值或将被覆盖的文件创建备份，便于回滚。',
      deps: ['inspect'], tools: ['copy_file'],
      expectedOutput: '备份文件路径', estimatedDifficulty: 15, parallelizable: true,
    },
    {
      key: 'apply', title: '执行文件操作',
      description: '按用户要求创建、修改、重命名或删除文件。',
      deps: ['inspect', 'backup'], tools: ['write_file', 'edit_file', 'move_file', 'delete_file'],
      expectedOutput: '完成后的文件状态', estimatedDifficulty: 50, parallelizable: false,
    },
    {
      key: 'verify', title: '验证操作结果',
      description: '重新读取文件确认内容正确，检查无遗漏或误删。',
      deps: ['apply'], tools: ['read_file', 'list_dir'],
      expectedOutput: '验证报告', estimatedDifficulty: 25, parallelizable: true,
    },
    {
      key: 'summarize', title: '汇总变更',
      description: '列出所有变更文件与操作类型，给出回滚提示。',
      deps: ['verify'], tools: [],
      expectedOutput: '变更清单', estimatedDifficulty: 15, parallelizable: false,
    },
  ],

  /* ── shell：命令/系统操作 ──────────────────────────────── */
  shell: [
    {
      key: 'assess', title: '评估命令风险',
      description: '识别命令是否涉及删除、系统级修改、网络或付费操作，确定护栏等级。',
      deps: [], tools: [],
      expectedOutput: '风险评估与执行许可判断', estimatedDifficulty: 30, parallelizable: false,
    },
    {
      key: 'environment', title: '确认执行环境',
      description: '检查操作系统、工作目录、依赖工具是否存在与版本兼容性。',
      deps: ['assess'], tools: ['shell'],
      expectedOutput: '环境检查结论', estimatedDifficulty: 25, parallelizable: true,
    },
    {
      key: 'dryrun', title: '预演命令（如可行）',
      description: '对高风险命令先做 dry-run 或打印展开后的参数，确认行为符合预期。',
      deps: ['environment'], tools: ['shell'],
      expectedOutput: '预演输出', estimatedDifficulty: 35, parallelizable: false,
    },
    {
      key: 'execute', title: '执行命令',
      description: '在确认安全后执行命令，捕获 stdout/stderr 与退出码。',
      deps: ['dryrun'], tools: ['shell'],
      expectedOutput: '命令输出与退出码', estimatedDifficulty: 45, parallelizable: false,
    },
    {
      key: 'diagnose', title: '诊断与重试',
      description: '若失败，分析错误信息并给出修正命令，最多有限次重试。',
      deps: ['execute'], tools: ['shell', 'grep'],
      expectedOutput: '失败诊断或成功结果', estimatedDifficulty: 55, parallelizable: false,
    },
    {
      key: 'report', title: '报告结果',
      description: '汇总命令执行结果、关键输出与后续建议。',
      deps: ['diagnose'], tools: [],
      expectedOutput: '执行报告', estimatedDifficulty: 20, parallelizable: false,
    },
  ],

  /* ── research：搜索/调研 ───────────────────────────────── */
  research: [
    {
      key: 'scope', title: '界定调研范围',
      description: '拆解问题为可搜索的子问题，明确时间范围与可信来源要求。',
      deps: [], tools: [],
      expectedOutput: '子问题清单与检索策略', estimatedDifficulty: 30, parallelizable: false,
    },
    {
      key: 'collect', title: '并行收集资料',
      description: '针对各子问题执行搜索，记录来源、时间与关键结论。',
      deps: ['scope'], tools: ['web_search', 'read_url'],
      expectedOutput: '带来源的资料摘录', estimatedDifficulty: 55, parallelizable: true,
    },
    {
      key: 'filter', title: '筛选与去重',
      description: '按时效性、权威性与相关性过滤资料，剔除矛盾或低质量信息。',
      deps: ['collect'], tools: [],
      expectedOutput: '筛选后的证据集', estimatedDifficulty: 45, parallelizable: true,
    },
    {
      key: 'crosscheck', title: '交叉验证',
      description: '对关键结论用独立来源交叉验证，标注不确定性。',
      deps: ['filter'], tools: ['web_search', 'read_url'],
      expectedOutput: '验证后的结论与置信度', estimatedDifficulty: 60, parallelizable: true,
    },
    {
      key: 'synthesize', title: '综合归纳',
      description: '把证据组织成结构化结论，区分事实、推断与待确认项。',
      deps: ['crosscheck'], tools: [],
      expectedOutput: '结构化调研结论', estimatedDifficulty: 50, parallelizable: false,
    },
    {
      key: 'cite', title: '整理引用与出处',
      description: '为每个结论附来源链接/出处，生成参考列表。',
      deps: ['synthesize'], tools: [],
      expectedOutput: '引用列表', estimatedDifficulty: 20, parallelizable: false,
    },
  ],

  /* ── writing：文档/文案写作 ────────────────────────────── */
  writing: [
    {
      key: 'brief', title: '明确写作目标',
      description: '确定受众、语气、篇幅、格式与核心信息。',
      deps: [], tools: [],
      expectedOutput: '写作简报', estimatedDifficulty: 20, parallelizable: false,
    },
    {
      key: 'outline', title: '拟定大纲',
      description: '设计结构（开头/主体/结尾）与各段要点。',
      deps: ['brief'], tools: [],
      expectedOutput: '文章大纲', estimatedDifficulty: 35, parallelizable: false,
    },
    {
      key: 'draft', title: '撰写初稿',
      description: '按大纲展开成完整初稿，保证逻辑连贯、信息完整。',
      deps: ['outline'], tools: [],
      expectedOutput: '完整初稿', estimatedDifficulty: 55, parallelizable: false,
    },
    {
      key: 'enrich', title: '补充细节与例证',
      description: '增加数据、案例或修辞，使内容更具体可信。',
      deps: ['draft'], tools: ['web_search'],
      expectedOutput: '充实的稿件', estimatedDifficulty: 40, parallelizable: true,
    },
    {
      key: 'polish', title: '润色与风格统一',
      description: '优化措辞、节奏与一致性，修正病句与错别字。',
      deps: ['enrich'], tools: [],
      expectedOutput: '润色稿', estimatedDifficulty: 35, parallelizable: true,
    },
    {
      key: 'proofread', title: '校对定稿',
      description: '最终校对格式、标点与事实，输出定稿。',
      deps: ['polish'], tools: [],
      expectedOutput: '最终稿件', estimatedDifficulty: 25, parallelizable: false,
    },
  ],

  /* ── data：数据处理/分析 ───────────────────────────────── */
  data: [
    {
      key: 'define', title: '明确分析目标',
      description: '确定要回答的问题、指标定义与评价标准。',
      deps: [], tools: [],
      expectedOutput: '分析目标与指标定义', estimatedDifficulty: 25, parallelizable: false,
    },
    {
      key: 'load', title: '加载与检查数据',
      description: '读取数据源，检查结构、类型、缺失值与异常值。',
      deps: ['define'], tools: ['read_file', 'shell'],
      expectedOutput: '数据画像与质量报告', estimatedDifficulty: 40, parallelizable: true,
    },
    {
      key: 'clean', title: '数据清洗',
      description: '处理缺失、去重、格式统一与异常值，记录清洗规则。',
      deps: ['load'], tools: ['shell', 'write_file'],
      expectedOutput: '清洗后数据集与规则说明', estimatedDifficulty: 50, parallelizable: false,
    },
    {
      key: 'analyze', title: '分析与建模',
      description: '执行统计、聚合或建模计算，提取趋势与相关性。',
      deps: ['clean'], tools: ['shell', 'code_interpreter'],
      expectedOutput: '分析结果与关键指标', estimatedDifficulty: 70, parallelizable: true,
    },
    {
      key: 'visualize', title: '可视化呈现',
      description: '生成图表或表格，使结论直观可读。',
      deps: ['analyze'], tools: ['code_interpreter', 'write_file'],
      expectedOutput: '图表/报表文件', estimatedDifficulty: 45, parallelizable: true,
    },
    {
      key: 'interpret', title: '解读与结论',
      description: '解释结果含义，指出局限与可行动建议。',
      deps: ['visualize'], tools: [],
      expectedOutput: '结论报告', estimatedDifficulty: 40, parallelizable: false,
    },
  ],

  /* ── creative：创作/设计 ───────────────────────────────── */
  creative: [
    {
      key: 'inspire', title: '确定创意方向',
      description: '明确主题、风格、受众与情感基调，收集灵感参考。',
      deps: [], tools: ['web_search'],
      expectedOutput: '创意方向与参考', estimatedDifficulty: 30, parallelizable: true,
    },
    {
      key: 'brainstorm', title: '构思多个备选方案',
      description: '发散产生多个候选创意，评估独特性与可行性。',
      deps: ['inspire'], tools: [],
      expectedOutput: '候选创意清单', estimatedDifficulty: 45, parallelizable: true,
    },
    {
      key: 'select', title: '选定并深化方案',
      description: '从中选择最佳方案，补充细节与执行路径。',
      deps: ['brainstorm'], tools: [],
      expectedOutput: '深化的创意方案', estimatedDifficulty: 40, parallelizable: false,
    },
    {
      key: 'create', title: '创作初版作品',
      description: '按方案产出初版文本/图像/设计方案。',
      deps: ['select'], tools: ['generate_image', 'write_file'],
      expectedOutput: '初版作品', estimatedDifficulty: 65, parallelizable: false,
    },
    {
      key: 'iterate', title: '迭代打磨',
      description: '根据反馈或自检改进作品，优化细节与整体效果。',
      deps: ['create'], tools: ['generate_image', 'edit_file'],
      expectedOutput: '改进后的作品', estimatedDifficulty: 50, parallelizable: false,
    },
    {
      key: 'deliver', title: '定稿与说明',
      description: '输出最终作品并附创作说明与使用建议。',
      deps: ['iterate'], tools: [],
      expectedOutput: '最终作品与说明', estimatedDifficulty: 20, parallelizable: false,
    },
  ],

  /* ── planning：规划/架构 ───────────────────────────────── */
  planning: [
    {
      key: 'goals', title: '明确目标与约束',
      description: '梳理目标、成功标准、资源限制与时间约束。',
      deps: [], tools: [],
      expectedOutput: '目标与约束清单', estimatedDifficulty: 25, parallelizable: false,
    },
    {
      key: 'current', title: '盘点现状',
      description: '调研现有系统/流程，识别痛点与可复用资产。',
      deps: ['goals'], tools: ['read_file', 'list_dir', 'web_search'],
      expectedOutput: '现状盘点报告', estimatedDifficulty: 40, parallelizable: true,
    },
    {
      key: 'options', title: '生成备选方案',
      description: '提出多个可行方案，标注各自优缺点与适用场景。',
      deps: ['current'], tools: [],
      expectedOutput: '备选方案对比', estimatedDifficulty: 55, parallelizable: true,
    },
    {
      key: 'evaluate', title: '评估与决策',
      description: '按目标与约束对方案打分，选定推荐方案。',
      deps: ['options'], tools: [],
      expectedOutput: '推荐方案与决策依据', estimatedDifficulty: 50, parallelizable: false,
    },
    {
      key: 'roadmap', title: '制定实施路线图',
      description: '拆分里程碑、任务依赖与优先级，估算工作量。',
      deps: ['evaluate'], tools: [],
      expectedOutput: '分阶段路线图', estimatedDifficulty: 60, parallelizable: false,
    },
    {
      key: 'risks', title: '风险与缓解',
      description: '识别关键风险，制定缓解措施与应急预案。',
      deps: ['roadmap'], tools: [],
      expectedOutput: '风险清单与对策', estimatedDifficulty: 40, parallelizable: true,
    },
  ],

  /* ── qa：测试/验证/审查 ────────────────────────────────── */
  qa: [
    {
      key: 'criteria', title: '定义验收标准',
      description: '明确被测对象、测试范围与通过/失败判定条件。',
      deps: [], tools: [],
      expectedOutput: '验收标准清单', estimatedDifficulty: 25, parallelizable: false,
    },
    {
      key: 'cases', title: '设计测试用例',
      description: '覆盖正常、边界与异常场景，标注优先级。',
      deps: ['criteria'], tools: [],
      expectedOutput: '测试用例集', estimatedDifficulty: 45, parallelizable: true,
    },
    {
      key: 'setup', title: '准备测试环境',
      description: '搭建/确认运行环境与测试数据。',
      deps: ['criteria'], tools: ['shell', 'write_file'],
      expectedOutput: '就绪的测试环境', estimatedDifficulty: 35, parallelizable: true,
    },
    {
      key: 'execute', title: '执行测试',
      description: '运行用例，记录实际结果与日志。',
      deps: ['cases', 'setup'], tools: ['shell'],
      expectedOutput: '测试执行结果', estimatedDifficulty: 50, parallelizable: false,
    },
    {
      key: 'analyze', title: '缺陷分析',
      description: '定位失败原因，区分产品缺陷与环境问题，评估严重度。',
      deps: ['execute'], tools: ['grep', 'read_file'],
      expectedOutput: '缺陷报告', estimatedDifficulty: 60, parallelizable: true,
    },
    {
      key: 'report', title: '质量报告',
      description: '汇总通过率、遗留问题与发布建议。',
      deps: ['analyze'], tools: [],
      expectedOutput: '质量报告与结论', estimatedDifficulty: 30, parallelizable: false,
    },
  ],

  /* ── conversation：普通对话（保底模板，短小） ──────────── */
  conversation: [
    {
      key: 'understand', title: '理解对话意图',
      description: '识别用户想获得的信息、情绪与期望的回应方式。',
      deps: [], tools: [],
      expectedOutput: '意图理解', estimatedDifficulty: 15, parallelizable: false,
    },
    {
      key: 'respond', title: '组织回答',
      description: '基于上下文生成切题、简洁、友好的回答。',
      deps: ['understand'], tools: [],
      expectedOutput: '回答草稿', estimatedDifficulty: 25, parallelizable: false,
    },
    {
      key: 'review', title: '自检回答',
      description: '确认回答准确、无幻觉、符合语气要求。',
      deps: ['respond'], tools: [],
      expectedOutput: '最终回答', estimatedDifficulty: 15, parallelizable: false,
    },
  ],
}

/* ─────────────────────────────────────────────────────────────
 * 多步骤解析
 * ───────────────────────────────────────────────────────────── */

/** 解析出的一个用户显式步骤 */
interface ParsedUserStep {
  /** 原文（已裁剪） */
  text: string
  /** 序号（若从编号列表解析得到） */
  index: number
}

/**
 * 从原始文本解析用户显式列出的步骤。
 *
 * 支持三种常见写法：
 *   1. 编号列表：`1. xxx` / `1) xxx` / `（1）xxx` / `一、xxx`
 *   2. 步骤词行：`第一步：xxx` / `Step 2: xxx` / `然后 xxx`
 *   3. hasMultiStep 为真但没有编号：按换行/分号切成多位
 *
 * 返回 [] 表示没有足够明确的步骤，调用方回退到模板库。
 */
export function parseUserSteps(rawText: string, hasMultiStep: boolean): ParsedUserStep[] {
  if (!rawText || typeof rawText !== 'string') return []

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // 1) 编号列表：独占一行的 "1." "1)" "（1）" "一、"
  const numbered: ParsedUserStep[] = []
  const numberedPattern = /^(?:[（(]?\d{1,2}[）).、]|[一二三四五六七八九十]{1,3}[、.]|step\s*\d+\s*[:：]?|第[一二三四五六七八九十\d]{1,3}步\s*[:：]?)\s*(.+)$/i
  for (const line of lines) {
    const m = line.match(numberedPattern)
    if (m && m[1] && m[1].trim().length > 0) {
      numbered.push({ text: m[1].trim(), index: numbered.length + 1 })
    }
  }
  if (numbered.length >= 2) return numbered

  // 2) 单行内嵌编号："1) a 2) b 3) c"
  const inline = rawText.match(/(?:\d{1,2}[).、]|（\d{1,2}）)\s*[^0-9]{2,}/g)
  if (inline && inline.length >= 2) {
    return inline.map((chunk, i) => ({
      text: chunk.replace(/^(?:\d{1,2}[).、]|（\d{1,2}）)\s*/, '').trim(),
      index: i + 1,
    })).filter((s) => s.text.length > 0)
  }

  // 3) hasMultiStep 为真：按换行/分号切
  if (hasMultiStep) {
    const pieces = rawText
      .split(/[\n;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 200)
    if (pieces.length >= 2) {
      return pieces.map((text, i) => ({ text, index: i + 1 }))
    }
  }

  return []
}

/**
 * 把用户显式步骤文本裁剪成合理的 title / description。
 * 过长文本截断，避免污染 plan 体积。
 */
function shorten(text: string, max = 24): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1) + '…'
}

/* ─────────────────────────────────────────────────────────────
 * 轮次估算
 * ───────────────────────────────────────────────────────────── */

/**
 * 估算执行轮数：以拓扑层数为基准，叠加复杂度与验证开销。
 * 公式刻意保守，宁可多估一轮也不低估（低估会让执行层提前截断）。
 */
function estimateRounds(levels: string[][], analysis: TaskAnalysis, steps: PlanStep[]): number {
  if (levels.length === 0) return 1

  const complexityBonus: Record<string, number> = {
    trivial: 0, simple: 0, moderate: 1, complex: 2, expert: 3,
  }
  let rounds = levels.length + (complexityBonus[analysis.complexity.level] ?? 1)

  // 若计划里有明显验证步骤、且风险较高，追加一轮复核
  const hasVerify = steps.some((s) => /verify|test|qa|check|review|validate|lint/i.test(s.id + s.title))
  if (hasVerify && (analysis.risk === 'high' || analysis.risk === 'critical')) rounds += 1

  // 自主闭环通常需要额外规划轮
  if (analysis.benefitsFromAutonomy) rounds += 1

  return Math.max(1, Math.round(rounds))
}

/* ─────────────────────────────────────────────────────────────
 * 模板选择
 * ───────────────────────────────────────────────────────────── */

/**
 * 选择要使用的模板：
 *   - 主领域优先；
 *   - 若主领域置信度低 (<0.5)，且存在权重接近的第二领域，采用两领域模板拼接；
 *   - 拼接时去重相同 key 的步骤，避免重复劳动。
 */
function selectTemplates(analysis: TaskAnalysis): StepTemplate[] {
  const primary = DOMAIN_TEMPLATES[analysis.domain] ?? DOMAIN_TEMPLATES.conversation

  if (analysis.confidence >= 0.5) return primary

  const secondary = [...analysis.domains]
    .filter((d) => d.domain !== analysis.domain && d.weight >= 0.3)
    .sort((a, b) => b.weight - a.weight)[0]

  if (!secondary) return primary

  const extra = DOMAIN_TEMPLATES[secondary.domain] ?? []
  const merged = [...primary]
  const existingKeys = new Set(primary.map((t) => t.key))
  for (const t of extra) {
    if (existingKeys.has(t.key)) continue
    // 只补充"准备/验证"类步骤，避免主线被第二个领域带偏
    if (/prepare|verify|check|test|review|analyze|scan|inspect|report/i.test(t.key)) {
      merged.push(t)
      existingKeys.add(t.key)
    }
  }
  return merged
}

/* ─────────────────────────────────────────────────────────────
 * 实现类
 * ───────────────────────────────────────────────────────────── */

export class TaskPlannerImpl implements TaskPlanner {
  /**
   * 主入口：生成执行计划。
   *
   * 流程：
   *   1. 选模板 -> 分配 id -> 把 deps key 映射为真实 id -> 得到 steps；
   *   2. 若解析到显式用户步骤且数量合适，用它们替换/增强步骤；
   *   3. 建图 -> 校验依赖 -> 计算 levels / criticalPath / estimatedRounds；
   *   4. 返回 ExecutionPlan。
   */
  plan(analysis: TaskAnalysis, signals: TaskSignals): ExecutionPlan {
    const steps = this.buildSteps(analysis, signals)

    // 建图并做依赖合法性兜底（模板理论上无环，这里防御性修复）
    const graph = buildDependencyGraph(steps)
    if (!graph.isAcyclic()) {
      // 极端情况下（模板拼接冲突），自动断开推荐边，保证后续算法可用
      let guard = 0
      while (!graph.isAcyclic() && guard < 10) {
        const removed = graph.applyRecommendedCycleBreak()
        if (removed === 0) break
        guard += 1
      }
    }
    // 同步修复后的依赖回 steps（图内节点是 steps 的引用，edges 已改，但 step.dependsOn 未改）
    this.syncDependsOnFromGraph(steps, graph)

    const levels = graph.topologicalLevels()
    const criticalPath = graph.criticalPath()
    const estimatedRounds = estimateRounds(levels, analysis, steps)

    return {
      goal: this.buildGoal(analysis, signals),
      steps,
      levels,
      estimatedRounds,
      criticalPath,
    }
  }

  /**
   * 构建步骤列表（可被子类/测试单独调用）。
   */
  buildSteps(analysis: TaskAnalysis, signals: TaskSignals): PlanStep[] {
    const templates = selectTemplates(analysis)
    const userSteps = parseUserSteps(signals?.rawText ?? '', Boolean(signals?.hasMultiStep))

    // 显式步骤足够多时，用它们替换模板，但保留首尾的"理解"与"验证"骨架
    if (userSteps.length >= 2) {
      return this.buildFromUserSteps(templates, userSteps, analysis, signals)
    }
    return this.buildFromTemplates(templates, analysis, signals)
  }

  /* ── 模板 -> 步骤 ──────────────────────────────────────── */

  private buildFromTemplates(
    templates: StepTemplate[],
    analysis: TaskAnalysis,
    signals: TaskSignals,
  ): PlanStep[] {
    const prefix = this.idPrefix(analysis.domain)
    const keyToId = new Map<string, string>()
    templates.forEach((t, i) => keyToId.set(t.key, `${prefix}${i + 1}`))

    const steps: PlanStep[] = templates.map((t, i) => {
      // 依赖只映射存在的 key，且排除自依赖
      const deps = t.deps
        .filter((k) => k !== t.key && keyToId.has(k))
        .map((k) => keyToId.get(k) as string)
      const difficulty = this.adjustDifficulty(t.estimatedDifficulty, analysis, signals)
      return {
        id: `${prefix}${i + 1}`,
        title: t.title,
        description: t.description,
        dependsOn: deps,
        tools: this.resolveTools(t.tools, analysis),
        expectedOutput: t.expectedOutput,
        parallelizable: t.parallelizable && difficulty < 80,
        estimatedDifficulty: difficulty,
      }
    })

    return steps
  }

  /* ── 用户显式步骤 -> 步骤 ──────────────────────────────── */

  private buildFromUserSteps(
    templates: StepTemplate[],
    userSteps: ParsedUserStep[],
    analysis: TaskAnalysis,
    signals: TaskSignals,
  ): PlanStep[] {
    const prefix = this.idPrefix(analysis.domain)
    const steps: PlanStep[] = []

    // 顶部保留一个"理解"步骤（若模板有）
    const understand = templates.find((t) => /understand|scope|brief|goals|criteria|assess|define|inspire|locate/i.test(t.key))
    if (understand) {
      steps.push({
        id: `${prefix}1`,
        title: understand.title,
        description: understand.description,
        dependsOn: [],
        tools: this.resolveTools(understand.tools, analysis),
        expectedOutput: understand.expectedOutput,
        parallelizable: false,
        estimatedDifficulty: this.adjustDifficulty(understand.estimatedDifficulty, analysis, signals),
      })
    }

    const baseIndex = steps.length
    // 每个用户步骤是一个节点，默认串行依赖前一个（保证合法且无环）
    userSteps.forEach((u, i) => {
      const prevId = i === 0 && baseIndex > 0 ? `${prefix}1` : `${prefix}${baseIndex + i}`
      steps.push({
        id: `${prefix}${baseIndex + i + 1}`,
        title: `步骤 ${u.index}: ${shorten(u.text)}`,
        description: u.text,
        dependsOn: prevId ? [prevId] : [],
        tools: this.inferToolsForText(u.text, analysis),
        expectedOutput: `完成：${shorten(u.text, 30)}`,
        parallelizable: false,
        estimatedDifficulty: this.adjustDifficulty(
          35 + Math.min(40, Math.floor(u.text.length / 6)), analysis, signals,
        ),
      })
    })

    // 底部保留一个"验证/收尾"步骤
    const verify = templates.find((t) => /verify|review|test|report|proofread|summarize|interpret|deliver|risks|cite/i.test(t.key))
    if (verify) {
      const lastId = steps[steps.length - 1]?.id
      steps.push({
        id: `${prefix}${steps.length + 1}`,
        title: verify.title,
        description: verify.description,
        dependsOn: lastId ? [lastId] : [],
        tools: this.resolveTools(verify.tools, analysis),
        expectedOutput: verify.expectedOutput,
        parallelizable: false,
        estimatedDifficulty: this.adjustDifficulty(verify.estimatedDifficulty, analysis, signals),
      })
    }

    return steps
  }

  /* ── 工具/难度/目标 辅助 ───────────────────────────────── */

  /**
   * 解析步骤工具：在模板建议之外，若分析器建议的工具未被包含，
   * 追加到第一个"执行类"步骤（而非所有步骤），避免工具建议泛滥。
   */
  private resolveTools(templateTools: string[], analysis: TaskAnalysis): string[] {
    const result = [...templateTools]
    if (analysis.needsTools && templateTools.length === 0) {
      for (const tool of analysis.suggestedTools.slice(0, 2)) {
        if (!result.includes(tool)) result.push(tool)
      }
    }
    return result
  }

  /** 依据文本关键词推断单步工具 */
  private inferToolsForText(text: string, analysis: TaskAnalysis): string[] {
    const tools: string[] = []
    if (/搜索|查找资料|调研|latest|search/i.test(text)) tools.push('web_search')
    if (/读|打开|查看文件|read/i.test(text)) tools.push('read_file')
    if (/写|创建|生成文件|write/i.test(text)) tools.push('write_file')
    if (/运行|执行|命令|shell|bash/i.test(text)) tools.push('shell')
    if (/测试|验证|test/i.test(text)) tools.push('shell')
    if (tools.length === 0 && analysis.needsTools) tools.push(...analysis.suggestedTools.slice(0, 1))
    return [...new Set(tools)]
  }

  /** 难度随复杂度/风险微调，夹逼 0-100 */
  private adjustDifficulty(base: number, analysis: TaskAnalysis, signals: TaskSignals): number {
    const levelDelta: Record<string, number> = {
      trivial: -15, simple: -5, moderate: 0, complex: 8, expert: 14,
    }
    const riskDelta: Record<string, number> = { low: 0, medium: 2, high: 6, critical: 10 }
    let value = base + (levelDelta[analysis.complexity.level] ?? 0) + (riskDelta[analysis.risk] ?? 0)
    if (signals?.hasHighRisk) value += 5
    if (signals?.hasAttachment) value += 3
    return Math.max(0, Math.min(100, Math.round(value)))
  }

  /** 生成步骤 id 前缀（按领域，稳定且可读） */
  private idPrefix(domain: TaskDomain): string {
    return `${domain}-`
  }

  /** 构造目标描述：优先 intent，否则用原始文本摘要 */
  private buildGoal(analysis: TaskAnalysis, signals: TaskSignals): string {
    const intent = analysis?.intent?.trim()
    if (intent) return shorten(intent, 80)
    const raw = signals?.rawText?.trim()
    if (raw) return shorten(raw, 80)
    return '完成用户请求'
  }

  /**
   * 把图的 edges 同步回 step.dependsOn。
   * 原因是环修复发生在图的邻接表上，而 steps 是原始对象；这里以图为准。
   */
  private syncDependsOnFromGraph(steps: PlanStep[], graph: ReturnType<typeof buildDependencyGraph>): void {
    for (const step of steps) {
      const deps = graph.edges.get(step.id)
      if (deps) step.dependsOn = [...deps]
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 工厂函数
 * ───────────────────────────────────────────────────────────── */

/** 默认规划器实例（无状态，可安全共享） */
export const defaultTaskPlanner = new TaskPlannerImpl()

/**
 * 顶层入口，符合契约中"导出 planTask(analysis, signals): ExecutionPlan"的约定。
 */
export function planTask(analysis: TaskAnalysis, signals: TaskSignals): ExecutionPlan {
  return defaultTaskPlanner.plan(analysis, signals)
}
