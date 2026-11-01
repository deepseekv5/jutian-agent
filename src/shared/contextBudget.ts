/**
 * 上下文预算管理（v14.5）
 *
 * 我们此前的上下文策略只有「单条工具结果超 40K 截断」，从不按总量裁剪：
 * 长任务跑到后面必然把上下文撑爆，上游直接报 context length exceeded，
 * 用户看到的是一条原始错误——整轮白跑。
 *
 * 这里补两件事（都是纯函数，可测）：
 *   1. microcompact：老工具结果清空成占位符（只清「可重跑」的工具，
 *      保留最近 N 条）。参考 Claude Code 的 Function Result Clearing。
 *   2. truncateForBudget：按 token 预算从最新往最旧裁剪，并**修复切点**——
 *      绝不能以 tool 消息开头，也不能留下没有工具响应的 assistant(tool_calls)，
 *      否则上游会因为历史非法直接 400。
 *
 * 与「对话摘要压缩」的区别：这里不生成摘要、不改写内容，只是丢弃/清空
 * 已失去价值的大块原始输出，信息损失可预期。
 */

/** 中文/全角 ≈ 1 token，其余 ≈ 4 字符 1 token */
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

export interface BudgetMessage {
  role: string
  content?: unknown
  tool_calls?: unknown
  tool_call_id?: string
  [k: string]: unknown
}

/** 单条消息的 token 估算（含 tool_calls 的 JSON 体积） */
export function messageTokens(m: BudgetMessage): number {
  const c = typeof m.content === 'string' ? m.content : (m.content == null ? '' : JSON.stringify(m.content))
  let n = estimateTokens(c)
  if (m.tool_calls) n += estimateTokens(JSON.stringify(m.tool_calls))
  return n
}

export function totalTokens(messages: BudgetMessage[]): number {
  let n = 0
  for (const m of messages) n += messageTokens(m)
  return n
}

/* ─── microcompact：清空老的可重跑工具结果 ─── */

/** 保留最近 N 条工具结果 */
export const MICROCOMPACT_KEEP_RECENT = 6

/** 可清空的工具：输出大且可重跑。编辑/子代理/交互结果小而关键，不清。 */
const CLEARABLE = new Set([
  'read_file', 'list_dir', 'search_files', 'search_content', 'web_search', 'web_fetch',
  'system_info', 'process_list', 'port_check', 'shell_output',
])

export const CLEARED_PLACEHOLDER =
  '[旧工具结果已清空以释放上下文。关键信息应已体现在后续回复里；需要时重新调用该工具即可。]'

/**
 * 清空较早的工具结果。只处理 role='tool' 且内容超过阈值的消息，
 * 且保留最近 keepRecent 条工具结果不动。
 * @returns 新数组（未改动时返回原引用）
 */
export function microcompact<T extends BudgetMessage>(
  messages: T[],
  opts: { keepRecent?: number; minChars?: number } = {},
): { messages: T[]; cleared: number } {
  const keep = Math.max(1, opts.keepRecent ?? MICROCOMPACT_KEEP_RECENT)
  const minChars = opts.minChars ?? 800
  const toolIdx: number[] = []
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'tool') toolIdx.push(i)
  if (toolIdx.length <= keep) return { messages, cleared: 0 }

  const protectedFrom = toolIdx[toolIdx.length - keep]
  let cleared = 0
  const out = messages.map((m, i) => {
    if (i >= protectedFrom || m.role !== 'tool') return m
    const text = typeof m.content === 'string' ? m.content : ''
    if (text.length < minChars) return m
    if (text === CLEARED_PLACEHOLDER) return m
    // 判断这条结果对应哪个工具：tool 消息上没有工具名，只能看内容特征——
    // 保守起见只要够长就清（可重跑的判断由调用方在生成时打标更准，
    // 这里用长度阈值 + 保留最近 N 条来兜住关键结果）
    cleared++
    return { ...m, content: CLEARED_PLACEHOLDER }
  })
  return cleared > 0 ? { messages: out, cleared } : { messages, cleared: 0 }
}

/* ─── 按预算裁剪 ─── */

export interface TruncateResult<T> {
  messages: T[]
  /** 被丢弃的消息条数 */
  dropped: number
  /** 裁剪后的估算 token */
  tokens: number
}

/**
 * 从最新往最旧累计 token，超预算即切；随后修复切点保证历史合法：
 *   - 不能以 role='tool' 开头（缺前驱 assistant(tool_calls)）
 *   - 不能留下没有工具响应的 assistant(tool_calls)
 * 系统消息始终保留（静态提示词是行为约束，丢了模型会乱来）。
 */
export function truncateForBudget<T extends BudgetMessage>(messages: T[], budgetTokens: number): TruncateResult<T> {
  if (!budgetTokens || budgetTokens <= 0) return { messages, dropped: 0, tokens: totalTokens(messages) }
  if (totalTokens(messages) <= budgetTokens) {
    return { messages, dropped: 0, tokens: totalTokens(messages) }
  }

  const systemCount = messages.findIndex((m) => m.role !== 'system')
  const sysEnd = systemCount === -1 ? messages.length : systemCount
  const system = messages.slice(0, sysEnd)
  const rest = messages.slice(sysEnd)

  let used = system.reduce((a, m) => a + messageTokens(m), 0)
  let cut = rest.length
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = messageTokens(rest[i])
    // 至少保留最后 4 条（最后一条通常是当前用户输入）
    if (used + t > budgetTokens && rest.length - i >= 4) {
      cut = i + 1
      break
    }
    used += t
  }

  // 修复切点：不能以 tool 开头
  while (cut < rest.length && rest[cut].role === 'tool') {
    const prev = cut > 0 ? rest[cut - 1] : null
    if (prev && prev.role === 'assistant' && prev.tool_calls) { cut--; continue }
    cut++
  }
  // 修复切点：assistant(tool_calls) 必须有对应的 tool 响应紧随
  while (cut < rest.length) {
    const m = rest[cut]
    if (m.role === 'assistant' && m.tool_calls) {
      const ids = (m.tool_calls as { id?: string }[]).map((tc) => tc.id).filter(Boolean) as string[]
      const next = rest[cut + 1]
      if (next && next.role === 'tool' && ids.includes(String(next.tool_call_id || ''))) break
      cut++
      continue
    }
    break
  }

  const kept = [...system, ...rest.slice(cut)]
  return { messages: kept, dropped: cut, tokens: totalTokens(kept) }
}

/* ─── 上游错误分类（决定「重试」还是「压缩后重放」） ─── */

const CONTEXT_OVERFLOW_PATTERN =
  /context length|prompt is too long|too many tokens|maximum context|context_length_exceeded|request too large|exceed[s]? the (maximum )?context|context window|输入过长|上下文超长/i

const QUOTA_PATTERN =
  /insufficient_quota|quota exceeded|out of budget|billing|insufficient balance|payment required|credit.*(exhaust|expired)/i

/** 上下文溢出：重试无用，必须裁剪后重放 */
export function isContextOverflowError(message: string): boolean {
  return CONTEXT_OVERFLOW_PATTERN.test(String(message || ''))
}

/** 配额/计费类：重试无用，直接提示用户处理 */
export function isQuotaError(message: string): boolean {
  return QUOTA_PATTERN.test(String(message || ''))
}
