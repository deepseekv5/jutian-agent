/**
 * 上下文 Token 估算（近似值）
 * 中文/全角字符 ≈ 1 token，其余 ≈ 4 字符 1 token
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if ((code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) cjk++
  }
  const other = text.length - cjk
  return Math.ceil(cjk + other / 4)
}

/** 默认上下文窗口：1M tokens */
export const CONTEXT_LIMIT = 1_000_000

/** 按模型名推断真实上下文窗口（设置里手动填的 contextWindow 优先于它） */
export function guessModelContext(model?: string): number {
  const m = (model || '').toLowerCase()
  const has = (...keys: string[]) => keys.some(k => m.includes(k))
  if (has('gpt-4o', 'gpt-4.1', 'gpt-4-turbo')) return 128_000
  if (has('o1', 'o3', 'o4-mini')) return 200_000
  if (has('gpt-3.5')) return 16_000
  if (has('claude')) return 200_000
  if (has('gemini-1.5', 'gemini-2')) return 1_000_000
  if (has('deepseek-v4', 'deepseek-v3', 'deepseek-chat', 'deepseek-r2')) return 128_000
  if (has('deepseek')) return 64_000
  if (has('kimi-k3', 'moonshot-v1-128')) return 128_000
  if (has('moonshot-v1-32')) return 32_000
  if (has('moonshot')) return 128_000
  if (has('qwen3', 'qwen2.5-72', 'qwen-vl-max')) return 128_000
  if (has('qwen')) return 32_000
  if (has('glm-5', 'glm-4.5', 'glm-4-plus')) return 128_000
  if (has('glm-4')) return 128_000
  if (has('step-3.7', 'step-3', 'step-explore', 'step-router')) return 1_000_000
  if (has('kimi')) return 128_000
  if (has('longcat')) return 128_000
  if (has('spark')) return 128_000
  if (has('sensenova')) return 128_000
  if (has('minimax')) return 1_000_000
  if (has('llama')) return 128_000
  return CONTEXT_LIMIT
}

/** 格式化 token 数：1234 → 1.2K，1234567 → 1.2M */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

/** 格式化百分比：<0.1% 时显示 <0.1% */
export function fmtPercent(frac: number): string {
  if (frac > 0 && frac < 0.001) return '<0.1%'
  return (frac * 100).toFixed(1) + '%'
}
