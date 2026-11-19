import { describe, it, expect } from 'vitest'
import {
  SignalExtractorImpl,
  extractSignals,
  DEFAULT_SIGNAL_EXTRACTOR,
  normalizeText,
  estimateTokens,
  extractFilePaths,
  detectTechStacks,
  countStepMarkers,
  analyzeRisk,
  extractTextFromContent,
  scanMessages,
  compileKeywords,
  escapeRegExp,
  matchesAny,
  countAny,
  CODE_KEYWORDS,
  FILE_OP_KEYWORDS,
  SHELL_KEYWORDS,
  RESEARCH_KEYWORDS,
  CREATIVE_KEYWORDS,
  DATA_KEYWORDS,
  MULTI_STEP_KEYWORDS,
  GOAL_LOOP_KEYWORDS,
  PLANNING_KEYWORDS,
  VERIFICATION_KEYWORDS,
  TIME_SENSITIVE_KEYWORDS,
  HIGH_RISK_KEYWORDS,
  TECH_STACKS,
  FILE_EXTENSIONS,
  NEGATION_KEYWORDS,
  UNCERTAINTY_KEYWORDS,
  collectEvidence,
  collectKeywordHits,
  findKeywordOccurrences,
  detectModality,
  summarizeSignals,
  extractWithEvidence,
} from '../../src/shared/super/signals/extractor'
import type { LoopMessage } from '../../src/shared/agentLoop'

/* ── 测试辅助 ── */
function user(content: unknown): LoopMessage {
  return { role: 'user', content }
}
function assistant(content: unknown): LoopMessage {
  return { role: 'assistant', content }
}
function tool(role: string, content: unknown): LoopMessage {
  return { role, content }
}

describe('信号采集器：词表规模（充分性）', () => {
  it('每个检测维度都有几十个词，而不是三五个', () => {
    expect(CODE_KEYWORDS.length).toBeGreaterThan(70)
    expect(FILE_OP_KEYWORDS.length).toBeGreaterThan(60)
    expect(SHELL_KEYWORDS.length).toBeGreaterThan(60)
    expect(RESEARCH_KEYWORDS.length).toBeGreaterThan(60)
    expect(CREATIVE_KEYWORDS.length).toBeGreaterThan(60)
    expect(DATA_KEYWORDS.length).toBeGreaterThan(60)
    expect(MULTI_STEP_KEYWORDS.length).toBeGreaterThan(40)
    expect(GOAL_LOOP_KEYWORDS.length).toBeGreaterThan(50)
    expect(PLANNING_KEYWORDS.length).toBeGreaterThan(40)
    expect(VERIFICATION_KEYWORDS.length).toBeGreaterThan(50)
    expect(TIME_SENSITIVE_KEYWORDS.length).toBeGreaterThan(40)
    expect(HIGH_RISK_KEYWORDS.length).toBeGreaterThan(80)
    expect(TECH_STACKS.length).toBeGreaterThan(50)
    expect(FILE_EXTENSIONS.length).toBeGreaterThan(50)
  })
})

describe('工具函数', () => {
  it('escapeRegExp 转义元字符，C++ 不再被当成正则语法', () => {
    expect(escapeRegExp('a.b')).toBe('a\\.b')
    expect(escapeRegExp('C++')).toBe('C\\+\\+')
    expect(() => compileKeywords(['C++', 'a.b', 'rm -rf'])).not.toThrow()
  })

  it('compileKeywords + matchesAny：ASCII 词有边界，中文子串匹配', () => {
    const go = compileKeywords(['go'])
    expect(matchesAny(go, 'please go home')).toBe(true)
    expect(matchesAny(go, 'algorithm')).toBe(false) // 边界保护，不应命中 logo/algorithm
    expect(matchesAny(go, 'logo')).toBe(false)

    const zh = compileKeywords(['删除'])
    expect(matchesAny(zh, '请删除这个文件')).toBe(true)
    expect(matchesAny(zh, '无需操作')).toBe(false)

    expect(matchesAny([], 'anything')).toBe(false)
    expect(matchesAny(go, '')).toBe(false)
  })

  it('countAny 统计总命中数', () => {
    const patterns = compileKeywords(['测试', '验证'])
    expect(countAny(patterns, '先测试，再验证，最后再测试')).toBe(3)
    expect(countAny(patterns, '')).toBe(0)
  })
})

describe('文本归一化 normalizeText', () => {
  it('NFKC 全角转半角、去空白与标点、转小写', () => {
    expect(normalizeText('  Ｈｅｌｌｏ， 世界！  ')).toBe('hello世界')
    expect(normalizeText('A B\tc\nd')).toBe('abcd')
    expect(normalizeText('')).toBe('')
  })
})

describe('token 粗估 estimateTokens', () => {
  it('纯中文按字符计', () => {
    expect(estimateTokens('你好世界')).toBe(4)
  })
  it('纯英文按词计', () => {
    expect(estimateTokens('hello world')).toBe(2)
    expect(estimateTokens('one two three')).toBe(3)
  })
  it('中英混合 + 数字', () => {
    // 中文 3（你好呀）+ 英文 2（hello world）+ 数字 1（123）
    expect(estimateTokens('你好呀 hello world 123')).toBe(6)
  })
  it('空文本为 0，标点分摊', () => {
    expect(estimateTokens('')).toBe(0)
    // 4 个符号 ≈ 1 token
    expect(estimateTokens('!!!?')).toBe(1)
  })
})

describe('多模态 content 解析', () => {
  it('纯字符串', () => {
    expect(extractTextFromContent('hello')).toEqual({ text: 'hello', hasMedia: false })
  })
  it('数组型 text 分片', () => {
    const content = [
      { type: 'text', text: '请分析 ' },
      { type: 'text', text: '这张图' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } },
    ]
    const result = extractTextFromContent(content)
    expect(result.text).toBe('请分析 这张图')
    expect(result.hasMedia).toBe(true)
  })
  it('内联图片标记也算媒体', () => {
    expect(extractTextFromContent('请看 ![图](http://x.png)').hasMedia).toBe(true)
    expect(extractTextFromContent('[附件]').hasMedia).toBe(true)
  })
  it('对象型分片与 null 容错', () => {
    expect(extractTextFromContent({ type: 'text', text: '对象文本' }).text).toBe('对象文本')
    expect(extractTextFromContent({ type: 'input_audio' }).hasMedia).toBe(true)
    expect(extractTextFromContent(null)).toEqual({ text: '', hasMedia: false })
    expect(extractTextFromContent(42)).toEqual({ text: '', hasMedia: false })
  })
})

describe('消息扫描 scanMessages', () => {
  it('统计历史轮次、取最近一条 user、识别附件', () => {
    const messages: LoopMessage[] = [
      user('第一轮'),
      assistant('答复'),
      user([{ type: 'text', text: '第二轮带图' }, { type: 'image_url', image_url: {} }]),
      assistant('再答'),
    ]
    const scan = scanMessages(messages)
    expect(scan.historyTurns).toBe(2)
    expect(scan.lastUserText).toBe('第二轮带图')
    expect(scan.hasAttachment).toBe(true)
    expect(scan.allUserText).toContain('第一轮')
  })
  it('空数组与无 user 消息', () => {
    expect(scanMessages([]).historyTurns).toBe(0)
    const only = scanMessages([assistant('hi')])
    expect(only.historyTurns).toBe(0)
    expect(only.lastUserText).toBe('')
  })
})

describe('文件路径提取 extractFilePaths', () => {
  it('绝对路径 / 相对路径 / Windows 路径 / 扩展名文件名', () => {
    const paths = extractFilePaths(
      '请改 /Users/foo/bar.ts 和 ./src/index.js，还有 config.yaml、C:\\proj\\main.py、README.md',
    )
    expect(paths).toContain('/Users/foo/bar.ts')
    expect(paths).toContain('./src/index.js')
    expect(paths).toContain('config.yaml')
    expect(paths).toContain('C:\\proj\\main.py')
    expect(paths).toContain('README.md')
  })
  it('去重且清理行尾标点', () => {
    const paths = extractFilePaths('看 a.ts， b.ts。 a.ts')
    expect(paths.filter((p) => p === 'a.ts')).toHaveLength(1)
    expect(paths).not.toContain('b.ts。')
  })
  it('不把 URL 当路径', () => {
    const paths = extractFilePaths('打开 https://example.com/a/b.ts')
    expect(paths.some((p) => p.includes('://'))).toBe(false)
  })
  it('空文本返回空数组', () => {
    expect(extractFilePaths('')).toEqual([])
  })
})

describe('技术栈识别 detectTechStacks', () => {
  it('英文技术栈', () => {
    const stacks = detectTechStacks('用 React 和 TypeScript 写，数据库用 PostgreSQL，部署在 Docker')
    expect(stacks).toContain('React')
    expect(stacks).toContain('TypeScript')
    expect(stacks).toContain('PostgreSQL')
    expect(stacks).toContain('Docker')
  })
  it('中文技术栈', () => {
    const stacks = detectTechStacks('用python写，结合mysql数据库')
    expect(stacks).toContain('Python')
    expect(stacks).toContain('MySQL')
  })
  it('单个词边界保护：algorithm 不应误判为 Go', () => {
    expect(detectTechStacks('an algorithm problem')).not.toContain('Go')
  })
  it('去重且保持顺序', () => {
    const stacks = detectTechStacks('React React Vue')
    expect(stacks.filter((s) => s === 'React')).toHaveLength(1)
    expect(stacks.indexOf('React')).toBeLessThan(stacks.indexOf('Vue'))
  })
})

describe('步骤标记统计 countStepMarkers', () => {
  it('中文第N步 / 先…再… / Markdown 列表', () => {
    const text = '第一步 读取文件\n第二步 解析内容\n先安装依赖，再运行测试\n- 项目A\n- 项目B'
    expect(countStepMarkers(text)).toBeGreaterThanOrEqual(4)
  })
  it('英文 step N / first', () => {
    expect(countStepMarkers('Step 1: do A. Step 2: do B. First, plan.')).toBeGreaterThanOrEqual(3)
  })
  it('空文本为 0', () => {
    expect(countStepMarkers('')).toBe(0)
  })
})

describe('高风险分析 analyzeRisk', () => {
  it('单类别加权', () => {
    const r = analyzeRisk('请删除文件')
    expect(r.hits).toBeGreaterThan(0)
    expect(r.categories.has('destructive')).toBe(true)
    expect(r.weighted).toBeGreaterThan(0)
  })
  it('跨类别累计', () => {
    const r = analyzeRisk('删库之后转账，再部署到生产环境')
    expect(r.categories.size).toBeGreaterThanOrEqual(3)
    expect(r.categories.has('destructive')).toBe(true)
    expect(r.categories.has('financial')).toBe(true)
    expect(r.categories.has('system')).toBe(true)
  })
  it('重复词最多计 3 次（防止刷分）', () => {
    const once = analyzeRisk('删除').weighted
    const many = analyzeRisk('删除删除删除删除删除删除').weighted
    expect(many).toBeLessThanOrEqual(once * 3 + 0.001)
  })
  it('无风险词返回空', () => {
    const r = analyzeRisk('今天天气真好')
    expect(r.hits).toBe(0)
    expect(r.categories.size).toBe(0)
    expect(r.weighted).toBe(0)
  })
})

describe('SignalExtractorImpl.extract', () => {
  const extractor = new SignalExtractorImpl()

  it('英文代码任务：代码块、函数、import、路径、技术栈', () => {
    const signals = extractor.extract([user(
      'Please write a TypeScript function in src/utils.ts: ' +
      '```ts\nimport React from "react"\nfunction foo(): number { return 1 }\n```',
    )])
    expect(signals.hasCode).toBe(true)
    expect(signals.hasFileOp).toBe(true) // 路径/文件迹象
    expect(signals.fileRefs).toContain('src/utils.ts')
    expect(signals.techStacks).toContain('TypeScript')
    expect(signals.techStacks).toContain('React')
    expect(signals.rawText).toContain('function foo')
    expect(signals.tokenEstimate).toBeGreaterThan(10)
  })

  it('中文代码任务', () => {
    const signals = extractor.extract([user('帮我写一个函数，实现快速排序算法')])
    expect(signals.hasCode).toBe(true)
  })

  it('文件操作动词（读/写/删/创建）', () => {
    expect(extractor.extract([user('读取 config.json 并修改它')]).hasFileOp).toBe(true)
    expect(extractor.extract([user('删除这个文件夹')]).hasFileOp).toBe(true)
    expect(extractor.extract([user('create a new file named app.ts')]).hasFileOp).toBe(true)
    expect(extractor.extract([user('今天天气如何')]).hasFileOp).toBe(false)
  })

  it('shell 迹象', () => {
    expect(extractor.extract([user('运行 npm install 然后 docker build')]).hasShell).toBe(true)
    expect(extractor.extract([user('用 bash 脚本执行 grep 命令')]).hasShell).toBe(true)
  })

  it('搜索调研迹象（中英文）', () => {
    expect(extractor.extract([user('帮我搜索最新的 React 文档')]).hasResearch).toBe(true)
    expect(extractor.extract([user('research the market and find competitors')]).hasResearch).toBe(true)
  })

  it('创作迹象（中英文）', () => {
    expect(extractor.extract([user('写一首关于春天的诗')]).hasCreative).toBe(true)
    expect(extractor.extract([user('generate an image of a cat')]).hasCreative).toBe(true)
  })

  it('数据分析迹象（中英文）', () => {
    expect(extractor.extract([user('用 pandas 分析这个 csv 并画柱状图')]).hasData).toBe(true)
    expect(extractor.extract([user('analyze the dataset and create a chart')]).hasData).toBe(true)
  })

  it('多步骤结构：编号列表 / 步骤词 / 先…再…', () => {
    expect(extractor.extract([user('第一步读取，第二步解析，第三步保存')]).hasMultiStep).toBe(true)
    expect(extractor.extract([user('先安装依赖，再运行测试')]).hasMultiStep).toBe(true)
    expect(extractor.extract([user('step by step: 1. plan 2. build 3. test')]).hasMultiStep).toBe(true)
  })

  it('目标闭环词', () => {
    expect(extractor.extract([user('自动完成所有步骤，直到全部搞定')]).hasGoalLoop).toBe(true)
    expect(extractor.extract([user('finish it automatically and ensure all done')]).hasGoalLoop).toBe(true)
  })

  it('规划词', () => {
    expect(extractor.extract([user('帮我设计一个微服务架构方案')]).hasPlanning).toBe(true)
    expect(extractor.extract([user('make a plan and roadmap')]).hasPlanning).toBe(true)
  })

  it('验证词', () => {
    expect(extractor.extract([user('写完后运行测试并验证结果')]).hasVerification).toBe(true)
    expect(extractor.extract([user('run the tests and verify')]).hasVerification).toBe(true)
  })

  it('时间敏感词', () => {
    expect(extractor.extract([user('查一下今天的最新消息')]).isTimeSensitive).toBe(true)
    expect(extractor.extract([user('what is the latest news right now')]).isTimeSensitive).toBe(true)
  })

  it('高风险操作', () => {
    expect(extractor.extract([user('删库跑路')]).hasHighRisk).toBe(true)
    expect(extractor.extract([user('转账 1000 元到生产环境的账户')]).hasHighRisk).toBe(true)
    expect(extractor.extract([user('帮我写首诗')]).hasHighRisk).toBe(false)
  })

  it('多模态：数组型 content 的 text 分片', () => {
    const signals = extractor.extract([user([
      { type: 'text', text: '分析这张图里的代码：function main() {}' },
      { type: 'image_url', image_url: { url: 'x' } },
    ])])
    expect(signals.hasCode).toBe(true)
    expect(signals.hasAttachment).toBe(true)
    expect(signals.rawText).toContain('function main')
  })

  it('历史轮次与最近一条 user', () => {
    const signals = extractor.extract([
      user('第一轮'), assistant('回答'), user('第二轮'), assistant('回答2'), user('最近这条有代码 function x()'),
    ])
    expect(signals.historyTurns).toBe(3)
    expect(signals.rawText).toContain('最近这条')
    expect(signals.hasCode).toBe(true)
  })

  it('normalized / charLength / tokenEstimate 一致', () => {
    const signals = extractor.extract([user('Hello 世界')])
    expect(signals.normalized).toBe('hello世界')
    expect(signals.charLength).toBe('Hello 世界'.length)
    expect(signals.tokenEstimate).toBe(estimateTokens('Hello 世界'))
  })

  it('没有 user 消息时的边界', () => {
    const signals = extractor.extract([assistant('只有助手消息')])
    expect(signals.rawText).toBe('')
    expect(signals.historyTurns).toBe(0)
    expect(signals.tokenEstimate).toBe(0)
    expect(signals.hasCode).toBe(false)
  })

  it('空消息数组', () => {
    const signals = extractor.extract([])
    expect(signals.historyTurns).toBe(0)
    expect(signals.fileRefs).toEqual([])
    expect(signals.techStacks).toEqual([])
  })

  it('自定义词表扩展', () => {
    const custom = new SignalExtractorImpl({ extraCodeKeywords: ['量子纠缠'] })
    expect(custom.extract([user('讲讲量子纠缠')]).hasCode).toBe(true)
    expect(custom.extract([user('讲讲量子纠缠')]).hasCode).toBe(true)
  })
})

describe('便捷函数与单例', () => {
  it('extractSignals 等价于默认单例', () => {
    const messages = [user('写个 python 函数')]
    expect(extractSignals(messages)).toEqual(DEFAULT_SIGNAL_EXTRACTOR.extract(messages))
  })
  it('extractSignals 与新建实例一致', () => {
    const messages = [user('删掉 /tmp/x.log')]
    expect(extractSignals(messages)).toEqual(new SignalExtractorImpl().extract(messages))
  })
})

describe('证据追踪子系统', () => {
  it('词表规模：否定词与不确定词也有几十个', () => {
    expect(NEGATION_KEYWORDS.length).toBeGreaterThan(40)
    expect(UNCERTAINTY_KEYWORDS.length).toBeGreaterThan(35)
  })

  it('findKeywordOccurrences 找所有位置', () => {
    expect(findKeywordOccurrences('删除', '删除A，删除B')).toHaveLength(2)
    expect(findKeywordOccurrences('删除', '无')).toHaveLength(0)
  })

  it('collectKeywordHits 按次数排序并限量', () => {
    const hits = collectKeywordHits(['删除', '修改', '读取'], '删除 删除 修改')
    expect(hits[0].keyword).toBe('删除')
    expect(hits[0].count).toBe(2)
    expect(hits[0].firstIndex).toBeGreaterThanOrEqual(0)
    expect(collectKeywordHits(['删除'], '删除', 0)).toHaveLength(0)
  })

  it('collectEvidence 生成逐维度报告', () => {
    const signals = extractSignals([user('写代码并删除文件')])
    const report = collectEvidence(signals)
    expect(report.dimensions.code.active).toBe(true)
    expect(report.dimensions.code.distinctHits).toBeGreaterThan(0)
    expect(report.dimensions.highRisk.active).toBe(true)
    expect(report.dimensions.highRisk.hits.some((h) => h.keyword.includes('destructive'))).toBe(true)
    expect(report.source).toContain('写代码')
  })

  it('detectModality 检测否定/不确定语气', () => {
    const neg = detectModality('不要删除文件')
    expect(neg.hasNegation).toBe(true)
    expect(neg.negationCount).toBeGreaterThan(0)

    const tent = detectModality('也许可以试试')
    expect(tent.hasUncertainty).toBe(true)
    expect(tent.isTentative).toBe(true)

    const firm = detectModality('必须完成，务必删除')
    expect(firm.isTentative).toBe(false)
  })

  it('summarizeSignals 生成一行摘要', () => {
    const signals = extractSignals([user('写代码并搜索文档')])
    const summary = summarizeSignals(signals)
    expect(summary).toContain('代码')
    expect(summary).toContain('token')
    expect(summary).toContain('轮')
  })

  it('extractWithEvidence 一站式返回信号+证据+语气+摘要', () => {
    const result = extractWithEvidence(new SignalExtractorImpl(), [user('删除文件')])
    expect(result.signals.hasHighRisk).toBe(true)
    expect(result.evidence.dimensions.fileOp.active).toBe(true)
    expect(result.modality.hasNegation).toBe(false)
    expect(result.summary.length).toBeGreaterThan(0)
  })
})
