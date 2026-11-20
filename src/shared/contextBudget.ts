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
export const CLEARABLE_TOOLS = new Set([
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
  opts: { keepRecent?: number; minChars?: number; clearableIds?: Set<string> } = {},
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
    // 给了「可清空 id 集合」就严格按它判断（循环里知道工具名，最准）；
    // 没给则退化为按长度阈值——只清大块输出，风险可控
    if (opts.clearableIds && !opts.clearableIds.has(String(m.tool_call_id || ''))) return m
    // tool 消息上没有工具名，靠调用方传 clearableIds 精确判断（agentLoop 会传）
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
 *   - 工具调用组整体同进退：assistant(tool_calls) 与其全部 tool 响应要么都留、
 *     要么都丢（并行多 tool_calls 切在响应中间、或 tool_call_id 对不上时，
 *     按整组处理，绝不留悬空引用）
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
  // 初始为 0：非 system 消息不足 4 条时尾部保护会让循环找不到切点，
  // 此时必须保住全部（宁可超预算，也绝不能把当前用户输入丢掉）。
  // rest ≥ 4 条时循环必然在 i=0 处命中切点（总量已确认超预算），初值不参与结果。
  let cut = 0
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = messageTokens(rest[i])
    // 至少保留最后 4 条（最后一条通常是当前用户输入）
    if (used + t > budgetTokens && rest.length - i >= 4) {
      cut = i + 1
      break
    }
    used += t
  }

  // 修复切点：assistant(tool_calls) 与其后全部 tool 响应必须「同进退」——
  // 一组 = assistant(tool_calls) + 紧随的、id 匹配的连续 tool 响应。
  //   - 整组塞得进剩余预算 → 切点前移到组首（整组保留，尽量少丢上下文）
  //   - 塞不进（或组内一条响应都没有）→ 切点后移到组尾（整组丢弃）
  //   - 孤儿 tool（前驱不是 assistant(tool_calls)，或 tool_call_id 对不上——
  //     模型吐错 id / 网关改写时真实会发生）→ 整段连续 tool 丢弃
  // 绝不允许保留区以孤儿 tool 开头，也绝不允许留下没有响应的 tool_calls，
  // 否则上游按非法历史直接 400。循环每条路径都让 cut 严格前进，保证终止。
  while (cut < rest.length) {
    const m = rest[cut]
    if (m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls)) break

    let start = cut
    if (m.role === 'tool') {
      // 向前走完整段连续 tool，源头必须紧邻 assistant(tool_calls)
      let s = cut
      while (s > 0 && rest[s - 1].role === 'tool') s--
      const owner = s > 0 ? rest[s - 1] : null
      const ownerIds = owner && owner.role === 'assistant' && owner.tool_calls
        ? new Set(
            ((owner.tool_calls as { id?: string }[] | undefined) ?? [])
              .map((tc) => String(tc?.id ?? ''))
              .filter(Boolean),
          )
        : null
      if (!ownerIds || !ownerIds.has(String(m.tool_call_id ?? ''))) {
        // 孤儿 tool：无 owner，或 id 对不上。整段连续 tool 都无法配对，全部丢弃
        let e = cut
        while (e < rest.length && rest[e].role === 'tool') e++
        used -= rest.slice(cut, e).reduce((a, x) => a + messageTokens(x), 0)
        cut = e
        continue
      }
      start = s - 1
    }

    // 组尾：assistant 之后连续且 id 匹配的 tool 响应
    const ids = new Set(
      ((rest[start].tool_calls as { id?: string }[] | undefined) ?? [])
        .map((tc) => String(tc?.id ?? ''))
        .filter(Boolean),
    )
    let end = start + 1
    while (end < rest.length && rest[end].role === 'tool' && ids.has(String(rest[end].tool_call_id ?? ''))) end++

    // start < cut 时，[start, cut) 是此前被裁掉、现在要补回的组前缀
    const prefixTokens = rest.slice(start, cut).reduce((a, x) => a + messageTokens(x), 0)
    if (end > start + 1 && used + prefixTokens <= budgetTokens) {
      // 整组保留：组首成为新保留区起点，其后全是合法历史
      cut = start
      used += prefixTokens
      break
    }
    // 整组丢弃（组没有可配对的响应，或补回组前缀会超预算），从组尾继续检查
    used -= rest.slice(cut, end).reduce((a, x) => a + messageTokens(x), 0)
    cut = end
  }

  const kept = [...system, ...rest.slice(cut)]
  return { messages: kept, dropped: cut, tokens: totalTokens(kept) }
}

/* ─── 上游错误分类（决定「重试」还是「压缩后重放」） ─── */

/**
 * 上游溢出错误形态（按上游逐一核对）：
 *   - OpenAI:  "This model's maximum context length is ..." / code: context_length_exceeded
 *   - Anthropic: "prompt is too long" / "input length and max_tokens exceed context limit"
 *   - 本地网关: code "context_length_exceeded"
 *   - 中文表述: 上下文过长 / 超出上下文 / 上下文超长 / 输入过长
 */
const CONTEXT_OVERFLOW_PATTERN =
  /context length|prompt (is )?too long|too many tokens|maximum context|context_length_exceeded|request too large|exceed[s]?( the)?( maximum )? context|context window|input (is )?too long|输入过长|输入太长|上下文过长|上下文超长|上下文太长|超出上下文|上下文超出/i

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
