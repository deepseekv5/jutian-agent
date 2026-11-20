/**
 * 模块 C 路由决策 / 模型选择 / 自适应学习 单元测试
 *
 * 覆盖：
 *  - KernelRouter 五套内核决策树各分支
 *  - overrides 边界（critical 护栏、expert deep、trivial direct、direct 单轮）
 *  - 置信度（多规则一致高、冲突低）
 *  - 冲突消解与果断性（v18.1）：典型场景置信度下限、专家规则、reasons 去重与排序
 *  - ModelSelector 三种偏好、硬约束淘汰、备选排序、理由
 *  - AdaptationEngine 学习调整（喂样本看决策变化）、衰减、最小样本、stats、序列化
 */
import { describe, it, expect } from 'vitest'
import {
  KernelRouterImpl,
  createKernelRouter,
  MIN_ROUTE_CONFIDENCE,
} from '../../src/shared/super/routing/router'
import {
  ModelSelectorImpl,
  DEFAULT_MODEL_PROFILES,
  createModelSelector,
  windowUsagePenalty,
  tieBreakBySpeedThenCost,
} from '../../src/shared/super/routing/modelSelector'
import {
  AdaptationEngineImpl,
  createAdaptationEngine,
} from '../../src/shared/super/routing/adaptation'
import type {
  TaskAnalysis,
  TaskComplexity,
  TaskDomain,
  RiskLevel,
  ExecutionPlan,
  ExecutionStrategy,
  PlanStep,
  RouteDecision,
  RouteStrategy,
  ModelProfile,
  ModelChoice,
  TaskOutcome,
} from '../../src/shared/super/types'

/* ─────────────────────────────────────────────────────────────────────────────
 * 测试夹具
 * ───────────────────────────────────────────────────────────────────────────── */

function makeAnalysis(overrides: Partial<TaskAnalysis> = {}): TaskAnalysis {
  const complexity: TaskAnalysis['complexity'] = {
    score: 30,
    level: 'simple',
    dimensions: { length: 20, domain: 20, steps: 20, risk: 10, context: 20 },
    reasons: [],
  }
  return {
    domain: 'code',
    confidence: 0.8,
    domains: [{ domain: 'code', weight: 1 }],
    complexity,
    risk: 'low',
    intent: '测试任务',
    needsTools: false,
    suggestedTools: [],
    benefitsFromAutonomy: false,
    ...overrides,
  }
}

function setComplexity(a: TaskAnalysis, level: TaskComplexity, score?: number): TaskAnalysis {
  const scoreMap: Record<TaskComplexity, number> = {
    trivial: 5, simple: 25, moderate: 50, complex: 75, expert: 95,
  }
  return {
    ...a,
    complexity: {
      ...a.complexity,
      level,
      score: score ?? scoreMap[level],
    },
  }
}

/**
 * 构造「matched/(matched+1)」比例的次领域权重列表（用于同分 tie-break 用例）：
 * n 条 code（weight 1）+ 1 条 writing（weight 1），匹配 code 的模型领域分为
 * n/(n+1)，同时匹配两者的为 1。用多条目而非大权重，因为单项 weight 会被
 * 选择器 clamp 到 [0,1]。
 */
function buildDomainRatio(n: number): TaskAnalysis['domains'] {
  return [
    ...Array.from({ length: n }, () => ({ domain: 'code' as TaskDomain, weight: 1 })),
    { domain: 'writing' as TaskDomain, weight: 1 },
  ]
}

function makePlan(stepCount = 0, overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  const steps: PlanStep[] = []
  for (let i = 0; i < stepCount; i++) {
    steps.push({
      id: `s${i}`,
      title: `步骤 ${i}`,
      description: '',
      dependsOn: i > 0 ? [`s${i - 1}`] : [],
      tools: ['read_file'],
      expectedOutput: '',
      parallelizable: false,
      estimatedDifficulty: 40,
    })
  }
  const ids = steps.map(s => s.id)
  return {
    goal: '测试目标',
    steps,
    levels: ids.length ? [ids] : [],
    estimatedRounds: Math.max(1, stepCount),
    criticalPath: ids,
    ...overrides,
  }
}

function makeStrategy(overrides: Partial<ExecutionStrategy> = {}): ExecutionStrategy {
  return {
    name: 'iterative',
    description: '测试策略',
    parallelTools: false,
    maxRounds: 8,
    verifyEachStep: false,
    allowAutonomy: false,
    fallbackOnFailure: null,
    ...overrides,
  }
}

function makeOutcome(
  decision: RouteDecision,
  analysis: TaskAnalysis,
  success: boolean,
  overrides: Partial<TaskOutcome> = {},
): TaskOutcome {
  return {
    decision,
    analysis,
    success,
    rounds: 3,
    durationMs: 1000,
    toolErrors: 0,
    timestamp: Date.now(),
    ...overrides,
  }
}

/** 构造一个指定策略/领域的决策，供学习引擎测试使用。 */
function makeDecision(strategy: RouteStrategy, confidence = 0.7): RouteDecision {
  const kernelMap: Record<RouteStrategy, RouteDecision['kernel']> = {
    direct: 'pro',
    single_tool: 'pro',
    iterative: 'super',
    autonomous: 'auto',
    deep: 'ultra',
  }
  return {
    strategy,
    kernel: kernelMap[strategy],
    confidence,
    reasons: [],
    overrides: {},
  }
}

/* ============================================================================
 * 一、KernelRouter 决策树
 * ============================================================================ */

describe('KernelRouterImpl 路由决策树', () => {
  const router = new KernelRouterImpl()

  it('trivial + 无需工具 => 直接走 direct + pro，1 轮', () => {
    let analysis = makeAnalysis({ needsTools: false })
    analysis = setComplexity(analysis, 'trivial')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy())

    expect(decision.strategy).toBe('direct')
    expect(decision.kernel).toBe('pro')
    expect(decision.overrides.maxRounds).toBe(1)
    expect(decision.overrides.hermesMode).toBe('off')
    expect(decision.reasons.join(' ')).toMatch(/trivial/)
  })

  it('expert 复杂度 => 强制 deep + ultra（硬约束）', () => {
    let analysis = makeAnalysis({ needsTools: true, suggestedTools: ['read_file'] })
    analysis = setComplexity(analysis, 'expert')
    const decision = router.routeTask(analysis, makePlan(3), makeStrategy())

    expect(decision.strategy).toBe('deep')
    expect(decision.kernel).toBe('ultra')
    expect(decision.overrides.enableVerification).toBe(true)
    expect(decision.overrides.maxRounds).toBeGreaterThanOrEqual(20)
    expect(decision.reasons.join(' ')).toMatch(/硬约束/)
  })

  it('critical 风险 => deep + ultra，强制护栏与验证', () => {
    const analysis = setComplexity(makeAnalysis({
      risk: 'critical',
      needsTools: true,
      suggestedTools: ['write_file', 'shell'],
    }), 'moderate')
    const decision = router.routeTask(analysis, makePlan(2), makeStrategy())

    expect(decision.strategy).toBe('deep')
    expect(decision.kernel).toBe('ultra')
    expect(decision.overrides.enableGuardrails).toBe(true)
    expect(decision.overrides.enableVerification).toBe(true)
  })

  it('benefitsFromAutonomy => autonomous + auto 内核', () => {
    const analysis = makeAnalysis({
      domain: 'planning',
      benefitsFromAutonomy: true,
      needsTools: true,
      suggestedTools: ['task'],
    })
    const decision = router.routeTask(analysis, makePlan(2), makeStrategy())

    expect(decision.strategy).toBe('autonomous')
    expect(decision.kernel).toBe('auto')
    expect(decision.overrides.hermesMode).toBe('auto')
    expect(decision.reasons.join(' ')).toMatch(/自主|autonomous/)
  })

  it('需要很多工具 + 大计划 => deep', () => {
    const analysis = setComplexity(makeAnalysis({
      needsTools: true,
      suggestedTools: ['a', 'b', 'c', 'd'],
    }), 'complex')
    const decision = router.routeTask(analysis, makePlan(10), makeStrategy())

    expect(decision.strategy).toBe('deep')
    expect(decision.overrides.enableVerification).toBe(true)
    expect(decision.overrides.maxRounds).toBeGreaterThanOrEqual(12)
  })

  it('简单代码任务 + 单工具 => single_tool 或 iterative（带工具）', () => {
    const analysis = setComplexity(makeAnalysis({
      needsTools: true,
      suggestedTools: ['read_file'],
      domain: 'code',
    }), 'simple')
    const decision = router.routeTask(analysis, makePlan(1), makeStrategy())

    expect(['single_tool', 'iterative']).toContain(decision.strategy)
    expect(decision.strategy).not.toBe('direct')
  })

  it('创作类 + 无需工具 + 简单 => direct', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'creative',
      needsTools: false,
    }), 'simple')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy())

    expect(decision.strategy).toBe('direct')
  })

  it('needsTools 但选了 direct => 升级为带工具策略（硬约束）', () => {
    // trivial 通常强制 direct，但因 needsTools 为真，硬约束 4 应升级。
    const analysis = setComplexity(makeAnalysis({
      needsTools: true,
      suggestedTools: ['shell', 'file'],
      domain: 'shell',
    }), 'trivial')
    const decision = router.routeTask(analysis, makePlan(1), makeStrategy())

    expect(decision.strategy).not.toBe('direct')
    expect(['single_tool', 'iterative']).toContain(decision.strategy)
  })

  it('route 方法（契约接口名）与 routeTask 行为一致', () => {
    const analysis = setComplexity(makeAnalysis(), 'moderate')
    const plan = makePlan(4)
    const strategy = makeStrategy()
    const a = router.route(analysis, plan, strategy)
    const b = router.routeTask(analysis, plan, strategy)
    expect(a).toEqual(b)
  })

  it('工厂函数 createKernelRouter 可用', () => {
    const r = createKernelRouter()
    expect(r).toBeInstanceOf(KernelRouterImpl)
  })

  it('输入策略每步验证 => 开启验证覆盖', () => {
    const analysis = setComplexity(makeAnalysis({ domain: 'conversation', needsTools: false }), 'moderate')
    const decision = router.routeTask(
      analysis,
      makePlan(3),
      makeStrategy({ verifyEachStep: true }),
    )
    expect(decision.overrides.enableVerification).toBe(true)
  })
})

/* ============================================================================
 * 二、overrides 边界与置信度
 * ============================================================================ */

describe('KernelRouterImpl overrides 与置信度', () => {
  const router = new KernelRouterImpl()

  it('direct 策略 maxRounds 恒为 1，token 有上限', () => {
    const analysis = setComplexity(makeAnalysis({ needsTools: false }), 'simple')
    const decision = router.routeTask(
      analysis,
      makePlan(0),
      makeStrategy({ maxRounds: 50 }),
    )
    expect(decision.strategy).toBe('direct')
    expect(decision.overrides.maxRounds).toBe(1)
    expect(decision.overrides.maxTokens).toBeLessThanOrEqual(8192)
  })

  it('single_tool 策略 maxRounds 被钳制在 1-3', () => {
    const analysis = setComplexity(makeAnalysis({
      needsTools: true,
      suggestedTools: ['file'],
    }), 'simple')
    const decision = router.routeTask(analysis, makePlan(1), makeStrategy({ maxRounds: 30 }))
    expect(decision.overrides.maxRounds).toBeGreaterThanOrEqual(1)
    expect(decision.overrides.maxRounds).toBeLessThanOrEqual(3)
  })

  it('创作领域温度较高，代码领域温度较低', () => {
    const creative = router.routeTask(
      setComplexity(makeAnalysis({ domain: 'creative', needsTools: false }), 'simple'),
      makePlan(0),
      makeStrategy(),
    )
    const code = router.routeTask(
      setComplexity(makeAnalysis({ domain: 'code', needsTools: true, suggestedTools: ['x'] }), 'simple'),
      makePlan(1),
      makeStrategy(),
    )
    expect(creative.overrides.temperature!).toBeGreaterThan(code.overrides.temperature!)
  })

  it('low 风险 + 非验证领域 + direct => 不强制验证', () => {
    const decision = router.routeTask(
      setComplexity(makeAnalysis({ domain: 'conversation', risk: 'low', needsTools: false }), 'trivial'),
      makePlan(0),
      makeStrategy(),
    )
    expect(decision.overrides.enableVerification).toBe(false)
  })

  it('高复杂度工程任务 => 开护栏', () => {
    const decision = router.routeTask(
      setComplexity(makeAnalysis({ domain: 'code', needsTools: true, suggestedTools: ['a', 'b'] }), 'complex'),
      makePlan(5),
      makeStrategy(),
    )
    expect(decision.overrides.enableGuardrails).toBe(true)
  })

  it('置信度在 0-1 之间，且理由数组非空', () => {
    const decision = router.routeTask(
      makeAnalysis({ domain: 'research', needsTools: true, suggestedTools: ['search'] }),
      makePlan(4),
      makeStrategy(),
    )
    expect(decision.confidence).toBeGreaterThanOrEqual(0)
    expect(decision.confidence).toBeLessThanOrEqual(1)
    expect(decision.reasons.length).toBeGreaterThan(0)
  })

  it('多规则一致（moderate + 多步 + 风险 medium）置信度较高', () => {
    const decision = router.routeTask(
      setComplexity(makeAnalysis({
        domain: 'code',
        risk: 'medium',
        needsTools: true,
        suggestedTools: ['a', 'b', 'c'],
      }), 'moderate'),
      makePlan(5),
      makeStrategy(),
    )
    expect(decision.confidence).toBeGreaterThan(0.4)
  })

  it('weightScale 缩放不改变硬约束结果', () => {
    const r = new KernelRouterImpl({ weightScale: 0.1 })
    const analysis = setComplexity(makeAnalysis({
      risk: 'critical', needsTools: true, suggestedTools: ['x'],
    }), 'expert')
    const decision = r.routeTask(analysis, makePlan(2), makeStrategy())
    expect(decision.strategy).toBe('deep')
    expect(decision.kernel).toBe('ultra')
  })
})

/* ============================================================================
 * 二.5、冲突消解与路由果断性（v18.1）
 *
 * 背景：e2e 实测「帮我写快速排序」这类任务置信度只有 14-18%——复杂度说 trivial
 * 应直接答复、工具需求说需要 iterative，多条规则投票冲突把置信度拉到不可用区间。
 * 优化后：按「硬约束 > 自主目标 > 工具需求 > 风险 > 领域专家 > 复杂度 > 计划 >
 * 输入策略」的优先级阶梯果断消解冲突，典型任务置信度回到 50% 以上。
 * ============================================================================ */

describe('KernelRouterImpl 冲突消解与果断性（v18.1）', () => {
  const router = new KernelRouterImpl()

  /** 「帮我写一个快速排序算法」的等价分析夹具：code 领域 + trivial + 需要 3 类工具。 */
  function makeQuickSortAnalysis() {
    return setComplexity(makeAnalysis({
      domain: 'code',
      needsTools: true,
      suggestedTools: ['code_search', 'read_file', 'write_file'],
      intent: '文本写作',
    }), 'trivial')
  }

  it('写代码冲突场景（trivial 但需要工具）=> 按工具需求果断升级 iterative，confidence >= 0.5', () => {
    const decision = router.routeTask(
      makeQuickSortAnalysis(),
      makePlan(0),
      makeStrategy({ name: 'direct', maxRounds: 1 }),
    )

    expect(decision.strategy).toBe('iterative')
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5)
    expect(decision.reasons.join(' ')).toMatch(/冲突消解/)
    // 升级后不能按 direct 压回 1 轮
    expect(decision.overrides.maxRounds).toBeGreaterThan(1)
  })

  it('小型代码任务升级后的 iterative 停留在 pro 轻内核', () => {
    const decision = router.routeTask(
      makeQuickSortAnalysis(),
      makePlan(0),
      makeStrategy({ name: 'direct', maxRounds: 1 }),
    )

    expect(decision.strategy).toBe('iterative')
    expect(decision.kernel).toBe('pro')
  })

  it('简单问答（trivial 闲聊、无需工具）=> direct + pro，confidence >= 0.8', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'conversation',
      needsTools: false,
      suggestedTools: [],
      intent: '日常对话',
    }), 'trivial')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy({ name: 'direct', maxRounds: 1 }))

    expect(decision.strategy).toBe('direct')
    expect(decision.kernel).toBe('pro')
    expect(decision.overrides.maxRounds).toBe(1)
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('专家规则：code + 需要工具 + 验证信号 => iterative + pro 轻内核 + 开启验证', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'code',
      needsTools: true,
      suggestedTools: ['code_search', 'read_file', 'run_tests'],
      intent: '测试验证',
    }), 'trivial')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy({ name: 'direct', maxRounds: 1 }))

    expect(decision.strategy).toBe('iterative')
    expect(decision.kernel).toBe('pro')
    expect(decision.overrides.enableVerification).toBe(true)
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5)
    expect(decision.reasons.join(' ')).toMatch(/专家规则/)
  })

  it('专家规则：目标闭环信号（自动/直到/完成全部）压过 trivial 直接答复 => autonomous + auto', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'planning',
      needsTools: true,
      suggestedTools: ['task_list'],
      benefitsFromAutonomy: true,
      intent: '方案规划',
    }), 'trivial')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy({ name: 'direct', maxRounds: 1 }))

    expect(decision.strategy).toBe('autonomous')
    expect(decision.kernel).toBe('auto')
    expect(decision.overrides.hermesMode).toBe('auto')
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('冲突消解（工具需求 > 复杂度）：creative trivial 但需要工具 => 升级 single_tool', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'creative',
      needsTools: true,
      suggestedTools: ['read_file', 'write_file'],
      intent: '内容创作',
    }), 'trivial')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy({ name: 'direct', maxRounds: 1 }))

    expect(decision.strategy).toBe('single_tool')
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5)
    expect(decision.reasons.join(' ')).toMatch(/工具需求 > 复杂度/)
  })

  it('风险 > 复杂度：high 风险压过 simple 直接答复 => deep + 护栏', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'conversation',
      needsTools: false,
      suggestedTools: [],
      risk: 'high',
    }), 'simple')
    const decision = router.routeTask(analysis, makePlan(0), makeStrategy({ name: 'direct', maxRounds: 1 }))

    expect(decision.strategy).toBe('deep')
    expect(decision.kernel).toBe('ultra')
    expect(decision.overrides.enableGuardrails).toBe(true)
  })

  it('置信度下限：多维度真实分歧（无消解）时 confidence 仍不低于 0.35', () => {
    // 复杂度+计划推 iterative、工具/领域/输入策略推 direct：高优先级维度不支持赢家，
    // 属于无法消解的真实分歧——旧公式会跌到 15% 区间，新公式下限 0.35。
    const analysis = setComplexity(makeAnalysis({
      domain: 'conversation',
      needsTools: false,
      suggestedTools: [],
      intent: '知识问答',
      confidence: 0.4,
    }), 'moderate')
    const decision = router.routeTask(analysis, makePlan(4), makeStrategy({ name: 'direct' }))

    expect(decision.strategy).toBe('iterative')
    expect(decision.confidence).toBeGreaterThanOrEqual(MIN_ROUTE_CONFIDENCE)
    expect(decision.confidence).toBeLessThanOrEqual(1)
  })

  it('相邻档位分歧（single_tool vs iterative）是程度问题：confidence >= 0.45', () => {
    const analysis = setComplexity(makeAnalysis({
      needsTools: true,
      suggestedTools: ['read_file'],
      intent: '代码相关',
    }), 'simple')
    const decision = router.routeTask(analysis, makePlan(1), makeStrategy({ name: 'single_tool' }))

    expect(['single_tool', 'iterative']).toContain(decision.strategy)
    expect(decision.confidence).toBeGreaterThanOrEqual(0.45)
  })

  it('reasons 质量：去重、总数 <= 6、决定性理由（专家规则/工具）先于复杂度理由', () => {
    const decision = router.routeTask(
      makeQuickSortAnalysis(),
      makePlan(0),
      makeStrategy({ name: 'direct', maxRounds: 1 }),
    )

    // 无重复条目
    expect(new Set(decision.reasons).size).toBe(decision.reasons.length)
    // 总条数上限
    expect(decision.reasons.length).toBeLessThanOrEqual(6)
    // 同类合并：至多一条「领域为 code」理由（e2e 中曾出现两条）
    const domainReasons = decision.reasons.filter(r => r.startsWith('领域为'))
    expect(domainReasons.length).toBeLessThanOrEqual(1)
    // 首条必是最决定性的信息：消解说明 / 硬约束 / 结论摘要
    expect(decision.reasons[0]).toMatch(/冲突消解|硬约束|最终决策/)
    // 决定性理由排在复杂度理由之前（冲突场景下复杂度理由通常已被压制）
    const expertIdx = decision.reasons.findIndex(r => r.includes('专家规则'))
    const complexityIdx = decision.reasons.findIndex(r => r.startsWith('复杂度为'))
    if (expertIdx >= 0 && complexityIdx >= 0) {
      expect(expertIdx).toBeLessThan(complexityIdx)
    }
  })

  it('expert 复杂度：硬约束说明置顶，且理由总数不超过 6', () => {
    const analysis = setComplexity(makeAnalysis({
      needsTools: true,
      suggestedTools: ['read_file', 'write_file'],
    }), 'expert')
    const decision = router.routeTask(analysis, makePlan(3), makeStrategy())

    expect(decision.reasons[0]).toMatch(/硬约束/)
    expect(decision.reasons.length).toBeLessThanOrEqual(6)
  })
})

/* ============================================================================
 * 三、ModelSelector 模型选择
 * ============================================================================ */

describe('ModelSelectorImpl 模型选择', () => {
  const selector = new ModelSelectorImpl()

  it('DEFAULT_MODEL_PROFILES 含 20+ 个模型且字段合法', () => {
    expect(DEFAULT_MODEL_PROFILES.length).toBeGreaterThanOrEqual(20)
    const ids = new Set(DEFAULT_MODEL_PROFILES.map(m => m.id))
    expect(ids.size).toBe(DEFAULT_MODEL_PROFILES.length)
    for (const m of DEFAULT_MODEL_PROFILES) {
      expect(m.contextWindow).toBeGreaterThan(0)
      expect(m.costTier).toBeGreaterThanOrEqual(0)
      expect(m.costTier).toBeLessThanOrEqual(3)
      expect(m.speedTier).toBeGreaterThanOrEqual(0)
      expect(m.speedTier).toBeLessThanOrEqual(3)
    }
  })

  it('质量偏好：复杂代码任务倾向推理模型（o3/deepseek-r1 等）', () => {
    const analysis = setComplexity(makeAnalysis({
      domain: 'code', needsTools: true, suggestedTools: ['read_file'],
    }), 'expert')
    const choice = selector.selectModel(analysis, DEFAULT_MODEL_PROFILES, 'quality')

    expect(choice.model.reasoning).toBe(true)
    expect(choice.score).toBeGreaterThan(0)
    expect(choice.reasons.length).toBeGreaterThan(0)
  })

  it('速度偏好：优先选择 speedTier 低的模型', () => {
    const analysis = setComplexity(makeAnalysis({ domain: 'writing', needsTools: false }), 'simple')
    const choice = selector.selectModel(analysis, DEFAULT_MODEL_PROFILES, 'speed')

    expect(choice.model.speedTier).toBeLessThanOrEqual(1)
  })

  it('成本偏好：优先选择 costTier 低的模型', () => {
    const analysis = setComplexity(makeAnalysis({ domain: 'writing', needsTools: false }), 'simple')
    const choice = selector.selectModel(analysis, DEFAULT_MODEL_PROFILES, 'cost')

    expect(choice.model.costTier).toBeLessThanOrEqual(1)
  })

  it('硬约束：needsTools 时淘汰不支持工具的模型', () => {
    const analysis = makeAnalysis({ needsTools: true, suggestedTools: ['read_file'] })
    const candidates: ModelProfile[] = [
      { ...DEFAULT_MODEL_PROFILES[0], id: 'no-tools', name: '无工具模型', supportsTools: false },
      { ...DEFAULT_MODEL_PROFILES[1], id: 'with-tools', name: '有工具模型', supportsTools: true },
    ]
    const choice = selector.selectModel(analysis, candidates)
    expect(choice.model.id).toBe('with-tools')
    expect(choice.reasons.join(' ')).toMatch(/淘汰/)
  })

  it('硬约束：视觉任务淘汰不支持视觉的模型', () => {
    const analysis = makeAnalysis({ needsTools: false, suggestedTools: ['vision_ocr'] })
    const candidates: ModelProfile[] = [
      { ...DEFAULT_MODEL_PROFILES[0], id: 'no-vision', supportsVision: false, supportsTools: true },
      { ...DEFAULT_MODEL_PROFILES[1], id: 'yes-vision', supportsVision: true, supportsTools: true },
    ]
    const choice = selector.selectModel(analysis, candidates)
    expect(choice.model.id).toBe('yes-vision')
  })

  it('硬约束：窗口不足的模型被淘汰', () => {
    const analysis = setComplexity(makeAnalysis({ domain: 'code', needsTools: false }), 'expert')
    const small: ModelProfile = {
      ...DEFAULT_MODEL_PROFILES[0], id: 'tiny-window', contextWindow: 1024,
    }
    const big: ModelProfile = {
      ...DEFAULT_MODEL_PROFILES[1], id: 'big-window', contextWindow: 1048576,
    }
    const choice = selector.selectModel(analysis, [small, big])
    expect(choice.model.id).toBe('big-window')
  })

  it('全部被窗口淘汰时降级选择（放宽窗口约束）', () => {
    const analysis = setComplexity(makeAnalysis({ domain: 'code', needsTools: true, suggestedTools: ['x'] }), 'expert')
    const candidates: ModelProfile[] = [
      { ...DEFAULT_MODEL_PROFILES[0], id: 'small1', contextWindow: 1024 },
      { ...DEFAULT_MODEL_PROFILES[1], id: 'small2', contextWindow: 2048 },
    ]
    const choice = selector.selectModel(analysis, candidates)
    expect(choice.model).toBeDefined()
    expect(choice.reasons.join(' ')).toMatch(/降级|放宽/)
  })

  it('备选列表按分数排序且不含首选', () => {
    const analysis = makeAnalysis({ domain: 'research', needsTools: false })
    const choice = selector.selectModel(analysis, DEFAULT_MODEL_PROFILES, 'quality')
    expect(choice.alternatives.length).toBeGreaterThan(0)
    expect(choice.alternatives.length).toBeLessThanOrEqual(3)
    expect(choice.alternatives.some(m => m.id === choice.model.id)).toBe(false)
  })

  it('select 方法（契约接口名）与 selectModel 一致', () => {
    const analysis = makeAnalysis({ domain: 'data' })
    expect(selector.select(analysis, DEFAULT_MODEL_PROFILES, 'cost'))
      .toEqual(selector.selectModel(analysis, DEFAULT_MODEL_PROFILES, 'cost'))
  })

  it('空候选列表回退到默认模型库并在理由中说明', () => {
    const choice = selector.selectModel(makeAnalysis(), [])
    expect(choice.model).toBeDefined()
    expect(choice.reasons.join(' ')).toMatch(/候选列表为空|内置默认/)
  })

  it('工厂函数 createModelSelector 可用', () => {
    expect(createModelSelector()).toBeInstanceOf(ModelSelectorImpl)
  })
})

/* ============================================================================
 * 三.5、ModelSelector 数据校准 / 同分决胜 / 梯度罚分 / 兜底强化
 *
 * 背景：通宵优化批次对模型选择器的四项强化——
 *  1. DEFAULT_MODEL_PROFILES 与真实规格校准，并补免费/本地档 profile；
 *  2. 全部硬约束淘汰 / 候选为空 / 内部异常时返回保守默认而非抛错；
 *  3. 同分 tie-break：速度档低者优，其次成本档低者优；
 *  4. 窗口软约束改为梯度罚分（接近 90% 时罚分幅度大于刚超 50% 时）。
 * ============================================================================ */

describe('ModelSelectorImpl 校准、同分决胜与兜底强化', () => {
  const selector = new ModelSelectorImpl()

  /** 从内置模型库取指定 id 的 profile（不存在时失败并给出可读信息）。 */
  function findProfile(id: string): ModelProfile {
    const profile = DEFAULT_MODEL_PROFILES.find(m => m.id === id)
    expect(profile, `内置模型库应包含 ${id}`).toBeDefined()
    return profile as ModelProfile
  }

  /* ── 数据增补与校准 ── */

  it('内置模型 contextWindow 与真实规格对齐（gpt-4o 128k / claude 200k / deepseek 64k / kimi 256k / qwen 128k / gemini 1M）', () => {
    expect(findProfile('gpt-4o').contextWindow).toBe(128000)
    expect(findProfile('gpt-4o-mini').contextWindow).toBe(128000)
    expect(findProfile('claude-3.7-sonnet').contextWindow).toBe(200000)
    expect(findProfile('claude-3.5-haiku').contextWindow).toBe(200000)
    // DeepSeek V3 官方 API 为 64K（V3.1+ 才扩展到 128K），R1 为 128K。
    expect(findProfile('deepseek-v3').contextWindow).toBe(64000)
    expect(findProfile('deepseek-r1').contextWindow).toBe(128000)
    // Kimi 家族覆盖 128K / 256K 两档。
    expect(findProfile('moonshot-v1-128k').contextWindow).toBe(128000)
    expect(findProfile('kimi-k2').contextWindow).toBe(256000)
    // Qwen2.5-72B 真实支持 128K（原值 32K 与规格不符，已校准）。
    expect(findProfile('qwen2.5-72b').contextWindow).toBe(128000)
    expect(findProfile('qwen3-235b').contextWindow).toBe(128000)
    expect(findProfile('gemini-2.5-pro').contextWindow).toBe(1048576)
  })

  it('免费/本地档模型已入库（glm-4-flash / spark-lite / kimi 免费 / poly 免费 / ollama 本地）且均为零成本档', () => {
    const freeIds = ['glm-4-flash', 'spark-lite', 'moonshot-kimi-free', 'poly-free', 'ollama-local']
    for (const id of freeIds) {
      const profile = findProfile(id)
      expect(profile.costTier).toBe(0)
      expect(profile.contextWindow).toBeGreaterThan(0)
      expect(profile.strength.length).toBeGreaterThan(0)
      // 免费档必须支持工具调用，才能作为 needsTools 任务的有效兜底候选。
      expect(profile.supportsTools).toBe(true)
    }
    // 本地档（ollama）窗口应明显小于云端免费档，体现本地硬件约束。
    expect(findProfile('ollama-local').contextWindow)
      .toBeLessThan(findProfile('glm-4-flash').contextWindow)
  })

  /* ── 同分 tie-break ── */

  it('tieBreakBySpeedThenCost：speedTier 低者优先，其次 costTier 低者优，完全相同返回 0', () => {
    const fast: ModelProfile = { ...DEFAULT_MODEL_PROFILES[0], id: 'fast', speedTier: 0, costTier: 2 }
    const slow: ModelProfile = { ...DEFAULT_MODEL_PROFILES[0], id: 'slow', speedTier: 2, costTier: 1 }
    expect(tieBreakBySpeedThenCost(fast, slow)).toBeLessThan(0)
    expect(tieBreakBySpeedThenCost(slow, fast)).toBeGreaterThan(0)
    // 速度档相同时比较成本档。
    const cheap: ModelProfile = { ...DEFAULT_MODEL_PROFILES[0], id: 'cheap', speedTier: 1, costTier: 0 }
    const pricey: ModelProfile = { ...DEFAULT_MODEL_PROFILES[0], id: 'pricey', speedTier: 1, costTier: 2 }
    expect(tieBreakBySpeedThenCost(cheap, pricey)).toBeLessThan(0)
    expect(tieBreakBySpeedThenCost(pricey, cheap)).toBeGreaterThan(0)
    // 完全相同返回 0（由调用方保持顺序稳定）。
    expect(tieBreakBySpeedThenCost(cheap, { ...cheap, id: 'twin' })).toBe(0)
  })

  it('同分时 speedTier 低者先（与候选数组顺序无关）', () => {
    // 构造两个总分完全一致的候选：慢者用更高的领域匹配度补偿速度档劣势。
    // 快 A：领域匹配 17/18、speedTier 0；慢 B：领域匹配 1、speedTier 1。
    // quality 权重下 0.24*(1-17/18) = 0.04*(1-2/3)，两项差值恰好抵消。
    // 注意 domains 的单项 weight 会被 clamp 到 [0,1]，因此用 17 条 code 条目
    // 表达 17/18 的匹配占比。
    const analysis = makeAnalysis({
      domain: 'planning',
      domains: buildDomainRatio(17),
      needsTools: false,
      suggestedTools: [],
    })
    const base = DEFAULT_MODEL_PROFILES[0]
    const fastA: ModelProfile = {
      ...base, id: 'fast-a', name: '快A', strength: ['code'], speedTier: 0,
      costTier: 0, reasoning: true, supportsVision: false, contextWindow: 128000,
    }
    const slowB: ModelProfile = {
      ...base, id: 'slow-b', name: '慢B', strength: ['code', 'writing'], speedTier: 1,
      costTier: 0, reasoning: true, supportsVision: false, contextWindow: 128000,
    }
    const first = selector.selectModel(analysis, [fastA, slowB])
    const reversed = selector.selectModel(analysis, [slowB, fastA])
    // 两种顺序都应选出 speedTier 更低的 fast-a，证明结果来自 tie-break 而非数组顺序。
    expect(first.model.id).toBe('fast-a')
    expect(reversed.model.id).toBe('fast-a')
    expect(first.score).toBe(reversed.score)
  })

  it('同分且 speedTier 相同时 costTier 低者先', () => {
    const analysis = makeAnalysis({
      domain: 'planning',
      domains: buildDomainRatio(17),
      needsTools: false,
      suggestedTools: [],
    })
    const base = DEFAULT_MODEL_PROFILES[0]
    const cheapA: ModelProfile = {
      ...base, id: 'cheap-a', name: '省A', strength: ['code'], speedTier: 1,
      costTier: 0, reasoning: true, supportsVision: false, contextWindow: 128000,
    }
    const priceyB: ModelProfile = {
      ...base, id: 'pricey-b', name: '贵B', strength: ['code', 'writing'], speedTier: 1,
      costTier: 1, reasoning: true, supportsVision: false, contextWindow: 128000,
    }
    const first = selector.selectModel(analysis, [cheapA, priceyB])
    const reversed = selector.selectModel(analysis, [priceyB, cheapA])
    expect(first.model.id).toBe('cheap-a')
    expect(reversed.model.id).toBe('cheap-a')
    expect(first.score).toBe(reversed.score)
  })

  /* ── 窗口软约束梯度罚分 ── */

  it('windowUsagePenalty 梯度：50% 以内不罚，90% 以上斜率加倍（梯度而非线性跳变）', () => {
    const required = 9000
    // 使用率恰为 50%：余量充裕不罚分。
    expect(windowUsagePenalty(required, 18000)).toBe(0)
    // 60% -> 约 0.015；90% -> 0.06；95% -> 约 0.08；100% -> 0.10。
    const at60 = windowUsagePenalty(required, 15000)
    const at90 = windowUsagePenalty(required, 10000)
    const at100 = windowUsagePenalty(required, 9000)
    expect(at60).toBeCloseTo(0.015, 4)
    expect(at90).toBeCloseTo(0.06, 4)
    expect(at100).toBeCloseTo(0.1, 4)
    // 「接近 90% 时的罚分幅度大于刚超 50% 时」：90% 处罚分明显高于 60% 处。
    expect(at90).toBeGreaterThan(at60 * 3)
    // 90%-100% 区间的每百分点斜率是 50%-90% 区间的 2 倍以上。
    const slopeLow = (at90 - at60) / 30
    const slopeHigh = (at100 - at90) / 10
    expect(slopeHigh).toBeGreaterThan(slopeLow * 2)
  })

  it('窗口使用率约 90% 的候选有罚分理由，且输给余量充裕的候选；使用率 <= 50% 无罚分理由', () => {
    // 默认夹具 complexity=30、writing 领域、无工具：任务约需 11296 token。
    const analysis = makeAnalysis({ domain: 'writing', needsTools: false })
    const tight: ModelProfile = { ...DEFAULT_MODEL_PROFILES[0], id: 'tight', name: '紧张档', contextWindow: 12500 }
    const roomy: ModelProfile = { ...DEFAULT_MODEL_PROFILES[0], id: 'roomy', name: '宽裕档', contextWindow: 26000 }

    // 单独评估紧张档：使用率约 90.4%，理由中应明确标注罚分及占比。
    const soloTight = selector.selectModel(analysis, [tight])
    expect(soloTight.reasons.join(' ')).toMatch(/余量偏紧（任务估算约占窗口 90%）/)

    // 单独评估宽裕档：使用率约 43%（<= 50%），不应出现罚分理由。
    const soloRoomy = selector.selectModel(analysis, [roomy])
    expect(soloRoomy.reasons.join(' ')).not.toMatch(/余量偏紧/)

    // 同场竞争：宽裕档窗口分更高且无梯度罚分，应稳定胜出。
    const both = selector.selectModel(analysis, [tight, roomy])
    expect(both.model.id).toBe('roomy')
  })

  /* ── 无候选可用的兜底 ── */

  it('异常路径：任务分析字段损坏时返回保守默认（第一个支持工具的候选）而不抛错', () => {
    // domains 被替换为不可迭代对象，常规打分会在遍历时抛 TypeError。
    const broken = {
      ...makeAnalysis({ needsTools: true, suggestedTools: ['read_file'] }),
      domains: {} as unknown as TaskAnalysis['domains'],
    }
    const candidates: ModelProfile[] = [
      { ...DEFAULT_MODEL_PROFILES[0], id: 'no-tools', name: '无工具模型', supportsTools: false },
      { ...DEFAULT_MODEL_PROFILES[1], id: 'with-tools', name: '有工具模型', supportsTools: true },
    ]
    let choice: ModelChoice | undefined
    expect(() => { choice = selector.selectModel(broken, candidates) }).not.toThrow()
    expect(choice).toBeDefined()
    // 保守默认策略：优先返回第一个支持工具调用的候选。
    expect(choice!.model.id).toBe('with-tools')
    expect(choice!.reasons.join(' ')).toMatch(/异常|保守默认/)
  })

  it('极端兜底：所有候选都不支持工具时返回候选首位并明确标记', () => {
    const analysis = makeAnalysis({ needsTools: true, suggestedTools: ['read_file'] })
    const candidates: ModelProfile[] = [
      { ...DEFAULT_MODEL_PROFILES[0], id: 'nt1', name: '无工具一', supportsTools: false },
      { ...DEFAULT_MODEL_PROFILES[1], id: 'nt2', name: '无工具二', supportsTools: false },
    ]
    const choice = selector.selectModel(analysis, candidates)
    expect(choice.model.id).toBe('nt1')
    expect(choice.score).toBe(0)
    expect(choice.reasons.join(' ')).toMatch(/严重警告/)
    expect(choice.reasons.join(' ')).toMatch(/兜底/)
    expect(choice.alternatives).toEqual([])
  })

  it('极端兜底：视觉约束无人满足时优先返回第一个支持工具的候选', () => {
    const analysis = makeAnalysis({ needsTools: false, suggestedTools: ['vision_ocr'] })
    const candidates: ModelProfile[] = [
      { ...DEFAULT_MODEL_PROFILES[0], id: 'nv-no-tools', name: '无视觉无工具', supportsVision: false, supportsTools: false },
      { ...DEFAULT_MODEL_PROFILES[1], id: 'nv-with-tools', name: '无视觉有工具', supportsVision: false, supportsTools: true },
    ]
    const choice = selector.selectModel(analysis, candidates)
    expect(choice.model.id).toBe('nv-with-tools')
    expect(choice.reasons.join(' ')).toMatch(/兜底策略|保守默认/)
  })
})

/* ============================================================================
 * 四、AdaptationEngine 自适应学习
 * ============================================================================ */

describe('AdaptationEngineImpl 自适应学习', () => {
  it('样本不足 => adjust 不改变决策', () => {
    const engine = createAdaptationEngine({ minSamples: 5 })
    const analysis = makeAnalysis({ domain: 'code' })
    const base = makeDecision('iterative')

    // 只喂 2 条样本。
    engine.record(makeOutcome(makeDecision('iterative'), analysis, false))
    engine.record(makeOutcome(makeDecision('iterative'), analysis, false))

    const adjusted = engine.adjust(base, analysis)
    expect(adjusted.strategy).toBe('iterative')
    expect(adjusted.reasons).toEqual(base.reasons)
  })

  it('喂入足够失败样本后，替换为该领域表现更好的策略', () => {
    const engine = createAdaptationEngine({ minSamples: 3, switchThreshold: 0.1 })
    const analysis = makeAnalysis({ domain: 'code' })

    // iterative 在 code 领域 6 次全失败。
    for (let i = 0; i < 6; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, false))
    }
    // deep 在 code 领域 6 次全成功。
    for (let i = 0; i < 6; i++) {
      engine.record(makeOutcome(makeDecision('deep'), analysis, true))
    }

    const base = makeDecision('iterative')
    const adjusted = engine.adjust(base, analysis)

    expect(adjusted.strategy).toBe('deep')
    expect(adjusted.kernel).toBe('ultra')
    expect(adjusted.reasons.join(' ')).toMatch(/自适应调整/)
  })

  it('当前策略成功率高 => 上调置信度', () => {
    const engine = createAdaptationEngine({ minSamples: 3, maxConfidenceDelta: 0.15 })
    const analysis = makeAnalysis({ domain: 'research' })
    for (let i = 0; i < 6; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    }
    const base = makeDecision('iterative', 0.5)
    const adjusted = engine.adjust(base, analysis)
    expect(adjusted.confidence).toBeGreaterThan(0.5)
  })

  it('当前策略成功率低但无更好替代 => 下调置信度', () => {
    const engine = createAdaptationEngine({ minSamples: 3, maxConfidenceDelta: 0.15 })
    const analysis = makeAnalysis({ domain: 'qa' })
    for (let i = 0; i < 6; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, false))
    }
    const base = makeDecision('iterative', 0.7)
    const adjusted = engine.adjust(base, analysis)
    expect(adjusted.confidence).toBeLessThan(0.7)
    expect(adjusted.strategy).toBe('iterative')
  })

  it('工具错误率高 => 强制开启护栏与验证', () => {
    const engine = createAdaptationEngine({ minSamples: 3 })
    const analysis = makeAnalysis({ domain: 'shell' })
    for (let i = 0; i < 5; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, true, { toolErrors: 2 }))
    }
    const base = makeDecision('iterative')
    base.overrides = { enableGuardrails: false, enableVerification: false }
    const adjusted = engine.adjust(base, analysis)
    expect(adjusted.overrides.enableGuardrails).toBe(true)
    expect(adjusted.overrides.enableVerification).toBe(true)
  })

  it('高风险任务自适应不会关闭护栏', () => {
    const engine = createAdaptationEngine({ minSamples: 3 })
    const analysis = makeAnalysis({ domain: 'code', risk: 'critical' })
    for (let i = 0; i < 5; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    }
    const base = makeDecision('iterative')
    const adjusted = engine.adjust(base, analysis)
    expect(adjusted.overrides.enableGuardrails).toBe(true)
  })

  it('stats 聚合：策略成功率、平均轮次、领域分布、失败原因', () => {
    const engine = createAdaptationEngine({ minSamples: 3 })
    const code = makeAnalysis({ domain: 'code' })
    const data = makeAnalysis({ domain: 'data' })

    engine.record(makeOutcome(makeDecision('iterative'), code, true, { rounds: 4, durationMs: 1000 }))
    engine.record(makeOutcome(makeDecision('iterative'), code, false, { rounds: 6, durationMs: 2000, toolErrors: 1 }))
    engine.record(makeOutcome(makeDecision('deep'), data, true, { rounds: 10, durationMs: 5000 }))

    const s = engine.stats() as any
    expect(s.totalOutcomes).toBe(3)
    expect(s.overall.successRate).toBeCloseTo(2 / 3, 2)
    expect(s.overall.avgRounds).toBeCloseTo(20 / 3, 1)
    expect(s.byStrategy.iterative.count).toBe(2)
    expect(s.byStrategy.iterative.successRate).toBeCloseTo(0.5, 2)
    expect(s.byDomain.code.count).toBe(2)
    expect(s.byDomain.data.count).toBe(1)
    expect(s.domainDistribution.code).toBe(2)
    expect(s.recentFailureReasons.length).toBeGreaterThan(0)
    expect(s.recentFailureReasons.join(' ')).toMatch(/工具|失败/)
  })

  it('环形缓冲上限生效', () => {
    const engine = createAdaptationEngine({ capacity: 3, minSamples: 1 })
    const analysis = makeAnalysis({ domain: 'code' })
    for (let i = 0; i < 10; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, i % 2 === 0))
    }
    const s = engine.stats() as any
    expect(s.totalOutcomes).toBe(10)
    expect(s.windowSize).toBe(3)
  })

  it('衰减因子：近期样本权重更高（recent 成功率变化更敏感）', () => {
    const engine = createAdaptationEngine({ minSamples: 2, decay: 0.5 })
    const analysis = makeAnalysis({ domain: 'code' })
    // 先连续成功，再连续失败。
    for (let i = 0; i < 4; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    }
    for (let i = 0; i < 4; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, false))
    }
    const s = engine.stats() as any
    // 朴素成功率 0.5，但衰减后近期失败权重更高，加权成功率应低于 0.5。
    expect(s.byStrategy.iterative.weightedSuccessRate).toBeLessThan(0.5)
    expect(s.byStrategy.iterative.successRate).toBeCloseTo(0.5, 2)
  })

  it('序列化 / 反序列化保留统计', () => {
    const engine = createAdaptationEngine({ minSamples: 3 })
    const analysis = makeAnalysis({ domain: 'code' })
    for (let i = 0; i < 5; i++) {
      engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    }
    const data = engine.serialize()
    expect(data.length).toBeGreaterThan(0)

    const restored = createAdaptationEngine()
    restored.deserialize(data)
    const s = restored.stats() as any
    expect(s.totalOutcomes).toBe(5)
    expect(s.byStrategy.iterative.successRate).toBeCloseTo(1, 2)
  })

  it('反序列化损坏数据时不崩溃', () => {
    const engine = createAdaptationEngine()
    expect(() => engine.deserialize('not-json')).not.toThrow()
    expect(() => engine.deserialize('{"version":999}')).not.toThrow()
  })

  it('reset 清空学习状态', () => {
    const engine = createAdaptationEngine()
    engine.record(makeOutcome(makeDecision('iterative'), makeAnalysis(), true))
    engine.reset()
    const s = engine.stats() as any
    expect(s.totalOutcomes).toBe(0)
  })

  it('工厂函数与接口方法 record/adjust/stats 齐备', () => {
    const engine = createAdaptationEngine()
    expect(engine).toBeInstanceOf(AdaptationEngineImpl)
    expect(typeof engine.record).toBe('function')
    expect(typeof engine.adjust).toBe('function')
    expect(typeof engine.stats).toBe('function')
  })

  it('stats 质量核查：各策略总样本/成功率、按领域分组样本数、最近失败原因列表齐备', () => {
    const engine = createAdaptationEngine({ minSamples: 2 })
    const code = makeAnalysis({ domain: 'code' })
    const writing = makeAnalysis({ domain: 'writing' })

    engine.record(makeOutcome(makeDecision('iterative'), code, true, { rounds: 2 }))
    engine.record(makeOutcome(makeDecision('iterative'), code, false, { rounds: 4, toolErrors: 2 }))
    engine.record(makeOutcome(makeDecision('deep'), writing, true, { rounds: 8 }))

    const s = engine.stats() as Record<string, any>

    // 一、各 strategy 的总样本数与成功率（朴素口径）。
    expect(s.byStrategy.iterative.count).toBe(2)
    expect(s.byStrategy.iterative.successRate).toBeCloseTo(0.5, 2)
    expect(s.byStrategy.deep.count).toBe(1)
    expect(s.byStrategy.deep.successRate).toBe(1)
    // 每个策略条目都带加权成功率，供外部核查「学到的」口径。
    expect(typeof s.byStrategy.iterative.weightedSuccessRate).toBe('number')

    // 二、按 domain 分组样本数（byDomain 明细 + domainDistribution 分布双通道）。
    expect(s.byDomain.code.count).toBe(2)
    expect(s.byDomain.writing.count).toBe(1)
    expect(s.domainDistribution.code).toBe(2)
    expect(s.domainDistribution.writing).toBe(1)

    // 三、最近失败原因列表：字符串数组，只含失败/带工具错误的样本，带策略与领域标注。
    expect(Array.isArray(s.recentFailureReasons)).toBe(true)
    expect(s.recentFailureReasons.length).toBe(1)
    expect(typeof s.recentFailureReasons[0]).toBe('string')
    expect(s.recentFailureReasons[0]).toContain('iterative')
    expect(s.recentFailureReasons[0]).toContain('code')
    expect(s.recentFailureReasons[0]).toMatch(/工具调用出错|失败/)
  })

  it('最小样本阈值边界：样本数恰好等于阈值时参与调整，少于阈值才跳过', () => {
    const engine = createAdaptationEngine({ minSamples: 3, maxConfidenceDelta: 0.15 })
    const analysis = makeAnalysis({ domain: 'code' })
    const base = makeDecision('iterative', 0.5)

    // 阈值 - 1 条全成功样本：count < minSamples，adjust 原样返回。
    engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    const before = engine.adjust(base, analysis)
    expect(before.strategy).toBe('iterative')
    expect(before.confidence).toBe(base.confidence)

    // 补到恰好 3 条（count == minSamples）：现有语义是「达到阈值即参与调整」——
    // 全成功样本应上调置信度。
    engine.record(makeOutcome(makeDecision('iterative'), analysis, true))
    const after = engine.adjust(base, analysis)
    expect(after.strategy).toBe('iterative')
    expect(after.confidence).toBeGreaterThan(0.5)
  })
})
