/**
 * 模块 A / 信号采集器（Super Core v18.0.0）
 *
 * 职责：把一串 LoopMessage（来自上层 agentLoop）压缩成一个 `TaskSignals`
 * 快照，供下游「复杂度评分 / 任务分析 / 路由决策」消费。
 *
 * 设计原则：
 *   1. 纯函数、零副作用、零 IO——同样的 messages 永远得到同样的 signals，
 *      这样路由诊断面板才能复现每一次决策。
 *   2. 只依赖 `../types` 的类型契约（外加 agentLoop 的 LoopMessage 类型别名），
 *      不 import 兄弟模块（planning / routing / context ...），保证可并行开发。
 *   3. 判定要「可解释」——每个布尔标记背后都是一张显式的中英文词表或一条
 *      显式正则，而不是拍脑袋的 `if (text.includes('代码'))`。
 *   4. 对真实聊天数据宽容：content 可能是纯字符串、数组型多模态分片
 *      （text / image_url / input_audio / file）、对象或 null，都要能吞下去。
 *
 * 性能：所有词表在模块加载时一次性编译成 RegExp 并缓存（见 MATCHERS），
 * 每次 extract 只做线性扫描，1000 条消息也是毫秒级。
 */

import type { TaskSignals, SignalExtractor } from '../types'
import type { LoopMessage } from '../../agentLoop'

/* ═══════════════════════════════════════════════════════════════════════════
 * 一、通用工具函数
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 转义正则元字符，避免词表里的 `C++` / `a.b` 被当成正则语法。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 判断一个关键词是否应当按「ASCII 单词」方式匹配。
 *
 * 只有以字母/数字开头、且主体是 ASCII 的词才加边界，例如：
 *   - `go`    → 加边界，避免命中 `algorithm` / `logo`
 *   - `cat`   → 加边界，避免命中 `category`
 *   - `C++`   → 加边界（尾字符是 `+`，只对首字符加 lookbehind）
 * 中文/符号关键词直接子串匹配（中文没有单词边界概念）。
 */
function isAsciiKeyword(keyword: string): boolean {
  return /^[a-z0-9]/i.test(keyword) && /^[a-z0-9+#.\-_ /]+$/i.test(keyword) && /[a-z]/i.test(keyword)
}

/**
 * 把词表编译成 RegExp 数组（模块加载时调用一次）。
 * ASCII 词使用 `(?<![a-z0-9])` / `(?![a-z0-9])` 做左右边界；
 * 中文词直接子串匹配。全部忽略大小写。
 */
export function compileKeywords(keywords: readonly string[]): RegExp[] {
  return keywords.map((keyword) => {
    const escaped = escapeRegExp(keyword)
    if (isAsciiKeyword(keyword)) {
      const head = '(?<![a-z0-9])'
      const tail = /[a-z0-9]$/i.test(keyword) ? '(?![a-z0-9])' : ''
      return new RegExp(`${head}${escaped}${tail}`, 'i')
    }
    return new RegExp(escaped, 'i')
  })
}

/** 任一命中即返回 true。传入的正则不带 g 标志，不存在 lastIndex 污染。 */
export function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  if (!text) return false
  return patterns.some((re) => re.test(text))
}

/** 统计某个正则在文本里的出现次数（内部临时构造 global 版本）。 */
export function countPattern(pattern: RegExp, text: string): number {
  if (!text) return 0
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const global = new RegExp(pattern.source, flags)
  const found = text.match(global)
  return found ? found.length : 0
}

/** 统计整组词表在文本里的命中总数（用于「强度」打分，不是简单布尔）。 */
export function countAny(patterns: readonly RegExp[], text: string): number {
  if (!text) return 0
  let total = 0
  for (const re of patterns) total += countPattern(re, text)
  return total
}

/** 数值钳制到 [min, max]（供扩展的评分器使用，当前主流程未直接调用）。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 二、词表：代码迹象
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 代码相关词（中英混合，约 80 词）。
 * 这些词单独出现不一定代表代码任务，但大量出现时几乎必然是代码上下文。
 */
export const CODE_KEYWORDS: readonly string[] = [
  // 英文：定义与声明
  'function', 'def', 'class', 'interface', 'enum', 'struct', 'trait', 'impl',
  'typedef', 'type alias', 'namespace', 'module', 'package',
  // 英文：导入导出与依赖
  'import', 'export', 'require', 'from', 'dependency', 'dependencies',
  // 英文：变量与控制流
  'const', 'let', 'var', 'return', 'async', 'await', 'promise', 'callback',
  'lambda', 'closure', 'generator', 'yield', 'try', 'catch', 'throw', 'finally',
  'if else', 'switch case', 'for loop', 'while loop', 'foreach',
  // 英文：类型与 OOP
  'public', 'private', 'protected', 'static', 'abstract', 'virtual', 'override',
  'extends', 'implements', 'generic', 'template', 'inheritance', 'polymorphism',
  'encapsulation', 'constructor', 'destructor', 'this', 'super',
  // 英文：其他语言要素
  'null', 'undefined', 'boolean', 'integer', 'float', 'string', 'array', 'object',
  'dictionary', 'hashmap', 'list', 'tuple', 'set', 'regex', 'regular expression',
  'json', 'xml', 'yaml', 'sql query', 'api call', 'http request', 'algorithm',
  'complexity', 'time complexity', 'space complexity', 'recursion', 'memoization',
  'sort', 'search algorithm', 'binary search', 'dynamic programming',
  // 英文：工程动作
  'refactor', 'compile', 'build', 'debug', 'stack trace', 'unit test',
  'source code', 'codebase', 'code snippet', 'pseudocode', 'git commit',
  // 中文：定义与结构
  '函数', '方法', '类', '接口', '枚举', '结构体', '命名空间', '模块', '包',
  '变量', '常量', '参数', '返回值', '闭包', '递归', '循环', '数组', '对象',
  '字符串', '布尔', '整数', '浮点', '字典', '列表', '元组', '集合',
  // 中文：语言特性
  '继承', '多态', '封装', '抽象', '泛型', '模板', '装饰器', '注解', '构造函数',
  '静态', '私有', '公有', '异常处理', '捕获异常', '正则表达式', '面向对象',
  // 中文：工程动作
  '代码', '源码', '代码片段', '伪代码', '算法', '时间复杂度', '空间复杂度',
  '重构', '编译', '调试', '调用栈', '单元测试', '写代码', '写函数', '实现',
]

/**
 * 结构性代码正则（比词表更「硬」的证据）：
 * 代码块围栏、函数定义、import/require、箭头函数、JSX、SQL、日志调用等。
 */
export const CODE_STRUCTURE_PATTERNS: readonly RegExp[] = [
  /```[\s\S]*?```/,                                    // Markdown 代码块
  /```/,                                               // 未闭合的代码围栏也算
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/i,              // JS function foo(
  /\basync\s+function\s+[A-Za-z_$][\w$]*\s*\(/i,      // async function
  /\bdef\s+[A-Za-z_][\w]*\s*\(/i,                     // Python def foo(
  /\bclass\s+[A-Za-z_][\w]*[\s(:]/i,                  // class Foo: / class Foo {
  /\b(interface|enum|struct|trait|impl)\s+[A-Za-z_][\w]*/i,
  /\bimport\s+(?:\{[^}]*\}|[\w*]+|\([^)]*\))\s+from\s+['"]/i,
  /\bimport\s+['"][^'"]+['"]/i,
  /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/i,
  /\bfrom\s+['"][^'"]+['"]\s+import\b/i,
  /\bexport\s+(?:default|const|function|class|interface|type|\{)/i,
  /\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/i,
  /\b[A-Za-z_$][\w$]*\s*=>\s*[({\w'"`]/,            // 箭头函数
  /\breturn\s+[^\s;]{1,80}/i,
  /\btry\s*\{[\s\S]{0,400}?\}\s*catch\b/i,
  /\bnew\s+[A-Z][\w$]*(?:\(|\s)/,
  /<\/?[A-Za-z][\w-]*(?:\s[^<>]{0,80})?>/,           // JSX / HTML 标签
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+[\w*`,\s]+\s+FROM\b/i,
  /\b(?:public|private|protected|static)\s+[\w<>,]+\s+[\w]+\s*\(/i,
  /\b(?:console\.(?:log|error|warn|debug)|print\s*\(|println\s*\()/i,
  /\b(?:npm|yarn|pnpm|pip|pip3|cargo|go\s+(?:mod|build|run))\s+[\w-]+/i,
  /\bgit\s+(?:clone|commit|push|pull|checkout|merge|rebase)\b/i,
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|swift|cpp|cc|cxx|c|h|hpp|rb|php|pl|sh|bash|sql|vue|svelte)\b/i,
  /\b(?:TODO|FIXME|HACK|XXX)\b/,
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 三、词表：文件操作
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 文件读写改删创建动词（中英，约 90 词）。 */
export const FILE_OP_KEYWORDS: readonly string[] = [
  // 英文：基础 CRUD
  'read', 'write', 'edit', 'modify', 'change', 'create', 'make', 'new file',
  'open', 'close', 'save', 'save as', 'rename', 'move', 'copy', 'paste',
  'delete', 'remove', 'erase', 'unlink', 'destroy', 'wipe', 'truncate',
  // 英文：目录与路径
  'folder', 'directory', 'path', 'mkdir', 'rmdir', 'rm -r', 'touch',
  'list files', 'list directory', 'browse files', 'traverse',
  // 英文：内容操作
  'append', 'insert', 'overwrite', 'prepend', 'replace', 'update file',
  'rewrite', 'patch', 'duplicate', 'clone file', 'file content',
  'upload', 'download', 'load file', 'dump file', 'export file', 'import file',
  'serialize', 'deserialize', 'parse file', 'write to file', 'read from file',
  // 英文：文件类型名词（帮助识别「操作对象」）
  'text file', 'config file', 'source file', 'log file', 'binary file',
  'temp file', 'cache file', 'lock file', 'zip file', 'archive',
  // 中文：读取
  '读取', '读', '载入', '加载', '打开文件', '打开', '查看文件', '浏览文件',
  // 中文：写入
  '写入', '写', '保存', '另存', '另存为', '写入文件', '导出文件', '落盘',
  // 中文：修改
  '编辑', '修改', '改动', '改', '改写', '重写', '更新文件', '替换', '追加',
  '插入', '覆盖', '重命名', '改名', '调整文件', '整理文件',
  // 中文：删除
  '删除', '删掉', '删', '移除', '清除', '清空', '删库', '删除文件', '删除目录',
  // 中文：创建
  '创建', '新建', '建立', '创建文件', '新建文件', '创建目录', '新建文件夹',
  // 中文：复制移动与其他
  '复制', '拷贝', '粘贴', '移动', '剪切', '上传', '下载', '解压', '压缩',
  '遍历目录', '列出文件', '查找文件', '文件路径', '文件名', '目录', '文件夹',
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 四、词表：shell / 命令
 * ═══════════════════════════════════════════════════════════════════════════ */

/** shell 与命令行迹象（约 80 词）。刻意不收录裸词 run/exec，避免误判。 */
export const SHELL_KEYWORDS: readonly string[] = [
  // 解释器与终端
  'bash', 'zsh', 'fish', 'shell', 'terminal', 'console', 'powershell',
  'cmd.exe', 'command line', '命令行', '终端', '控制台', '脚本', '执行脚本',
  'shell script', 'batch script', '批处理',
  // 包管理器 / 语言工具链
  'npm', 'yarn', 'pnpm', 'npx', 'bun', 'pip', 'pip3', 'conda', 'poetry',
  'cargo', 'rustc', 'go build', 'go run', 'go mod', 'go install', 'mvn', 'gradle',
  'composer', 'gem install', 'dotnet', 'makefile',
  // 容器与编排
  'docker', 'docker-compose', 'dockerfile', 'kubectl', 'helm', 'container',
  '容器', '编排', '镜像',
  // 版本控制与网络
  'git clone', 'git commit', 'git push', 'git pull', 'git status', 'git log',
  'curl', 'wget', 'httpie', 'ssh', 'scp', 'rsync', 'ping', 'netstat',
  // 系统命令
  'sudo', 'su -', 'chmod', 'chown', 'chgrp', 'systemctl', 'crontab',
  'ls -', 'pwd', 'cd ', 'mkdir', 'rm ', 'rm -f', 'cp ', 'mv ', 'cat ',
  'grep', 'awk', 'sed', 'find .', 'xargs', 'head ', 'tail ', 'sort ',
  'tar ', 'gzip', 'unzip', 'zip ', 'make ', 'cmake', 'touch ',
  'env ', 'export ', 'source ', 'ps aux', 'kill -', 'top ', 'df -', 'du -',
  // 操作符（作为正则子串出现，通常伴随真实命令）
  '&&', '||', '| grep', '>>', '2>&1', './', '../',
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 五、词表：搜索 / 调研
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 搜索调研迹象（中英，约 80 词）。 */
export const RESEARCH_KEYWORDS: readonly string[] = [
  // 英文
  'search', 'search for', 'google', 'bing', 'duckduckgo', 'yahoo',
  'lookup', 'look up', 'find out', 'research', 'investigate', 'explore',
  'browse', 'fetch', 'crawl', 'scrape', 'spider', 'query the web',
  'web search', 'online search', 'find information', 'gather information',
  'fact-check', 'cross-check', 'source', 'reference', 'citation', 'bibliography',
  'documentation', 'docs', 'paper', 'publication', 'wikipedia', 'wiki',
  'forum', 'stackoverflow', 'github issue', 'news', 'headline', 'article',
  'blog post', 'tutorial', 'guide', 'specification', 'rfc', 'whitepaper',
  'competitor', 'market research', 'survey', 'benchmark', 'case study',
  'recent', 'latest news', 'discover', 'learn about', 'what is', 'how to',
  // 中文
  '搜索', '搜一下', '搜搜', '查找', '查一下', '查查', '检索', '查询',
  '调研', '研究', '调查', '了解', '探寻', '探究', '搜集', '收集资料',
  '找资料', '查资料', '资料', '文献', '论文', '出处', '来源', '查证', '核实',
  '网页', '网站', '在线', '网上', '互联网', '网络', '谷歌', '百度', '必应',
  '维基', '百科', '官方文档', '参考文档', '教程', '指南', '规范', '标准',
  '竞品', '市场', '现状', '新闻', '最新消息', '资讯', '报道', '论坛', '帖子',
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 六、词表：创作
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 创作迹象（文学/艺术/图像/音乐，中英，约 80 词）。 */
export const CREATIVE_KEYWORDS: readonly string[] = [
  // 英文
  'write a poem', 'write a story', 'write an article', 'poem', 'poetry',
  'story', 'short story', 'novel', 'fiction', 'fictional', 'narrative',
  'screenplay', 'script', 'lyrics', 'song', 'compose', 'melody', 'music',
  'draw', 'drawing', 'paint', 'painting', 'sketch', 'illustrate',
  'illustration', 'image generation', 'generate an image', 'generate image',
  'create an image', 'picture', 'artwork', 'art', 'poster', 'logo design',
  'design a', 'creative', 'imagine', 'imaginative', 'character', 'worldbuilding',
  'plot', 'metaphor', 'rhyme', 'slogan', 'tagline', 'brainstorm ideas',
  '广告语', '文案',
  // 中文
  '创作', '写诗', '作诗', '诗', '诗歌', '散文', '写故事', '故事', '小说',
  '剧本', '台词', '歌词', '作词', '作曲', '编曲', '旋律', '写歌',
  '画画', '绘画', '画一幅', '画一张', '绘图', '画图', '生成图片', '生成图像',
  '生成一张图', '插画', '漫画', '海报', 'logo', '标志设计', '头像', '壁纸',
  '创意', '想象', '虚构', '角色', '场景描写', '情节', '设定', '取名', '起名',
  '标语', '口号', '广告词', '文案', '润色', '仿写', '续写',
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 七、词表：数据分析
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 数据分析迹象（中英，约 90 词）。 */
export const DATA_KEYWORDS: readonly string[] = [
  // 英文：动作
  'analyze', 'analyse', 'analysis', 'statistical', 'statistics', 'aggregate',
  'aggregation', 'group by', 'pivot', 'summarize', 'summarise', 'visualize',
  'visualise', 'visualization', 'plot', 'chart', 'graph', 'histogram',
  'scatter plot', 'bar chart', 'line chart', 'pie chart', 'dashboard',
  // 英文：数据对象与工具
  'dataset', 'data set', 'dataframe', 'data frame', 'pandas', 'numpy',
  'scipy', 'sklearn', 'scikit-learn', 'matplotlib', 'seaborn', 'tableau',
  'csv', 'excel', 'spreadsheet', 'xlsx', 'parquet', 'json data', 'sql query',
  'database query', 'data warehouse', 'data pipeline', 'etl',
  // 英文：统计方法
  'regression', 'clustering', 'cluster analysis', 'classification',
  'prediction', 'predict', 'forecast', 'trend', 'correlation', 'distribution',
  'probability', 'variance', 'standard deviation', 'mean', 'median', 'mode',
  'percentile', 'outlier', 'sampling', 'sample', 'hypothesis test',
  'machine learning', 'training model', 'feature engineering', 'cross validation',
  'metric', 'kpi', 'a/b test', 'cohort', 'funnel',
  // 中文：动作
  '分析', '数据分析', '统计分析', '统计', '汇总', '聚合', '分组', '透视',
  '可视化', '画图', '绘制图表', '画图表', '生成报表', '做报表', '建模',
  // 中文：对象
  '数据', '数据集', '数据源', '数据表', '表格', '电子表格', '报表', '指标',
  '维度', '度量', '字段', '样本', '训练集', '测试集', '特征',
  // 中文：方法与图表
  '回归', '聚类', '分类', '预测', '趋势', '相关性', '分布', '概率', '方差',
  '平均值', '中位数', '求和', '计数', '分位数', '异常值', '抽样', '假设检验',
  '机器学习', '柱状图', '折线图', '饼图', '散点图', '直方图', '漏斗', '转化',
  '同比增长', '环比', '留存', 'csv', 'excel', 'xlsx',
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 八、词表：多步骤结构
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 步骤词（中英，约 60 词）。 */
export const MULTI_STEP_KEYWORDS: readonly string[] = [
  // 中文：序数步骤
  '步骤', '第一步', '第二步', '第三步', '第四步', '第五步', '步骤一', '步骤二',
  '第一步先', '最后一步', '每一步',
  // 中文：顺序连接词
  '首先', '其次', '再次', '然后', '接着', '随后', '之后', '最后', '最终',
  '先', '再', '后', '同时', '紧接着', '接下来', '随后再', '依次', '逐步',
  '一边', '一边', '在此基础之上', '在此基础上', '完成上述', '完成上述后',
  // 中文：流程名词
  '分步骤', '分阶段', '阶段', '流程', '流水线', '环节', '顺序', '次序',
  '拆解', '分解', '递进', '分步执行',
  // 英文
  'first', 'secondly', 'second', 'third', 'thirdly', 'then', 'next',
  'after that', 'afterwards', 'subsequently', 'finally', 'lastly',
  'step by step', 'step-by-step', 'steps', 'in steps', 'sequentially',
  'in order', 'in sequence', 'phase', 'phased', 'stage', 'stages',
  'workflow', 'pipeline', 'meanwhile', 'once done', 'after completing',
  'before that', 'at each stage', 'progressively',
]

/** 结构性多步骤正则：编号列表 / 第N步 / 先…再… / Markdown 列表。 */
export const MULTI_STEP_STRUCTURE_PATTERNS: readonly RegExp[] = [
  /第[一二三四五六七八九十百两\d]+步/g,
  /步骤[一二三四五六七八九十百两\d]+/g,
  /(?:^|[\s。；;，,])[一二三四五六七八九十\d]{1,3}[.、)）]/gm,
  /\bstep\s*[-#]?\s*\d{1,3}\b/gi,
  /先[^。；;\n]{1,60}再/s,
  /先[^。；;\n]{1,60}后/s,
  /(?:^|\n)\s*[-*•]\s+\S/gm,
  /\b(?:1st|2nd|3rd|4th|5th)\b/gi,
  /\b(?:first|second|third|fourth|fifth)\b(?=\s*[,:.)])/gi,
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 九、词表：目标闭环 / 规划 / 验证 / 时间敏感 / 高风险
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 目标闭环词（中英，约 70 词）——「做到为止」的强自主信号。 */
export const GOAL_LOOP_KEYWORDS: readonly string[] = [
  // 中文
  '完成', '做完', '做完为止', '搞定', '弄好', '直到', '直至', '一直到',
  '自动', '自动化', '自动完成', '全部', '所有', '每一个', '每个', '彻底',
  '完全', '全程', '闭环', '自己', '自主', '自行', '主动', '端到端',
  '一气呵成', '反复', '持续', '一直', '不断', '循环', '迭代', '迭代到',
  '确保', '确保全部', '全部完成', '最终完成', '不达目的', '直到成功',
  '尽可能', '尽力', '务必', '一定', '保证', '负责到底', '全程负责',
  // 英文
  'finish', 'finish it', 'complete', 'complete it', 'until', 'till',
  'until done', 'automatically', 'auto', 'automate', 'automated',
  'all', 'all of them', 'every', 'each', 'entire', 'whole', 'end-to-end',
  'autonomously', 'autonomous', 'on your own', 'by yourself', 'loop',
  'iterate', 'iteration', 'repeatedly', 'continuously', 'keep going',
  'ensure', 'make sure', 'ultimately', 'thorough', 'thoroughly',
  'final result', 'to the end', 'no matter what', 'get it done',
]

/** 规划词（中英，约 60 词）。 */
export const PLANNING_KEYWORDS: readonly string[] = [
  // 中文
  '计划', '方案', '设计', '架构', '规划', '策略', '蓝图', '路线图',
  '制定', '拟定', '大纲', '提纲', '框架', '结构设计', '架构设计',
  '技术方案', '实施方案', '规划一下', '做个计划', '先规划', '拆解任务',
  '任务分解', '排期', '里程碑', '目标', '分阶段', '分步骤', '顶层设计',
  '统筹', '布局', '推演', '设想', '构思',
  // 英文
  'plan', 'planning', 'a plan', 'design', 'architecture', 'strategy',
  'roadmap', 'blueprint', 'outline', 'scheme', 'proposal', 'structure',
  'framework', 'approach', 'breakdown', 'task breakdown', 'milestone',
  'schedule', 'organize', 'lay out', 'draft a plan', 'think through',
  'architect', 'high-level design', 'low-level design', 'staging',
  ' phased', 'decompose', 'decomposition', 'design doc', 'rfc',
]

/** 验证词（中英，约 70 词）。 */
export const VERIFICATION_KEYWORDS: readonly string[] = [
  // 中文
  '测试', '测试一下', '验证', '验证一下', '检查', '检查一下', '校验', '核对',
  '复核', '审查', '运行', '运行一下', '调试', '排查', '确认', '试运行',
  '跑一下', '跑一遍', '单测', '单元测试', '集成测试', '回归测试', '端到端测试',
  '自检', '验收', '看看结果', '确保正确', '复查', '测试通过', '跑测试',
  // 英文
  'test', 'tests', 'testing', 'verify', 'verification', 'validate',
  'validation', 'check', 'checking', 'run', 'running', 'debug', 'debugging',
  'execute', 'inspect', 'review', 'confirm', 'sanity check', 'unit test',
  'integration test', 'e2e test', 'regression', 'build', 'compile',
  'lint', 'try it', 'try out', 'dry run', 'smoke test', 'assert',
  'assertion', 'ensure correct', 'proofread', 'proofreading', 'double-check',
  'cross-check', 'test suite', 'test case', 'coverage', 'pass all tests',
]

/** 时间敏感词（中英，约 60 词）。 */
export const TIME_SENSITIVE_KEYWORDS: readonly string[] = [
  // 中文
  '今天', '今日', '今天之内', '今明两天', '现在', '此刻', '立刻', '马上',
  '立即', '即刻', '尽快', '实时', '即时', '同步', '最新', '最新的',
  '刚刚', '刚才', '当前', '目前', '近日', '近期', '本周', '这周',
  '限时', '紧急', '加急', '截止', '期限', ' deadline', '马上要',
  // 英文
  'today', "today's", 'now', 'right now', 'immediately', 'at once',
  'instantly', 'asap', 'urgent', 'urgently', 'realtime', 'real-time',
  'live', 'latest', 'up-to-date', 'up to date', 'current', 'currently',
  'recent', 'recently', 'just now', 'this week', 'tonight', 'deadline',
  'breaking', 'hot', 'fresh', 'time-sensitive', 'time sensitive',
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 十、高风险操作词表（带分类与权重）
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RiskCategory = 'destructive' | 'financial' | 'external' | 'system' | 'permission'

export interface RiskKeyword {
  keyword: string
  category: RiskCategory
  /** 该类别内的权重（1 普通，1.5 严重，2 极严重）。 */
  weight: number
}

/**
 * 高风险词表（约 100 条）。分类用于复杂度评分里「非线性风险加权」：
 * 同一句话里同时出现「删除 + 付费 + 系统级」比单纯出现一次「删除」危险得多。
 */
export const HIGH_RISK_KEYWORDS: readonly RiskKeyword[] = [
  // ── 破坏性操作 ──
  { keyword: '删除', category: 'destructive', weight: 1.5 },
  { keyword: '删掉', category: 'destructive', weight: 1.5 },
  { keyword: '删库', category: 'destructive', weight: 2 },
  { keyword: '删文件', category: 'destructive', weight: 1.5 },
  { keyword: '清空', category: 'destructive', weight: 1.5 },
  { keyword: '清除', category: 'destructive', weight: 1.2 },
  { keyword: '格式化', category: 'destructive', weight: 2 },
  { keyword: '覆盖', category: 'destructive', weight: 1.2 },
  { keyword: '卸载', category: 'destructive', weight: 1.3 },
  { keyword: '移除', category: 'destructive', weight: 1 },
  { keyword: '销毁', category: 'destructive', weight: 2 },
  { keyword: '抹掉', category: 'destructive', weight: 1.8 },
  { keyword: '回滚', category: 'destructive', weight: 1 },
  { keyword: 'reset --hard', category: 'destructive', weight: 1.8 },
  { keyword: 'rm -rf', category: 'destructive', weight: 2 },
  { keyword: 'rm -r', category: 'destructive', weight: 1.6 },
  { keyword: 'drop table', category: 'destructive', weight: 2 },
  { keyword: 'delete', category: 'destructive', weight: 1.5 },
  { keyword: 'drop', category: 'destructive', weight: 1.5 },
  { keyword: 'truncate', category: 'destructive', weight: 1.6 },
  { keyword: 'wipe', category: 'destructive', weight: 1.8 },
  { keyword: 'erase', category: 'destructive', weight: 1.6 },
  { keyword: 'uninstall', category: 'destructive', weight: 1.3 },
  { keyword: 'format', category: 'destructive', weight: 1.8 },
  { keyword: 'purge', category: 'destructive', weight: 1.6 },
  { keyword: 'destroy', category: 'destructive', weight: 2 },
  { keyword: 'overwrite', category: 'destructive', weight: 1.2 },
  // ── 资金相关 ──
  { keyword: '付费', category: 'financial', weight: 1.5 },
  { keyword: '支付', category: 'financial', weight: 1.6 },
  { keyword: '付款', category: 'financial', weight: 1.6 },
  { keyword: '购买', category: 'financial', weight: 1.5 },
  { keyword: '下单', category: 'financial', weight: 1.5 },
  { keyword: '订阅', category: 'financial', weight: 1.2 },
  { keyword: '扣费', category: 'financial', weight: 1.8 },
  { keyword: '充值', category: 'financial', weight: 1.6 },
  { keyword: '转账', category: 'financial', weight: 2 },
  { keyword: '汇款', category: 'financial', weight: 2 },
  { keyword: 'buy', category: 'financial', weight: 1.5 },
  { keyword: 'purchase', category: 'financial', weight: 1.6 },
  { keyword: 'pay', category: 'financial', weight: 1.5 },
  { keyword: 'payment', category: 'financial', weight: 1.6 },
  { keyword: 'subscribe', category: 'financial', weight: 1.2 },
  { keyword: 'charge', category: 'financial', weight: 1.5 },
  { keyword: 'billing', category: 'financial', weight: 1.4 },
  { keyword: 'checkout', category: 'financial', weight: 1.6 },
  { keyword: 'order', category: 'financial', weight: 1 },
  { keyword: 'transfer money', category: 'financial', weight: 2 },
  // ── 对外发送 / 发布 ──
  { keyword: '发送', category: 'external', weight: 1.3 },
  { keyword: '发邮件', category: 'external', weight: 1.5 },
  { keyword: '发短信', category: 'external', weight: 1.5 },
  { keyword: '群发', category: 'external', weight: 1.6 },
  { keyword: '发布', category: 'external', weight: 1.5 },
  { keyword: '推送', category: 'external', weight: 1.3 },
  { keyword: '提交', category: 'external', weight: 1.1 },
  { keyword: '上传', category: 'external', weight: 1.1 },
  { keyword: '分享', category: 'external', weight: 1.1 },
  { keyword: '发推', category: 'external', weight: 1.3 },
  { keyword: 'email', category: 'external', weight: 1.3 },
  { keyword: 'sms', category: 'external', weight: 1.4 },
  { keyword: 'send', category: 'external', weight: 1.2 },
  { keyword: 'publish', category: 'external', weight: 1.5 },
  { keyword: 'deploy', category: 'external', weight: 1.5 },
  { keyword: 'push', category: 'external', weight: 1.2 },
  { keyword: 'tweet', category: 'external', weight: 1.3 },
  { keyword: 'post', category: 'external', weight: 1 },
  { keyword: 'broadcast', category: 'external', weight: 1.5 },
  { keyword: 'notify', category: 'external', weight: 1.1 },
  // ── 系统级 ──
  { keyword: '系统级', category: 'system', weight: 2 },
  { keyword: '系统设置', category: 'system', weight: 1.8 },
  { keyword: '注册表', category: 'system', weight: 1.8 },
  { keyword: '内核', category: 'system', weight: 2 },
  { keyword: '关机', category: 'system', weight: 1.8 },
  { keyword: '重启', category: 'system', weight: 1.6 },
  { keyword: '生产环境', category: 'system', weight: 2 },
  { keyword: '线上环境', category: 'system', weight: 2 },
  { keyword: 'root', category: 'system', weight: 1.8 },
  { keyword: 'sudo', category: 'system', weight: 1.6 },
  { keyword: 'kernel', category: 'system', weight: 2 },
  { keyword: 'shutdown', category: 'system', weight: 1.8 },
  { keyword: 'reboot', category: 'system', weight: 1.6 },
  { keyword: 'production', category: 'system', weight: 1.8 },
  { keyword: 'prod', category: 'system', weight: 1.4 },
  { keyword: 'system', category: 'system', weight: 1.2 },
  { keyword: 'registry', category: 'system', weight: 1.6 },
  { keyword: 'privileged', category: 'system', weight: 1.6 },
  // ── 权限 / 授权 ──
  { keyword: '权限', category: 'permission', weight: 1.3 },
  { keyword: '授权', category: 'permission', weight: 1.4 },
  { keyword: '管理员权限', category: 'permission', weight: 1.8 },
  { keyword: '提权', category: 'permission', weight: 1.8 },
  { keyword: 'chmod', category: 'permission', weight: 1.3 },
  { keyword: 'chmod 777', category: 'permission', weight: 1.8 },
  { keyword: 'chown', category: 'permission', weight: 1.4 },
  { keyword: 'grant', category: 'permission', weight: 1.4 },
  { keyword: 'permission', category: 'permission', weight: 1.2 },
  { keyword: 'access control', category: 'permission', weight: 1.3 },
  { keyword: 'admin', category: 'permission', weight: 1.2 },
]

/** 高风险分析结果（供 extractor 与 complexity 共用同一套语义）。 */
export interface RiskAnalysis {
  /** 命中的关键词条数（去重后按词计） */
  hits: number
  /** 命中的类别集合 */
  categories: Set<RiskCategory>
  /** 加权强度（Σ weight，跨类别叠加体现非线性） */
  weighted: number
}

/** 对文本做高风险分析。 */
export function analyzeRisk(text: string): RiskAnalysis {
  const categories = new Set<RiskCategory>()
  let hits = 0
  let weighted = 0
  if (!text) return { hits, categories, weighted }
  for (const entry of HIGH_RISK_KEYWORDS) {
    const pattern = RISK_PATTERNS.get(entry.keyword)
    if (!pattern) continue
    const count = countPattern(pattern, text)
    if (count > 0) {
      hits += 1
      categories.add(entry.category)
      weighted += entry.weight * Math.min(count, 3) // 同一词重复出现最多计 3 次，防止刷分
    }
  }
  return { hits, categories, weighted }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十一、路径 / 扩展名 / 技术栈
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 常见文件扩展名（用于路径提取，约 60 种）。 */
export const FILE_EXTENSIONS: readonly string[] = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyw', 'ipynb', 'go', 'rs',
  'java', 'kt', 'kts', 'swift', 'cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'rb',
  'php', 'pl', 'sh', 'bash', 'zsh', 'sql', 'vue', 'svelte', 'astro',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'jsonc', 'yaml',
  'yml', 'toml', 'ini', 'conf', 'md', 'mdx', 'txt', 'log', 'csv', 'tsv',
  'xlsx', 'xls', 'docx', 'doc', 'pptx', 'pdf', 'png', 'jpg', 'jpeg', 'gif',
  'svg', 'webp', 'ico', 'mp3', 'mp4', 'wav', 'zip', 'tar', 'gz', 'lock',
  'env', 'gitignore', 'dockerfile', 'gradle', 'xml', 'properties',
]

/** 技术栈定义（约 70 种），每个都配一条精确正则。 */
export const TECH_STACKS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // 前端框架 / 库
  { name: 'React', pattern: /\breact(?:\.js)?\b|\buseState\b|\buseEffect\b|\bJSX\b/i },
  { name: 'Vue', pattern: /\bvue(?:\.js)?\b|\bv-if\b|\bv-for\b|\bdefineComponent\b/i },
  { name: 'Angular', pattern: /\bangular(?:\.js)?\b|\b@Component\b/i },
  { name: 'Svelte', pattern: /\bsvelte\b|\bsveltekit\b/i },
  { name: 'Next.js', pattern: /\bnext(?:\.js)?\b|\bnextjs\b/i },
  { name: 'Nuxt', pattern: /\bnuxt(?:\.js)?\b/i },
  { name: 'Tailwind CSS', pattern: /\btailwind(?:\s*css)?\b/i },
  { name: 'jQuery', pattern: /\bjquery\b/i },
  { name: 'Three.js', pattern: /\bthree(?:\.js)?\b|\bwebgl\b/i },
  // 编程语言
  { name: 'TypeScript', pattern: /\btype\s?script\b|\bts(?:config)?\b/i },
  { name: 'JavaScript', pattern: /\bjava\s?script\b|\becmascript\b/i },
  { name: 'Python', pattern: /\bpython\b|\bpy(?:thon)?\b|\b__init__\b/i },
  { name: 'Go', pattern: /\bgo(?:lang)?\b|\bgofmt\b/i },
  { name: 'Rust', pattern: /\brust\b|\bcargo\b/i },
  { name: 'Java', pattern: /\bjava\b(?!script)|\bjvm\b|\bmaven\b|\bgradle\b/i },
  { name: 'Kotlin', pattern: /\bkotlin\b/i },
  { name: 'Swift', pattern: /\bswift\b/i },
  { name: 'Objective-C', pattern: /\bobjective-c\b|\bobjc\b/i },
  { name: 'C++', pattern: /\bc\+\+\b|\bcpp\b/i },
  { name: 'C#', pattern: /\bc#\b|\bcsharp\b|\b\.net\b/i },
  { name: 'C', pattern: /\bc语言\b|\bc program\b/i },
  { name: 'PHP', pattern: /\bphp\b|\bcomposer\b/i },
  { name: 'Ruby', pattern: /\bruby\b|\brails\b|\bgem\b/i },
  { name: 'Perl', pattern: /\bperl\b/i },
  { name: 'Scala', pattern: /\bscala\b/i },
  { name: 'Dart', pattern: /\bdart\b/i },
  { name: 'R', pattern: /\br语言\b|\bcran\b/i },
  { name: 'MATLAB', pattern: /\bmatlab\b/i },
  { name: 'Shell', pattern: /\bshell\b|\bbash\b|\bzsh\b/i },
  { name: 'SQL', pattern: /\bsql\b|\bpostgres(?:ql)?\b/i },
  { name: 'Solidity', pattern: /\bsolidity\b|\b智能合约\b/i },
  // 运行时 / 服务端
  { name: 'Node.js', pattern: /\bnode(?:\.js)?\b|\bnpm\b|\bexpress\b/i },
  { name: 'Deno', pattern: /\bdeno\b/i },
  { name: 'Bun', pattern: /\bbun\b/i },
  { name: 'Django', pattern: /\bdjango\b/i },
  { name: 'Flask', pattern: /\bflask\b/i },
  { name: 'FastAPI', pattern: /\bfastapi\b/i },
  { name: 'Spring', pattern: /\bspring\b|\bspring boot\b/i },
  { name: 'Express', pattern: /\bexpress(?:\.js)?\b/i },
  { name: 'NestJS', pattern: /\bnest(?:js)?\b/i },
  { name: 'Gin', pattern: /\bgin(?:\.go|框架)?\b/i },
  { name: 'Rails', pattern: /\bruby on rails\b|\brails\b/i },
  { name: 'Laravel', pattern: /\blaravel\b/i },
  // 移动端 / 桌面
  { name: 'React Native', pattern: /\breact native\b/i },
  { name: 'Flutter', pattern: /\bflutter\b|\bdart\b/i },
  { name: 'Electron', pattern: /\belectron\b/i },
  { name: 'Unity', pattern: /\bunity\b|\bunity3d\b/i },
  { name: 'Unreal Engine', pattern: /\bunreal\b|\bue[45]\b/i },
  // 数据库 / 存储
  { name: 'PostgreSQL', pattern: /\bpostgre(?:sql)?\b|\bpsql\b/i },
  { name: 'MySQL', pattern: /\bmysql\b|\bmariadb\b/i },
  { name: 'MongoDB', pattern: /\bmongo(?:db)?\b/i },
  { name: 'Redis', pattern: /\bredis\b/i },
  { name: 'SQLite', pattern: /\bsqlite\b/i },
  { name: 'Oracle', pattern: /\boracle\b/i },
  { name: 'SQL Server', pattern: /\bsql server\b|\bmssql\b/i },
  { name: 'Elasticsearch', pattern: /\belasticsearch\b|\belk\b/i },
  { name: 'Kafka', pattern: /\bkafka\b/i },
  { name: 'RabbitMQ', pattern: /\brabbitmq\b/i },
  // DevOps / 云
  { name: 'Docker', pattern: /\bdocker\b|\bdockerfile\b|\bdocker-compose\b/i },
  { name: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b|\bkubectl\b|\bhelm\b/i },
  { name: 'AWS', pattern: /\baws\b|\bamazon web services\b|\bs3\b|\bec2\b/i },
  { name: 'Azure', pattern: /\bazure\b/i },
  { name: 'GCP', pattern: /\bgcp\b|\bgoogle cloud\b|\bbigquery\b/i },
  { name: 'Terraform', pattern: /\bterraform\b/i },
  { name: 'Nginx', pattern: /\bnginx\b/i },
  { name: 'Linux', pattern: /\blinux\b|\bubuntu\b|\bcentos\b|\bdebian\b/i },
  { name: 'macOS', pattern: /\bmacos\b|\bmac os\b|\bosx\b/i },
  { name: 'Windows', pattern: /\bwindows\b|\bwin32\b/i },
  { name: 'Git', pattern: /\bgit\b|\bgithub\b|\bgitlab\b/i },
  { name: 'CI/CD', pattern: /\bci\/cd\b|\bjenkins\b|\bgithub actions\b|\bgitlab ci\b/i },
  // API / 数据 / ML
  { name: 'GraphQL', pattern: /\bgraphql\b/i },
  { name: 'REST API', pattern: /\brest(?:ful)?\s*api\b|\brestful\b/i },
  { name: 'WebSocket', pattern: /\bwebsocket\b|\bws:\/\//i },
  { name: 'Pandas', pattern: /\bpandas\b/i },
  { name: 'NumPy', pattern: /\bnumpy\b/i },
  { name: 'PyTorch', pattern: /\bpytorch\b|\btorch\b/i },
  { name: 'TensorFlow', pattern: /\btensorflow\b|\bkeras\b/i },
  { name: 'Scikit-learn', pattern: /\bscikit-learn\b|\bsklearn\b/i },
]

/* ═══════════════════════════════════════════════════════════════════════════
 * 十二、预编译匹配器（模块加载时一次性构建）
 * ═══════════════════════════════════════════════════════════════════════════ */

const RISK_PATTERNS = new Map<string, RegExp>(
  HIGH_RISK_KEYWORDS.map((entry) => [entry.keyword, compileKeywords([entry.keyword])[0]]),
)

const MATCHERS = {
  code: [...compileKeywords(CODE_KEYWORDS), ...CODE_STRUCTURE_PATTERNS],
  fileOp: compileKeywords(FILE_OP_KEYWORDS),
  shell: compileKeywords(SHELL_KEYWORDS),
  research: compileKeywords(RESEARCH_KEYWORDS),
  creative: compileKeywords(CREATIVE_KEYWORDS),
  data: compileKeywords(DATA_KEYWORDS),
  multiStep: compileKeywords(MULTI_STEP_KEYWORDS),
  goalLoop: compileKeywords(GOAL_LOOP_KEYWORDS),
  planning: compileKeywords(PLANNING_KEYWORDS),
  verification: compileKeywords(VERIFICATION_KEYWORDS),
  timeSensitive: compileKeywords(TIME_SENSITIVE_KEYWORDS),
} as const

/** 附件/媒体内容的正则（用于识别多模态分片）。 */
const MEDIA_TYPE_PATTERN = /image|audio|video|file|attachment|document|binary|image_url|input_image/i
const INLINE_MEDIA_PATTERN = /data:image\/|\[图片\]|\[附件\]|!\[[^\]]*\]\(/i

/* ═══════════════════════════════════════════════════════════════════════════
 * 十三、文本归一化 / token 估算 / 路径提取
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 归一化文本：NFKC 兼容字符（全角→半角）、转小写、去空白与标点符号。
 * 仅用于 `TaskSignals.normalized` 字段；检测仍基于原始文本，
 * 因为去掉空白会破坏英文单词边界。
 */
export function normalizeText(text: string): string {
  if (!text) return ''
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '')
}

/**
 * token 粗估（中英混合策略）：
 *   - 中文/日文/韩文表意字符：每个字符 ≈ 1 token（按字符计）
 *   - 英文单词：每个词 ≈ 1 token（按词计）
 *   - 数字串：每组 ≈ 1 token
 *   - 其余标点/符号：每 4 个 ≈ 1 token
 * 这不是精确 tokenizer，但对路由预算估算足够稳定且可解释。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length
  const words = (text.match(/[A-Za-z][A-Za-z0-9_'’-]*/g) || []).length
  const numbers = (text.match(/\d+(?:\.\d+)?/g) || []).length
  const symbols = (text.match(/[^\s\p{L}\p{N}]/gu) || []).length
  return cjk + words + numbers + Math.floor(symbols / 4)
}

/** 收集去重后的路径，只清理行尾标点（不能清中间的点，否则扩展名会被吃掉）。 */
function pushPath(set: Set<string>, raw: string): void {
  const cleaned = raw
    .replace(/[.,;:)\]}"'，。；：）】、]+$/g, '')
    .trim()
  if (cleaned.length > 1) set.add(cleaned)
}

/**
 * 提取文件路径：
 *   1. Windows 盘符路径（C:\foo\bar.ts）
 *   2. POSIX 绝对路径（/Users/foo/bar.ts）
 *   3. 带扩展名的相对路径 / 文件名（./src/a.ts、config.yaml、README.md）
 * 去重后返回。刻意排除 URL（lookbehind 阻挡 `://`）。
 */
export function extractFilePaths(text: string): string[] {
  const found = new Set<string>()
  if (!text) return []

  // Windows 路径
  for (const match of text.matchAll(/[a-zA-Z]:\\[^\s"'<>|，。；、]+/g)) {
    pushPath(found, match[0])
  }

  // POSIX 绝对路径（含多层目录或至少一个扩展名）
  for (const match of text.matchAll(/(?<![:\w/])(\/(?:[\w.@~+-]+\/)*[\w.@~+-]+)/g)) {
    const candidate = match[1]
    // 过滤纯符号("/", "//") 与明显是 URL 片段的短串
    if (/[\w]/.test(candidate) && candidate.length > 1) pushPath(found, candidate)
  }

  // 相对路径 / 带扩展名文件名
  const ext = FILE_EXTENSIONS.map(escapeRegExp).join('|')
  const relative = new RegExp(
    `(?<![\\w/])((?:\\.{1,2}/)?[\\w.@~+-]+(?:\\/[\\w.@~+-]+)*\\.(?:${ext}))\\b`,
    'gi',
  )
  for (const match of text.matchAll(relative)) {
    pushPath(found, match[1])
  }

  return [...found]
}

/** 识别技术栈，返回规范名称（去重，保持出现顺序）。 */
export function detectTechStacks(text: string): string[] {
  const out: string[] = []
  if (!text) return out
  for (const { name, pattern } of TECH_STACKS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    if (global.test(text) && !out.includes(name)) out.push(name)
  }
  return out
}

/** 统计文本里的步骤标记数量（编号、第N步、先…再…）。 */
export function countStepMarkers(text: string): number {
  if (!text) return 0
  let total = 0
  for (const pattern of MULTI_STEP_STRUCTURE_PATTERNS) {
    total += countPattern(pattern, text)
  }
  return total
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十四、多模态 content 解析
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ContentExtraction {
  /** 拼接出的纯文本（仅 text 类型的分片） */
  text: string
  /** 是否含有图片/音频/文件/附件分片 */
  hasMedia: boolean
}

/**
 * 从 LoopMessage.content 中抽取文本与媒体标记。
 * 兼容四种常见形态：
 *   - string
 *   - Array<{ type, text } | { type: 'image_url', image_url } | string>
 *   - { type, text }（对象型单分片）
 *   - null / undefined / 其他
 */
export function extractTextFromContent(content: unknown): ContentExtraction {
  if (typeof content === 'string') {
    return { text: content, hasMedia: INLINE_MEDIA_PATTERN.test(content) }
  }

  if (Array.isArray(content)) {
    let text = ''
    let hasMedia = false
    for (const part of content) {
      if (typeof part === 'string') {
        text += part
        continue
      }
      if (!part || typeof part !== 'object') continue
      const record = part as Record<string, unknown>
      const type = typeof record.type === 'string' ? record.type : ''
      if (MEDIA_TYPE_PATTERN.test(type)) hasMedia = true
      if (typeof record.text === 'string') text += record.text
      else if (typeof record.content === 'string') text += record.content
      else if (typeof record.alt === 'string') text += record.alt
      // 只要分片携带 image_url / image 字段，也视为媒体
      if ('image_url' in record || 'image' in record || 'input_image' in record) hasMedia = true
    }
    return { text, hasMedia: hasMedia || INLINE_MEDIA_PATTERN.test(text) }
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    const text = typeof record.text === 'string'
      ? record.text
      : (typeof record.content === 'string' ? record.content : '')
    return {
      text,
      hasMedia: MEDIA_TYPE_PATTERN.test(type) || INLINE_MEDIA_PATTERN.test(text),
    }
  }

  return { text: '', hasMedia: false }
}

export interface MessageScan {
  /** 最近一条 user 消息的文本（多模态已摊平为纯文本） */
  lastUserText: string
  /** 任意消息中是否出现附件/媒体 */
  hasAttachment: boolean
  /** user 角色消息数量（含本轮） */
  historyTurns: number
  /** 所有 user 文本按序拼接（备用，当前判定以最近一条为准） */
  allUserText: string
}

/** 扫描整个消息数组，产出 rawText / 附件 / 轮次等元信息。 */
export function scanMessages(messages: LoopMessage[]): MessageScan {
  const empty: MessageScan = { lastUserText: '', hasAttachment: false, historyTurns: 0, allUserText: '' }
  if (!Array.isArray(messages) || messages.length === 0) return empty

  let lastUserText = ''
  let hasAttachment = false
  let historyTurns = 0
  const userTexts: string[] = []

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : ''
    const extracted = extractTextFromContent(message.content)

    // 显式附件字段（上层可能把附件挂在消息根上）
    const rootAttachments = message.attachments || message.images || message.files
    if (extracted.hasMedia || Array.isArray(rootAttachments) && rootAttachments.length > 0) {
      hasAttachment = true
    }

    if (role === 'user') {
      historyTurns += 1
      lastUserText = extracted.text
      userTexts.push(extracted.text)
    }
  }

  return {
    lastUserText,
    hasAttachment,
    historyTurns,
    allUserText: userTexts.join('\n'),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十五、SignalExtractorImpl
 * ═══════════════════════════════════════════════════════════════════════════ */

export class SignalExtractorImpl implements SignalExtractor {
  /** 可传入自定义词表扩展（默认使用内置的全部词表）。 */
  constructor(private readonly options: {
    /** 额外代码词 */
    extraCodeKeywords?: string[]
    /** 额外技术栈 */
    extraTechStacks?: Array<{ name: string; pattern: RegExp }>
  } = {}) {}

  extract(messages: LoopMessage[]): TaskSignals {
    const scan = scanMessages(messages)
    const rawText = scan.lastUserText

    // 检测基于原始文本（正则自带 i 标志）；归一化文本只作为输出字段。
    const codeHit = matchesAny(MATCHERS.code, rawText) ||
      (this.options.extraCodeKeywords?.length
        ? matchesAny(compileKeywords(this.options.extraCodeKeywords), rawText)
        : false)
    const risk = analyzeRisk(rawText)
    const techStacks = detectTechStacks(rawText)
    if (this.options.extraTechStacks?.length) {
      for (const { name, pattern } of this.options.extraTechStacks) {
        const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
        if (re.test(rawText) && !techStacks.includes(name)) techStacks.push(name)
      }
    }

    return {
      rawText,
      normalized: normalizeText(rawText),
      charLength: rawText.length,
      tokenEstimate: estimateTokens(rawText),
      hasCode: codeHit,
      hasFileOp: matchesAny(MATCHERS.fileOp, rawText),
      hasShell: matchesAny(MATCHERS.shell, rawText),
      hasResearch: matchesAny(MATCHERS.research, rawText),
      hasCreative: matchesAny(MATCHERS.creative, rawText),
      hasData: matchesAny(MATCHERS.data, rawText),
      hasMultiStep: matchesAny(MATCHERS.multiStep, rawText) || countStepMarkers(rawText) > 0,
      hasGoalLoop: matchesAny(MATCHERS.goalLoop, rawText),
      hasPlanning: matchesAny(MATCHERS.planning, rawText),
      hasVerification: matchesAny(MATCHERS.verification, rawText),
      fileRefs: extractFilePaths(rawText),
      techStacks,
      historyTurns: scan.historyTurns,
      hasAttachment: scan.hasAttachment,
      isTimeSensitive: matchesAny(MATCHERS.timeSensitive, rawText),
      hasHighRisk: risk.hits > 0,
    }
  }
}

/** 默认单例（无状态，可安全共享）。 */
export const DEFAULT_SIGNAL_EXTRACTOR = new SignalExtractorImpl()

/** 便捷函数：等价于 `new SignalExtractorImpl().extract(messages)`。 */
export function extractSignals(messages: LoopMessage[]): TaskSignals {
  return DEFAULT_SIGNAL_EXTRACTOR.extract(messages)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十六、证据追踪（可解释性的第二层）
 *
 * 前文的 TaskSignals 是一组「压缩后的布尔/数值」，下游能据此路由，但无法
 * 回答「为什么 hasCode = true」。本节提供一套证据追踪能力：把每个维度
 * 到底命中了哪些词、命中几次、首现位置全部记录下来。
 *
 * 使用场景：
 *   - 诊断面板：点开「复杂度得分」能看到触发词高亮；
 *   - 回归调试：改了一个词表能立刻看到哪些用例的判定会变化；
 *   - 用户申诉：为什么这条消息被判为高风险——直接列出命中的风险词。
 *
 * 这些函数不修改 extract() 的输出契约（TaskSignals 字段定死，见 types.ts），
 * 而是作为独立的「旁路观测」API 存在，需要时显式调用。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 单个关键词的命中证据。 */
export interface KeywordHit {
  /** 命中的词表原文（可能是中文或英文） */
  keyword: string
  /** 出现次数 */
  count: number
  /** 首次出现位置（字符下标，-1 表示未命中） */
  firstIndex: number
}

/** 一个维度的命中最值。 */
export interface DimensionEvidence {
  /** 维度名（与 TaskSignals 字段对应） */
  dimension: string
  /** 是否判定为真 */
  active: boolean
  /** 命中的关键词证据（按 count 降序） */
  hits: KeywordHit[]
  /** 命中词的总种类数 */
  distinctHits: number
  /** 命中总次数（含重复） */
  totalOccurrences: number
}

/** 完整的信号证据报告。 */
export interface SignalEvidenceReport {
  /** 参与检测的文本 */
  source: string
  /** 各维度证据 */
  dimensions: Record<string, DimensionEvidence>
  /** 风险细项（类别与加权） */
  risk: RiskAnalysis
  /** 提取出的路径 */
  fileRefs: string[]
  /** 识别出的技术栈 */
  techStacks: string[]
}

/**
 * 在文本中查找一个关键词的所有出现位置（大小写不敏感）。
 * 复用 compileKeywords 生成的正则（自带词边界），但用 global 迭代。
 */
export function findKeywordOccurrences(keyword: string, text: string): number[] {
  if (!text) return []
  const base = compileKeywords([keyword])[0]
  const global = new RegExp(base.source, base.flags.includes('g') ? base.flags : `${base.flags}g`)
  const positions: number[] = []
  let match: RegExpExecArray | null
  let guard = 0
  while ((match = global.exec(text)) !== null && guard < 1000) {
    positions.push(match.index)
    if (match[0].length === 0) global.lastIndex += 1
    guard += 1
  }
  return positions
}

/**
 * 关键词表 → 命中证据数组。
 * @param keywords 原始词表
 * @param text 待检测文本
 * @param limit 最多返回多少个证据（默认 20，避免报告过长）
 */
export function collectKeywordHits(keywords: readonly string[], text: string, limit = 20): KeywordHit[] {
  const hits: KeywordHit[] = []
  for (const keyword of keywords) {
    const positions = findKeywordOccurrences(keyword, text)
    if (positions.length > 0) {
      hits.push({ keyword, count: positions.length, firstIndex: positions[0] })
    }
  }
  hits.sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
  return hits.slice(0, limit)
}

/** 维度名 → 词表的映射（证据子系统专用，与 MATCHERS 一一对应）。 */
export const DIMENSION_KEYWORD_TABLES: Record<string, readonly string[]> = {
  code: CODE_KEYWORDS,
  fileOp: FILE_OP_KEYWORDS,
  shell: SHELL_KEYWORDS,
  research: RESEARCH_KEYWORDS,
  creative: CREATIVE_KEYWORDS,
  data: DATA_KEYWORDS,
  multiStep: MULTI_STEP_KEYWORDS,
  goalLoop: GOAL_LOOP_KEYWORDS,
  planning: PLANNING_KEYWORDS,
  verification: VERIFICATION_KEYWORDS,
  timeSensitive: TIME_SENSITIVE_KEYWORDS,
}

/** 维度名 → 布尔字段的取值器（判断该维度是否「激活」）。 */
const DIMENSION_ACTIVATORS: Record<string, (signals: TaskSignals) => boolean> = {
  code: (s) => s.hasCode,
  fileOp: (s) => s.hasFileOp,
  shell: (s) => s.hasShell,
  research: (s) => s.hasResearch,
  creative: (s) => s.hasCreative,
  data: (s) => s.hasData,
  multiStep: (s) => s.hasMultiStep,
  goalLoop: (s) => s.hasGoalLoop,
  planning: (s) => s.hasPlanning,
  verification: (s) => s.hasVerification,
  timeSensitive: (s) => s.isTimeSensitive,
}

/**
 * 生成完整的信号证据报告。
 * 这是 `extract()` 的「可解释旁路」：同样的文本，输出逐维度命中明细。
 */
export function collectEvidence(signals: TaskSignals, source?: string): SignalEvidenceReport {
  const text = source ?? signals.rawText ?? ''
  const dimensions: Record<string, DimensionEvidence> = {}

  for (const [name, table] of Object.entries(DIMENSION_KEYWORD_TABLES)) {
    const hits = collectKeywordHits(table, text)
    dimensions[name] = {
      dimension: name,
      active: DIMENSION_ACTIVATORS[name]?.(signals) ?? false,
      hits,
      distinctHits: hits.length,
      totalOccurrences: hits.reduce((sum, h) => sum + h.count, 0),
    }
  }

  // 高风险维度单独处理：词表条目是对象而非字符串
  const riskHits: KeywordHit[] = []
  for (const entry of HIGH_RISK_KEYWORDS) {
    const positions = findKeywordOccurrences(entry.keyword, text)
    if (positions.length > 0) {
      riskHits.push({ keyword: `${entry.keyword}(${entry.category})`, count: positions.length, firstIndex: positions[0] })
    }
  }
  riskHits.sort((a, b) => b.count - a.count)
  dimensions.highRisk = {
    dimension: 'highRisk',
    active: signals.hasHighRisk,
    hits: riskHits,
    distinctHits: riskHits.length,
    totalOccurrences: riskHits.reduce((sum, h) => sum + h.count, 0),
  }

  return {
    source: text,
    dimensions,
    risk: analyzeRisk(text),
    fileRefs: extractFilePaths(text),
    techStacks: detectTechStacks(text),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十七、否定与不确定性处理
 *
 * 真实聊天里，「不要删除文件」「别写代码了」「不需要搜索」这类否定句
 * 若按正向命中处理会严重误判。本节提供轻量的否定检测，供 extract() 之外
 * 的高级调用方（如 router）做二次校正。extract() 本身保持「语法命中」语义
 * （因为下游复杂度评分要的是「话题涉及」，而非「最终意图」），但把否定
 * 信号作为旁路输出，避免信息丢失。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 否定词表（中英，约 60 词）。 */
export const NEGATION_KEYWORDS: readonly string[] = [
  // 中文
  '不', '不要', '不用', '不需要', '别', '别再', '不再', '没有', '没', '非',
  '无需', '无须', '不必', '禁止', '切勿', '千万不', '避免', '别把', '别给',
  '不做', '不写', '不删', '不运行', '不创建', '不修改', '不发送', '不买',
  '不用管', '先不', '暂时不', '暂时不用', '取消', '撤销', '放弃', '停止',
  '算了', '不用了', '不需要了', '不作',
  // 英文
  'no', 'not', "don't", 'do not', 'dont', 'never', 'none', 'nothing',
  'without', 'skip', 'avoid', 'stop', 'cancel', 'abort', 'undo',
  "isn't", "aren't", "can't", "cannot", "won't", "wouldn't", "shouldn't",
  'never mind', 'forget it', 'no need', 'not necessary', 'hold off',
]

/** 不确定性 / 试探词表（中英，约 50 词）。 */
export const UNCERTAINTY_KEYWORDS: readonly string[] = [
  // 中文
  '也许', '或许', '可能', '大概', '也许吧', '好像', '似乎', '或许可以',
  '能不能', '可不可以', '要不要', '是不是', '有没有', '请问', '如果',
  '假如', '假设', '万一', '不一定', '不确定', '我不确定', '试试', '试着',
  '随便', '都可以', '你看着办', '酌情', '视情况', '大致', '差不多',
  // 英文
  'maybe', 'perhaps', 'possibly', 'probably', 'might', 'could', 'perhaps',
  'i think', 'i guess', 'not sure', 'unsure', 'perhaps not', 'if possible',
  'try to', 'attempt to', 'roughly', 'about', 'around', 'sort of', 'kind of',
]

const NEGATION_PATTERNS = compileKeywords(NEGATION_KEYWORDS)
const UNCERTAINTY_PATTERNS = compileKeywords(UNCERTAINTY_KEYWORDS)

export interface ModalitySignals {
  /** 是否含否定词 */
  hasNegation: boolean
  /** 命中否定词数量 */
  negationCount: number
  /** 是否含不确定词 */
  hasUncertainty: boolean
  /** 命中不确定词数量 */
  uncertaintyCount: number
  /** 是否像是在「试探/询问」而非「下达指令」 */
  isTentative: boolean
}

/** 检测文本里的否定 / 不确定性语气。 */
export function detectModality(text: string): ModalitySignals {
  const negationCount = countAny(NEGATION_PATTERNS, text)
  const uncertaintyCount = countAny(UNCERTAINTY_PATTERNS, text)
  return {
    hasNegation: negationCount > 0,
    negationCount,
    hasUncertainty: uncertaintyCount > 0,
    uncertaintyCount,
    isTentative: uncertaintyCount > 0 && !/(?:必须|一定|务必|ensure|must)/i.test(text),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 十八、信号摘要（人类可读的一行速览）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 把 TaskSignals 压缩成一段中文摘要，便于日志/诊断面板快速浏览。 */
export function summarizeSignals(signals: TaskSignals): string {
  const active: string[] = []
  const labels: Array<[boolean, string]> = [
    [signals.hasCode, '代码'], [signals.hasFileOp, '文件'], [signals.hasShell, '命令行'],
    [signals.hasResearch, '调研'], [signals.hasCreative, '创作'], [signals.hasData, '数据'],
    [signals.hasMultiStep, '多步'], [signals.hasGoalLoop, '闭环'], [signals.hasPlanning, '规划'],
    [signals.hasVerification, '验证'], [signals.hasHighRisk, '高风险'],
    [signals.isTimeSensitive, '时效'], [signals.hasAttachment, '附件'],
  ]
  for (const [flag, label] of labels) if (flag) active.push(label)
  const tech = signals.techStacks.slice(0, 3).join('/')
  const parts = [
    `长度${signals.charLength}字/${signals.tokenEstimate}token`,
    `${signals.historyTurns}轮`,
    active.length ? `信号[${active.join('、')}]` : '信号[无]',
    tech ? `技术栈[${tech}]` : '',
    signals.fileRefs.length ? `${signals.fileRefs.length}个文件引用` : '',
  ].filter(Boolean)
  return parts.join(' | ')
}

/** 在 SignalExtractorImpl 上挂一个「带证据」的便捷方法。 */
export function extractWithEvidence(
  extractor: SignalExtractorImpl,
  messages: LoopMessage[],
): { signals: TaskSignals; evidence: SignalEvidenceReport; modality: ModalitySignals; summary: string } {
  const signals = extractor.extract(messages)
  return {
    signals,
    evidence: collectEvidence(signals),
    modality: detectModality(signals.rawText),
    summary: summarizeSignals(signals),
  }
}
