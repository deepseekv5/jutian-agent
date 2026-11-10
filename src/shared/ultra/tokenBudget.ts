/**
 * JT Core Ultra / tokenBudget —— gemini-cli core/tokenLimits.ts + contextBudget 移植
 * 模型 token 上限表、max_tokens 钳制、输入预算 80% 裁剪、工具输出占比守卫。
 * 零依赖（Apache-2.0）。
 */
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gpt-5': 400_000,
  'claude': 200_000,
  'deepseek': 128_000,
  'qwen': 131_072,
  'kimi': 262_144,
  'glm': 128_000,
  'spark': 128_000,
}
export const DEFAULT_CONTEXT_WINDOW = 128_000
export const INPUT_BUDGET_RATIO = 0.8
export const OUTPUT_RESERVE_RATIO = 0.06

export function resolveContextWindow(model: string, declared?: number): number {
  if (declared && declared > 0) return declared
  const m = String(model || '').toLowerCase()
  for (const [k, v] of Object.entries(MODEL_TOKEN_LIMITS)) if (m.includes(k)) return v
  return DEFAULT_CONTEXT_WINDOW
}
export function inputBudget(contextWindow: number): number {
  return Math.floor(contextWindow * INPUT_BUDGET_RATIO)
}
export function maxOutputTokens(contextWindow: number): number {
  return Math.max(1024, Math.min(8192, Math.floor(contextWindow * OUTPUT_RESERVE_RATIO)))
}
/** 输入裁剪：从头部丢消息直到预算内（系统消息永远保留） */
export function trimToBudget<T extends { role: string; content?: string }>(messages: T[], contextWindow: number, estimate: (msgs: T[]) => number): { messages: T[]; dropped: number } {
  const budget = inputBudget(contextWindow)
  const out = [...messages]
  let dropped = 0
  while (out.length > 1 && estimate(out) > budget) {
    // 保留第一条 system，丢最老的非 system
    let i = 0
    while (i < out.length && out[i].role === 'system') i++
    if (i >= out.length) break
    out.splice(i, 1); dropped++
  }
  return { messages: out, dropped }
}
