/**
 * 模块 A / 任务分析器（Super Core v18.0.0）
 *
 * 职责：把 `TaskSignals` 升级为完整的 `TaskAnalysis`——
 *   领域分类（10 个 TaskDomain，多标签加权）
 *   + 风险分级（low / medium / high / critical）
 *   + 意图抽取（intent）
 *   + 工具需求（needsTools / suggestedTools）
 *   + 自主闭环适配性（benefitsFromAutonomy）
 *
 * 与 complexity.ts 的分工：
 *   - complexity 回答「这任务有多难」，纯看信号强度；
 *   - analyzer 回答「这任务是什么、该怎么处理」，看信号语义。
 * analyzer 内部调用 scoreComplexity 把复杂度嵌入分析结果，保持单一事实来源。
 *
 * 依赖：类型只来自 `../types`；评分复用同目录 complexity.ts；
 *      风险细分复用 signlas/extractor.ts 的 analyzeRisk（不反向依赖，无环）。
 */

import type {
  TaskSignals, TaskAnalysis, TaskDomain, RiskLevel, ComplexityScore,
  TaskAnalyzer,
} from '../types'
import { scoreComplexity } from './complexity'
import { analyzeRisk, compileKeywords, countAny } from '../signals/extractor'

/* ═══════════════════════════════════════════════════════════════════════════
 * 一、通用工具
 * ═══════════════════════════════════════════════════════════════════════════ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 二、领域关键词大词表（domainKeywords）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 每个领域的关键词表（中英混合，合计 400+ 词）。
 * 词表是「软证据」——命中数参与加权打分，而非一锤定音的布尔。
 */
export const domainKeywords: Record<TaskDomain, readonly string[]> = {
  code: [
    // 英文：动作
    'code', 'coding', 'program', 'programming', 'develop', 'implement', 'refactor',
    'debug', 'compile', 'build', 'write function', 'fix bug', 'fix the bug',
    'optimize', 'migrate', 'port code', 'deploy code', 'commit', 'merge',
    // 英文：结构
    'function', 'class', 'interface', 'module', 'api', 'endpoint', 'algorithm',
    'data structure', 'source code', 'repository', 'git', 'typescript', 'javascript',
    'python', 'java', 'golang', 'rust', 'c++', 'component', 'service', 'server',
    // 中文
    '写代码', '代码', '编程', '程序', '函数', '类', '接口', '模块', '重构',
    '调试', '编译', '修复', '实现', '优化', '算法', '数据结构', '源码', '仓库',
    '开发', '封装', '继承', '多态', '写个函数', '写个方法', '脚本', '后端', '前端',
    '全栈', '框架', '依赖', '版本', '单元测试', '接口开发',
  ],
  file: [
    // 英文
    'file', 'files', 'folder', 'directory', 'path', 'read file', 'write file',
    'create file', 'delete file', 'edit file', 'rename', 'move file', 'copy file',
    'list files', 'open file', 'save', 'upload', 'download', 'parse file',
    'text file', 'config file', 'json file', 'csv file',
    // 中文
    '文件', '文件夹', '目录', '路径', '读取', '写入', '创建文件', '删除文件',
    '编辑文件', '修改文件', '重命名', '移动文件', '复制文件', '列出文件',
    '打开文件', '保存', '上传', '下载', '文件名', '文件路径', '文件系统',
  ],
  shell: [
    // 英文
    'shell', 'command', 'terminal', 'bash', 'zsh', 'powershell', 'cli',
    'npm', 'yarn', 'pnpm', 'pip', 'cargo', 'docker', 'kubectl', 'sudo',
    'chmod', 'grep', 'awk', 'sed', 'curl', 'wget', 'ssh', 'script',
    'run command', 'execute command', 'ls', 'cd', 'mkdir', 'rm', 'cp', 'mv',
    // 中文
    '命令行', '终端', '脚本', '执行', '运行命令', '终端命令', 'shell脚本',
    '批处理', '控制台', '控制台命令', '安装依赖', '打包', '部署命令',
  ],
  research: [
    // 英文
    'search', 'research', 'find', 'lookup', 'google', 'browse', 'investigate',
    'explore', 'fetch', 'crawl', 'scrape', 'documentation', 'docs', 'paper',
    'article', 'news', 'source', 'citation', 'reference', 'wikipedia',
    'stackoverflow', 'github', 'tutorial', 'guide', 'compare', 'benchmark',
    'competitor', 'market', 'what is', 'how to', 'latest',
    // 中文
    '搜索', '查找', '查一下', '检索', '调研', '研究', '调查', '了解', '搜集',
    '资料', '文献', '论文', '出处', '来源', '查证', '核实', '网页', '网站',
    '在线', '网上', '互联网', '谷歌', '百度', '维基', '百科', '官方文档',
    '教程', '指南', '规范', '竞品', '市场', '现状', '新闻', '最新', '对比',
  ],
  writing: [
    // 英文
    'write', 'article', 'blog', 'essay', 'report', 'summary', 'translate',
    'rewrite', 'edit text', 'proofread', 'draft', 'copywriting', 'caption',
    'documentation', 'readme', 'email draft', 'resume', 'letter', 'script writing',
    // 中文
    '写', '写作', '文章', '博客', '作文', '报告', '总结', '摘要', '翻译',
    '改写', '润色', '校对', '草案', '文案', '撰写', '起草', '扩写', '缩写',
    '续写', '仿写', '简历', '信件', '说明文', '议论文', '记叙文',
  ],
  data: [
    // 英文
    'data', 'analyze data', 'analysis', 'statistics', 'csv', 'excel', 'database',
    'sql', 'query', 'pandas', 'numpy', 'chart', 'graph', 'visualize', 'plot',
    'dashboard', 'regression', 'clustering', 'prediction', 'machine learning',
    'dataset', 'table', 'metric', 'kpi', 'aggregate', 'pivot', 'etl',
    // 中文
    '数据', '数据分析', '统计', '数据库', '查询', '表格', '电子表格', '报表',
    '可视化', '图表', '柱状图', '折线图', '饼图', '回归', '聚类', '预测',
    '趋势', '相关性', '分布', '机器学习', '数据集', '指标', '求和', '平均值',
  ],
  creative: [
    // 英文
    'create', 'creative', 'imagine', 'story', 'poem', 'poetry', 'novel',
    'fiction', 'screenplay', 'lyrics', 'song', 'draw', 'paint', 'illustrate',
    'image', 'generate image', 'design', 'logo', 'poster', 'artwork', 'brainstorm',
    // 中文
    '创作', '写诗', '作诗', '诗歌', '散文', '故事', '小说', '剧本', '歌词',
    '写歌', '画画', '绘画', '生成图片', '生成图像', '插画', '漫画', '海报',
    'logo', '标志', '头像', '壁纸', '创意', '想象', '虚构', '角色', '设定',
    '取名', '起名', '标语', '口号',
  ],
  planning: [
    // 英文
    'plan', 'planning', 'design', 'architecture', 'strategy', 'roadmap',
    'blueprint', 'outline', 'proposal', 'breakdown', 'milestone', 'schedule',
    'organize', 'structure', 'framework', 'approach', 'steps', 'workflow',
    // 中文
    '计划', '方案', '设计', '架构', '规划', '策略', '蓝图', '路线图', '大纲',
    '提纲', '框架', '结构设计', '架构设计', '技术方案', '实施方案', '拆解',
    '任务分解', '排期', '里程碑', '目标', '分阶段', '分步骤', '统筹', '布局',
  ],
  qa: [
    // 英文
    'test', 'testing', 'verify', 'validate', 'check', 'debug', 'inspect',
    'review', 'audit', 'lint', 'regression', 'unit test', 'integration test',
    'e2e test', 'assert', 'coverage', 'bug', 'issue', 'troubleshoot',
    'quality', 'sanity check', 'smoke test',
    // 中文
    '测试', '验证', '检查', '校验', '核对', '复核', '审查', '排查', '调试',
    '确认', '试运行', '单测', '单元测试', '集成测试', '回归测试', '端到端测试',
    '自检', '验收', '质检', '测试通过', '跑测试', '找bug', '修bug', '缺陷',
  ],
  conversation: [
    // 英文
    'hello', 'hi', 'hey', 'thanks', 'thank you', 'how are you', 'chat',
    'tell me', 'explain', 'what do you think', 'opinion', 'advice', 'help me',
    'question', 'answer', 'discuss', 'please',
    // 中文
    '你好', '您好', 'hi', '嗨', '谢谢', '感谢', '在吗', '请问', '问一下',
    '聊聊', '怎么看', '你认为', '你觉得', '建议', '帮我', '能不能', '可以吗',
    '是什么', '为什么', '怎么样', '介绍一下', '解释一下',
  ],
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 三、预编译领域匹配器
 * ═══════════════════════════════════════════════════════════════════════════ */

interface DomainMatcher {
  domain: TaskDomain
  patterns: RegExp[]
}

const DOMAIN_MATCHERS: DomainMatcher[] = (Object.keys(domainKeywords) as TaskDomain[]).map((domain) => ({
  domain,
  patterns: compileKeywords(domainKeywords[domain]),
}))

/* ═══════════════════════════════════════════════════════════════════════════
 * 四、领域分类（多标签加权）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DomainClassification {
  /** 主领域 */
  primary: TaskDomain
  /** 归一化置信度 0-1 */
  confidence: number
  /** 多标签结果（按 weight 降序），weight 归一化到 0-1 且合计约 1 */
  domains: Array<{ domain: TaskDomain; weight: number }>
  /** 每个领域的原始命中强度（调试用） */
  rawScores: Record<TaskDomain, number>
}

/**
 * 领域原始打分：关键词命中强度 + signals 布尔硬信号加成。
 *
 * 关键词命中：countAny（重复词也计入，但单个词表内已去重编译，
 *            重复文本会重复命中——这恰好反映「用户反复强调」的强度）。
 * 硬信号加成：每个领域都有一个或多个高置信布尔信号，命中一次性 +N。
 */
function domainRawScores(signals: TaskSignals, text: string): Record<TaskDomain, number> {
  const scores = {} as Record<TaskDomain, number>
  for (const { domain, patterns } of DOMAIN_MATCHERS) {
    scores[domain] = countAny(patterns, text)
  }

  // 硬信号加成：这些来自 extractor 的布尔标记，置信度高于关键词散命中
  const boosts: Partial<Record<TaskDomain, number>> = {
    code: (signals.hasCode ? 4 : 0) + Math.min(signals.techStacks?.length || 0, 3),
    file: (signals.hasFileOp ? 4 : 0) + Math.min(signals.fileRefs?.length || 0, 4),
    shell: signals.hasShell ? 5 : 0,
    research: signals.hasResearch ? 4 : 0,
    writing: signals.hasCreative ? 1 : 0,
    data: (signals.hasData ? 5 : 0) + (signals.techStacks?.some((t) => /Pandas|NumPy|SQL|Scikit|PyTorch|TensorFlow/i.test(t)) ? 2 : 0),
    creative: signals.hasCreative ? 5 : 0,
    planning: (signals.hasPlanning ? 5 : 0) + (signals.hasGoalLoop ? 1 : 0),
    qa: signals.hasVerification ? 5 : 0,
    conversation: 0,
  }
  for (const key of Object.keys(boosts) as TaskDomain[]) {
    scores[key] += boosts[key] || 0
  }

  // conversation 是「兜底领域」：当文本很短、几乎没有其他硬信号时，
  // 给一点点基础分，避免全 0 时任意选第一个领域。
  if (text.length <= 40 && signals.historyTurns <= 1) {
    scores.conversation += 1.5
  }

  return scores
}

/**
 * 领域分类主逻辑：
 *   1. 计算每个领域原始分；
 *   2. 取所有 >0 的领域，归一化成 weight（合计 1）；
 *   3. 主领域 = 最高分；
 *   4. 置信度 = 主领域领先程度（top1 / (top1+top2)）与绝对强度的乘积，
 *      让「一边倒」且「信号强」的情况置信度高，「势均力敌」时置信度低。
 */
export function classifyDomains(signals: TaskSignals, text?: string): DomainClassification {
  const source = text ?? signals.rawText ?? ''
  // 空输入：直接兜底，避免「兜底分」被算成真实置信度。
  if (!source.trim()) {
    const empty = {} as Record<TaskDomain, number>
    for (const key of Object.keys(domainKeywords) as TaskDomain[]) empty[key] = 0
    return {
      primary: 'conversation',
      confidence: 0,
      domains: [{ domain: 'conversation', weight: 1 }],
      rawScores: empty,
    }
  }
  const raw = domainRawScores(signals, source)
  const entries = (Object.keys(raw) as TaskDomain[])
    .map((domain) => ({ domain, score: raw[domain] }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))

  if (entries.length === 0) {
    // 极端边界：空文本。落到 conversation，置信度 0。
    return {
      primary: 'conversation',
      confidence: 0,
      domains: [{ domain: 'conversation', weight: 1 }],
      rawScores: raw,
    }
  }

  const total = entries.reduce((sum, entry) => sum + entry.score, 0)
  const domains = entries.map((entry) => ({
    domain: entry.domain,
    weight: round2(entry.score / total),
  }))
  // 修正浮点误差：最后一个标签吸收残差，保证合计 ≈ 1
  const weightSum = domains.reduce((sum, d) => sum + d.weight, 0)
  if (domains.length > 1 && Math.abs(weightSum - 1) > 0.001) {
    domains[domains.length - 1].weight = round2(domains[domains.length - 1].weight + (1 - weightSum))
  }

  const top1 = entries[0].score
  const top2 = entries.length > 1 ? entries[1].score : 0
  const dominance = top2 === 0 ? 1 : top1 / (top1 + top2)
  const strength = clamp(top1 / 8, 0, 1) // 8 分以上视为信号充分
  const confidence = round2(clamp(dominance * (0.5 + 0.5 * strength), 0, 1))

  return { primary: entries[0].domain, confidence, domains, rawScores: raw }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 五、风险分级
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface RiskGrading {
  level: RiskLevel
  /** 0-1 风险分（供路由覆盖护栏强度） */
  score: number
  /** 命中的类别名 */
  categories: string[]
}

/**
 * 风险分级规则（结合 extractor 的加权风险分析 + signals 布尔）：
 *   weighted <= 0                         → low
 *   0 < weighted <= 2 且类别数 <= 1        → low
 *   2 < weighted <= 5                     → medium
 *   weighted > 5 或类别数 >= 2             → high
 *   出现「删库 / rm -rf / 转账 / 生产环境 / 内核」等极危险词
 *   （单条 weight >= 2），或类别数 >= 3 + weighted >= 8 → critical
 */
export function gradeRisk(signals: TaskSignals, text?: string): RiskGrading {
  const source = text ?? signals.rawText ?? ''
  const analysis = analyzeRisk(source)
  const categoryNames: Record<string, string> = {
    destructive: '破坏性',
    financial: '资金',
    external: '对外发送',
    system: '系统级',
    permission: '权限',
  }
  const categories = [...analysis.categories].map((c) => categoryNames[c] || c)

  // 极危险词：单条 weight >= 2（如删库、rm -rf、转账、生产环境、内核）
  const hasExtreme = Boolean(source && EXTREME_PATTERNS.some((re) => re.test(source)))

  let level: RiskLevel
  if (hasExtreme || (analysis.categories.size >= 3 && analysis.weighted >= 8)) {
    level = 'critical'
  } else if (analysis.weighted > 5 || analysis.categories.size >= 2) {
    level = 'high'
  } else if (analysis.weighted > 2) {
    level = 'medium'
  } else {
    level = 'low'
  }

  // 分数归一：weighted 12 + 类别乘数 视为满分风险
  const score = round2(clamp(
    (analysis.weighted / 12) * 0.6 + (analysis.categories.size / 5) * 0.4,
    0, 1,
  ))

  return { level, score, categories }
}

/** 极危险关键词（单条 weight >= 2 的条目，模块加载时编译一次）。 */
const EXTREME_KEYWORDS: readonly string[] = [
  '删库', '格式化', '销毁', '清空', '抹掉', 'rm -rf', 'drop table',
  '转账', '汇款', 'transfer money', '生产环境', '线上环境', '内核',
  'kernel', '系统级', 'root', 'sudo', 'chmod 777',
]
const EXTREME_PATTERNS = compileKeywords(EXTREME_KEYWORDS)

/* ═══════════════════════════════════════════════════════════════════════════
 * 六、意图抽取
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 意图模式：正则 → 规范化意图标签（按优先级从上到下匹配）。 */
const INTENT_PATTERNS: ReadonlyArray<{ pattern: RegExp; intent: string }> = [
  // 代码类
  { pattern: /(?:写|编写|实现|implement|write)\s*(?:一个|个|a|an)?\s*(?:函数|方法|function|class|类)/i, intent: '实现代码' },
  { pattern: /(?:修复|fix|debug|调试|排查)\s*(?:bug|错误|问题|issue)?/i, intent: '修复缺陷' },
  { pattern: /(?:重构|refactor|优化|optimize|性能)/i, intent: '重构优化' },
  { pattern: /(?:解释|explain|讲讲|讲一下|介绍一下)\s*(?:代码|这段|这个函数|this)/i, intent: '代码讲解' },
  // 文件类
  { pattern: /(?:读取|读|write|写|创建|新建|删除|编辑|修改)\s*(?:文件|file|目录|folder)/i, intent: '文件操作' },
  // 命令行
  { pattern: /(?:运行|执行|执行一下|run|execute)\s*(?:命令|command|脚本|script|npm|docker)/i, intent: '命令行执行' },
  // 调研
  { pattern: /(?:搜索|查找|查一下|search|查找|调研|研究|research|了解|latest|最新)/i, intent: '信息检索' },
  // 数据分析
  { pattern: /(?:分析|统计|可视化|画图|chart|plot|analyze|数据)/i, intent: '数据分析' },
  // 创作（允许「写一首关于春天的诗」这类动词与名词间有修饰语）
  { pattern: /(?:写|创作|作|画|生成|来一首|来一篇)[^。；;]{0,12}(?:诗|诗歌|故事|小说|歌词|歌|散文|图|图片|image|poem|story|song)/i, intent: '内容创作' },
  // 写作
  { pattern: /(?:写|撰写|翻译|润色|改写|写篇|写一篇|article|blog|essay|translate)/i, intent: '文本写作' },
  // 规划
  { pattern: /(?:计划|规划|设计|方案|架构|plan|design|roadmap)/i, intent: '方案规划' },
  // 验证
  { pattern: /(?:测试|验证|检查|跑一下|运行测试|test|verify|check)/i, intent: '测试验证' },
  // 问答
  { pattern: /(?:是什么|为什么|怎么样|怎么看|如何|what|why|how|explain|解释)/i, intent: '知识问答' },
  // 闲聊
  { pattern: /(?:你好|您好|hi|hello|谢谢|感谢|在吗|聊聊)/i, intent: '日常对话' },
]

/**
 * 抽取意图字符串：
 *   1. 按 INTENT_PATTERNS 优先级匹配（专用模式在前，通用在后）；
 *   2. 都不中时，按主领域给一个默认意图；
 *   3. 对过长文本做截断（取前 30 字符 + 省略号），保持 intent 简短可展示。
 */
export function extractIntent(signals: TaskSignals, text?: string): string {
  const source = text ?? signals.rawText ?? ''
  for (const { pattern, intent } of INTENT_PATTERNS) {
    if (pattern.test(source)) return intent
  }
  const fallback: Record<TaskDomain, string> = {
    code: '代码相关', file: '文件处理', shell: '命令执行', research: '信息检索',
    writing: '文本写作', data: '数据处理', creative: '创意内容', planning: '方案规划',
    qa: '测试验证', conversation: '日常对话',
  }
  if (source.trim().length === 0) return '空输入'
  return fallback[classifyDomains(signals, source).primary]
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 七、工具需求与建议
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 工具名常量（与上层工具注册表命名约定保持一致）。 */
export const TOOLS = {
  readFile: 'read_file',
  writeFile: 'write_file',
  editFile: 'edit_file',
  deleteFile: 'delete_file',
  listDir: 'list_directory',
  shell: 'run_command',
  webSearch: 'web_search',
  webFetch: 'web_fetch',
  codeSearch: 'code_search',
  runTests: 'run_tests',
  dataAnalysis: 'data_analysis',
  imageGen: 'image_generation',
  plan: 'plan',
  taskList: 'task_list',
} as const

/** 领域 → 建议工具集（基础映射，后续按 signals 增补）。 */
const DOMAIN_TOOLS: Record<TaskDomain, string[]> = {
  code: [TOOLS.codeSearch, TOOLS.readFile],
  file: [TOOLS.listDir, TOOLS.readFile],
  shell: [TOOLS.shell],
  research: [TOOLS.webSearch, TOOLS.webFetch],
  writing: [],
  data: [TOOLS.dataAnalysis],
  creative: [],
  planning: [TOOLS.plan, TOOLS.taskList],
  qa: [TOOLS.runTests, TOOLS.shell],
  conversation: [],
}

export interface ToolRecommendation {
  needsTools: boolean
  suggestedTools: string[]
}

/**
 * 工具建议规则：
 *   - 以主领域的 DOMAIN_TOOLS 为基础；
 *   - 按 signals 增补：
 *       hasFileOp → read_file（写/删类由风险分级决定是否真的执行）
 *       fileRefs 多 → read_file
 *       hasCode → code_search + read_file
 *       hasVerification → run_tests
 *       hasResearch → web_search
 *       isTimeSensitive + hasResearch → web_fetch
 *       hasCreative + 图像词 → image_generation
 *       hasMultiStep → task_list
 *   - needsTools：suggestedTools 非空，或明显需要外部能力（shell/file/research/data/code）；
 *     纯 writing/conversation 且无外部信号时不需要工具。
 *   - 去重，保持顺序稳定。
 */
export function recommendTools(signals: TaskSignals, primary: TaskDomain): ToolRecommendation {
  const tools: string[] = [...(DOMAIN_TOOLS[primary] || [])]
  const add = (tool: string) => { if (!tools.includes(tool)) tools.push(tool) }

  if (signals.hasCode) { add(TOOLS.codeSearch); add(TOOLS.readFile) }
  if (signals.hasFileOp) add(TOOLS.readFile)
  if (Array.isArray(signals.fileRefs) && signals.fileRefs.length >= 2) add(TOOLS.readFile)
  if (signals.hasShell) add(TOOLS.shell)
  if (signals.hasResearch) { add(TOOLS.webSearch); add(TOOLS.webFetch) }
  if (signals.isTimeSensitive && signals.hasResearch) add(TOOLS.webFetch)
  if (signals.hasVerification) add(TOOLS.runTests)
  if (signals.hasData) add(TOOLS.dataAnalysis)
  if (signals.hasCreative) {
    // 仅当文本像「生成图片」类创作才给图像工具；纯文字创作不给。
    if (/(?:图|图片|image|draw|paint|画一)/i.test(signals.rawText || '')) add(TOOLS.imageGen)
  }
  if (signals.hasMultiStep || signals.hasPlanning) add(TOOLS.taskList)
  if (signals.hasFileOp && /(?:创建|新建|写|写入|create|write)/i.test(signals.rawText || '')) add(TOOLS.writeFile)

  const externalNeed = signals.hasFileOp || signals.hasShell || signals.hasResearch ||
    signals.hasCode || signals.hasData || Array.isArray(signals.fileRefs) && signals.fileRefs.length > 0
  const needsTools = tools.length > 0 || externalNeed

  return { needsTools, suggestedTools: tools }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 八、自主闭环适配性
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 是否受益于自主闭环（Auto 内核）：
 * 正向信号：目标闭环词、多步骤、规划、验证、跨域、历史轮次多（像在推进一个目标）。
 * 负向信号：高风险（autonomy 需要护栏，不宜完全自主）、纯闲聊/单轮问答、
 *           强时间敏感（应先给出快速答复而非长循环）。
 *
 * 规则：
 *   positive = 2·goalLoop + 1.5·multiStep + 1·planning + 1·verification
 *              + min(domainTags-1, 2)·0.5 + min(turns,6)/6
 *   if risk >= high → positive *= 0.3（高风险强烈抑制自主）
 *   if timeSensitive → positive *= 0.7
 *   benefits = positive >= 2.0 且 (risk <= medium 或 goalLoop)
 */
export function benefitsFromAutonomy(
  signals: TaskSignals,
  classification: DomainClassification,
  risk: RiskGrading,
): boolean {
  let positive = 0
  if (signals.hasGoalLoop) positive += 2
  if (signals.hasMultiStep) positive += 1.5
  if (signals.hasPlanning) positive += 1
  if (signals.hasVerification) positive += 1
  positive += Math.min((classification.domains.length - 1), 2) * 0.5
  positive += Math.min(signals.historyTurns || 0, 6) / 6

  if (risk.level === 'high' || risk.level === 'critical') positive *= 0.3
  if (signals.isTimeSensitive) positive *= 0.7

  // 纯闲聊/纯问答且无闭环词：直接否定
  if (classification.primary === 'conversation' && !signals.hasGoalLoop) return false

  return positive >= 2.0 && (risk.level === 'low' || risk.level === 'medium' || signals.hasGoalLoop)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 九、TaskAnalyzerImpl
 * ═══════════════════════════════════════════════════════════════════════════ */

export class TaskAnalyzerImpl implements TaskAnalyzer {
  constructor(private readonly options: {
    /** 自定义复杂度评分器（默认用 scoreComplexity） */
    scorer?: (signals: TaskSignals) => ComplexityScore
  } = {}) {}

  analyze(signals: TaskSignals): TaskAnalysis {
    const classification = classifyDomains(signals)
    const risk = gradeRisk(signals)
    const complexity = this.options.scorer
      ? this.options.scorer(signals)
      : scoreComplexity(signals)
    const intent = extractIntent(signals)
    const { needsTools, suggestedTools } = recommendTools(signals, classification.primary)
    const autonomy = benefitsFromAutonomy(signals, classification, risk)

    return {
      domain: classification.primary,
      confidence: classification.confidence,
      domains: classification.domains,
      complexity,
      risk: risk.level,
      intent,
      needsTools,
      suggestedTools,
      benefitsFromAutonomy: autonomy,
    }
  }
}

/** 默认单例（无状态，可安全共享）。 */
export const DEFAULT_TASK_ANALYZER = new TaskAnalyzerImpl()

/** 便捷函数。 */
export function analyzeTask(signals: TaskSignals): TaskAnalysis {
  return DEFAULT_TASK_ANALYZER.analyze(signals)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十、分析解释（规则追踪）
 *
 * TaskAnalysis 是给机器消费的结构化结果；本节把「每一条结论的规则依据」
 * 展开成人类可读的追踪记录，供诊断面板和路由层解释使用。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 一条规则追踪记录。 */
export interface RuleTrace {
  /** 结论类别：domain / risk / tools / autonomy / intent */
  category: string
  /** 结论值 */
  value: string
  /** 依据（中文短句） */
  basis: string
  /** 该结论的置信度 0-1（不适用时给 1） */
  confidence: number
}

/** 生成完整的规则追踪。 */
export function explainAnalysis(signals: TaskSignals, analysis: TaskAnalysis): RuleTrace[] {
  const traces: RuleTrace[] = []

  // 领域
  const topDomains = analysis.domains.slice(0, 3)
    .map((d) => `${d.domain}(${(d.weight * 100).toFixed(0)}%)`).join('、')
  traces.push({
    category: 'domain',
    value: analysis.domain,
    basis: `关键词命中 + 信号加成，多标签分布：${topDomains}`,
    confidence: analysis.confidence,
  })

  // 风险
  const grading = gradeRisk(signals)
  traces.push({
    category: 'risk',
    value: analysis.risk,
    basis: grading.categories.length > 0
      ? `命中风险类别：${grading.categories.join('、')}，风险分 ${grading.score.toFixed(2)}`
      : '未命中高风险词表',
    confidence: 1,
  })

  // 复杂度
  traces.push({
    category: 'complexity',
    value: `${analysis.complexity.level}(${analysis.complexity.score})`,
    basis: analysis.complexity.reasons.join('；'),
    confidence: 1,
  })

  // 工具
  traces.push({
    category: 'tools',
    value: analysis.needsTools ? '需要工具' : '无需工具',
    basis: analysis.suggestedTools.length > 0
      ? `建议工具集：${analysis.suggestedTools.join('、')}`
      : '纯对话/文本任务，无外部能力需求',
    confidence: 1,
  })

  // 自主闭环
  const autonomyBasis: string[] = []
  if (signals.hasGoalLoop) autonomyBasis.push('含闭环词')
  if (signals.hasMultiStep) autonomyBasis.push('多步骤')
  if (signals.hasVerification) autonomyBasis.push('含验证')
  if (analysis.risk === 'high' || analysis.risk === 'critical') autonomyBasis.push('高风险抑制')
  traces.push({
    category: 'autonomy',
    value: analysis.benefitsFromAutonomy ? '适合自主闭环' : '不适合自主闭环',
    basis: autonomyBasis.length ? autonomyBasis.join('、') : '缺乏目标闭环信号',
    confidence: 1,
  })

  // 意图
  traces.push({ category: 'intent', value: analysis.intent, basis: '意图模式匹配', confidence: analysis.confidence })

  return traces
}

/** 把规则追踪渲染成一段人类可读文本（诊断面板用）。 */
export function renderAnalysisExplanation(signals: TaskSignals, analysis: TaskAnalysis): string {
  const traces = explainAnalysis(signals, analysis)
  const lines = traces.map((t) => `- [${t.category}] ${t.value}：${t.basis}（置信度 ${t.confidence.toFixed(2)}）`)
  return `任务分析追踪：\n${lines.join('\n')}`
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十一、领域关键词覆盖度自检
 *
 * 统计给定文本命中了哪些领域的词、命中多少，用于验证「词表是否对某类
 * 输入有明显盲区」。返回每个领域的命中词列表（前 10 个）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 领域词命中明细。 */
export interface DomainKeywordCoverage {
  domain: TaskDomain
  matched: string[]
  count: number
}

/** 逐领域列出命中词（不加权，纯词汇覆盖观察）。 */
export function domainKeywordCoverage(text: string): DomainKeywordCoverage[] {
  const result: DomainKeywordCoverage[] = []
  for (const { domain, patterns } of DOMAIN_MATCHERS) {
    const matched: string[] = []
    const keywords = domainKeywords[domain]
    keywords.forEach((keyword, index) => {
      if (patterns[index]?.test(text)) matched.push(keyword)
    })
    result.push({ domain, matched: matched.slice(0, 10), count: matched.length })
  }
  return result.sort((a, b) => b.count - a.count)
}
