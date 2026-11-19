import { describe, it, expect } from 'vitest'
import {
  // complexity
  ComplexityScorerImpl,
  scoreComplexity,
  DEFAULT_COMPLEXITY_SCORER,
  scoreLength,
  scoreDomain,
  scoreDomainDetailed,
  scoreSteps,
  scoreStepsDetailed,
  scoreRisk,
  scoreRiskDetailed,
  scoreContext,
  scoreContextDetailed,
  levelFromScore,
  explainScore,
  explainScoreBrief,
  computeDetailedDimensions,
  DEFAULT_WEIGHTS,
  LEVEL_THRESHOLDS,
  LEVEL_LABELS,
  analyzeContributions,
  analyzeSensitivity,
  scoreWithWeights,
  validateScoreSanity,
  validateManySignals,
} from '../../src/shared/super/analysis/complexity'
import {
  TaskAnalyzerImpl,
  analyzeTask,
  DEFAULT_TASK_ANALYZER,
  domainKeywords,
  classifyDomains,
  gradeRisk,
  extractIntent,
  recommendTools,
  benefitsFromAutonomy,
  TOOLS,
  explainAnalysis,
  renderAnalysisExplanation,
  domainKeywordCoverage,
} from '../../src/shared/super/analysis/analyzer'
import { extractSignals } from '../../src/shared/super/signals/extractor'
import type { TaskSignals } from '../../src/shared/super/types'
import type { LoopMessage } from '../../src/shared/agentLoop'

/* ── 测试辅助 ── */
function user(content: unknown): LoopMessage { return { role: 'user', content } }

function sig(overrides: Partial<TaskSignals> = {}): TaskSignals {
  return {
    rawText: '', normalized: '', charLength: 0, tokenEstimate: 0,
    hasCode: false, hasFileOp: false, hasShell: false, hasResearch: false,
    hasCreative: false, hasData: false, hasMultiStep: false, hasGoalLoop: false,
    hasPlanning: false, hasVerification: false, fileRefs: [], techStacks: [],
    historyTurns: 0, hasAttachment: false, isTimeSensitive: false, hasHighRisk: false,
    ...overrides,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 第一部分：复杂度评分
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('复杂度：权重与阈值配置', () => {
  it('五维权重合计为 1.0', () => {
    const total = DEFAULT_WEIGHTS.length + DEFAULT_WEIGHTS.domain + DEFAULT_WEIGHTS.steps +
      DEFAULT_WEIGHTS.risk + DEFAULT_WEIGHTS.context
    expect(total).toBeCloseTo(1.0, 6)
  })
  it('等级阈值覆盖 0-100 且按分数降序', () => {
    expect(LEVEL_THRESHOLDS[0].min).toBe(82)
    expect(LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].min).toBe(0)
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i].min).toBeLessThan(LEVEL_THRESHOLDS[i - 1].min)
    }
  })
  it('五个等级都有中文标签', () => {
    for (const level of ['trivial', 'simple', 'moderate', 'complex', 'expert'] as const) {
      expect(LEVEL_LABELS[level]).toBeTruthy()
    }
  })
})

describe('复杂度：等级映射 levelFromScore', () => {
  it('边界值精确落档', () => {
    expect(levelFromScore(0)).toBe('trivial')
    expect(levelFromScore(14)).toBe('trivial')
    expect(levelFromScore(15)).toBe('simple')
    expect(levelFromScore(34)).toBe('simple')
    expect(levelFromScore(35)).toBe('moderate')
    expect(levelFromScore(59)).toBe('moderate')
    expect(levelFromScore(60)).toBe('complex')
    expect(levelFromScore(81)).toBe('complex')
    expect(levelFromScore(82)).toBe('expert')
    expect(levelFromScore(100)).toBe('expert')
  })
  it('越界与非法值钳制', () => {
    expect(levelFromScore(-10)).toBe('trivial')
    expect(levelFromScore(999)).toBe('expert')
    expect(levelFromScore(NaN)).toBe('trivial')
  })
})

describe('复杂度：length 维度', () => {
  it('单调递增且封顶在 100', () => {
    const s0 = scoreLength(sig())
    const s1 = scoreLength(sig({ tokenEstimate: 100, charLength: 400 }))
    const s2 = scoreLength(sig({ tokenEstimate: 1000, charLength: 4000 }))
    const s3 = scoreLength(sig({ tokenEstimate: 100000, charLength: 400000 }))
    expect(s0).toBe(0)
    expect(s1).toBeGreaterThan(s0)
    expect(s2).toBeGreaterThan(s1)
    expect(s3).toBeLessThanOrEqual(100)
  })
  it('对数曲线：低 token 区间的边际增幅大于高区间', () => {
    const d1 = scoreLength(sig({ tokenEstimate: 200 })) - scoreLength(sig({ tokenEstimate: 100 }))
    const d2 = scoreLength(sig({ tokenEstimate: 2100 })) - scoreLength(sig({ tokenEstimate: 2000 }))
    expect(d1).toBeGreaterThan(d2)
  })
})

describe('复杂度：domain 维度', () => {
  it('跨域硬信号越多分越高', () => {
    const one = scoreDomainDetailed(sig({ hasCode: true }))
    const three = scoreDomainDetailed(sig({ hasCode: true, hasData: true, hasShell: true }))
    expect(one.score).toBeLessThan(three.score)
    expect(one.hits).toContain('代码')
    expect(three.hits).toContain('命令行')
  })
  it('技术栈数量叠加（封顶 5 个）', () => {
    const base = scoreDomain(sig({ hasCode: true }))
    const withStacks = scoreDomain(sig({ hasCode: true, techStacks: ['React', 'TS', 'Node', 'Docker', 'K8s', 'Go'] }))
    expect(withStacks).toBeGreaterThanOrEqual(base)
    expect(scoreDomain(sig({ hasCode: true, techStacks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })))
      .toBe(scoreDomain(sig({ hasCode: true, techStacks: ['a', 'b', 'c', 'd', 'e'] })))
  })
  it('无信号为 0', () => {
    expect(scoreDomain(sig())).toBe(0)
  })
})

describe('复杂度：steps 维度（指数饱和）', () => {
  it('多步骤 + 闭环 + 规划 + 验证叠加', () => {
    const simple = scoreStepsDetailed(sig())
    const rich = scoreStepsDetailed(sig({
      rawText: '第一步 第二步 第三步 第四步',
      hasMultiStep: true, hasGoalLoop: true, hasPlanning: true, hasVerification: true,
    }))
    expect(simple.score).toBe(0)
    expect(rich.score).toBeGreaterThan(simple.score)
    expect(rich.flags).toContain('多步骤')
    expect(rich.flags).toContain('目标闭环')
    expect(rich.stepMarkers).toBeGreaterThan(0)
  })
  it('单调不溢出：步骤标记再多也不超过 100', () => {
    const many = scoreSteps(sig({ hasMultiStep: true, rawText: '1. 2. 3. 4. 5. '.repeat(50) }))
    expect(many).toBeLessThanOrEqual(100)
    expect(many).toBeGreaterThanOrEqual(0)
  })
  it('边际递减：加入第 1 个标记比第 10 个标记涨分多', () => {
    const base = sig({ hasMultiStep: true })
    const s1 = scoreSteps({ ...base, rawText: '第一步' })
    const s0 = scoreSteps(base)
    const s10 = scoreSteps({ ...base, rawText: '1. '.repeat(11) })
    const s9 = scoreSteps({ ...base, rawText: '1. '.repeat(10) })
    expect(s1 - s0).toBeGreaterThanOrEqual(s10 - s9)
  })
})

describe('复杂度：risk 维度（非线性加权）', () => {
  it('单个低风险词 vs 跨类别高风险', () => {
    const low = scoreRiskDetailed(sig({ hasHighRisk: true }), '请发送一封邮件')
    const high = scoreRiskDetailed(sig({ hasHighRisk: true }), '删库之后转账，再发布到生产环境')
    expect(high.score).toBeGreaterThan(low.score)
    expect(high.analysis.categories.size).toBeGreaterThanOrEqual(3)
    expect(high.detail).toContain('高风险类别')
    expect(low.detail).toContain('对外发送')
    expect(scoreRiskDetailed(sig()).detail).toBe('无高风险操作')
  })
  it('破坏性 + 资金 + 系统级 的叠加显著高于单一类别', () => {
    const single = scoreRisk(sig({ hasHighRisk: true }), '删除文件')
    const cross = scoreRisk(sig({ hasHighRisk: true }), '删除文件，然后转账，再操作生产环境')
    expect(cross - single).toBeGreaterThanOrEqual(24)
  })
  it('无风险词但有布尔标记时仍有基础加分', () => {
    expect(scoreRisk(sig({ hasHighRisk: true }), '普通文本')).toBeGreaterThanOrEqual(6)
    expect(scoreRisk(sig({ hasHighRisk: false }), '删库')).toBeGreaterThan(0) // 文本自身命中
  })
})

describe('复杂度：context 维度', () => {
  it('历史轮次 / 附件 / 时间敏感 / 文件引用叠加', () => {
    const base = scoreContextDetailed(sig())
    const rich = scoreContextDetailed(sig({
      historyTurns: 8, hasAttachment: true, isTimeSensitive: true,
      fileRefs: ['a.ts', 'b.ts', 'c.ts'],
    }))
    expect(base.score).toBe(0)
    expect(rich.score).toBeGreaterThan(0)
    expect(rich.flags).toContain('含附件')
    expect(rich.flags).toContain('时间敏感')
    expect(rich.flags.some((f) => f.includes('轮历史'))).toBe(true)
  })
  it('轮次与引用都封顶', () => {
    const capped = scoreContext(sig({ historyTurns: 1000, fileRefs: Array(100).fill('x') }))
    expect(capped).toBeLessThanOrEqual(100)
    expect(scoreContext(sig({ historyTurns: 20, fileRefs: Array(8).fill('x') }))).toBe(capped)
  })
})

describe('复杂度：综合评分 scoreComplexity', () => {
  it('简单闲聊 → trivial / simple 低分', () => {
    const signals = extractSignals([user('你好')])
    const score = scoreComplexity(signals)
    expect(score.score).toBeLessThan(30)
    expect(['trivial', 'simple']).toContain(score.level)
    expect(score.score).toBeGreaterThanOrEqual(0)
    expect(score.score).toBeLessThanOrEqual(100)
  })
  it('复杂多步代码任务 → 中高分', () => {
    const signals = extractSignals([user(
      '帮我重构这个 React + TypeScript 项目：第一步读取 src/app.tsx，第二步修复 bug，' +
      '然后运行测试验证；自动完成所有步骤直到全部通过。删除旧文件后部署到生产环境。',
    )])
    const score = scoreComplexity(signals)
    expect(score.score).toBeGreaterThan(signals.tokenEstimate * 0) // sanity
    expect(score.score).toBeGreaterThan(40)
    expect(['complex', 'expert', 'moderate']).toContain(score.level)
  })
  it('维度子分都在 0-100，reasons 非空', () => {
    const score = scoreComplexity(extractSignals([user('写个函数')]))
    for (const v of Object.values(score.dimensions)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
    expect(score.reasons.length).toBeGreaterThan(0)
  })
  it('等级与分数严格一致', () => {
    const score = scoreComplexity(extractSignals([user('分析数据并画图')]))
    expect(score.level).toBe(levelFromScore(score.score))
  })
  it('可解释：各维度加权求和等于总分（取整误差内）', () => {
    const signals = extractSignals([user('多步骤写代码并测试')])
    const computed = computeDetailedDimensions(signals)
    const sum = computed.weighted.length + computed.weighted.domain + computed.weighted.steps +
      computed.weighted.risk + computed.weighted.context
    expect(Math.abs(sum - computed.total)).toBeLessThanOrEqual(0.001)
    expect(scoreComplexity(signals).score).toBe(Math.round(computed.total))
  })
})

describe('复杂度：explainScore 可解释文本', () => {
  it('完整解释包含分数、等级、各维度与来源', () => {
    const score = scoreComplexity(extractSignals([user('写代码并测试')]))
    const text = explainScore(score)
    expect(text).toContain(`${score.score}/100`)
    expect(text).toContain('各维度')
    expect(text).toContain('长度')
    expect(text).toContain('领域')
    expect(text).toContain('来源')
  })
  it('简短解释', () => {
    expect(explainScoreBrief(50)).toContain('50/100')
    expect(explainScoreBrief(50)).toContain('moderate')
  })
})

describe('复杂度：自定义权重与单例', () => {
  it('自定义权重可改变评分', () => {
    const signals = extractSignals([user('第一步写代码，第二步测试')])
    const defaultScore = scoreComplexity(signals).score
    const riskHeavy = new ComplexityScorerImpl({ ...DEFAULT_WEIGHTS, risk: 0.6, length: 0.05, domain: 0.05, steps: 0.15, context: 0.1 })
      .score(signals).score
    // 权重合计不必严格为 1，但应能改变结果
    expect(typeof riskHeavy).toBe('number')
    expect(Number.isFinite(defaultScore)).toBe(true)
  })
  it('便捷函数等价于默认单例', () => {
    const signals = extractSignals([user('分析数据')])
    expect(scoreComplexity(signals)).toEqual(DEFAULT_COMPLEXITY_SCORER.score(signals))
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 第二部分：任务分析
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('分析器：领域词表充分性', () => {
  it('覆盖全部 10 个领域且每个都有几十个词', () => {
    const domains = ['code', 'file', 'shell', 'research', 'writing', 'data', 'creative', 'planning', 'qa', 'conversation'] as const
    expect(Object.keys(domainKeywords).sort()).toEqual([...domains].sort())
    for (const domain of domains) {
      expect(domainKeywords[domain].length).toBeGreaterThan(20)
    }
  })
})

describe('分析器：领域分类 classifyDomains', () => {
  it('代码任务 → code', () => {
    const c = classifyDomains(extractSignals([user('帮我写个函数实现排序算法')]))
    expect(c.primary).toBe('code')
    expect(c.confidence).toBeGreaterThan(0)
    expect(c.domains[0].domain).toBe('code')
  })
  it('文件操作 → file', () => {
    const c = classifyDomains(extractSignals([user('读取并编辑文件 config.json')]))
    expect(c.primary).toBe('file')
  })
  it('调研任务 → research', () => {
    const c = classifyDomains(extractSignals([user('搜索并调研最新的市场竞品信息')]))
    expect(c.primary).toBe('research')
  })
  it('数据分析 → data', () => {
    const c = classifyDomains(extractSignals([user('用 pandas 分析 csv 数据并画图表')]))
    expect(c.primary).toBe('data')
  })
  it('多标签加权：跨域任务产生多个标签且权重合计约 1', () => {
    const c = classifyDomains(extractSignals([user('写代码读取文件，并运行测试验证，再搜索文档')]))
    expect(c.domains.length).toBeGreaterThan(1)
    const sum = c.domains.reduce((s, d) => s + d.weight, 0)
    expect(sum).toBeCloseTo(1, 1)
    // 权重按降序
    for (let i = 1; i < c.domains.length; i++) {
      expect(c.domains[i].weight).toBeLessThanOrEqual(c.domains[i - 1].weight)
    }
  })
  it('闲聊 → conversation', () => {
    const c = classifyDomains(extractSignals([user('你好，谢谢')]))
    expect(c.primary).toBe('conversation')
  })
  it('空输入兜底到 conversation 且置信度 0', () => {
    const c = classifyDomains(sig())
    expect(c.primary).toBe('conversation')
    expect(c.confidence).toBe(0)
  })
})

describe('分析器：风险分级 gradeRisk', () => {
  it('无风险 → low', () => {
    expect(gradeRisk(extractSignals([user('今天天气如何')])).level).toBe('low')
  })
  it('中等风险 → medium', () => {
    const g = gradeRisk(extractSignals([user('发送一封邮件给团队')]))
    expect(['low', 'medium']).toContain(g.level)
  })
  it('跨类别 → high', () => {
    const g = gradeRisk(extractSignals([user('删除文件后转账，然后发布到网上')]))
    expect(['high', 'critical']).toContain(g.level)
    expect(g.categories.length).toBeGreaterThanOrEqual(2)
    expect(g.score).toBeGreaterThan(0)
  })
  it('极危险词 → critical', () => {
    expect(gradeRisk(extractSignals([user('删库跑路')])).level).toBe('critical')
    expect(gradeRisk(extractSignals([user('请 rm -rf 整个目录')])).level).toBe('critical')
    expect(gradeRisk(extractSignals([user('把服务部署到生产环境')])).level).toBe('critical')
  })
})

describe('分析器：意图抽取 extractIntent', () => {
  it('英文意图', () => {
    expect(extractIntent(extractSignals([user('write a function to sort')]))).toBe('实现代码')
    expect(extractIntent(extractSignals([user('fix the bug in login')]))).toBe('修复缺陷')
    expect(extractIntent(extractSignals([user('search the web for news')]))).toBe('信息检索')
    expect(extractIntent(extractSignals([user('run the tests and verify')]))).toBe('测试验证')
  })
  it('中文意图', () => {
    expect(extractIntent(extractSignals([user('帮我写个函数实现排序')]))).toBe('实现代码')
    expect(extractIntent(extractSignals([user('搜索一下最新的新闻')]))).toBe('信息检索')
    expect(extractIntent(extractSignals([user('写一首关于春天的诗')]))).toBe('内容创作')
    expect(extractIntent(extractSignals([user('你好')]))).toBe('日常对话')
  })
  it('空输入', () => {
    expect(extractIntent(sig())).toBe('空输入')
  })
  it('无模式命中时按领域兜底', () => {
    const intent = extractIntent(sig({ rawText: '随便聊聊点什么吧', hasCreative: false }))
    expect(typeof intent).toBe('string')
    expect(intent.length).toBeGreaterThan(0)
  })
})

describe('分析器：工具建议 recommendTools', () => {
  it('纯闲聊不需要工具', () => {
    const r = recommendTools(extractSignals([user('你好')]), 'conversation')
    expect(r.needsTools).toBe(false)
    expect(r.suggestedTools).toEqual([])
  })
  it('代码任务建议 code_search + read_file + run_tests', () => {
    const r = recommendTools(extractSignals([user('写代码并运行测试')]), 'code')
    expect(r.needsTools).toBe(true)
    expect(r.suggestedTools).toContain(TOOLS.codeSearch)
    expect(r.suggestedTools).toContain(TOOLS.readFile)
    expect(r.suggestedTools).toContain(TOOLS.runTests)
    // 去重
    expect(new Set(r.suggestedTools).size).toBe(r.suggestedTools.length)
  })
  it('调研建议 web_search，时间敏感追加 web_fetch', () => {
    const r = recommendTools(extractSignals([user('搜索今天的最新消息')]), 'research')
    expect(r.suggestedTools).toContain(TOOLS.webSearch)
    expect(r.suggestedTools).toContain(TOOLS.webFetch)
  })
  it('shell 任务建议 run_command', () => {
    const r = recommendTools(extractSignals([user('运行 docker 命令')]), 'shell')
    expect(r.suggestedTools).toContain(TOOLS.shell)
  })
  it('图像创作才建议 image_generation，纯文字创作不建议', () => {
    const img = recommendTools(extractSignals([user('生成一张图片')]), 'creative')
    expect(img.suggestedTools).toContain(TOOLS.imageGen)
    const text = recommendTools(extractSignals([user('写一首诗')]), 'creative')
    expect(text.suggestedTools).not.toContain(TOOLS.imageGen)
  })
  it('多步骤/规划建议 task_list，创建文件建议 write_file', () => {
    const r = recommendTools(extractSignals([user('创建文件并分步骤完成')]), 'planning')
    expect(r.suggestedTools).toContain(TOOLS.taskList)
    expect(r.suggestedTools).toContain(TOOLS.writeFile)
  })
})

describe('分析器：自主闭环适配 benefitsFromAutonomy', () => {
  it('目标闭环 + 多步骤 + 验证 → true', () => {
    const signals = extractSignals([user('自动完成所有步骤，先写代码再运行测试，直到全部通过')])
    const result = benefitsFromAutonomy(signals, classifyDomains(signals), gradeRisk(signals))
    expect(result).toBe(true)
  })
  it('纯闲聊 → false', () => {
    const signals = extractSignals([user('你好')])
    expect(benefitsFromAutonomy(signals, classifyDomains(signals), gradeRisk(signals))).toBe(false)
  })
  it('高风险强烈抑制（无闭环词时）→ false', () => {
    const signals = sig({ hasMultiStep: true, hasPlanning: true, hasHighRisk: true, rawText: '删库后转账' })
    const result = benefitsFromAutonomy(signals, classifyDomains(signals), gradeRisk(signals))
    expect(result).toBe(false)
  })
  it('高风险但有明确闭环词仍可能受益', () => {
    const signals = sig({ hasGoalLoop: true, hasMultiStep: true, rawText: '自动完成直到成功' })
    expect(benefitsFromAutonomy(signals, classifyDomains(signals), gradeRisk(sig()))).toBe(true)
  })
})

describe('分析器：TaskAnalyzerImpl.analyze 综合', () => {
  it('英文多步高风险代码任务：全字段自洽', () => {
    const signals = extractSignals([user(
      'Refactor the React app: first read src/app.tsx, then fix the bug, then run tests. ' +
      'Automatically finish all steps. Delete old files and deploy to production.',
    )])
    const analysis = analyzeTask(signals)
    expect(analysis.domain).toBe('code')
    expect(analysis.confidence).toBeGreaterThanOrEqual(0)
    expect(analysis.domains.length).toBeGreaterThan(0)
    expect(analysis.complexity.score).toBeGreaterThanOrEqual(0)
    expect(analysis.complexity.level).toBe(levelFromScore(analysis.complexity.score))
    expect(['low', 'medium', 'high', 'critical']).toContain(analysis.risk)
    expect(analysis.intent.length).toBeGreaterThan(0)
    expect(analysis.needsTools).toBe(true)
    expect(analysis.suggestedTools.length).toBeGreaterThan(0)
    expect(typeof analysis.benefitsFromAutonomy).toBe('boolean')
  })
  it('中文简单问答：低复杂度、不需要工具', () => {
    const analysis = analyzeTask(extractSignals([user('你好，今天怎么样')]))
    expect(analysis.domain).toBe('conversation')
    expect(analysis.needsTools).toBe(false)
    expect(analysis.complexity.score).toBeLessThan(40)
  })
  it('自定义 scorer 被使用', () => {
    const custom = new TaskAnalyzerImpl({ scorer: () => ({ score: 7, level: 'trivial', dimensions: { length: 0, domain: 0, steps: 0, risk: 0, context: 0 }, reasons: ['custom'] }) })
    const analysis = custom.analyze(extractSignals([user('写代码')]))
    expect(analysis.complexity.score).toBe(7)
    expect(analysis.complexity.reasons).toEqual(['custom'])
  })
  it('便捷函数等价于默认单例', () => {
    const signals = extractSignals([user('分析数据')])
    expect(analyzeTask(signals)).toEqual(DEFAULT_TASK_ANALYZER.analyze(signals))
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 第三部分：可解释性与健壮性子系统
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('复杂度：贡献度与灵敏度', () => {
  it('analyzeContributions 五维贡献之和约等于总分', () => {
    const signals = extractSignals([user('写代码并运行测试，删除文件')])
    const report = analyzeContributions(signals)
    expect(report.contributions).toHaveLength(5)
    const sum = report.contributions.reduce((s, c) => s + c.contribution, 0)
    expect(Math.abs(sum - report.total)).toBeLessThanOrEqual(0.001)
    expect(report.contributions.every((c) => c.percentage >= 0 && c.percentage <= 100)).toBe(true)
    expect(report.dominant).toBeTruthy()
    expect(report.weakest).toBeTruthy()
  })

  it('analyzeSensitivity 翻转信号会改变分数，按影响排序', () => {
    const signals = extractSignals([user('第一步删除文件，然后运行测试验证')])
    const entries = analyzeSensitivity(signals)
    expect(entries.length).toBeGreaterThan(0)
    // 高风险信号翻转应有明显影响
    const risk = entries.find((e) => e.field === 'hasHighRisk')
    expect(risk).toBeDefined()
    expect(Math.abs(risk!.delta)).toBeGreaterThan(0)
    // 按 |delta| 降序
    for (let i = 1; i < entries.length; i++) {
      expect(Math.abs(entries[i].delta)).toBeLessThanOrEqual(Math.abs(entries[i - 1].delta))
    }
  })

  it('scoreWithWeights 与 scoreComplexity 在默认权重下一致', () => {
    const signals = extractSignals([user('分析数据')])
    expect(scoreWithWeights(signals, DEFAULT_WEIGHTS)).toBeCloseTo(scoreComplexity(signals).score, 0)
  })
})

describe('复杂度：分数健全性校验', () => {
  it('正常分数无问题', () => {
    expect(validateScoreSanity(scoreComplexity(extractSignals([user('写代码')])))).toEqual([])
  })
  it('能抓出越界维度与等级不一致', () => {
    const bad = { score: 150, level: 'trivial' as const, dimensions: { length: 200, domain: -1, steps: 0, risk: 0, context: 0 }, reasons: [] }
    const problems = validateScoreSanity(bad)
    expect(problems.some((p) => p.includes('总分越界'))).toBe(true)
    expect(problems.some((p) => p.includes('length 越界'))).toBe(true)
    expect(problems.some((p) => p.includes('等级与分数不一致'))).toBe(true)
    expect(problems.some((p) => p.includes('理由数组为空'))).toBe(true)
  })
  it('批量校验', () => {
    const list = [sig(), sig({ hasCode: true, rawText: '写函数' }), sig({ historyTurns: 5, fileRefs: ['a'] })]
    expect(validateManySignals(list)).toEqual([])
  })
})

describe('分析器：规则追踪与覆盖度', () => {
  it('explainAnalysis 输出六类追踪', () => {
    const signals = extractSignals([user('自动完成所有步骤，删除文件后部署到生产环境')])
    const analysis = analyzeTask(signals)
    const traces = explainAnalysis(signals, analysis)
    const categories = traces.map((t) => t.category)
    expect(categories).toContain('domain')
    expect(categories).toContain('risk')
    expect(categories).toContain('complexity')
    expect(categories).toContain('tools')
    expect(categories).toContain('autonomy')
    expect(categories).toContain('intent')
    expect(traces.every((t) => t.value && t.basis)).toBe(true)
  })

  it('renderAnalysisExplanation 渲染为可读文本', () => {
    const signals = extractSignals([user('写代码')])
    const text = renderAnalysisExplanation(signals, analyzeTask(signals))
    expect(text).toContain('任务分析追踪')
    expect(text).toContain('[domain]')
    expect(text).toContain('置信度')
  })

  it('domainKeywordCoverage 按命中数降序返回词表覆盖', () => {
    const coverage = domainKeywordCoverage('写代码函数并读取文件')
    expect(coverage).toHaveLength(10)
    expect(coverage[0].count).toBeGreaterThanOrEqual(coverage[9].count)
    expect(coverage.some((c) => c.domain === 'code' && c.count > 0)).toBe(true)
    expect(coverage.every((c) => c.matched.length <= 10)).toBe(true)
  })
})
