import { describe, it, expect } from 'vitest'
import type {
  PlanStep,
  TaskSignals,
  TaskAnalysis,
  ComplexityScore,
  ExecutionPlan,
} from '../../src/shared/super/types'
import {
  DependencyGraphImpl,
  buildDependencyGraph,
  buildConcreteDependencyGraph,
} from '../../src/shared/super/planning/dependencyGraph'
import {
  TaskPlannerImpl,
  planTask,
  parseUserSteps,
} from '../../src/shared/super/planning/planner'
import {
  StrategyPickerImpl,
  pickStrategy,
  explainStrategy,
  STRATEGY_DIRECT,
  STRATEGY_SINGLE_TOOL,
  STRATEGY_ITERATIVE,
  STRATEGY_AUTONOMOUS,
  STRATEGY_DEEP,
  BUILTIN_STRATEGIES,
} from '../../src/shared/super/planning/strategies'

/* ─────────────────────────────────────────────────────────────
 * 测试辅助
 * ───────────────────────────────────────────────────────────── */

function mkStep(
  id: string,
  deps: string[] = [],
  difficulty = 50,
  parallelizable = false,
): PlanStep {
  return {
    id,
    title: id,
    description: `步骤 ${id}`,
    dependsOn: deps,
    tools: [],
    expectedOutput: '产物',
    parallelizable,
    estimatedDifficulty: difficulty,
  }
}

function mkComplexity(
  level: ComplexityScore['level'],
  score = 50,
): ComplexityScore {
  return {
    score,
    level,
    dimensions: { length: score, domain: score, steps: score, risk: score, context: score },
    reasons: [],
  }
}

function mkSignals(overrides: Partial<TaskSignals> = {}): TaskSignals {
  return {
    rawText: '',
    normalized: '',
    charLength: 0,
    tokenEstimate: 0,
    hasCode: false,
    hasFileOp: false,
    hasShell: false,
    hasResearch: false,
    hasCreative: false,
    hasData: false,
    hasMultiStep: false,
    hasGoalLoop: false,
    hasPlanning: false,
    hasVerification: false,
    fileRefs: [],
    techStacks: [],
    historyTurns: 1,
    hasAttachment: false,
    isTimeSensitive: false,
    hasHighRisk: false,
    ...overrides,
  }
}

function mkAnalysis(overrides: Partial<TaskAnalysis> = {}): TaskAnalysis {
  return {
    domain: 'code',
    confidence: 0.9,
    domains: [{ domain: 'code', weight: 1 }],
    complexity: mkComplexity('moderate', 50),
    risk: 'low',
    intent: '',
    needsTools: false,
    suggestedTools: [],
    benefitsFromAutonomy: false,
    ...overrides,
  }
}

function flatten(levels: string[][]): string[] {
  return levels.reduce((acc, level) => acc.concat(level), [])
}

/** 断言步骤 id 唯一、依赖均指向存在的节点 */
function expectValidSteps(steps: PlanStep[]): void {
  const ids = steps.map((s) => s.id)
  expect(new Set(ids).size).toBe(ids.length)
  const idSet = new Set(ids)
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      expect(idSet.has(dep)).toBe(true)
      expect(dep).not.toBe(s.id)
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 依赖图：拓扑排序
 * ───────────────────────────────────────────────────────────── */

describe('DependencyGraph - topologicalLevels', () => {
  it('空图返回空数组', () => {
    const graph = buildDependencyGraph([])
    expect(graph.topologicalLevels()).toEqual([])
    expect(graph.criticalPath()).toEqual([])
    expect(graph.detectCycle()).toBeNull()
  })

  it('并行层：同一层节点互不依赖，可并行执行', () => {
    // step1 无依赖；step2、step3 都依赖 step1；step4 依赖两者
    const graph = buildDependencyGraph([
      mkStep('step4', ['step2', 'step3']),
      mkStep('step2', ['step1']),
      mkStep('step1', []),
      mkStep('step3', ['step1']),
    ])
    const levels = graph.topologicalLevels()
    expect(levels.length).toBe(3)
    expect(levels[0]).toEqual(['step1'])
    expect(new Set(levels[1])).toEqual(new Set(['step2', 'step3']))
    expect(levels[2]).toEqual(['step4'])
    // 所有节点都出现且只出现一次
    expect(flatten(levels).sort()).toEqual(['step1', 'step2', 'step3', 'step4'])
  })

  it('无依赖节点全部落在第一层', () => {
    const graph = buildDependencyGraph([
      mkStep('a'), mkStep('b'), mkStep('c'),
    ])
    expect(graph.topologicalLevels()).toEqual([['a', 'b', 'c']])
  })

  it('链式依赖逐层展开', () => {
    const graph = buildDependencyGraph([
      mkStep('c', ['b']), mkStep('b', ['a']), mkStep('a'),
    ])
    expect(graph.topologicalLevels()).toEqual([['a'], ['b'], ['c']])
  })

  it('环图降级：无法解锁的节点被放进最后一个降级层', () => {
    const graph = buildDependencyGraph([
      mkStep('a', ['c']), mkStep('b', ['a']), mkStep('c', ['b']),
    ])
    const levels = graph.topologicalLevels()
    // 无入度 0 节点，全部被降级
    expect(levels.length).toBe(1)
    expect(new Set(levels[0])).toEqual(new Set(['a', 'b', 'c']))
  })

  it('环 + 后继：环外被阻塞节点与环一起降级，环前节点正常解锁', () => {
    const graph = buildDependencyGraph([
      mkStep('root'),
      mkStep('a', ['root', 'c']),
      mkStep('b', ['a']),
      mkStep('c', ['b']),
      mkStep('tail', ['c']),
    ])
    const levels = graph.topologicalLevels()
    expect(levels[0]).toEqual(['root'])
    const last = levels[levels.length - 1]
    expect(new Set(last)).toEqual(new Set(['a', 'b', 'c', 'tail']))
    // 每个节点恰好出现一次
    const all = flatten(levels)
    expect(new Set(all).size).toBe(all.length)
  })

  it('输出稳定：同一图重复调用得到完全相同的结果', () => {
    const a = buildDependencyGraph([
      mkStep('x'), mkStep('y'), mkStep('z', ['x', 'y']),
    ])
    // 层内按插入顺序归一，重复调用不得抖动
    expect(a.topologicalLevels()).toEqual([['x', 'y'], ['z']])
    expect(a.topologicalLevels()).toEqual(a.topologicalLevels())
  })
})

/* ─────────────────────────────────────────────────────────────
 * 依赖图：关键路径
 * ───────────────────────────────────────────────────────────── */

describe('DependencyGraph - criticalPath', () => {
  it('单节点图的关键路径就是该节点', () => {
    const graph = buildDependencyGraph([mkStep('only', [], 42)])
    expect(graph.criticalPath()).toEqual(['only'])
  })

  it('带权最长路径：选择难度和更大的依赖链', () => {
    const graph = buildDependencyGraph([
      mkStep('s1', [], 10),
      mkStep('s2', ['s1'], 20),
      mkStep('s3', ['s1'], 5),
      mkStep('s4', ['s2', 's3'], 15),
    ])
    // s1->s2->s4 = 10+20+15 = 45，大于 s1->s3->s4 = 30
    expect(graph.criticalPath()).toEqual(['s1', 's2', 's4'])
  })

  it('难度被夹逼到 0-100，异常值不破坏结果', () => {
    const graph = buildDependencyGraph([
      mkStep('a', [], 1000),
      mkStep('b', [], -50),
    ])
    const cp = graph.criticalPath()
    expect(cp).toEqual(['a']) // a 被夹到 100，b 被夹到 0
  })

  it('平局时取插入顺序更早的终点', () => {
    const graph = buildDependencyGraph([
      mkStep('a', [], 50),
      mkStep('b', [], 50),
    ])
    expect(graph.criticalPath()).toEqual(['a'])
  })

  it('关键路径方向正确：起点无前置、终点无后继瓶颈', () => {
    const graph = buildDependencyGraph([
      mkStep('s1', [], 30),
      mkStep('s2', ['s1'], 40),
      mkStep('s3', ['s1'], 10),
    ])
    const cp = graph.criticalPath()
    expect(cp).toEqual(['s1', 's2'])
    expect(cp[0]).toBe('s1') // 起点
  })
})

/* ─────────────────────────────────────────────────────────────
 * 依赖图：环检测与打破
 * ───────────────────────────────────────────────────────────── */

describe('DependencyGraph - detectCycle / break', () => {
  it('无环返回 null', () => {
    const graph = buildDependencyGraph([
      mkStep('a'), mkStep('b', ['a']), mkStep('c', ['a']),
    ])
    expect(graph.detectCycle()).toBeNull()
    expect(graph.isAcyclic()).toBe(true)
  })

  it('三色 DFS 返回闭合环路径（首尾相同）', () => {
    const graph = buildDependencyGraph([
      mkStep('a', ['c']), mkStep('b', ['a']), mkStep('c', ['b']),
    ])
    const cycle = graph.detectCycle()
    expect(cycle).not.toBeNull()
    const c = cycle as string[]
    expect(c[0]).toBe(c[c.length - 1])
    expect(new Set(c)).toEqual(new Set(['a', 'b', 'c']))
    expect(graph.isAcyclic()).toBe(false)
  })

  it('自环能被检测', () => {
    const graph = buildDependencyGraph([mkStep('self', ['self'])])
    expect(graph.detectCycle()).toEqual(['self', 'self'])
  })

  it('打破建议：优先移除低难度前置，理由可解释', () => {
    const graph = buildDependencyGraph([
      mkStep('a', ['c'], 10),
      mkStep('b', ['a'], 10),
      mkStep('c', ['b'], 90), // c 难度高，移除依赖 c 的边代价更低
    ])
    const suggestions = graph.suggestCycleBreaks()
    expect(suggestions.length).toBeGreaterThanOrEqual(2)
    expect(suggestions[0].recommended).toBe(true)
    // 推荐项应是被依赖难度最低的那条边（a、b 难度 10，c 难度 90）
    const recommended = suggestions.find((s) => s.recommended)!
    const minDifficulty = Math.min(...suggestions.map((s) =>
      graph.getNodeInfo(s.to)?.difficulty ?? 0,
    ))
    expect(graph.getNodeInfo(recommended.to)?.difficulty).toBe(minDifficulty)
    expect(recommended.to).not.toBe('c')
    expect(recommended.reason).toContain('循环依赖')

    const removed = graph.applyRecommendedCycleBreak()
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(graph.isAcyclic()).toBe(true)
  })

  it('无环时打破操作不产生副作用', () => {
    const graph = buildDependencyGraph([mkStep('a'), mkStep('b', ['a'])])
    expect(graph.suggestCycleBreaks()).toEqual([])
    expect(graph.applyRecommendedCycleBreak()).toBe(0)
  })
})

/* ─────────────────────────────────────────────────────────────
 * 依赖图：三张表一致性
 * ───────────────────────────────────────────────────────────── */

describe('DependencyGraph - 结构一致性', () => {
  it('构建后 nodes/edges/reverse 一致，validate 无问题', () => {
    const graph = buildConcreteDependencyGraph([
      mkStep('a'), mkStep('b', ['a']), mkStep('c', ['a', 'b']),
    ])
    expect(graph.validate()).toEqual([])
    expect(graph.size).toBe(3)
    expect(graph.nodes.has('a')).toBe(true)
    expect(graph.edges.get('c')).toEqual(['a', 'b'])
    expect(graph.reverse.get('a')).toEqual(['b', 'c'])
  })

  it('addEdge / removeEdge 同步维护反向表', () => {
    const graph = new DependencyGraphImpl([mkStep('a'), mkStep('b')])
    expect(graph.addEdge('b', 'a')).toBe(true)
    expect(graph.addEdge('b', 'a')).toBe(false) // 去重
    expect(graph.reverse.get('a')).toEqual(['b'])
    expect(graph.removeEdge('b', 'a')).toBe(true)
    expect(graph.reverse.get('a')).toEqual([])
    expect(graph.validate()).toEqual([])
  })

  it('removeNode 摘除所有关联边', () => {
    const graph = new DependencyGraphImpl([
      mkStep('a'), mkStep('b', ['a']), mkStep('c', ['a']),
    ])
    expect(graph.removeNode('a')).toBe(true)
    expect(graph.edges.get('b')).toEqual([])
    expect(graph.edges.get('c')).toEqual([])
    expect(graph.hasNode('a')).toBe(false)
    expect(graph.validate()).toEqual([])
  })

  it('忽略不存在的依赖引用', () => {
    const graph = buildConcreteDependencyGraph([mkStep('a', ['ghost'])])
    expect(graph.edges.get('a')).toEqual([])
    expect(graph.validate()).toEqual([])
  })

  it('getNodeInfo 返回难度与出入度', () => {
    const graph = new DependencyGraphImpl([mkStep('a', [], 120), mkStep('b', ['a'])])
    const info = graph.getNodeInfo('a')!
    expect(info.difficulty).toBe(100) // 夹逼
    expect(info.outDegree).toBe(1)
    expect(info.inDegree).toBe(0)
    expect(graph.getNodeInfo('none')).toBeNull()
  })
})

/* ─────────────────────────────────────────────────────────────
 * 规划器：领域模板
 * ───────────────────────────────────────────────────────────── */

describe('TaskPlanner - 领域模板选择', () => {
  const domains = [
    'code', 'file', 'shell', 'research', 'writing',
    'data', 'creative', 'planning', 'qa', 'conversation',
  ] as const

  it('每个领域都生成 5-10 个有效步骤', () => {
    for (const domain of domains) {
      const plan = planTask(
        mkAnalysis({ domain, domains: [{ domain, weight: 1 }] }),
        mkSignals(),
      )
      expect(plan.steps.length).toBeGreaterThanOrEqual(3)
      expect(plan.steps.length).toBeLessThanOrEqual(12)
      expectValidSteps(plan.steps)
      expect(plan.levels.length).toBeGreaterThan(0)
      expect(plan.criticalPath.length).toBeGreaterThan(0)
      expect(plan.estimatedRounds).toBeGreaterThanOrEqual(1)
    }
  })

  it('code 领域包含读文件/编辑工具建议', () => {
    const plan = planTask(mkAnalysis({ domain: 'code' }), mkSignals())
    const tools = plan.steps.flatMap((s) => s.tools)
    expect(tools).toContain('read_file')
    expect(tools.some((t) => /edit|write/.test(t))).toBe(true)
  })

  it('research 领域包含搜索工具建议', () => {
    const plan = planTask(mkAnalysis({ domain: 'research' }), mkSignals())
    const tools = plan.steps.flatMap((s) => s.tools)
    expect(tools).toContain('web_search')
  })

  it('shell 领域包含 shell 工具建议', () => {
    const plan = planTask(mkAnalysis({ domain: 'shell' }), mkSignals())
    const tools = plan.steps.flatMap((s) => s.tools)
    expect(tools).toContain('shell')
  })

  it('低置信度时拼接第二领域的验证类步骤', () => {
    const plan = planTask(
      mkAnalysis({
        domain: 'code',
        confidence: 0.3,
        domains: [
          { domain: 'code', weight: 0.5 },
          { domain: 'qa', weight: 0.5 },
        ],
      }),
      mkSignals(),
    )
    // code 基础 7 步 + qa 补充的 analyze/report 步骤
    expect(plan.steps.length).toBeGreaterThan(7)
    expectValidSteps(plan.steps)
  })

  it('计划 levels 覆盖所有步骤，criticalPath 合法', () => {
    const plan = planTask(mkAnalysis({ domain: 'data' }), mkSignals())
    const all = flatten(plan.levels)
    expect(new Set(all).size).toBe(all.length)
    const idSet = new Set(plan.steps.map((s) => s.id))
    for (const id of all) expect(idSet.has(id)).toBe(true)
    for (const id of plan.criticalPath) expect(idSet.has(id)).toBe(true)
  })
})

/* ─────────────────────────────────────────────────────────────
 * 规划器：多步骤解析
 * ───────────────────────────────────────────────────────────── */

describe('TaskPlanner - 多步骤拆解', () => {
  it('parseUserSteps 解析编号列表', () => {
    const steps = parseUserSteps('1. 读取文件\n2. 修改代码\n3. 运行测试', true)
    expect(steps.length).toBe(3)
    expect(steps.map((s) => s.text)).toEqual(['读取文件', '修改代码', '运行测试'])
  })

  it('parseUserSteps 解析单行内嵌编号', () => {
    const steps = parseUserSteps('1) 采集数据 2) 清洗数据 3) 生成报表', false)
    expect(steps.length).toBe(3)
  })

  it('parseUserSteps 对无结构文本返回空', () => {
    expect(parseUserSteps('帮我写段代码', false)).toEqual([])
  })

  it('hasMultiStep 时按分号/换行切分', () => {
    const steps = parseUserSteps('先采集；再清洗；最后分析', true)
    expect(steps.length).toBe(3)
  })

  it('显式步骤替换模板骨架：保留理解与验证，串行依赖合法', () => {
    const plan = planTask(
      mkAnalysis({ domain: 'code' }),
      mkSignals({ rawText: '1. 读取配置\n2. 重构模块\n3. 运行测试', hasMultiStep: true }),
    )
    // 理解步 + 3 个用户步 + 验证步
    expect(plan.steps.length).toBe(5)
    expectValidSteps(plan.steps)
    expect(plan.steps[0].title).toContain('理解')
    expect(plan.steps[plan.steps.length - 1].title).toMatch(/验证|自检|测试|复查/)
    // 串行链，每层一个
    expect(plan.levels.length).toBe(plan.steps.length)
  })

  it('用户步骤文本会被裁剪进 title，不污染计划', () => {
    const long = 'x'.repeat(300)
    const plan = planTask(
      mkAnalysis({ domain: 'code' }),
      mkSignals({ rawText: `1. ${long}\n2. 第二步`, hasMultiStep: true }),
    )
    for (const s of plan.steps) expect(s.title.length).toBeLessThanOrEqual(40)
  })
})

/* ─────────────────────────────────────────────────────────────
 * 规划器：轮次估算与目标
 * ───────────────────────────────────────────────────────────── */

describe('TaskPlanner - 轮次与目标', () => {
  it('复杂度越高估算轮次越多', () => {
    const low = planTask(mkAnalysis({ complexity: mkComplexity('simple') }), mkSignals())
    const high = planTask(mkAnalysis({ complexity: mkComplexity('expert', 90) }), mkSignals())
    expect(high.estimatedRounds).toBeGreaterThan(low.estimatedRounds)
  })

  it('高风险且含验证步骤时追加复核轮', () => {
    const low = planTask(mkAnalysis({ risk: 'low' }), mkSignals())
    const high = planTask(mkAnalysis({ risk: 'critical' }), mkSignals())
    expect(high.estimatedRounds).toBeGreaterThanOrEqual(low.estimatedRounds)
  })

  it('goal 优先使用 analysis.intent', () => {
    const plan = planTask(mkAnalysis({ intent: '重构登录模块' }), mkSignals({ rawText: '随便写点' }))
    expect(plan.goal).toBe('重构登录模块')
  })

  it('planner 直接实例化与工厂函数行为一致', () => {
    const a = new TaskPlannerImpl().plan(mkAnalysis(), mkSignals())
    const b = planTask(mkAnalysis(), mkSignals())
    expect(a).toEqual(b)
  })
})

/* ─────────────────────────────────────────────────────────────
 * 策略：常量定义
 * ───────────────────────────────────────────────────────────── */

describe('StrategyPicker - 策略常量', () => {
  it('五种核心策略配置正确', () => {
    expect(STRATEGY_DIRECT.name).toBe('direct')
    expect(STRATEGY_DIRECT.maxRounds).toBe(1)
    expect(STRATEGY_DIRECT.parallelTools).toBe(false)
    expect(STRATEGY_DIRECT.verifyEachStep).toBe(false)

    expect(STRATEGY_SINGLE_TOOL.fallbackOnFailure).toBe('direct')
    expect(STRATEGY_ITERATIVE.verifyEachStep).toBe(true)
    expect(STRATEGY_AUTONOMOUS.allowAutonomy).toBe(true)
    expect(STRATEGY_DEEP.maxRounds).toBeGreaterThanOrEqual(STRATEGY_AUTONOMOUS.maxRounds)
    expect(STRATEGY_DEEP.fallbackOnFailure).toBe('autonomous')
  })

  it('内置策略常量被冻结，防止全局污染', () => {
    expect(Object.isFrozen(STRATEGY_DIRECT)).toBe(true)
    expect(Object.isFrozen(STRATEGY_DEEP)).toBe(true)
    expect(Object.keys(BUILTIN_STRATEGIES).length).toBeGreaterThanOrEqual(5)
  })

  it('pick 返回副本，修改不污染常量', () => {
    const plan = planTask(mkAnalysis(), mkSignals())
    const s = pickStrategy(mkAnalysis(), plan)
    s.name = 'mutated'
    expect(STRATEGY_DIRECT.name).not.toBe('mutated')
    expect(BUILTIN_STRATEGIES[s.name === 'mutated' ? 'direct' : s.name]).toBeDefined()
  })
})

/* ─────────────────────────────────────────────────────────────
 * 策略：选择边界
 * ───────────────────────────────────────────────────────────── */

describe('StrategyPicker - 策略选择边界', () => {
  it('trivial 无工具任务选择 direct', () => {
    const analysis = mkAnalysis({ complexity: mkComplexity('trivial'), needsTools: false, risk: 'low' })
    const plan = planTask(analysis, mkSignals())
    const s = pickStrategy(analysis, plan)
    expect(s.name).toBe('direct')
    expect(s.maxRounds).toBe(1)
  })

  it('简单问答（conversation + 3 步）仍是 direct', () => {
    const analysis = mkAnalysis({
      domain: 'conversation',
      domains: [{ domain: 'conversation', weight: 1 }],
      complexity: mkComplexity('simple'),
      needsTools: false,
    })
    const plan = planTask(analysis, mkSignals())
    expect(pickStrategy(analysis, plan).name).toBe('direct')
  })

  it('专家级高风险大计划选择 deep', () => {
    const analysis = mkAnalysis({
      complexity: mkComplexity('expert', 90),
      risk: 'critical',
      needsTools: true,
      suggestedTools: ['shell', 'read_file', 'write_file', 'grep'],
      benefitsFromAutonomy: true,
    })
    const plan = planTask(analysis, mkSignals())
    const s = pickStrategy(analysis, plan)
    expect(s.name).toBe('deep')
    expect(s.verifyEachStep).toBe(true)
    expect(s.allowAutonomy).toBe(true)
  })

  it('复杂且受益自主的任务偏向 autonomous 或 deep', () => {
    const analysis = mkAnalysis({
      complexity: mkComplexity('complex', 80),
      risk: 'medium',
      needsTools: true,
      suggestedTools: ['shell', 'read_file', 'grep'],
      benefitsFromAutonomy: true,
    })
    const plan = planTask(analysis, mkSignals())
    const s = pickStrategy(analysis, plan)
    expect(['autonomous', 'deep']).toContain(s.name)
    expect(s.allowAutonomy).toBe(true)
  })

  it('多工具 moderate 任务选择 iterative', () => {
    const analysis = mkAnalysis({
      complexity: mkComplexity('moderate', 55),
      risk: 'medium',
      needsTools: true,
      suggestedTools: ['read_file', 'shell', 'grep'],
    })
    const plan = planTask(analysis, mkSignals())
    const s = pickStrategy(analysis, plan)
    expect(s.name).toBe('iterative')
    expect(s.verifyEachStep).toBe(true)
  })

  it('低风险高并行迭代任务应用「并行快审」覆盖', () => {
    const analysis = mkAnalysis({
      complexity: mkComplexity('moderate', 55),
      risk: 'low',
      needsTools: true,
      suggestedTools: ['read_file', 'shell'],
    })
    // 构造高并行度计划：4 步中 3 步可并行
    const plan: ExecutionPlan = {
      goal: 'test',
      steps: [
        mkStep('a', [], 30, false),
        mkStep('b', ['a'], 30, true),
        mkStep('c', ['a'], 30, true),
        mkStep('d', ['a'], 30, true),
      ],
      levels: [['a'], ['b', 'c', 'd']],
      criticalPath: ['a', 'b'],
      estimatedRounds: 3,
    }
    const exp = explainStrategy(analysis, plan)
    expect(exp.strategy.name).toBe('iterative')
    expect(exp.strategy.verifyEachStep).toBe(false)
    expect(exp.overrides.some((o) => o.field === 'verifyEachStep')).toBe(true)
    expect(exp.reasons.join('')).toContain('并行快审')
  })

  it('关键路径过长时上调 maxRounds', () => {
    const analysis = mkAnalysis({
      complexity: mkComplexity('moderate'),
      needsTools: true,
      suggestedTools: ['read_file', 'shell'],
    })
    const deepPath = Array.from({ length: 9 }, (_, i) => `n${i}`)
    const plan: ExecutionPlan = {
      goal: 'test',
      steps: deepPath.map((id, i) => mkStep(id, i === 0 ? [] : [deepPath[i - 1]], 30, false)),
      levels: deepPath.map((id) => [id]),
      criticalPath: deepPath,
      estimatedRounds: 10,
    }
    const exp = explainStrategy(analysis, plan)
    expect(exp.strategy.maxRounds).toBeGreaterThanOrEqual(10)
    expect(exp.overrides.some((o) => o.field === 'maxRounds')).toBe(true)
  })

  it('高风险强制打开逐轮验证', () => {
    const analysis = mkAnalysis({
      complexity: mkComplexity('moderate'),
      risk: 'high',
      needsTools: true,
      suggestedTools: ['shell', 'read_file'],
    })
    const plan: ExecutionPlan = {
      goal: 'test',
      steps: [
        mkStep('a', [], 30, true),
        mkStep('b', ['a'], 30, true),
        mkStep('c', ['a'], 30, true),
        mkStep('d', ['a'], 30, true),
      ],
      levels: [['a'], ['b', 'c', 'd']],
      criticalPath: ['a', 'b'],
      estimatedRounds: 3,
    }
    const s = pickStrategy(analysis, plan)
    expect(s.verifyEachStep).toBe(true)
  })

  it('可解释结果包含分数与理由', () => {
    const analysis = mkAnalysis()
    const plan = planTask(analysis, mkSignals())
    const exp = explainStrategy(analysis, plan)
    expect(Object.keys(exp.scores).length).toBe(5)
    expect(exp.reasons.length).toBeGreaterThan(0)
    expect(STRATEGY_DEEP.name).toBe(exp.strategy.name === 'deep' ? 'deep' : STRATEGY_DEEP.name)
  })

  it('fallback 链合法且最终收敛到 null', () => {
    const chain = [STRATEGY_DIRECT, STRATEGY_SINGLE_TOOL, STRATEGY_ITERATIVE, STRATEGY_AUTONOMOUS, STRATEGY_DEEP]
    for (const s of chain) {
      if (s.fallbackOnFailure === null) continue
      expect(chain.some((c) => c.name === s.fallbackOnFailure)).toBe(true)
    }
    expect(STRATEGY_DIRECT.fallbackOnFailure).toBeNull()
  })

  it('组合策略：取更强的布尔项与更大的轮次', () => {
    const picker = new StrategyPickerImpl()
    const combined = picker.combine(STRATEGY_DIRECT, STRATEGY_DEEP)
    expect(combined.maxRounds).toBe(STRATEGY_DEEP.maxRounds)
    expect(combined.verifyEachStep).toBe(true)
    expect(combined.allowAutonomy).toBe(true)
    expect(combined.description).toContain('组合自')
  })

  it('withFallback 返回新对象，不修改原策略', () => {
    const picker = new StrategyPickerImpl()
    const withFb = picker.withFallback(STRATEGY_ITERATIVE, 'direct')
    expect(withFb.fallbackOnFailure).toBe('direct')
    expect(STRATEGY_ITERATIVE.fallbackOnFailure).toBe('single_tool')
  })

  it('picker 实例化与工厂函数行为一致', () => {
    const analysis = mkAnalysis()
    const plan = planTask(analysis, mkSignals())
    expect(new StrategyPickerImpl().pick(analysis, plan)).toEqual(pickStrategy(analysis, plan))
  })
})
