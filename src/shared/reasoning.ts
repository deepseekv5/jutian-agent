// 思考内容（reasoning）的字段名归一化 + <think> 标签容错。
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
//
// v18.1.1 新增 <think> 标签容错：部分网关会把 `<think>` / `</think>` 包裹
// 标签原样混进思考或正文字段。extractReasoning 保持无状态（签名不变），
// 只能剥离【单个字符串内】的完整标签；标签被网络分片切碎（如 `<thi` + `nk>`）
// 属于跨 chunk 问题，无状态函数无法解决 —— 用 createThinkTagStream 缓冲处理。

/** think 标签常量：部分网关把标签原样混进思考/正文字段 */
const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

/**
 * 无状态剥离完整 <think> / </think> 标签（保留内部文本，不做 trim，
 * 避免吃掉相邻 chunk 拼接时的合法首尾空格）。
 * 用于整段文本；跨 chunk 被切碎的标签交给 createThinkTagStream。
 */
export function stripThinkTags(text: string): string {
  if (!text || !text.includes('<')) return text
  return text.split(THINK_OPEN).join('').split(THINK_CLOSE).join('')
}

/** 跨 chunk 的 <think> 标签流式剥离器 */
export interface ThinkTagStream {
  /** 喂入一个 chunk，返回该 chunk 里应视为思考文本的部分（标签本身被吃掉，哪怕被切碎） */
  push(chunk: string): string
  /** 流结束：冲刷缓冲里疑似标签前缀的残包（按普通文本处理，避免丢字） */
  flush(): string
}

/**
 * 创建一个跨 chunk 的思考标签剥离流。
 *
 * 为什么必须有状态：extractReasoning 按 delta 无状态取值，单个 chunk 里的
 * `<thi` 与真文本 `a < b` 的 `<` 无法区分 —— 标签跨 chunk 分割只能靠
 * 跨 chunk 缓冲解决（按 chunk 独立匹配必然漏）。
 *
 * 语义（对齐 reasoning 字段的使用习惯）：
 *  - 默认处于"思考态"：文本原样产出，标签本身（哪怕被切成几段）不产出
 *  - 出现 </think> 后进入正文态：后续文本不再产出（那是答案，不是思考）
 *  - 正文态再遇 <think> 可重新进入思考态（多段思考也能吃）
 */
export function createThinkTagStream(): ThinkTagStream {
  let inside = true
  let pending = '' // 疑似标签前缀的尾部缓冲，等后续 chunk 补全后再判定

  // 在 s 的 i 位置尝试匹配标签：full = 完整命中；partial = s 已到结尾、
  // 剩余部分恰是标签前缀（可能被网络分片切断）；none = 不是标签
  const matchTag = (s: string, i: number, tag: string): 'full' | 'partial' | 'none' => {
    const rest = s.slice(i)
    if (rest.startsWith(tag)) return 'full'
    if (tag.startsWith(rest)) return 'partial'
    return 'none'
  }

  const scan = (s: string, out: string[]): void => {
    let i = 0
    for (;;) {
      const lt = s.indexOf('<', i)
      if (lt < 0) {
        // 剩余无 '<'：思考态整段产出，正文态整段丢弃
        if (inside) out.push(s.slice(i))
        return
      }
      if (inside && lt > i) out.push(s.slice(i, lt))
      const open = matchTag(s, lt, THINK_OPEN)
      const close = matchTag(s, lt, THINK_CLOSE)
      if (open === 'full') { i = lt + THINK_OPEN.length; inside = true; continue }
      if (close === 'full') { i = lt + THINK_CLOSE.length; inside = false; continue }
      if (open === 'partial' || close === 'partial') {
        pending = s.slice(lt) // 可能是被切碎的标签头：缓冲等待下一个 chunk 补全
        return
      }
      if (inside) out.push('<') // 普通文本里的裸 '<'（如 "a < b"）原样保留
      i = lt + 1
    }
  }

  return {
    push(chunk: string): string {
      const s = pending + chunk
      pending = ''
      const out: string[] = []
      scan(s, out)
      return out.join('')
    },
    flush(): string {
      const rest = pending
      pending = ''
      // 正文态的残包是答案文本，不产出；思考态按普通文本保留（宁多给不丢字）
      return inside ? rest : ''
    },
  }
}

/** 从一个 delta / message 对象里取出思考文本（取不到返回空串） */
export function extractReasoning(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const o = obj as Record<string, unknown>

  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const v = o[key]
    if (typeof v === 'string' && v) {
      // 网关可能把 <think> 包裹标签原样混进思考字段：剥掉标签保留内部文本。
      // 剥完为空（如整块只有标签本身）视同该 chunk 无思考内容，继续看下一字段
      const stripped = stripThinkTags(v)
      if (stripped) return stripped
    }
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
    const stripped = stripThinkTags(out)
    if (stripped) return stripped
  }

  return ''
}

/** 该对象是否带任何形式的思考内容（用于判断"模型是否在思考"） */
export function hasReasoning(obj: unknown): boolean {
  return extractReasoning(obj).length > 0
}
