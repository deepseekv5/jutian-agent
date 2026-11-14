/**
 * 模型能力与推荐（v12 新功能）
 *
 * 用户面对几十个模型不知道选哪个。这里做两件事：
 *   1. 从模型名推断能力（视觉/推理/长上下文/代码），不编造——只按明确特征判
 *   2. 按任务类型给推荐（带理由），而不是甩一个排名
 */

export interface ModelCapability {
  vision: boolean
  reasoning: boolean
  /** 上下文窗口（token），未知为 0 */
  contextWindow: number
  /** 是否支持工具调用（绝大多数 chat 模型支持，明确不支持的标注） */
  tools: boolean
  /** 是否免费 */
  free?: boolean
  /** 代码能力偏好（仅用于排序提示，不是绝对结论） */
  codeStrength?: 'high' | 'medium' | 'low' | 'unknown'
}

/** 已知模型的上下文窗口（按基名，宽松匹配） */
const CONTEXT_HINTS: { pattern: RegExp; window: number }[] = [
  { pattern: /gemini-?2\.5/i, window: 1_000_000 },
  { pattern: /gemini-?1\.5/i, window: 1_000_000 },
  { pattern: /claude-(sonnet|opus)-4/i, window: 200_000 },
  { pattern: /claude-3/i, window: 200_000 },
  { pattern: /gpt-4\.1/i, window: 1_000_000 },
  { pattern: /gpt-4o/i, window: 128_000 },
  { pattern: /o3|o4-mini/i, window: 200_000 },
  { pattern: /deepseek/i, window: 64_000 },
  { pattern: /qwen.*(turbo|plus|max)/i, window: 128_000 },
  { pattern: /kimi|moonshot/i, window: 128_000 },
  { pattern: /glm-4/i, window: 128_000 },
  { pattern: /llama.*3/i, window: 128_000 },
]

export function inferCapability(model: string, opts: { free?: boolean } = {}): ModelCapability {
  const m = String(model || '').toLowerCase()
  const window = CONTEXT_HINTS.find((h) => h.pattern.test(m))?.window || 0

  const vision =
    /gpt-4o|gpt-4\.1|o3|o4|claude-(sonnet|opus|haiku)-[34]|gemini|qwen.*(vl|vision)|llava|pixtral|step-3/i.test(m)
  const reasoning =
    /o3|o4|reason|thinking|r1|deepseek-r|qwq|thinking/i.test(m)
  // 少数已知不擅长代码的（不要滥标）
  const codeStrength: ModelCapability['codeStrength'] =
    /claude-(sonnet|opus)-4|gpt-4\.1|o3|deepseek|qwen.*coder|codestral|sonnet/i.test(m) ? 'high'
      : /mini|flash|haiku|small|nano/i.test(m) ? 'medium'
        : 'unknown'

  return { vision, reasoning, contextWindow: window, tools: true, free: opts.free, codeStrength }
}

export type TaskKind = 'chat' | 'code' | 'longdoc' | 'vision' | 'reasoning' | 'cheap'

export interface ModelCandidate {
  id: string
  name?: string
  provider?: string
  free?: boolean
}

export interface Recommendation {
  model: ModelCandidate
  reason: string
  score: number
}

/** 按任务给推荐；分数只用于排序，理由单独给，避免"黑箱排名" */
export function recommendModels(models: ModelCandidate[], task: TaskKind, limit = 3): Recommendation[] {
  const scored = models.map((m) => {
    const cap = inferCapability(m.id || m.name || '', { free: m.free })
    let score = 0
    const reasons: string[] = []

    if (task === 'vision') {
      if (cap.vision) { score += 50; reasons.push('支持看图') }
      else score -= 100
    }
    if (task === 'reasoning') {
      if (cap.reasoning) { score += 40; reasons.push('带推理能力') }
    }
    if (task === 'longdoc') {
      if (cap.contextWindow >= 200_000) { score += 50; reasons.push(`上下文 ${Math.round(cap.contextWindow / 1000)}K`) }
      else if (cap.contextWindow >= 128_000) { score += 25; reasons.push('上下文 128K') }
    }
    if (task === 'code') {
      if (cap.codeStrength === 'high') { score += 40; reasons.push('代码能力强') }
      else if (cap.codeStrength === 'medium') score += 10
    }
    if (task === 'cheap') {
      if (cap.free) { score += 60; reasons.push('免费') }
      // 小模型通常更便宜
      if (/mini|flash|haiku|small|nano|turbo/i.test(m.id)) { score += 20; reasons.push('轻量低价') }
    }
    if (task === 'chat') {
      score += 5
      if (cap.contextWindow >= 128_000) reasons.push('上下文充足')
    }
    if (!reasons.length) reasons.push('通用可用')

    return { model: m, reason: reasons.slice(0, 2).join('、'), score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || String(a.model.id).localeCompare(String(b.model.id)))
    .slice(0, limit)
}

/** 从模型列表里挑出"最可能适合当前对话"的（用于首次选择时的默认值） */
export function pickDefaultModel(models: ModelCandidate[]): ModelCandidate | null {
  if (!models.length) return null
  // 优先免费 + 带上下文的；否则第一个
  const free = models.find((m) => m.free)
  return free || models[0]
}

export const TASK_LABEL: Record<TaskKind, { label: string; hint: string }> = {
  chat: { label: '日常对话', hint: '均衡即可' },
  code: { label: '写代码', hint: '优先代码能力强的模型' },
  longdoc: { label: '长文档', hint: '需要大上下文' },
  vision: { label: '看图', hint: '必须支持视觉' },
  reasoning: { label: '深度思考', hint: '需要推理模型' },
  cheap: { label: '省钱', hint: '优先免费或轻量模型' },
}
