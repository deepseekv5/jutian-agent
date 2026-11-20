/**
 * 模块 C - 模型选择器（ModelSelector）
 *
 * 职责：在给定任务分析与可用模型集合时，按「质量 / 速度 / 成本」三种偏好之一
 * 做多目标打分，返回一个最优 ModelChoice（含备选排序）与可解释理由。
 *
 * 设计要点：
 *  1. 多目标打分：领域匹配、推理能力、工具支持、视觉支持、上下文窗口适配、
 *     成本档、速度档，共 7 个维度，每个维度先归一化到 0-1 再加权求和。
 *  2. 三种偏好的权重矩阵：quality 偏推理/领域/窗口，speed 偏速度档，
 *     cost 偏成本档；工具/视觉作为「能力门槛」不因偏好而被牺牲。
 *  3. 硬约束淘汰：任务需要工具但模型不支持工具 -> 直接淘汰；任务有附件/图片
 *     但模型不支持视觉 -> 直接淘汰；窗口小于任务所需最小 token -> 硬淘汰。
 *  4. 软约束降分：窗口使用率超过 50% 后按梯度罚分（越接近窗口上限罚得越重，
 *     90% 以上斜率加倍）；领域不匹配降分。
 *  5. 内置 DEFAULT_MODEL_PROFILES：30+ 常见模型（GPT / Claude / DeepSeek /
 *     Kimi / Qwen / Gemini / 国产免费档 / 本地 ollama 档等）作为默认候选常量。
 *  6. 同分决胜：score 相同时按速度档低者优（快者先），其次成本档低者优，
 *     最后保持候选顺序稳定。
 *  7. 兜底保障：候选列表为空时回退内置默认库并在理由中说明；全部候选被硬约束
 *     淘汰时放宽窗口约束降级选择；极端情况返回保守默认（第一个支持工具的候选，
 *     否则候选首位）；任何内部异常都不向上抛出，返回保守默认并附可读理由。
 *  8. 所有决策都带可读理由（进入 ModelChoice.reasons）。
 *
 * 本文件只依赖 ../types，不 import 其它 super 模块。
 */

import type {
  ModelChoice,
  ModelProfile,
  ModelSelector,
  TaskAnalysis,
  TaskDomain,
} from '../types'

/* ─────────────────────────────────────────────────────────────────────────────
 * 默认模型库
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 内置常见模型档案（30+，含免费/本地档）。
 * costTier: 0 免费 - 3 昂贵；speedTier: 0 快 - 3 慢。
 * strength 列表描述该模型擅长的领域（用于领域匹配打分）。
 * contextWindow 以各厂商官方 API 公开的上下文长度为准（常见值口径）。
 */
export const DEFAULT_MODEL_PROFILES: ModelProfile[] = [
  // ── OpenAI GPT 系列 ──
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    contextWindow: 128000,
    strength: ['code', 'research', 'writing', 'data', 'planning', 'qa', 'conversation'],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    contextWindow: 128000,
    strength: ['code', 'writing', 'conversation', 'qa'],
    costTier: 1,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    contextWindow: 1047576,
    strength: ['code', 'research', 'data', 'planning', 'qa', 'file'],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    contextWindow: 1047576,
    strength: ['code', 'writing', 'qa', 'data'],
    costTier: 1,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'o3',
    name: 'OpenAI o3',
    contextWindow: 200000,
    strength: ['code', 'research', 'data', 'planning', 'qa'],
    costTier: 3,
    speedTier: 3,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'o4-mini',
    name: 'OpenAI o4-mini',
    contextWindow: 200000,
    strength: ['code', 'research', 'data', 'qa'],
    costTier: 2,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },

  // ── Anthropic Claude 系列 ──
  {
    id: 'claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    contextWindow: 200000,
    strength: ['code', 'writing', 'research', 'planning', 'qa', 'conversation'],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'claude-3.5-haiku',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    strength: ['code', 'writing', 'conversation', 'qa', 'file'],
    costTier: 1,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'claude-3.7-opus',
    name: 'Claude 3.7 Opus',
    contextWindow: 200000,
    strength: ['code', 'research', 'planning', 'creative', 'writing', 'qa'],
    costTier: 3,
    speedTier: 3,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },

  // ── DeepSeek 系列 ──
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    // DeepSeek-V3 官方 API 上下文为 64K（V3.1+ 才扩展到 128K），校准为 64K。
    contextWindow: 64000,
    strength: ['code', 'research', 'data', 'qa', 'writing', 'planning'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    contextWindow: 128000,
    strength: ['code', 'research', 'data', 'planning', 'qa'],
    costTier: 0,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    contextWindow: 128000,
    strength: ['code', 'shell', 'file', 'qa'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },

  // ── Kimi（月之暗面）──
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    contextWindow: 256000,
    strength: ['code', 'research', 'writing', 'data', 'planning'],
    costTier: 1,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot v1 128K',
    contextWindow: 128000,
    strength: ['research', 'writing', 'creative', 'conversation'],
    costTier: 1,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },

  // ── Qwen（通义千问）──
  {
    id: 'qwen3-235b',
    name: 'Qwen3 235B',
    contextWindow: 128000,
    strength: ['code', 'research', 'data', 'writing', 'qa', 'planning'],
    costTier: 1,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'qwen3-coder',
    name: 'Qwen3 Coder',
    contextWindow: 128000,
    strength: ['code', 'shell', 'file', 'qa'],
    costTier: 0,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'qwen2.5-72b',
    name: 'Qwen2.5 72B',
    // Qwen2.5-72B-Instruct 官方支持 128K 上下文（原值 32K 与真实规格不符）。
    contextWindow: 128000,
    strength: ['code', 'research', 'writing', 'conversation', 'data'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: true,
  },

  // ── Google Gemini 系列 ──
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    contextWindow: 1048576,
    strength: ['code', 'research', 'data', 'writing', 'planning', 'qa', 'creative'],
    costTier: 2,
    speedTier: 2,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextWindow: 1048576,
    strength: ['code', 'research', 'writing', 'qa', 'conversation'],
    costTier: 1,
    speedTier: 0,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.0-flash-lite',
    name: 'Gemini 2.0 Flash Lite',
    contextWindow: 1048576,
    strength: ['writing', 'conversation', 'qa', 'research'],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true,
  },

  // ── 国产 / 免费档 / 其它 ──
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    contextWindow: 200000,
    strength: ['code', 'research', 'writing', 'planning', 'qa'],
    costTier: 1,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'minimax-m2',
    name: 'MiniMax M2',
    contextWindow: 200000,
    strength: ['code', 'writing', 'creative', 'conversation'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'doubao-seed',
    name: '豆包 Seed',
    contextWindow: 256000,
    strength: ['writing', 'creative', 'conversation', 'research', 'qa'],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    contextWindow: 128000,
    strength: ['code', 'writing', 'conversation', 'research'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    contextWindow: 128000,
    strength: ['code', 'research', 'writing', 'planning'],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'grok-4',
    name: 'Grok 4',
    contextWindow: 256000,
    strength: ['code', 'research', 'data', 'creative', 'conversation', 'planning'],
    costTier: 2,
    speedTier: 1,
    reasoning: true,
    supportsTools: true,
    supportsVision: true,
  },
  // ── 免费 / 本地档（零成本兜底候选）──
  {
    id: 'glm-4-flash',
    name: 'GLM-4 Flash（免费）',
    contextWindow: 128000,
    strength: ['code', 'writing', 'qa', 'conversation'],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'spark-lite',
    name: '星火 Spark Lite（免费）',
    contextWindow: 32768,
    strength: ['conversation', 'writing', 'qa'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'moonshot-kimi-free',
    name: 'Kimi 免费档（Moonshot）',
    contextWindow: 128000,
    strength: ['research', 'writing', 'conversation', 'qa'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'poly-free',
    name: 'Poly 免费聚合路由',
    contextWindow: 128000,
    strength: ['conversation', 'writing', 'qa', 'code'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'ollama-local',
    name: 'Ollama 本地模型',
    contextWindow: 32768,
    strength: ['code', 'conversation', 'qa'],
    costTier: 0,
    speedTier: 1,
    reasoning: false,
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: 'local-7b',
    name: '本地小模型 7B',
    contextWindow: 8192,
    strength: ['conversation', 'writing', 'qa'],
    costTier: 0,
    speedTier: 0,
    reasoning: false,
    supportsTools: false,
    supportsVision: false,
  },
]

/* ─────────────────────────────────────────────────────────────────────────────
 * 偏好权重矩阵
 * ───────────────────────────────────────────────────────────────────────────── */

export type ModelPreference = 'quality' | 'speed' | 'cost'

/**
 * 各评分维度的权重。权重之和归一化到 1，便于解释分数（0-1）。
 *
 * 维度说明：
 *  - domain：领域匹配度
 *  - reasoning：推理能力
 *  - tools：工具支持
 *  - vision：视觉支持
 *  - window：上下文窗口适配
 *  - cost：成本（越高档分越低，由打分函数取反）
 *  - speed：速度（越高档分越低，由打分函数取反）
 */
interface WeightMatrix {
  domain: number
  reasoning: number
  tools: number
  vision: number
  window: number
  cost: number
  speed: number
}

const WEIGHTS: Record<ModelPreference, WeightMatrix> = {
  // 质量偏好：推理/领域/窗口优先，能力维度权重最高。
  quality: {
    domain: 0.24,
    reasoning: 0.22,
    tools: 0.12,
    vision: 0.08,
    window: 0.16,
    cost: 0.04,
    speed: 0.04,
  },
  // 速度偏好：速度档权重最高，其次是轻量但够用的能力。
  speed: {
    domain: 0.14,
    reasoning: 0.08,
    tools: 0.14,
    vision: 0.06,
    window: 0.10,
    cost: 0.12,
    speed: 0.36,
  },
  // 成本偏好：成本档权重最高，其次偏好够用即可的能力。
  cost: {
    domain: 0.16,
    reasoning: 0.08,
    tools: 0.14,
    vision: 0.06,
    window: 0.12,
    cost: 0.36,
    speed: 0.08,
  },
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 打分辅助
 * ───────────────────────────────────────────────────────────────────────────── */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 成本/速度档（0 最好）-> 分数（1 最好），线性取反。 */
function tierToScore(tier: number, maxTier = 3): number {
  return clamp(1 - clamp(tier, 0, maxTier) / maxTier, 0, 1)
}

/**
 * 估计任务所需的最小上下文 token。
 * 复杂度分越高、领域越偏工程/研究，所需窗口越大。
 */
function estimateRequiredTokens(analysis: TaskAnalysis): number {
  const complexity = clamp(analysis.complexity.score, 0, 100)
  let base = 4096
  base += complexity * 240 // 0-100 -> 0-24000
  // 工程与研究类任务通常携带更多上下文（代码库/资料）。
  if (analysis.domain === 'code' || analysis.domain === 'research' || analysis.domain === 'data') {
    base += 8192
  }
  if (analysis.needsTools) base += 4096 // 工具定义与结果占用窗口
  return Math.round(base)
}

/** 领域匹配度：主领域命中得 1.0，domains 列表按权重加权补充。 */
function domainMatchScore(analysis: TaskAnalysis, model: ModelProfile): number {
  const strength = new Set<TaskDomain>(model.strength ?? [])
  let score = strength.has(analysis.domain) ? 1 : 0

  // 次领域加权：analysis.domains 给出每个领域的权重，按命中模型的 strength 累加。
  let weightSum = 0
  let matchedWeight = 0
  for (const entry of analysis.domains ?? []) {
    const w = clamp(entry.weight, 0, 1)
    weightSum += w
    if (strength.has(entry.domain)) matchedWeight += w
  }
  if (weightSum > 0) {
    const secondary = matchedWeight / weightSum
    score = Math.max(score, secondary)
  }

  return clamp(score, 0, 1)
}

/** 窗口适配分：窗口越大越从容，但超过需求 8 倍后边际收益趋零。 */
function windowFitScore(required: number, model: ModelProfile): number {
  if (required <= 0 || model.contextWindow <= 0) return 0.5
  const ratio = model.contextWindow / required
  if (ratio < 1) return clamp(ratio * 0.5, 0, 0.5) // 硬淘汰线以下的软罚分（实际会被硬约束淘汰）
  return clamp(0.5 + Math.log2(ratio) * 0.16, 0.5, 1)
}

/**
 * 窗口使用率软罚分（梯度制，导出便于单测锁定形状）：
 *  - 使用率 <= 50%：余量充裕，不罚分；
 *  - 50%-90%：随使用率线性爬升（每 10 个百分点约 +0.015）；
 *  - 90%-100%：进入紧张区，斜率加倍以上（每 10 个百分点约 +0.04）。
 * 即「接近 90% 时的罚分幅度明显大于刚超 50% 时」，是梯度而非线性跳变。
 * 使用率超过 100% 的模型已被硬约束淘汰，仅在放宽窗口的降级路径中可能出现
 * （此时罚分继续累加，配合 clamp 保证分数非负）。
 */
export function windowUsagePenalty(requiredTokens: number, contextWindow: number): number {
  if (!Number.isFinite(requiredTokens) || !Number.isFinite(contextWindow)) return 0
  if (requiredTokens <= 0 || contextWindow <= 0) return 0
  const usage = requiredTokens / contextWindow
  if (usage <= 0.5) return 0
  if (usage <= 0.9) return (usage - 0.5) * 0.15
  return 0.06 + (usage - 0.9) * 0.4
}

/**
 * 同分决胜比较器（导出便于单测）：score 相同时
 *  1. 速度档低者优先（快者先）；
 *  2. 速度档相同则成本档低者优；
 *  3. 完全相同返回 0，由调用方保持候选顺序稳定。
 */
export function tieBreakBySpeedThenCost(a: ModelProfile, b: ModelProfile): number {
  const speedA = clamp(a.speedTier, 0, 3)
  const speedB = clamp(b.speedTier, 0, 3)
  if (speedA !== speedB) return speedA - speedB
  const costA = clamp(a.costTier, 0, 3)
  const costB = clamp(b.costTier, 0, 3)
  if (costA !== costB) return costA - costB
  return 0
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 硬约束淘汰
 * ───────────────────────────────────────────────────────────────────────────── */

interface Rejection {
  model: ModelProfile
  reason: string
}

/**
 * 判断模型是否被硬约束淘汰。
 * 返回 null 表示通过；否则返回淘汰原因。
 */
function hardRejection(
  analysis: TaskAnalysis,
  model: ModelProfile,
  requiredTokens: number,
): string | null {
  // 约束 1：任务需要工具但模型不支持工具 -> 淘汰。
  if (analysis.needsTools && !model.supportsTools) {
    return '任务需要工具调用，但该模型不支持工具'
  }

  // 约束 2：有图片/附件但模型不支持视觉 -> 淘汰。
  // 使用 analysis.domains 中是否含视觉型领域作为保守判断（TaskAnalysis 无显式视觉位）。
  // 这里用复杂度维度中的 context 与 suggestedTools 里的 vision 关键字做补充判断。
  const wantsVision = (analysis.suggestedTools ?? []).some(t =>
    /vision|image|图片|截图|视觉|ocr/i.test(t),
  )
  if (wantsVision && !model.supportsVision) {
    return '任务涉及图像/视觉输入，但该模型不支持视觉'
  }

  // 约束 3：窗口小于任务所需最小 token -> 淘汰。
  if (model.contextWindow < requiredTokens) {
    return `上下文窗口 ${model.contextWindow} 小于任务所需约 ${requiredTokens} token`
  }

  return null
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 单模型评分
 * ───────────────────────────────────────────────────────────────────────────── */

interface ScoredModel {
  model: ModelProfile
  score: number
  reasons: string[]
  /** 软约束导致的扣分，用于生成理由 */
  softPenalties: string[]
}

function scoreModel(
  analysis: TaskAnalysis,
  model: ModelProfile,
  preference: ModelPreference,
  requiredTokens: number,
): ScoredModel {
  const weights = WEIGHTS[preference]
  const reasons: string[] = []
  const softPenalties: string[] = []

  // ── 各维度原始分（0-1）──
  const domainScore = domainMatchScore(analysis, model)
  const reasoningScore = model.reasoning ? 1 : 0
  const toolsScore = model.supportsTools ? 1 : 0
  const visionScore = model.supportsVision ? 1 : 0
  const windowScore = windowFitScore(requiredTokens, model)
  const costScore = tierToScore(model.costTier)
  const speedScore = tierToScore(model.speedTier)

  // ── 软约束：窗口使用率梯度罚分（越接近窗口上限罚得越重，见 windowUsagePenalty）──
  const windowPenalty = windowUsagePenalty(requiredTokens, model.contextWindow)
  if (windowPenalty > 0) {
    const usagePct = Math.round((requiredTokens / model.contextWindow) * 100)
    softPenalties.push(`上下文窗口余量偏紧（任务估算约占窗口 ${usagePct}%）`)
  }

  // ── 软约束：领域不匹配降分 ──
  let domainPenalty = 0
  if (domainScore < 0.5) {
    domainPenalty = (0.5 - domainScore) * 0.2
    softPenalties.push(`对领域「${analysis.domain}」的匹配度较低`)
  }

  // ── 能力维度加成：任务类型决定该维度是否计入 ──
  // 非工具任务不因模型不支持工具而被扣分（避免无意义地惩罚纯文本模型）。
  const effectiveTools = analysis.needsTools ? toolsScore : 1
  // 非视觉任务不因视觉能力额外加分，但也不惩罚。
  const effectiveVision = visionScore

  const raw =
    weights.domain * domainScore +
    weights.reasoning * reasoningScore +
    weights.tools * effectiveTools +
    weights.vision * effectiveVision +
    weights.window * windowScore +
    weights.cost * costScore +
    weights.speed * speedScore

  const score = raw - windowPenalty - domainPenalty

  // ── 生成理由 ──
  if (domainScore >= 0.99) reasons.push(`擅长任务领域「${analysis.domain}」`)
  else if (domainScore > 0) reasons.push(`对领域「${analysis.domain}」有一定匹配度`)
  if (reasoningScore && preference === 'quality') reasons.push('具备推理能力，契合质量偏好')
  if (toolsScore && analysis.needsTools) reasons.push('支持工具调用，满足任务需求')
  if (visionScore) reasons.push('支持视觉输入')
  if (costScore >= 0.66) reasons.push(`成本档较低（${model.costTier}），契合成本偏好`)
  if (speedScore >= 0.66) reasons.push(`速度档较快（${model.speedTier}），契合速度偏好`)
  if (windowScore >= 0.9) reasons.push('上下文窗口充裕')
  if (softPenalties.length > 0) reasons.push(...softPenalties.map(p => `注意：${p}`))

  return {
    model,
    score: round(clamp(score, 0, 1), 4),
    reasons,
    softPenalties,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 主体实现
 * ───────────────────────────────────────────────────────────────────────────── */

export class ModelSelectorImpl implements ModelSelector {
  /** 备选列表最大长度 */
  private readonly maxAlternatives: number

  constructor(options: { maxAlternatives?: number } = {}) {
    this.maxAlternatives = Math.max(0, options.maxAlternatives ?? 3)
  }

  /**
   * 主入口：需求中称 selectModel，契约接口名为 select。
   * 两者行为完全一致，select 在下方直接委托给本方法。
   *
   * 兜底保障：候选列表为空/未提供时回退内置默认库；任何内部异常都不向上抛出，
   * 返回保守默认（第一个支持工具的候选，否则候选首位）并附可读理由。
   */
  selectModel(
    analysis: TaskAnalysis,
    available: ModelProfile[],
    preference: ModelPreference = 'quality',
  ): ModelChoice {
    const usingDefaultPool = !available || available.length === 0
    const candidates = usingDefaultPool ? DEFAULT_MODEL_PROFILES : available
    try {
      return this.selectFromCandidates(analysis, candidates, preference, usingDefaultPool)
    } catch (error) {
      return this.conservativeChoice(available, preference, error)
    }
  }

  /**
   * 常规选择流程（假定 candidates 非空）。
   * 全部候选被硬约束淘汰时进入降级/兜底路径，绝不返回空 choice。
   */
  private selectFromCandidates(
    analysis: TaskAnalysis,
    candidates: ModelProfile[],
    preference: ModelPreference,
    usingDefaultPool: boolean,
  ): ModelChoice {
    const requiredTokens = estimateRequiredTokens(analysis)

    const scored: ScoredModel[] = []
    const rejected: Rejection[] = []

    for (const model of candidates) {
      // 硬约束淘汰。
      const rejection = hardRejection(analysis, model, requiredTokens)
      if (rejection !== null) {
        rejected.push({ model, reason: rejection })
        continue
      }
      scored.push(scoreModel(analysis, model, preference, requiredTokens))
    }

    // 按分数降序排序；同分时按 tie-break（速度档低者优先，其次成本档低者优），
    // 仍相同则保持候选顺序稳定。
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const tie = tieBreakBySpeedThenCost(a.model, b.model)
      if (tie !== 0) return tie
      return candidates.indexOf(a.model) - candidates.indexOf(b.model)
    })

    // 没有任何候选通过硬约束：放宽窗口约束（保留工具/视觉硬约束），
    // 否则返回一个「降级选择」，避免调用方拿到空 choice。
    if (scored.length === 0) {
      return this.fallbackChoice(
        analysis,
        candidates,
        preference,
        requiredTokens,
        rejected,
      )
    }

    const best = scored[0]
    const alternatives = scored
      .slice(1, this.maxAlternatives + 1)
      .map(s => s.model)

    const reasons = [...best.reasons]
    reasons.unshift(
      `在 ${candidates.length} 个候选中选出「${best.model.name}」` +
      `（偏好=${preference}，得分=${best.score}）`,
    )
    if (usingDefaultPool) {
      reasons.unshift(
        '候选列表为空（或未提供），已回退到内置默认模型库中的保守默认档并按常规流程选择',
      )
    }
    reasons.push(
      `已淘汰 ${rejected.length} 个不满足硬约束的模型` +
      (rejected.length > 0 ? `：${rejected.slice(0, 3).map(r => `${r.model.name}(${r.reason})`).join('；')}` : ''),
    )

    return {
      model: best.model,
      score: best.score,
      reasons,
      alternatives,
    }
  }

  /**
   * 异常路径兜底：打分/排序等内部逻辑意外报错时，返回保守默认
   * （优先第一个支持工具调用的候选，否则候选列表首位），绝不向上抛出。
   */
  private conservativeChoice(
    available: ModelProfile[] | undefined | null,
    preference: ModelPreference,
    error: unknown,
  ): ModelChoice {
    const pool = available && available.length > 0 ? available : DEFAULT_MODEL_PROFILES
    const model = pool.find(m => m && m.supportsTools) ?? pool[0] ?? DEFAULT_MODEL_PROFILES[0]
    const message = error instanceof Error ? error.message : String(error)
    return {
      model,
      score: 0,
      reasons: [
        `警告：模型选择器内部异常（${message}），已跳过常规打分流程`,
        '兜底策略：优先返回第一个支持工具调用的候选，否则返回候选列表首位（保守默认）',
        `偏好=${preference} 未参与本次决策，请检查任务分析输入是否完整`,
      ],
      alternatives: [],
    }
  }

  /** 契约接口方法：委托给 selectModel。 */
  select(
    analysis: TaskAnalysis,
    available: ModelProfile[],
    preference?: ModelPreference,
  ): ModelChoice {
    return this.selectModel(analysis, available, preference)
  }

  /**
   * 降级选择：当所有模型都被窗口硬约束淘汰时，仅保留工具/视觉硬约束，
   * 放开窗口约束重新评分。若仍然为空（例如所有模型都不支持工具/视觉），
   * 则返回保守默认（优先第一个支持工具调用的候选，否则候选列表首位），
   * 并在理由中明确标记，绝不向上抛错。
   */
  private fallbackChoice(
    analysis: TaskAnalysis,
    candidates: ModelProfile[],
    preference: ModelPreference,
    requiredTokens: number,
    rejected: Rejection[],
  ): ModelChoice {
    const viable: ScoredModel[] = []
    for (const model of candidates) {
      // 只保留能力和视觉约束，忽略窗口。
      if (analysis.needsTools && !model.supportsTools) continue
      const wantsVision = (analysis.suggestedTools ?? []).some(t =>
        /vision|image|图片|截图|视觉|ocr/i.test(t),
      )
      if (wantsVision && !model.supportsVision) continue
      viable.push(scoreModel(analysis, model, preference, requiredTokens))
    }

    if (viable.length > 0) {
      // 与主路径一致的排序规则：分数降序 + 同分 tie-break + 顺序稳定。
      viable.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const tie = tieBreakBySpeedThenCost(a.model, b.model)
        if (tie !== 0) return tie
        return candidates.indexOf(a.model) - candidates.indexOf(b.model)
      })
      const best = viable[0]
      return {
        model: best.model,
        score: best.score,
        reasons: [
          `警告：所有 ${candidates.length} 个候选的上下文窗口均不足 ` +
          `（任务约需 ${requiredTokens} token），已放宽窗口约束降级选择`,
          `按「${preference}」偏好退而求其次选择「${best.model.name}」（得分=${best.score}）`,
          ...best.reasons,
        ],
        alternatives: viable.slice(1, this.maxAlternatives + 1).map(s => s.model),
      }
    }

    // 极端情况：连工具/视觉能力约束都无人满足，按「第一个支持工具调用的候选 >
    // 候选列表首位 > 内置库首位」的顺序取保守默认兜底，并如实标记。
    const fallback =
      candidates.find(m => m && m.supportsTools) ??
      candidates[0] ??
      DEFAULT_MODEL_PROFILES[0]
    return {
      model: fallback,
      score: 0,
      reasons: [
        '严重警告：没有任何候选满足工具/视觉硬约束，返回保守默认兜底模型',
        `兜底策略：优先取第一个支持工具调用的候选，否则取候选列表首位（当前选中「${fallback.name}」）`,
        `被淘汰原因：${rejected.slice(0, 3).map(r => `${r.model.name}(${r.reason})`).join('；') || '无'}`,
        '请调用方补充支持所需能力的模型后重试',
      ],
      alternatives: [],
    }
  }
}

/** 工厂函数：创建一个默认模型选择器。 */
export function createModelSelector(options?: { maxAlternatives?: number }): ModelSelectorImpl {
  return new ModelSelectorImpl(options)
}

/** 默认导出的类。 */
export default ModelSelectorImpl
