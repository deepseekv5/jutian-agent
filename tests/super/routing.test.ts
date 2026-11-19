/**
 * 模块 C 路由决策 / 模型选择 / 自适应学习 单元测试
 *
 * 覆盖：
 *  - KernelRouter 五套内核决策树各分支
 *  - overrides 边界（critical 护栏、expert deep、trivial direct、direct 单轮）
 *  - 置信度（多规则一致高、冲突低）
 *  - ModelSelector 三种偏好、硬约束淘汰、备选排序、理由
 *  - AdaptationEngine 学习调整（喂样本看决策变化）、衰减、最小样本、stats、序列化
 */
import { describe, it, expect } from 'vitest'
import {
  KernelRouterImpl,
  createKernelRouter,
} from '../../src/shared/super/routing/router'
import {
  ModelSelectorImpl,
  DEFAULT_MODEL_PROFILES,
  createModelSelector,
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

  it('空候选列表回退到默认模型库', () => {
    const choice = selector.selectModel(makeAnalysis(), [])
    expect(choice.model).toBeDefined()
  })

  it('工厂函数 createModelSelector 可用', () => {
    expect(createModelSelector()).toBeInstanceOf(ModelSelectorImpl)
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
})
