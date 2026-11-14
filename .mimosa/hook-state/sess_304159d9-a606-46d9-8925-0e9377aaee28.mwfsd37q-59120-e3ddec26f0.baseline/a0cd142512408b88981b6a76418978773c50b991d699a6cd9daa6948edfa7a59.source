// 思考内容（reasoning）的字段名归一化。
//
// 各家上游对"模型思考过程"的字段命名不统一，实测遇到的：
//   · reasoning_content   —— DeepSeek / step 系列
//   · reasoning           —— OpenCode Zen（OpenRouter 风格）
//   · reasoning_details   —— OpenRouter 的结构化形式（数组，每项带 text）
//   · thinking            —— 部分网关
//
// 只认其中一个的后果是实打实的：接了 OpenCode Zen 之后，模型明明在思考
// （上游确实在推 reasoning 分片），界面上却完全看不到思考过程，
// 看起来像"这个模型不推理"。所以统一走这里，别各处各写一份。

/** 从一个 delta / message 对象里取出思考文本（取不到返回空串） */
export function extractReasoning(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const o = obj as Record<string, unknown>

  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const v = o[key]
    if (typeof v === 'string' && v) return v
  }

  // OpenRouter 的结构化形式：取每段 text 拼接
  const details = o.reasoning_details
  if (Array.isArray(details)) {
    let out = ''
    for (const d of details) {
      if (d && typeof d === 'object' && typeof (d as { text?: unknown }).text === 'string') {
        out += (d as { text: string }).text
      }
    }
    if (out) return out
  }

  return ''
}

/** 该对象是否带任何形式的思考内容（用于判断"模型是否在思考"） */
export function hasReasoning(obj: unknown): boolean {
  return extractReasoning(obj).length > 0
}
