/**
 * 执行策略选择实现（模块 B: planning / StrategyPicker）
 *
 * 职责：基于任务分析（TaskAnalysis）与执行计划（ExecutionPlan），
 * 选出合适的执行策略（ExecutionStrategy），供上游 KernelRouter 决定
 * 用哪个内核（pro/ultra/auto/super）与运行参数。
 *
 * 设计要点：
 *   1. 策略是"常量配置 + 选择规则"的组合。所有策略都以常量导出，
 *      picker 返回的是这些常量的浅拷贝，调用方修改不会污染全局。
 *   2. 规则可解释：每条规则有明确打分与理由，pickWithExplanation
 *      会把完整推理过程返回，供诊断面板展示。
 *   3. 组合与覆盖：基础策略选定后，根据风险/规模/自主性做"组合增强"
 *      （例如 iterative + 严格验证），再按 plan 规模调整 maxRounds。
 *
 * 选择信号一览（来自 analysis / plan）：
 *   - complexity.level / score  -> 迭代与深度需求
 *   - risk                      -> 验证与护栏需求
 *   - needsTools / suggestedTools-> 单工具 vs 直接回答
 *   - benefitsFromAutonomy      -> 自主闭环需求
 *   - plan.steps.length / levels-> 计划规模与并行机会
 *   - plan.criticalPath.length  -> 关键路径深度（决定轮数）
 */

import type {
  TaskAnalysis,
  ExecutionPlan,
  ExecutionStrategy,
  StrategyPicker,
  RouteStrategy,
} from '../types'

/* ─────────────────────────────────────────────────────────────
 * 策略常量
 * ───────────────────────────────────────────────────────────── */

/**
 * 直接回答：无工具、单轮、无验证。
 * 适用于 trivial/simple 的纯对话、简单问答。
 */
export const STRATEGY_DIRECT: ExecutionStrategy = Object.freeze({
  name: 'direct',
  description: '单次直接回答，不调用工具、不做逐轮验证，适合简单问答与闲聊。',
  parallelTools: false,
  maxRounds: 1,
  verifyEachStep: false,
  allowAutonomy: false,
  fallbackOnFailure: null,
})

/**
 * 单工具：一次工具调用后即可回答。
 * 适用于明确、低风险的单一检索/读取任务。
 */
export const STRATEGY_SINGLE_TOOL: ExecutionStrategy = Object.freeze({
  name: 'single_tool',
  description: '调用一次最相关的工具获取信息后作答，不进入多轮循环。',
  parallelTools: false,
  maxRounds: 2,
  verifyEachStep: false,
  allowAutonomy: false,
  fallbackOnFailure: 'direct' as RouteStrategy,
})

/**
 * 迭代循环：多轮工具循环，逐阶段推进并验证。
 * 适用于 moderate/complex 的多步骤任务。
 */
export const STRATEGY_ITERATIVE: ExecutionStrategy = Object.freeze({
  name: 'iterative',
  description: '多轮工具循环，按计划分阶段执行并逐轮验证，适合常规多步骤任务。',
  parallelTools: true,
  maxRounds: 8,
  verifyEachStep: true,
  allowAutonomy: false,
  fallbackOnFailure: 'single_tool' as RouteStrategy,
})

/**
 * 自主闭环：允许自主规划与自我修正，直到达成目标。
 * 适用于 benefitsFromAutonomy 且有明确目标的任务。
 */
export const STRATEGY_AUTONOMOUS: ExecutionStrategy = Object.freeze({
  name: 'autonomous',
  description: '自主目标闭环，允许自我规划、重试与收敛判断，适合目标明确的多阶段任务。',
  parallelTools: true,
  maxRounds: 12,
  verifyEachStep: true,
  allowAutonomy: true,
  fallbackOnFailure: 'iterative' as RouteStrategy,
})

/**
 * 深度工程：全套护栏 + 严格验证 + 较多轮次。
 * 适用于 complex/expert、高风险或关键路径很长的任务。
 */
export const STRATEGY_DEEP: ExecutionStrategy = Object.freeze({
  name: 'deep',
  description: '深度工程模式，启用全套护栏与严格逐步验证，适合高风险复杂任务。',
  parallelTools: true,
  maxRounds: 16,
  verifyEachStep: true,
  allowAutonomy: true,
  fallbackOnFailure: 'autonomous' as RouteStrategy,
})

/**
 * 并行快审：组合策略示例——以迭代为底，关闭逐轮验证、强化并行。
 * 当计划中存在大量可并行层且风险低时使用。
 */
export const STRATEGY_PARALLEL_SWIFT: ExecutionStrategy = Object.freeze({
  name: 'iterative', // 对外仍映射到 iterative 内核，但参数被覆盖
  description: '并行快审：在低风险、高并行度场景下关闭逐轮验证以提速。',
  parallelTools: true,
  maxRounds: 6,
  verifyEachStep: false,
  allowAutonomy: false,
  fallbackOnFailure: 'single_tool' as RouteStrategy,
})

/** 全部内置策略（按名称索引） */
export const BUILTIN_STRATEGIES: Record<string, ExecutionStrategy> = {
  direct: STRATEGY_DIRECT,
  single_tool: STRATEGY_SINGLE_TOOL,
  iterative: STRATEGY_ITERATIVE,
  autonomous: STRATEGY_AUTONOMOUS,
  deep: STRATEGY_DEEP,
}

/* ─────────────────────────────────────────────────────────────
 * 打分与解释
 * ───────────────────────────────────────────────────────────── */

/** 每个策略的累计得分 */
type StrategyScores = Record<'direct' | 'single_tool' | 'iterative' | 'autonomous' | 'deep', number>

/** 选择解释：包含每条规则与最终得分 */
export interface StrategyExplanation {
  strategy: ExecutionStrategy
  scores: StrategyScores
  reasons: string[]
  /** 被应用的覆盖项（如 maxRounds 调整） */
  overrides: Array<{ field: string; from: unknown; to: unknown; reason: string }>
}

/** 初始化分数（给每个策略一个基线，避免全 0 时平局难解） */
function initialScores(): StrategyScores {
  return { direct: 0, single_tool: 0, iterative: 0, autonomous: 0, deep: 0 }
}

/** 风险等级权重：越高越需要深度策略 */
const RISK_WEIGHT: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }

/** 复杂度等级权重 */
const COMPLEXITY_WEIGHT: Record<string, number> = {
  trivial: 0, simple: 1, moderate: 2, complex: 3, expert: 4,
}

/**
 * 计算计划规模特征：步数、层数、关键路径深度、可并行步骤占比。
 */
interface PlanFeatures {
  stepCount: number
  levelCount: number
  criticalDepth: number
  parallelRatio: number
}

function planFeatures(plan: ExecutionPlan | null | undefined): PlanFeatures {
  if (!plan) return { stepCount: 0, levelCount: 0, criticalDepth: 0, parallelRatio: 0 }
  const stepCount = plan.steps?.length ?? 0
  const levelCount = plan.levels?.length ?? 0
  const criticalDepth = plan.criticalPath?.length ?? 0
  const parallelSteps = (plan.steps ?? []).filter((s) => s.parallelizable).length
  const parallelRatio = stepCount > 0 ? parallelSteps / stepCount : 0
  return { stepCount, levelCount, criticalDepth, parallelRatio }
}

/* ─────────────────────────────────────────────────────────────
 * 实现类
 * ───────────────────────────────────────────────────────────── */

export class StrategyPickerImpl implements StrategyPicker {
  /** 字面量类型的字段集，便于统一覆盖 */
  private readonly editableFields: Array<keyof ExecutionStrategy> = [
    'name', 'description', 'parallelTools', 'maxRounds',
    'verifyEachStep', 'allowAutonomy', 'fallbackOnFailure',
  ]

  /**
   * 契约入口：返回 ExecutionStrategy。
   */
  pick(analysis: TaskAnalysis, plan: ExecutionPlan): ExecutionStrategy {
    return this.pickWithExplanation(analysis, plan).strategy
  }

  /**
   * 可解释版本：返回策略、全部打分、理由与覆盖记录。
   * 诊断面板可直接展示 scores/reasons。
   */
  pickWithExplanation(analysis: TaskAnalysis, plan: ExecutionPlan): StrategyExplanation {
    const scores = initialScores()
    const reasons: string[] = []
    const features = planFeatures(plan)
    const complexity = analysis?.complexity?.level ?? 'simple'
    const complexityScore = analysis?.complexity?.score ?? 0
    const risk = analysis?.risk ?? 'low'
    const complexityWeight = COMPLEXITY_WEIGHT[complexity] ?? 1
    const riskWeight = RISK_WEIGHT[risk] ?? 0

    /* ── 规则 1：复杂度 ────────────────────────────────── */
    if (complexity === 'trivial' || complexity === 'simple') {
      scores.direct += 3
      reasons.push(`复杂度为 ${complexity}，偏向直接回答（direct +3）。`)
    } else if (complexity === 'moderate') {
      scores.iterative += 2
      scores.single_tool += 1
      reasons.push('复杂度为 moderate，偏向迭代循环（iterative +2）。')
    } else if (complexity === 'complex') {
      scores.iterative += 2
      scores.autonomous += 2
      scores.deep += 2
      reasons.push('复杂度为 complex，迭代/自主/深度策略均加分。')
    } else {
      // expert
      scores.deep += 4
      scores.autonomous += 1
      reasons.push('复杂度为 expert，强烈偏向深度工程（deep +4）。')
    }
    // 高分数也推高深度需求
    if (complexityScore >= 75) {
      scores.deep += 1
      reasons.push(`综合复杂度分 ${complexityScore} >= 75，deep 额外 +1。`)
    }

    /* ── 规则 2：风险 ─────────────────────────────────── */
    if (riskWeight >= 2) {
      scores.deep += riskWeight
      reasons.push(`风险等级 ${risk}（权重 ${riskWeight}），deep 加 ${riskWeight} 分以启用严格护栏。`)
    } else if (riskWeight === 1) {
      scores.iterative += 1
      reasons.push('风险等级 medium，iterative 加 1 分以保留逐轮验证。')
    } else {
      scores.direct += 1
      reasons.push('风险等级 low，direct 加 1 分。')
    }

    /* ── 规则 3：是否需要工具 ─────────────────────────── */
    const toolCount = analysis?.suggestedTools?.length ?? 0
    if (!analysis?.needsTools) {
      scores.direct += 2
      reasons.push('任务不需要工具，direct 加 2 分。')
    } else if (toolCount <= 1 && complexityWeight <= 2) {
      scores.single_tool += 3
      reasons.push(`仅需工具且建议工具数=${toolCount}，single_tool 加 3 分。`)
    } else {
      scores.iterative += 2
      reasons.push(`需要多工具协作（建议工具数=${toolCount}），iterative 加 2 分。`)
    }

    /* ── 规则 4：自主闭环 ─────────────────────────────── */
    if (analysis?.benefitsFromAutonomy) {
      // 自主收益是决定性信号：complex/expert 且适合自主时，
      // autonomous 必须能压过 iterative 累积的"复杂度+多工具+规模"分。
      scores.autonomous += 4
      if (complexityWeight >= 3) {
        scores.autonomous += 2 // 越复杂越依赖自主推进与自我修正
        scores.deep += 2       // 同时具备深度工程的必要条件
      }
      reasons.push('任务适合自主闭环，autonomous 加 4 分' +
        (complexityWeight >= 3 ? '（复杂任务额外 +2 并推高 deep +2）。' : '。'))
    } else {
      scores.direct += 0.5
      scores.iterative += 0.5
      reasons.push('任务不特别受益自主，轻微偏向非自主策略。')
    }

    /* ── 规则 5：计划规模与并行度 ─────────────────────── */
    if (features.stepCount <= 1) {
      scores.direct += 1.5
      reasons.push(`计划仅 ${features.stepCount} 步，direct 加 1.5 分。`)
    } else if (features.stepCount <= 3) {
      scores.single_tool += 1.5
      reasons.push(`计划 ${features.stepCount} 步，single_tool 加 1.5 分。`)
    } else {
      scores.iterative += 1.5
      reasons.push(`计划 ${features.stepCount} 步（多步骤），iterative 加 1.5 分。`)
    }
    if (features.stepCount >= 8 || features.criticalDepth >= 6) {
      scores.deep += 2
      reasons.push(
        `计划规模较大（steps=${features.stepCount}，critical=${features.criticalDepth}），deep 加 2 分。`,
      )
    }
    if (features.parallelRatio >= 0.5 && riskWeight <= 1) {
      scores.iterative += 1
      reasons.push(`可并行步骤占比 ${Math.round(features.parallelRatio * 100)}% 且风险低，iterative 加 1 分。`)
    }

    /* ── 决出基础策略 ─────────────────────────────────── */
    const baseKey = this.argmax(scores)
    const overrides: StrategyExplanation['overrides'] = []

    // 复制常量，避免污染全局
    let strategy = this.copyStrategy(BUILTIN_STRATEGIES[baseKey])

    // 低风险高并行 -> 应用"并行快审"覆盖（关闭逐轮验证，缩短轮次）
    if (
      baseKey === 'iterative' && features.parallelRatio >= 0.6 &&
      riskWeight === 0 && complexityWeight <= 2 && features.stepCount >= 3
    ) {
      overrides.push(
        { field: 'verifyEachStep', from: strategy.verifyEachStep, to: false, reason: '低风险高并行，跳过逐轮验证以提速' },
        { field: 'maxRounds', from: strategy.maxRounds, to: STRATEGY_PARALLEL_SWIFT.maxRounds, reason: '低风险高并行，收紧轮次上限' },
      )
      strategy.verifyEachStep = STRATEGY_PARALLEL_SWIFT.verifyEachStep
      strategy.maxRounds = STRATEGY_PARALLEL_SWIFT.maxRounds
      reasons.push('应用组合策略「并行快审」：关闭逐轮验证并收紧轮次。')
    }

    // 按计划规模调整 maxRounds（至少覆盖关键路径长度 + 1）
    const minRounds = Math.max(1, features.criticalDepth + 1)
    if (strategy.maxRounds < minRounds && baseKey !== 'direct') {
      overrides.push({
        field: 'maxRounds', from: strategy.maxRounds, to: minRounds,
        reason: `关键路径深度 ${features.criticalDepth} 需要至少 ${minRounds} 轮`,
      })
      strategy.maxRounds = minRounds
      reasons.push(`上调 maxRounds 至 ${minRounds} 以覆盖关键路径。`)
    }

    // 高风险任务强制打开逐轮验证
    if (riskWeight >= 2 && !strategy.verifyEachStep) {
      overrides.push({
        field: 'verifyEachStep', from: strategy.verifyEachStep, to: true,
        reason: `风险等级 ${risk} 必须逐轮验证`,
      })
      strategy.verifyEachStep = true
      reasons.push('高风险强制打开 verifyEachStep。')
    }

    // 直接回答策略在存在验证步骤时升级为 single_tool（至少一次工具校验）
    if (baseKey === 'direct' && features.stepCount >= 2 && this.planHasVerification(plan)) {
      const upgrade = this.copyStrategy(BUILTIN_STRATEGIES.single_tool)
      overrides.push({
        field: 'name', from: strategy.name, to: upgrade.name,
        reason: '计划含验证步骤，direct 不足以保证质量，升级为 single_tool',
      })
      strategy = upgrade
      reasons.push('计划含验证步骤，direct 升级为 single_tool。')
    }

    // 最终一致性自检：策略字段必须合法
    this.assertValid(strategy)

    return { strategy, scores, reasons, overrides }
  }

  /**
   * 组合两个策略：以 primary 为底，用 secondary 的非默认字段覆盖。
   * 用于上游需要手动合成策略的场景（例如 AB 测试）。
   */
  combine(primary: ExecutionStrategy, secondary: ExecutionStrategy): ExecutionStrategy {
    const result = this.copyStrategy(primary)
    for (const field of this.editableFields) {
      const secondaryValue = secondary[field]
      // 只覆盖"更强"的布尔项与更大的轮次，避免被弱策略拉低
      if (field === 'maxRounds') {
        const p = primary.maxRounds ?? 0
        const s = secondary.maxRounds ?? 0
        result.maxRounds = Math.max(p, s)
      } else if (typeof secondaryValue === 'boolean' && secondaryValue === true) {
        ;(result as unknown as Record<string, unknown>)[field] = true
      }
    }
    // 描述合并，便于解释
    result.description = `${result.description}（组合自 ${secondary.name}）`
    return result
  }

  /**
   * 根据运行时 failure 覆盖策略的 fallback。
   * 返回一个新策略，不修改原对象。
   */
  withFallback(strategy: ExecutionStrategy, fallback: RouteStrategy | null): ExecutionStrategy {
    const result = this.copyStrategy(strategy)
    result.fallbackOnFailure = fallback
    return result
  }

  /* ── 内部工具 ─────────────────────────────────────────── */

  /** 取分数最大者；平局时按固定优先级打破（deep > autonomous > iterative > single_tool > direct） */
  private argmax(scores: StrategyScores): keyof StrategyScores {
    const priority: Array<keyof StrategyScores> = ['deep', 'autonomous', 'iterative', 'single_tool', 'direct']
    let best: keyof StrategyScores = priority[priority.length - 1]
    for (const key of priority) {
      if (scores[key] > scores[best]) best = key
    }
    return best
  }

  /** 浅拷贝策略（常量是 frozen，必须拷贝后才能改） */
  private copyStrategy(source: ExecutionStrategy): ExecutionStrategy {
    return {
      name: source.name,
      description: source.description,
      parallelTools: source.parallelTools,
      maxRounds: source.maxRounds,
      verifyEachStep: source.verifyEachStep,
      allowAutonomy: source.allowAutonomy,
      fallbackOnFailure: source.fallbackOnFailure,
    }
  }

  /**
   * 计划是否包含"需要工具"的验证类步骤。
   * 注意：纯对话模板里的"自检"步骤不带任何工具，属于推理自省，
   * 不应触发 direct -> single_tool 的升级；只有真正要跑工具校验才算。
   */
  private planHasVerification(plan: ExecutionPlan | null | undefined): boolean {
    if (!plan?.steps) return false
    return plan.steps.some((s) =>
      /verify|test|check|qa|lint|validate/i.test(s.id + s.title) && (s.tools?.length ?? 0) > 0,
    )
  }

  /** 策略字段合法性自检 */
  private assertValid(strategy: ExecutionStrategy): void {
    if (typeof strategy.name !== 'string' || strategy.name.length === 0) {
      throw new Error('策略 name 非法')
    }
    if (!Number.isFinite(strategy.maxRounds) || strategy.maxRounds < 1) {
      throw new Error(`策略 maxRounds 非法: ${strategy.maxRounds}`)
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * 工厂函数
 * ───────────────────────────────────────────────────────────── */

/** 默认 picker 实例（无状态，可安全共享） */
export const defaultStrategyPicker = new StrategyPickerImpl()

/**
 * 顶层入口，符合契约中"导出 pickStrategy(analysis, plan): ExecutionStrategy"的约定。
 */
export function pickStrategy(analysis: TaskAnalysis, plan: ExecutionPlan): ExecutionStrategy {
  return defaultStrategyPicker.pick(analysis, plan)
}

/** 可解释版本的便捷包装 */
export function explainStrategy(analysis: TaskAnalysis, plan: ExecutionPlan): StrategyExplanation {
  return defaultStrategyPicker.pickWithExplanation(analysis, plan)
}
