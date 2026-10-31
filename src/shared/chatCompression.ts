/**
 * 对话历史压缩引擎（v13.9.1）
 *
 * 移植自 gemini-cli 的 chatCompressionService（Apache-2.0，Copyright Google LLC），
 * 按 Apache-2.0 要求保留来源声明；消息形状从 Gemini Content[] 适配为
 * OpenAI tool 消息形状（role:'tool' + toolNameHint），语义保持一致：
 *
 *   1. collapseOlderToolResults —— 旧轮工具响应折叠：按字节折叠（字素安全，
 *      不会腰斩 emoji/中文）、保护最近 3 轮、检索类工具豁免（读取内容是
 *      模型决策的关键依据，Gemini 实测折叠损失大于收益）。
 *   2. archiveOldToolResults —— 反向预算（从最新往最旧遍历，累计超过预算后
 *      更旧的大响应截断保留「末尾若干行」）：命令的错误堆栈在输出尾部，
 *      保留尾部比保留头部更有价值。
 *
 * 纯函数、零外部依赖（仅 Node 内置 Buffer/Intl）。
 */

export const RECENT_TURNS_PROTECTED = 3
/** 旧轮工具响应折叠上限（字节）——gemini-cli 实测值 */
export const COLLAPSED_MAX_BYTES = 2048
/** 反向预算：工具响应累计字符超过此值后，更旧的大响应进入截断 */
export const TOOL_RESPONSE_BUDGET_CHARS = 50_000
/** 截断保留的尾部行数（错误堆栈在输出末尾） */
export const TAIL_LINES_KEPT = 30

/** 检索/读取类工具豁免折叠：其输出是模型下一步决策的关键依据（gemini 同款清单思路，映射到我们的工具名） */
const RETRIEVAL_EXEMPT = new Set([
  'read_file', 'search_files', 'search_content', 'web_fetch', 'recall', 'list_skills',
  'find_in_files', 'file_stats', 'get_file_info',
])

export interface SlimToolMsg {
  role: string
  content: string
  /** 消息上挂的工具名提示（stream 循环写入，用于豁免判定） */
  toolNameHint?: string
}

/** 字素安全截断到指定字节数（Intl.Segmenter 不会腰斩 emoji/中文组合字素） */
export function graphemeTruncateToBytes(str: string, maxBytes: number, suffix = ''): string {
  try {
    const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' })
    let kept = ''
    let used = 0
    for (const { segment } of seg.segment(str)) {
      const b = Buffer.byteLength(segment, 'utf8')
      if (used + b > maxBytes) break
      kept += segment
      used += b
    }
    return kept + suffix
  } catch {
    return str.slice(0, maxBytes) + suffix
  }
}

/** 折叠单条旧工具响应：超 2KB 折到 2KB + 归档标记 */
export function collapseToolResponse(content: string, maxBytes = COLLAPSED_MAX_BYTES): string {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content
  const suffix = `\n…[该轮工具输出已折叠：原始 ${Buffer.byteLength(content, 'utf8')} 字节。需要完整内容可重新调用工具，或在文件空间中查看。]`
  return graphemeTruncateToBytes(content, maxBytes, suffix)
}

/**
 * 折叠旧轮工具响应：保护最近 N 轮 + 检索豁免。
 * 返回新数组（未折叠时返回原引用，方便调用方零成本跳过）。
 */
export function collapseOlderToolResults<T extends SlimToolMsg>(messages: T[], protectedTurns = RECENT_TURNS_PROTECTED): T[] {
  // 找出所有工具响应消息的下标
  const toolIdx: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIdx.push(i)
  }
  if (toolIdx.length <= protectedTurns) return messages

  // 最近 N 条工具响应受保护，只折叠更早的
  const cutoff = toolIdx[toolIdx.length - protectedTurns]
  let modified = false
  const out = messages.map((m, i) => {
    if (i >= cutoff || m.role !== 'tool') return m
    if (m.toolNameHint && RETRIEVAL_EXEMPT.has(m.toolNameHint)) return m
    const collapsed = collapseToolResponse(m.content)
    if (collapsed === m.content) return m
    modified = true
    return { ...m, content: collapsed }
  })
  return modified ? out : messages
}

/** 从工具输出中提取可截断的主字符串（对象形态取 output/content 字段，gemini 同款规则） */
export function primaryOutput(content: string): string {
  if (content.startsWith('{') && content.endsWith('}')) {
    try {
      const obj = JSON.parse(content)
      if (obj && typeof obj === 'object') {
        if (typeof (obj as Record<string, unknown>).output === 'string') return (obj as Record<string, unknown>).output as string
        if (typeof (obj as Record<string, unknown>).content === 'string') return (obj as Record<string, unknown>).content as string
      }
    } catch { /* 非 JSON 按原文 */ }
  }
  return content
}

/** 截尾保留：只保留输出末尾 N 行（错误堆栈在末尾），头部一行提示省略量 */
export function truncateKeepTail(content: string, tailLines = TAIL_LINES_KEPT): string {
  // 对象形态的输出先取主字符串字段（{output: ...} 之类），截尾才截在正确文本上
  content = primaryOutput(content)
  const lines = content.split('\n')
  if (lines.length <= tailLines) return content
  const omitted = lines.length - tailLines
  return `[输出已归档：前 ${omitted} 行省略，保留最后 ${tailLines} 行。完整内容可重新调用工具获取。]\n` + lines.slice(-tailLines).join('\n')
}

/**
 * 反向预算（gemini truncateHistoryToBudget 语义）：从最新往最旧遍历工具响应，
 * 累计字符超过预算后，更旧的大响应截尾保留最后 N 行。
 * 返回新数组（全部在预算内时返回原引用）。
 */
export function archiveOldToolResults<T extends SlimToolMsg>(messages: T[], budgetChars = TOOL_RESPONSE_BUDGET_CHARS): T[] {
  let used = 0
  let modified = false
  // 从最新往最旧处理，重建时保持原顺序
  const marks: (string | null)[] = new Array(messages.length).fill(null)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'tool') continue
    used += m.content.length
    if (used > budgetChars && m.content.length > 500) {
      marks[i] = truncateKeepTail(m.content)
      modified = true
    }
  }
  if (!modified) return messages
  return messages.map((m, i) => (marks[i] != null ? { ...m, content: marks[i] as string } : m))
}

/**
 * 组合入口：折叠 + 归档，供 agent 每轮请求前调用。
 * 保护最近 RECENT_TURNS_PROTECTED 轮；检索豁免；压缩一次后文本稳定（前缀缓存友好）。
 */
export function compressHistory<T extends SlimToolMsg>(messages: T[]): T[] {
  return archiveOldToolResults(collapseOlderToolResults(messages))
}
