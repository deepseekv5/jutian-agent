/**
 * 上下文工程（Context Engineering）——超级内核 D 模块之一。
 *
 * 本文件负责三件事，三者共享同一套 token 估算口径：
 *   1. allocate()          —— 在给定上下文窗口下，为 system/history/tools/plan/reserved
 *                             五类内容动态分配预算；分配随任务领域、复杂度、计划规模变化。
 *   2. trim()              —— 按 history 预算裁剪对话历史：保留 system、首尾关键消息、
 *                             最近若干轮、工具调用块（assistant(tool_calls) + tool 结果）的
 *                             完整性，并对超长工具输出做"折叠摘要化"。
 *   3. buildSystemPrompt() —— 把任务分析摘要、执行计划、策略提示、护栏规则组装成增强 system，
 *                             统一走 <system-reminder> 通道注入，绝不写进用户正文。
 *
 * 设计约束（来自 types.ts 契约）：
 *   - 只依赖 types.ts 的类型与 agentLoop 的消息类型，模块之间零 import。
 *   - 所有算法必须是纯函数式/可解释的：预算怎么分、消息为什么被淘汰，都能追溯。
 *   - 不依赖任何真实工具、网络或 DOM，完全可测试。
 *
 * 为什么 token 估算要自己写而不是调用模型 tokenizer：
 *   tokenizer 随模型而变（GPT/Claude/DeepSeek 词表不同），而且引入依赖会破坏 headless。
 *   这里用"中英文混合"的经验模型估算，宁可略微高估（高估只会更早裁剪，不会撑爆窗口）。
 */

import type {
  ContextAssembler,
  ContextBudgetAllocation,
  TaskAnalysis,
  ExecutionPlan,
  RouteDecision,
  TaskDomain,
  TaskComplexity,
  RiskLevel,
} from '../types'
import type { LoopMessage } from '../../agentLoop'

/* ════════════════════════════════════════════════════════════════════════════
 * 第 0 节：通用小工具
 * ════════════════════════════════════════════════════════════════════════════ */

/** 把数值夹在 [lo, hi] 区间。预算计算里到处都要用，集中定义避免散落的 Math.min/max。 */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return Math.min(hi, Math.max(lo, value))
}

/** 安全读取消息文本：LoopMessage.content 是 unknown，可能是 string / 数组 / 对象 / null。 */
function contentText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // 多模态 content：[{type:'text',text:'...'}, {type:'image_url',...}]
    let out = ''
    for (const part of content) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>
        if (typeof p.text === 'string') out += p.text
      }
    }
    return out
  }
  if (typeof content === 'object') {
    try { return JSON.stringify(content) } catch { return String(content) }
  }
  return String(content)
}

/** 判断一条消息是否携带 OpenAI 格式的 tool_calls（assistant 发起工具调用）。 */
function hasToolCalls(msg: LoopMessage): boolean {
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
}

/** 从未知形状的 tool_call 条目里稳健提取函数名，用于重要性评分与折叠。 */
function toolCallName(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  // 兼容两种形状：{name, arguments} 与 {function:{name, arguments}}
  if (typeof obj.name === 'string') return obj.name
  const fn = obj.function
  if (fn && typeof fn === 'object') {
    const f = fn as Record<string, unknown>
    if (typeof f.name === 'string') return f.name
  }
  return ''
}

/** 从未知形状的 tool_call 条目里稳健提取参数字符串。 */
function toolCallArgsText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  if (typeof obj.arguments === 'string') return obj.arguments
  const fn = obj.function
  if (fn && typeof fn === 'object') {
    const f = fn as Record<string, unknown>
    if (typeof f.arguments === 'string') return f.arguments
    if (f.arguments != null) {
      try { return JSON.stringify(f.arguments) } catch { return String(f.arguments) }
    }
  }
  if (obj.arguments != null) {
    try { return JSON.stringify(obj.arguments) } catch { return String(obj.arguments) }
  }
  return ''
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 1 节：中英文混合 token 估算
 *
 * 经验口径（可通过 ASSEMBLER_TOKEN_PROFILE 覆盖）：
 *   - CJK 表意文字：约 1.4 token/字（多数汉字 1 token，生僻/组合词 2 token 的折中）
 *   - CJK 标点：1 token
 *   - 连续 ASCII 字母数字串：约 0.26 token/字符（≈4 字符 1 token），每串至少 1
 *   - 数字串：约 0.34 token/字符（数字往往逐位切分）
 *   - 其它字符（emoji/符号）：1 token
 *   - 换行/空白：并入相邻，单独按 0.2 token/个粗略计
 *
 * 向上取整以保证不低估；对整段文本则会再加上消息结构开销。
 * ════════════════════════════════════════════════════════════════════════════ */

export interface TokenEstimateProfile {
  cjkChar: number
  cjkPunct: number
  asciiPerChar: number
  digitPerChar: number
  other: number
  whitespace: number
  /** 每条消息固定结构开销（role、分隔符等） */
  messageOverhead: number
  /** 每个 tool_call 条目固定开销 */
  toolCallOverhead: number
}

export const DEFAULT_TOKEN_PROFILE: TokenEstimateProfile = {
  cjkChar: 1.4,
  cjkPunct: 1,
  asciiPerChar: 0.26,
  digitPerChar: 0.34,
  other: 1,
  whitespace: 0.2,
  messageOverhead: 4,
  toolCallOverhead: 8,
}

/** CJK 标点集合（全角/半角常见项），单列出来是因为它通常独占一个 token。 */
const CJK_PUNCT = new Set(Array.from(`，。！？、；：（）《》「」『』【】—…·\u3000"''`))

/** 判断是否为 CJK 表意文字（含扩展 A 区与兼容表意文字）。 */
function isCjkIdeograph(ch: string): boolean {
  const c = ch.codePointAt(0) || 0
  return (c >= 0x4e00 && c <= 0x9fff)
    || (c >= 0x3400 && c <= 0x4dbf)
    || (c >= 0xf900 && c <= 0xfaff)
    || (c >= 0x20000 && c <= 0x2ffff)
}

/**
 * 估算一段文本的 token 数（中英文混合）。
 * 逐字符扫描并按类别累计，连续 ASCII 串整体按比例计（比逐字符更贴近 BPE 行为）。
 */
export function estimateTextTokens(text: string, profile: TokenEstimateProfile = DEFAULT_TOKEN_PROFILE): number {
  if (!text) return 0
  let total = 0
  let asciiRun = 0
  let digitRun = 0

  const flushAscii = () => {
    if (asciiRun > 0) {
      total += Math.max(1, Math.ceil(asciiRun * profile.asciiPerChar))
      asciiRun = 0
    }
  }
  const flushDigit = () => {
    if (digitRun > 0) {
      total += Math.max(1, Math.ceil(digitRun * profile.digitPerChar))
      digitRun = 0
    }
  }

  for (const ch of text) {
    const c = ch.codePointAt(0) || 0
    if (isCjkIdeograph(ch)) {
      flushAscii(); flushDigit()
      total += profile.cjkChar
    } else if (CJK_PUNCT.has(ch)) {
      flushAscii(); flushDigit()
      total += profile.cjkPunct
    } else if ((c >= 0x30 && c <= 0x39)) {
      flushAscii()
      digitRun++
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
      || c === 0x5f /* _ */ || c === 0x2d /* - */) {
      flushDigit()
      asciiRun++
    } else if (/\s/.test(ch)) {
      flushAscii(); flushDigit()
      total += profile.whitespace
    } else {
      flushAscii(); flushDigit()
      total += profile.other
    }
  }
  flushAscii(); flushDigit()
  return Math.max(0, Math.ceil(total))
}

/** 估算单个 tool_call 条目的 token（函数名 + 参数 JSON + 结构开销）。 */
function estimateToolCallTokens(raw: unknown, profile: TokenEstimateProfile): number {
  const name = toolCallName(raw)
  const args = toolCallArgsText(raw)
  return profile.toolCallOverhead + estimateTextTokens(name, profile) + estimateTextTokens(args, profile)
}

/** 估算单条消息 token（结构开销 + 正文 + 工具调用 + tool_call_id）。 */
export function estimateMessageTokens(msg: LoopMessage, profile: TokenEstimateProfile = DEFAULT_TOKEN_PROFILE): number {
  let tokens = profile.messageOverhead
  tokens += estimateTextTokens(contentText(msg.content), profile)
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) tokens += estimateToolCallTokens(tc, profile)
  }
  if (typeof msg.tool_call_id === 'string') {
    tokens += estimateTextTokens(msg.tool_call_id, profile)
  }
  // 某些消息带有 name / role 之外的业务字段，粗略计入（避免低估）
  for (const key of ['name', 'tool_name', 'changeId'] as const) {
    const v = msg[key]
    if (typeof v === 'string' && v) tokens += estimateTextTokens(v, profile)
  }
  return Math.ceil(tokens)
}

/** 估算一组消息的总 token。 */
export function estimateMessagesTokens(messages: LoopMessage[], profile: TokenEstimateProfile = DEFAULT_TOKEN_PROFILE): number {
  let total = 0
  for (const m of messages) total += estimateMessageTokens(m, profile)
  return total
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 2 节：预算分配（多级策略）
 *
 * 分配分级细化：
 *   L1 基线比例     —— 默认 system 12% / history 46% / tools 18% / plan 10% / reserved 14%
 *   L2 领域偏移     —— code 多给 tools，research/writing 多给 history，planning 多给 plan
 *   L3 需求修正     —— needsTools=false 时 tools 预算转给 history；计划步数多时 plan 增加
 *   L3.5 下限强制   —— expert 复杂度强制 reserved >= 15%（防长输出把窗口挤爆）
 *   L4 归一化取整   —— 保证五类之和恰好等于 total，且每类不低于最小值
 * ════════════════════════════════════════════════════════════════════════════ */

interface RatioPolicy {
  system: number
  history: number
  tools: number
  plan: number
  reserved: number
}

/** L1 默认基线（比例和为 1）。 */
const BASE_RATIO: RatioPolicy = {
  system: 0.12,
  history: 0.46,
  tools: 0.18,
  plan: 0.10,
  reserved: 0.14,
}

/**
 * L2 领域策略表。每个领域给出相对基线的"倾向权重"，随后统一归一化。
 * 说明（可解释性的来源）：
 *   - code/file/shell   ：工具定义多、参数复杂，tools 权重高。
 *   - research/writing  ：需要大量历史材料与引文，history 权重高。
 *   - planning          ：计划本身很长，plan 权重高。
 *   - conversation      ：几乎不需要工具与计划，history 权重最高。
 *   - qa/data           ：偏平衡，略增 reserved 以容纳结构化输出。
 */
const DOMAIN_WEIGHTS: Record<TaskDomain, RatioPolicy> = {
  code:         { system: 1.0, history: 0.9, tools: 1.9, plan: 1.2, reserved: 0.9 },
  file:         { system: 1.0, history: 1.0, tools: 1.6, plan: 1.0, reserved: 1.0 },
  shell:        { system: 1.1, history: 0.9, tools: 1.7, plan: 1.1, reserved: 1.0 },
  research:     { system: 1.0, history: 1.7, tools: 1.2, plan: 0.9, reserved: 1.0 },
  writing:      { system: 1.1, history: 1.6, tools: 0.7, plan: 0.9, reserved: 1.1 },
  data:         { system: 1.0, history: 1.1, tools: 1.2, plan: 1.1, reserved: 1.2 },
  creative:     { system: 1.1, history: 1.3, tools: 0.6, plan: 0.8, reserved: 1.2 },
  planning:     { system: 1.1, history: 1.0, tools: 0.9, plan: 2.0, reserved: 1.1 },
  qa:           { system: 1.0, history: 1.2, tools: 1.0, plan: 0.9, reserved: 1.3 },
  conversation: { system: 0.9, history: 1.9, tools: 0.3, plan: 0.2, reserved: 1.0 },
}

/** L2 复杂度对 system/reserved 的加成：越复杂越需要护栏说明与输出缓冲。 */
const COMPLEXITY_WEIGHTS: Record<TaskComplexity, RatioPolicy> = {
  trivial:  { system: 0.7, history: 1.1, tools: 0.8, plan: 0.4, reserved: 0.8 },
  simple:   { system: 0.9, history: 1.0, tools: 0.9, plan: 0.7, reserved: 0.9 },
  moderate: { system: 1.0, history: 1.0, tools: 1.0, plan: 1.0, reserved: 1.0 },
  complex:  { system: 1.2, history: 0.9, tools: 1.1, plan: 1.4, reserved: 1.2 },
  expert:   { system: 1.4, history: 0.8, tools: 1.2, plan: 1.7, reserved: 1.4 },
}

/** 每类预算的最小绝对 token（窗口很小时按比例压缩，但不低于 0）。 */
const MIN_BUDGET: RatioPolicy = {
  system: 120,
  history: 200,
  tools: 0,
  plan: 0,
  reserved: 64,
}

/** 风险等级对 reserved 的加成：高风险要留更多输出/解释空间。 */
const RISK_RESERVED_BONUS: Record<RiskLevel, number> = {
  low: 1.0,
  medium: 1.05,
  high: 1.15,
  critical: 1.25,
}

/** 按比例乘权重并归一化，得到一份和为 1 的比例。 */
function normalizeRatios(raw: RatioPolicy): RatioPolicy {
  const sum = raw.system + raw.history + raw.tools + raw.plan + raw.reserved
  if (sum <= 0) return { ...BASE_RATIO }
  return {
    system: raw.system / sum,
    history: raw.history / sum,
    tools: raw.tools / sum,
    plan: raw.plan / sum,
    reserved: raw.reserved / sum,
  }
}

/** 把两个权重表逐项相乘。 */
function mulRatios(a: RatioPolicy, b: RatioPolicy): RatioPolicy {
  return {
    system: a.system * b.system,
    history: a.history * b.history,
    tools: a.tools * b.tools,
    plan: a.plan * b.plan,
    reserved: a.reserved * b.reserved,
  }
}

/**
 * expert 复杂度的 reserved 份额下限。
 * expert 任务输出长、返工多，若 reserved 不足，模型输出会"爆窗"挤掉历史或触发截断；
 * 因此无论领域与风险如何组合，归一化后强制 reserved >= 15%。
 */
const EXPERT_RESERVED_FLOOR = 0.15

/**
 * L3.5 reserved 下限强制：归一化后若 reserved 份额低于下限（当前仅 expert 复杂度），
 * 把 reserved 抬到下限，差额从其余四类按各自当前份额等比例扣回，
 * 保持其它类别之间的相对结构不变。返回的新比例总和仍为 1。
 */
function enforceReservedFloor(ratios: RatioPolicy, analysis: TaskAnalysis): RatioPolicy {
  const floor = analysis.complexity.level === 'expert' ? EXPERT_RESERVED_FLOOR : 0
  if (floor <= 0 || ratios.reserved >= floor) return ratios
  const others = ratios.system + ratios.history + ratios.tools + ratios.plan
  const out: RatioPolicy = { ...ratios, reserved: floor }
  if (others <= 0) return out // 理论不可达（四类全为 0 时无法扣回，直接返回）
  const scale = (1 - floor) / others
  out.system = ratios.system * scale
  out.history = ratios.history * scale
  out.tools = ratios.tools * scale
  out.plan = ratios.plan * scale
  return out
}

/**
 * L3 需求修正：根据"是否真需要工具"、"计划规模"、"风险"调整比例。
 * 返回的是修正后的权重（仍会被归一化）。
 */
function applyDemandAdjustments(
  weights: RatioPolicy,
  analysis: TaskAnalysis,
  plan: ExecutionPlan | null,
): RatioPolicy {
  const w: RatioPolicy = { ...weights }

  // 不需要工具：把 tools 的绝大部分让给 history（让模型看到更多上下文）。
  if (!analysis.needsTools) {
    const freed = w.tools * 0.85
    w.tools -= freed
    w.history += freed
  }

  // 计划步数越多，plan 预算越大（每步标题/产物说明都要放进去）。
  if (plan && plan.steps.length > 0) {
    const stepBoost = clamp(plan.steps.length / 8, 0, 1) // 8 步以上达到满额加成
    w.plan *= 1 + stepBoost * 0.8
    // 并行层级多说明计划结构复杂，system 里要多放策略提示。
    if (plan.levels.length > 2) w.system *= 1 + clamp((plan.levels.length - 2) / 6, 0, 0.3)
  } else {
    // 没有计划：plan 预算转给 history。
    w.history += w.plan * 0.7
    w.plan *= 0.3
  }

  // 建议工具集越大，tools 预算越要充足（工具 schema 多）。
  if (analysis.suggestedTools.length > 6) {
    w.tools *= 1 + clamp((analysis.suggestedTools.length - 6) / 20, 0, 0.4)
  }

  // 高风险：reserved 增加（用于放护栏结果与错误恢复说明）。
  w.reserved *= RISK_RESERVED_BONUS[analysis.risk] || 1

  return w
}

/**
 * L4 把比例落实为整数预算，并保证总和恰好为 total。
 * 做法：先按比例分配，再按最小预算兜底，最后用"最大余数法"把差额补给小数部分最大的类，
 * 这样既满足下限约束，又让取整误差最小。
 */
function materializeAllocation(total: number, ratios: RatioPolicy, tight: boolean): ContextBudgetAllocation {
  const keys: Array<keyof RatioPolicy> = ['system', 'history', 'tools', 'plan', 'reserved']
  const mins: RatioPolicy = tight
    ? { system: 16, history: 24, tools: 0, plan: 0, reserved: 8 }
    : MIN_BUDGET

  // 第一轮：按比例分配并夹到下限。
  const raw: Record<keyof RatioPolicy, number> = {
    system: total * ratios.system,
    history: total * ratios.history,
    tools: total * ratios.tools,
    plan: total * ratios.plan,
    reserved: total * ratios.reserved,
  }
  const floors: Record<keyof RatioPolicy, number> = { system: 0, history: 0, tools: 0, plan: 0, reserved: 0 }
  let allocated = 0
  for (const k of keys) {
    const min = Math.min(mins[k], total) // 窗口小于下限时不强行超发
    floors[k] = Math.max(min, Math.floor(raw[k]))
    allocated += floors[k]
  }

  // 第二轮：若下限导致超发，按可压缩比例回收。
  if (allocated > total) {
    let excess = allocated - total
    // 按"当前值越大越先被压"排序，优先压缩 history/tools/plan。
    const order: Array<keyof RatioPolicy> = ['history', 'tools', 'plan', 'system', 'reserved']
    for (const k of order) {
      if (excess <= 0) break
      const reducible = floors[k] - Math.min(mins[k], total)
      const cut = Math.min(reducible, excess)
      floors[k] -= cut
      excess -= cut
    }
    allocated = total - excess
  }

  // 第三轮：最大余数法补齐差额（total - allocated）。
  const remainders = keys.map((k) => ({ k, r: raw[k] - Math.floor(raw[k]) }))
  remainders.sort((a, b) => b.r - a.r)
  let diff = total - allocated
  let idx = 0
  while (diff > 0 && remainders.length > 0) {
    floors[remainders[idx % remainders.length].k] += 1
    diff -= 1
    idx += 1
  }

  return {
    system: floors.system,
    history: floors.history,
    tools: floors.tools,
    plan: floors.plan,
    reserved: floors.reserved,
    total,
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 3 节：历史裁剪
 *
 * 裁剪原则（按优先级）：
 *   P0 system 消息永远保留，且优先计入 system 预算。
 *   P1 "工具调用块"完整性：assistant(tool_calls) 与其后紧邻的 tool 结果必须同进同退，
 *      否则下游会因"悬空 tool_calls"被上游拒绝。
 *   P2 首尾锚点：第一条 user（任务起点）与最后一条消息（最新上下文）保留。
 *   P3 最近 N 轮优先保留（按 user 消息切分"轮"）。
 *   P4 其余消息按重要性评分从低到高淘汰，直到落入 history 预算。
 *   P5 超长工具结果折叠摘要化（保头 + 保尾 + 长度提示）。
 * ════════════════════════════════════════════════════════════════════════════ */

/** 消息角色分类（LoopMessage.role 是自由字符串，统一映射到少数几类）。 */
type MsgKind = 'system' | 'user' | 'assistant' | 'tool' | 'other'

function classifyMessage(msg: LoopMessage): MsgKind {
  const role = String(msg.role || '').toLowerCase()
  if (role === 'system' || role === 'developer') return 'system'
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  if (role === 'tool' || role === 'function') return 'tool'
  return 'other'
}

/**
 * user 消息的基础分：在所有普通角色中最高。
 * 设计意图：含用户消息的轮次权重最高——用户原话是任务的"锚"，
 * 除此之外，最近 2 轮内的 user 由"最近轮保护"（recentTurnStart）做硬保证、
 * 首条 user 由"首尾锚点保护"做硬保证，评分只是给中间轮次的软排序。
 */
const USER_BASE_SCORE = 10
/** assistant 正文引用了相邻工具结果时的加权（见 assistantQuotesToolResult）。 */
const QUOTE_BOOST = 5

const ERROR_HINT_RE = /(error|exception|traceback|failed|失败|错误|异常|timeout|超时|denied|拒绝)/i

/** 视为"引用"的最小片段长度（字符）。过短会把普通衔接词误判为逐字引用。 */
const QUOTE_MIN_FRAG_LEN = 10
/** 引文检测最多检查的片段数（性能上限，超出直接跳过——评分是热路径，不容许失控）。 */
const QUOTE_MAX_FRAGS = 40

/**
 * 判断 assistant 正文是否逐字引用了相邻工具结果的内容。
 * 做法：正文按行/句切成片段，折叠空白后取长度足够的片段在工具结果文本里查找，
 * 命中任意片段即视为引用。纯启发式，仅用于重要性加分，不影响协议合法性。
 * 中英文都适用：中文按句读切分（。；！？等），英文按行与句号切分。
 */
function assistantQuotesToolResult(content: string, toolTexts: string[]): boolean {
  if (!content || toolTexts.length === 0) return false
  const hay = toolTexts.join('\n').replace(/\s+/g, ' ')
  if (!hay) return false
  const frags = content.split(/[\r\n]+|[。；！？!?;.、，：]/)
  let checked = 0
  for (const raw of frags) {
    if (checked >= QUOTE_MAX_FRAGS) break
    const frag = raw.trim().replace(/\s+/g, ' ')
    if (frag.length < QUOTE_MIN_FRAG_LEN) continue
    checked++
    if (hay.includes(frag)) return true
  }
  return false
}

/** 收集某条消息前方紧邻的连续 tool 结果文本（最多 3 条），作为引文检测的对照语料。 */
function adjacentToolTexts(messages: LoopMessage[], index: number): string[] {
  const texts: string[] = []
  for (let j = index - 1; j >= 0 && texts.length < 3; j--) {
    const m = messages[j]
    if (classifyMessage(m) !== 'tool') break
    const t = contentText(m.content)
    if (t) texts.push(t)
  }
  return texts
}

/**
 * 消息重要性评分（越高越该保留）。所有加分项都可解释：
 *   - system：+∞（永不裁剪）
 *   - user：+USER_BASE_SCORE（最高基础分；用户意图优先于模型自述）
 *   - 首条 user：任务起点，再 +18
 *   - assistant 含 tool_calls：+6（保留工具链路）
 *   - assistant 正文逐字引用过相邻工具结果：+QUOTE_BOOST（裁掉会让上下文断裂，
 *     比如"如上面报错所示"的正文一旦与工具结果分离，模型就失去所指）；
 *     加权后封顶在 user 基础分之下，保证用户消息仍最高
 *   - assistant 普通正文：+3
 *   - tool 结果：基础 +1；包含 error/exception/失败 关键词 +6（错误是诊断关键）
 *   - 内容越长（信息密度）轻微加分，但封顶 +4
 *   - 携带附件：+5
 */
function messageImportance(
  msg: LoopMessage,
  index: number,
  firstUserIndex: number,
  total: number,
  all?: LoopMessage[],
): number {
  const kind = classifyMessage(msg)
  let score = 0
  if (kind === 'system') return Number.POSITIVE_INFINITY
  if (kind === 'user') {
    score += USER_BASE_SCORE
    if (index === firstUserIndex) score += 18
  } else if (kind === 'assistant') {
    score += hasToolCalls(msg) ? 6 : 3
    // 引用检测：正文里逐字引用了相邻工具结果的内容 → 提升权重，避免上下文断裂。
    if (all && score < USER_BASE_SCORE) {
      const quoted = assistantQuotesToolResult(contentText(msg.content), adjacentToolTexts(all, index))
      if (quoted) score = Math.min(score + QUOTE_BOOST, USER_BASE_SCORE - 1)
    }
  } else if (kind === 'tool') {
    score += 1
    const text = contentText(msg.content)
    if (ERROR_HINT_RE.test(text)) score += 6
  } else {
    score += 2
  }
  // 最新消息额外加权：越靠近当前轮越相关。
  const recency = total <= 1 ? 0 : (index / (total - 1)) * 6
  score += recency
  // 信息量轻度加分（封顶 4）。
  score += Math.min(4, contentText(msg.content).length / 500)
  // 附件消息加权。
  if (msg.attachments || msg.hasAttachment || (msg as Record<string, unknown>).images) score += 5
  return score
}

/** 折叠阈值：工具结果超过该字符数就摘要化。 */
const TOOL_FOLD_THRESHOLD = 4000
/**
 * 折叠后保留的头部/尾部字符数（保守取值）。
 * 头尾各 300 字符已足够定位"这是什么输出、最后发生了什么"；
 * 更长的内容应让模型按需 read_file 原文件取回，而不是长期占用历史预算。
 */
const FOLD_HEAD = 300
const FOLD_TAIL = 300

/**
 * 折叠单个超长工具结果为"保头 + 省略提示 + 保尾"的摘要字符串。
 * 省略提示必须同时包含：折叠了多少字符、如何取回完整内容（read_file 原文件），
 * 让模型在丢失正文后仍有明确的恢复路径。
 * 不改消息其它字段（tool_call_id 等），只替换 content，保持协议合法。
 */
function foldToolResult(text: string, threshold: number = TOOL_FOLD_THRESHOLD): { text: string; folded: boolean; saved: number } {
  if (text.length <= threshold) return { text, folded: false, saved: 0 }
  const head = text.slice(0, FOLD_HEAD)
  const tail = text.slice(-FOLD_TAIL)
  const omitted = text.length - FOLD_HEAD - FOLD_TAIL
  const marker = `\n\n…[上下文工程：已折叠 ${omitted} 字符，完整内容可 read_file 原文件（原长 ${text.length}，此处仅保留首尾各 ${FOLD_HEAD}/${FOLD_TAIL} 字符用于诊断）。]…\n\n`
  const folded = head + marker + tail
  return { text: folded, folded: true, saved: text.length - folded.length }
}

/** 是否是可安全折叠的工具角色消息。 */
function isFoldableToolMessage(msg: LoopMessage): boolean {
  return classifyMessage(msg) === 'tool' && typeof msg.content === 'string'
}

/** 把消息切成"工具调用块"：assistant(tool_calls) + 紧随其后直到下一条非 tool 消息。 */
interface MessageBlock {
  start: number
  end: number          // 不含
  messages: LoopMessage[]
  /** 整块重要性（取块内最大，tool 块跟随 assistant） */
  importance: number
  tokens: number
}

function buildBlocks(
  messages: LoopMessage[],
  firstUserIndex: number,
  importanceOf: (msg: LoopMessage, index: number) => number,
  profile: TokenEstimateProfile,
): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    const kind = classifyMessage(msg)
    if (kind === 'assistant' && hasToolCalls(msg)) {
      // 收集 assistant + 后续连续 tool 结果为一个不可拆分块。
      const end0 = i + 1
      let j = end0
      while (j < messages.length && classifyMessage(messages[j]) === 'tool') j++
      const slice = messages.slice(i, j)
      const imp = Math.max(...slice.map((m, k) => importanceOf(m, i + k)))
      const tok = slice.reduce((s, m) => s + estimateMessageTokens(m, profile), 0)
      blocks.push({ start: i, end: j, messages: slice, importance: imp, tokens: tok })
      i = j
    } else {
      const imp = importanceOf(msg, i)
      const tok = estimateMessageTokens(msg, profile)
      blocks.push({ start: i, end: i + 1, messages: [msg], importance: imp, tokens: tok })
      i += 1
    }
  }
  void firstUserIndex
  return blocks
}

/**
 * 按 user 消息切分"轮次"，返回每轮的起止下标。用于"最近 N 轮"保护。
 * 开头的 system 前缀不算一轮。
 */
function splitTurns(messages: LoopMessage[]): Array<{ start: number; end: number }> {
  const turns: Array<{ start: number; end: number }> = []
  let currentStart = -1
  for (let i = 0; i < messages.length; i++) {
    if (classifyMessage(messages[i]) === 'user') {
      if (currentStart >= 0) turns[turns.length - 1].end = i
      currentStart = i
      turns.push({ start: i, end: messages.length })
    }
  }
  return turns
}

/** 统计被裁剪消息的信息，供可解释诊断（不写文件，仅内部返回）。 */
export interface TrimStats {
  originalCount: number
  keptCount: number
  droppedCount: number
  foldedCount: number
  originalTokens: number
  keptTokens: number
  budget: number
  dropReasons: string[]
}

/**
 * trim() 的可配置选项。默认行为对齐 agentLoop 已有裁剪策略，但更保守地保护工具链路。
 */
export interface TrimOptions {
  /** 最近多少轮无条件保留（默认 2）。 */
  keepRecentTurns?: number
  /** 是否在裁剪前先折叠超长工具结果（默认 true）。 */
  foldToolResults?: boolean
  /** 折叠阈值（字符）。 */
  foldThreshold?: number
  /** token 估算口径覆盖。 */
  profile?: TokenEstimateProfile
  /** 是否输出裁剪统计（挂到返回数组的 non-enumerable 属性上）。 */
  withStats?: boolean
}

/** 把统计附加到数组的不可枚举属性，避免污染消息结构。 */
const TRIM_STATS_KEY = '__trimStats'

/**
 * 真正的裁剪实现。返回新的消息数组（不修改入参）。
 */
function trimMessages(
  messages: LoopMessage[],
  budget: ContextBudgetAllocation,
  opts: TrimOptions = {},
): LoopMessage[] {
  const profile = opts.profile || DEFAULT_TOKEN_PROFILE
  const keepRecentTurns = opts.keepRecentTurns ?? 2
  const foldThreshold = opts.foldThreshold ?? TOOL_FOLD_THRESHOLD

  if (messages.length === 0) return []

  // ── Step 1：分离 system 前缀（连同第一个非 system 之前的 system 消息都保留）。
  const systemMsgs: LoopMessage[] = []
  let bodyStart = 0
  while (bodyStart < messages.length && classifyMessage(messages[bodyStart]) === 'system') {
    systemMsgs.push(messages[bodyStart])
    bodyStart++
  }
  const body = messages.slice(bodyStart)
  const originalTokens = estimateMessagesTokens(messages, profile)

  // ── Step 2：折叠超长工具结果（在评分前做，折叠后 token 变小，可能少删消息）。
  let foldedCount = 0
  const prepared = body.map((m) => {
    if ((opts.foldToolResults ?? true) && isFoldableToolMessage(m)) {
      const text = String(m.content)
      if (text.length > foldThreshold) {
        const f = foldToolResult(text, foldThreshold)
        if (f.folded) {
          foldedCount++
          return { ...m, content: f.text } as LoopMessage
        }
      }
    }
    return m
  })

  // ── Step 3：确定首尾锚点与最近轮保护集合。
  const firstUserIndex = prepared.findIndex((m) => classifyMessage(m) === 'user')
  const turns = splitTurns(prepared)
  const recentTurnStart = turns.length > keepRecentTurns
    ? turns[turns.length - keepRecentTurns].start
    : (turns.length > 0 ? turns[0].start : prepared.length)

  const importance = (m: LoopMessage, i: number) =>
    messageImportance(m, i, firstUserIndex, prepared.length, prepared)

  // ── Step 4：把正文切成不可拆分的块。
  const blocks = buildBlocks(prepared, firstUserIndex, importance, profile)

  // 标记"必保"块：首条 user 所在块、最近 N 轮内的块、最后一个块。
  const protectedBlockIdx = new Set<number>()
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    let mustKeep = false
    for (let k = b.start; k < b.end; k++) {
      if (k === firstUserIndex) mustKeep = true
      if (k >= recentTurnStart) mustKeep = true
      if (k === prepared.length - 1) mustKeep = true
    }
    // system（理论上已在前缀处理）与错误工具块也保护。
    if (b.messages.some((m) => classifyMessage(m) === 'system')) mustKeep = true
    if (mustKeep) protectedBlockIdx.add(bi)
  }

  // ── Step 5：计算可用 history 预算。system 预算若未用完可借给 history。
  const systemTokens = systemMsgs.reduce((s, m) => s + estimateMessageTokens(m, profile), 0)
  const systemSlack = Math.max(0, budget.system - systemTokens)
  const historyBudget = Math.max(0, budget.history + systemSlack)
  const dropReasons: string[] = []

  // ── Step 6：先放入必保块；若必保本身已超预算，按重要性从低到高舍弃一部分必保块
  //    （最近轮与最后一块优先级最高，尽量保留）。
  const keptIdx = new Set<number>()
  let keptTokens = systemTokens
  const lastBlockIdx = blocks.length - 1
  const isFirstUserBlock = (idx: number): boolean => {
    const b = blocks[idx]
    return b.start <= firstUserIndex && b.end > firstUserIndex
  }
  // 必保块优先级：最后一块(最新上下文) > 首条 user 块(任务起点) > 最近轮 > 其它。
  const priorityOf = (idx: number): number => {
    if (idx === lastBlockIdx) return 3
    if (isFirstUserBlock(idx)) return 2
    if (blocks[idx].start >= recentTurnStart) return 1
    return 0
  }
  const protectedOrder = Array.from(protectedBlockIdx).sort((a, b) => {
    const pa = priorityOf(a)
    const pb = priorityOf(b)
    if (pa !== pb) return pb - pa
    return blocks[b].importance - blocks[a].importance
  })
  for (const bi of protectedOrder) {
    const b = blocks[bi]
    if (keptTokens + b.tokens <= historyBudget || keptIdx.size === 0) {
      keptIdx.add(bi)
      keptTokens += b.tokens
    } else {
      dropReasons.push(`必保块[${b.start}-${b.end - 1}]因预算不足舍弃（${b.tokens} tokens）`)
    }
  }

  // ── Step 7：剩余块按重要性从高到低尝试装入。
  const optional = blocks
    .map((b, idx) => ({ b, idx }))
    .filter((x) => !protectedBlockIdx.has(x.idx))
    .sort((x, y) => {
      if (y.b.importance !== x.b.importance) return y.b.importance - x.b.importance
      return x.b.start - y.b.start // 同分保持原顺序
    })
  for (const { b, idx } of optional) {
    if (keptTokens + b.tokens <= historyBudget) {
      keptIdx.add(idx)
      keptTokens += b.tokens
    } else {
      dropReasons.push(`块[${b.start}-${b.end - 1}]重要性 ${b.importance.toFixed(1)} 低于预算上限，舍弃`)
    }
  }

  // ── Step 8：按原始顺序输出 system + 保留块。
  const result: LoopMessage[] = [...systemMsgs]
  const sortedKept = Array.from(keptIdx).sort((a, b) => blocks[a].start - blocks[b].start)
  for (const bi of sortedKept) result.push(...blocks[bi].messages)

  const stats: TrimStats = {
    originalCount: messages.length,
    keptCount: result.length,
    droppedCount: messages.length - result.length,
    foldedCount,
    originalTokens,
    keptTokens: estimateMessagesTokens(result, profile),
    budget: budget.history,
    dropReasons,
  }
  Object.defineProperty(result, TRIM_STATS_KEY, { value: stats, enumerable: false, configurable: true })

  return result
}

/** 读取 trim 结果里附加的统计（测试/诊断用）。 */
export function getTrimStats(messages: LoopMessage[]): TrimStats | undefined {
  return (messages as unknown as Record<string, TrimStats>)[TRIM_STATS_KEY]
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 4 节：系统提示组装（<system-reminder> 通道）
 *
 * 增强 system 由四段组成：
 *   A. 任务分析摘要  —— 领域/复杂度/风险/意图，让模型知道"这是什么活"。
 *   B. 执行计划      —— 目标 + 分层步骤 + 依赖，让模型知道"按什么顺序干"。
 *   C. 策略提示      —— 来自 RouteDecision 的覆盖参数（轮次、工具、验证等）。
 *   D. 护栏规则      —— 简明规则清单（危险操作、密钥、循环等）。
 *
 * 全部包在 <system-reminder> 标签里：这是本项目约定的"系统通道"，渲染层与正文分离，
 * 不污染用户可见内容。
 * ════════════════════════════════════════════════════════════════════════════ */

/** 领域中文名（提示里用中文更符合中文用户习惯）。 */
const DOMAIN_LABEL: Record<TaskDomain, string> = {
  code: '代码工程',
  file: '文件操作',
  shell: '命令行',
  research: '调研检索',
  writing: '写作',
  data: '数据分析',
  creative: '创意创作',
  planning: '规划设计中',
  qa: '测试验证',
  conversation: '日常对话',
}

const COMPLEXITY_LABEL: Record<TaskComplexity, string> = {
  trivial: '极简',
  simple: '简单',
  moderate: '中等',
  complex: '复杂',
  expert: '专家级',
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '极高',
}

const STRATEGY_LABEL: Record<string, string> = {
  direct: '直接回答',
  single_tool: '单工具调用',
  iterative: '多轮工具循环',
  autonomous: '自主目标闭环',
  deep: '深度工程（全套护栏）',
}

/** A 段：任务分析摘要。 */
function formatAnalysisSummary(analysis: TaskAnalysis): string {
  const lines: string[] = []
  lines.push('【任务画像】')
  lines.push(`- 领域：${DOMAIN_LABEL[analysis.domain] || analysis.domain}（置信度 ${Math.round(analysis.confidence * 100)}%）`)
  lines.push(`- 复杂度：${COMPLEXITY_LABEL[analysis.complexity.level] || analysis.complexity.level}（${analysis.complexity.score}/100）`)
  lines.push(`- 风险等级：${RISK_LABEL[analysis.risk] || analysis.risk}`)
  if (analysis.intent) lines.push(`- 意图：${analysis.intent}`)
  // 次领域（top 2）帮助模型理解多领域混合任务。
  const alts = analysis.domains
    .filter((d) => d.domain !== analysis.domain)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
  if (alts.length > 0) {
    lines.push(`- 相关领域：${alts.map((d) => `${DOMAIN_LABEL[d.domain] || d.domain}(${Math.round(d.weight * 100)}%)`).join('、')}`)
  }
  if (analysis.complexity.reasons.length > 0) {
    lines.push(`- 评分依据：${analysis.complexity.reasons.slice(0, 3).join('；')}`)
  }
  return lines.join('\n')
}

/** B 段：执行计划（分层展示，标注依赖与建议工具）。 */
function formatPlanDigest(plan: ExecutionPlan | null): string {
  if (!plan || plan.steps.length === 0) return ''
  const lines: string[] = []
  lines.push('【执行计划】')
  lines.push(`目标：${plan.goal}`)
  const byId = new Map(plan.steps.map((s) => [s.id, s]))
  // 用 levels 分层输出，同一层用「｜」连接表示可并行。
  for (let li = 0; li < plan.levels.length; li++) {
    const ids = plan.levels[li]
    if (!ids || ids.length === 0) continue
    const parts = ids.map((id) => {
      const step = byId.get(id)
      if (!step) return id
      const dep = step.dependsOn.length ? `；依赖 ${step.dependsOn.join(',')}` : ''
      const tools = step.tools.length ? `；工具 ${step.tools.join(',')}` : ''
      return `${id} ${step.title}${dep}${tools}`
    })
    lines.push(`第 ${li + 1} 层${ids.length > 1 ? '（可并行）' : ''}：${parts.join(' ｜ ')}`)
  }
  if (plan.criticalPath.length > 0) {
    lines.push(`关键路径：${plan.criticalPath.join(' → ')}`)
  }
  lines.push(`预计轮次：${plan.estimatedRounds}`)
  return lines.join('\n')
}

/** C 段：策略提示（来自路由决策的覆盖参数）。 */
function formatStrategyHint(decision: RouteDecision): string {
  const lines: string[] = []
  lines.push('【执行策略】')
  lines.push(`- 路线：${STRATEGY_LABEL[decision.strategy] || decision.strategy}（内核 ${decision.kernel}，置信度 ${Math.round(decision.confidence * 100)}%）`)
  if (decision.reasons.length > 0) {
    lines.push(`- 选路理由：${decision.reasons.slice(0, 3).join('；')}`)
  }
  const o = decision.overrides
  const hints: string[] = []
  if (o.maxRounds != null) hints.push(`最多 ${o.maxRounds} 轮`)
  if (o.maxTokens != null) hints.push(`单次输出上限 ${o.maxTokens} token`)
  if (o.temperature != null) hints.push(`温度 ${o.temperature}`)
  if (o.enableGuardrails === true) hints.push('启用全套护栏')
  if (o.enableGuardrails === false) hints.push('护栏降级（仅保留硬阻断）')
  if (o.enableVerification === true) hints.push('每步完成后须验证')
  if (o.hermesMode && o.hermesMode !== 'auto') hints.push(`工具协议 ${o.hermesMode}`)
  if (hints.length > 0) lines.push(`- 运行参数：${hints.join('；')}`)
  return lines.join('\n')
}

/** D 段：护栏规则（给模型的"行为契约"，与 chain.ts 的机器检测互为表里）。 */
function formatGuardrailRules(analysis: TaskAnalysis): string {
  const lines: string[] = []
  lines.push('【护栏规则】')
  lines.push('- 删除、覆盖系统文件/数据库、发送网络请求、付费操作前必须获得明确确认。')
  lines.push('- 不得在输出中复述密钥、令牌、API Key 等敏感凭据。')
  lines.push('- 避免对同一目标重复执行相同参数的工具调用；若失败应换策略而非盲目重试。')
  if (analysis.risk === 'high' || analysis.risk === 'critical') {
    lines.push('- 本任务为高风险：每一步都要说明将产生的影响，并优先选择可逆操作。')
  }
  if (analysis.needsTools) {
    lines.push('- 调用工具前先用一句话说明目的；拿到结果后核对是否符合预期再继续。')
  }
  return lines.join('\n')
}

/** 把一段文本包成 <system-reminder> 通道。 */
function wrapReminder(title: string, body: string): string {
  if (!body) return ''
  return `<system-reminder title="${title}">\n${body}\n</system-reminder>`
}

/* ════════════════════════════════════════════════════════════════════════════
 * 第 5 节：ContextAssemblerImpl 类与工厂
 * ════════════════════════════════════════════════════════════════════════════ */

export interface AssemblerOptions {
  /** 覆盖 token 估算口径。 */
  tokenProfile?: TokenEstimateProfile
  /** 覆盖默认"最近保留轮数"。 */
  keepRecentTurns?: number
  /** 关闭工具结果折叠。 */
  disableFold?: boolean
}

/**
 * ContextAssembler 的实现。无状态（除配置），所有方法都是纯函数式，可安全并发调用。
 */
export class ContextAssemblerImpl implements ContextAssembler {
  private readonly profile: TokenEstimateProfile
  private readonly keepRecentTurns: number
  private readonly fold: boolean

  constructor(opts: AssemblerOptions = {}) {
    this.profile = opts.tokenProfile || DEFAULT_TOKEN_PROFILE
    this.keepRecentTurns = opts.keepRecentTurns ?? 2
    this.fold = !opts.disableFold
  }

  /**
   * L1-L4 四级预算分配。totalTokens <= 0 时返回全 0 分配（不抛错，便于降级）。
   */
  allocate(totalTokens: number, analysis: TaskAnalysis, plan: ExecutionPlan | null): ContextBudgetAllocation {
    const total = Math.max(0, Math.floor(Number(totalTokens) || 0))
    if (total === 0) {
      return { system: 0, history: 0, tools: 0, plan: 0, reserved: 0, total: 0 }
    }
    // L1 基线 × L2 领域/复杂度权重 × L3 需求修正 → 归一化 → L3.5 reserved 下限。
    const domainW = DOMAIN_WEIGHTS[analysis.domain] || BASE_RATIO
    const complexityW = COMPLEXITY_WEIGHTS[analysis.complexity.level] || BASE_RATIO
    const weighted = mulRatios(mulRatios(BASE_RATIO, domainW), complexityW)
    const adjusted = applyDemandAdjustments(weighted, analysis, plan)
    const ratios = enforceReservedFloor(normalizeRatios(adjusted), analysis)
    // L4 落实为整数；窗口很小时（<800）放宽最小预算，避免下限吃掉全部额度。
    return materializeAllocation(total, ratios, total < 800)
  }

  /**
   * 历史裁剪。委托给 trimMessages，并注入本实例配置。
   */
  trim(messages: LoopMessage[], budget: ContextBudgetAllocation): LoopMessage[] {
    return trimMessages(messages, budget, {
      profile: this.profile,
      keepRecentTurns: this.keepRecentTurns,
      foldToolResults: this.fold,
      withStats: true,
    })
  }

  /**
   * 系统提示组装：四段各自包 <system-reminder>，按固定顺序拼成一个 system 文本。
   *
   * 顺序稳定性契约：analysis → plan → strategy → guardrail。
   * 用"标题 + 正文"的有序列表驱动拼装，而不是手写拼接语句，保证：
   *   1. 顺序由列表字面量的位置决定，维护时不会被打乱；
   *   2. 正文为空的段（如 plan 为 null、或计划没有任何步骤）整段跳过，
   *      不产生空标签，也不会留下连续空行。
   */
  buildSystemPrompt(analysis: TaskAnalysis, plan: ExecutionPlan | null, decision: RouteDecision): string {
    const segments: Array<[string, string]> = [
      ['task-analysis', formatAnalysisSummary(analysis)],
      ['execution-plan', formatPlanDigest(plan)],
      ['execution-strategy', formatStrategyHint(decision)],
      ['guardrails', formatGuardrailRules(analysis)],
    ]
    return segments
      .filter(([, body]) => body.length > 0)
      .map(([title, body]) => wrapReminder(title, body))
      .join('\n')
  }

  /**
   * 用与裁剪完全一致的口径估算任意文本 token（对外暴露，便于调用方做预算决策）。
   */
  estimateTokens(text: string): number {
    return estimateTextTokens(text, this.profile)
  }

  /**
   * 估算一组消息的 token（供调用方在 trim 前后对比，验证裁剪是否达标）。
   */
  estimateMessages(messages: LoopMessage[]): number {
    return estimateMessagesTokens(messages, this.profile)
  }

  /**
   * 预算分配的可解释文本：逐类说明"分到多少、为什么"。
   * 诊断面板可直接展示，回答"为什么这次给工具/历史这么多额度"。
   */
  explainAllocation(
    alloc: ContextBudgetAllocation,
    analysis: TaskAnalysis,
    plan: ExecutionPlan | null,
  ): string {
    const pct = (n: number) => alloc.total > 0 ? `${Math.round((n / alloc.total) * 100)}%` : '0%'
    const lines: string[] = []
    lines.push(`上下文预算 ${alloc.total} token（领域 ${analysis.domain}，复杂度 ${analysis.complexity.level}，风险 ${analysis.risk}）：`)
    lines.push(`  system   ${alloc.system} (${pct(alloc.system)}) —— 分析摘要/计划/策略/护栏规则`)
    lines.push(`  history  ${alloc.history} (${pct(alloc.history)}) —— 对话历史，按重要性与最近轮裁剪`)
    lines.push(`  tools    ${alloc.tools} (${pct(alloc.tools)}) —— 工具 schema${analysis.needsTools ? '' : '（本任务无需工具，已压缩）'}`)
    lines.push(`  plan     ${alloc.plan} (${pct(alloc.plan)}) —— 执行计划${plan ? `（${plan.steps.length} 步）` : '（无计划，已压缩）'}`)
    lines.push(`  reserved ${alloc.reserved} (${pct(alloc.reserved)}) —— 输出与错误恢复缓冲`)
    return lines.join('\n')
  }

  /**
   * 一站式组装：分配预算 → 裁剪历史 → 生成增强 system。
   * 返回的 messages 已把裁剪后的历史与新的 system 提示合并（system 置顶）。
   * 注意：不会修改传入的 messages / analysis / plan / decision。
   */
  assemble(
    totalTokens: number,
    messages: LoopMessage[],
    analysis: TaskAnalysis,
    plan: ExecutionPlan | null,
    decision: RouteDecision,
  ): { messages: LoopMessage[]; budget: ContextBudgetAllocation; system: string } {
    const budget = this.allocate(totalTokens, analysis, plan)
    const trimmed = this.trim(messages, budget)
    const systemText = this.buildSystemPrompt(analysis, plan, decision)
    const systemMsg: LoopMessage = { role: 'system', content: systemText }
    // 去掉裁剪结果里原有的 system（若有），用新生成的增强 system 统一置顶。
    const withoutSystem = trimmed.filter((m) => classifyMessage(m) !== 'system')
    return {
      messages: [systemMsg, ...withoutSystem],
      budget,
      system: systemText,
    }
  }
}

/**
 * 消息去重：连续完全相同（role + content + tool_calls）的消息折叠为一条。
 * 在某些重试/重放场景里历史会混入重复消息，浪费预算；在裁剪前调用可省额度。
 * 不修改入参，返回新数组。
 */
export function dedupeMessages(messages: LoopMessage[]): LoopMessage[] {
  const out: LoopMessage[] = []
  const keyOf = (m: LoopMessage): string => {
    const calls = Array.isArray(m.tool_calls)
      ? m.tool_calls.map((tc) => toolCallName(tc) + ':' + toolCallArgsText(tc)).join('|')
      : ''
    return `${String(m.role)}|${contentText(m.content)}|${calls}`
  }
  for (const m of messages) {
    if (out.length > 0 && keyOf(out[out.length - 1]) === keyOf(m)) continue
    out.push(m)
  }
  return out
}

/**
 * 对话摘要：从历史中抽取"任务起点 + 最近结论"的短文本，供日志/诊断或未来的
 * 上下文压缩复用。纯文本提取，不调用模型。
 */
export function buildConversationDigest(messages: LoopMessage[], maxChars = 600): string {
  const userMsgs = messages.filter((m) => classifyMessage(m) === 'user')
  const assistantMsgs = messages.filter((m) => classifyMessage(m) === 'assistant' && !hasToolCalls(m))
  const task = userMsgs.length > 0 ? contentText(userMsgs[0].content).slice(0, 200) : '（无用户消息）'
  const conclusion = assistantMsgs.length > 0 ? contentText(assistantMsgs[assistantMsgs.length - 1].content).slice(0, 200) : '（无结论）'
  const digest = `任务：${task}\n最新结论：${conclusion}\n轮次：${userMsgs.length}`
  return digest.length > maxChars ? digest.slice(0, maxChars) + '…' : digest
}

/**
 * 预算可行性分析：在真正裁剪之前判断 history 预算是否够放"必保"内容，
 * 给出可解释的诊断（是否需要更早折叠工具结果、是否窗口过小）。
 *
 * 这是"防御性上下文工程"的一环：当连 system + 最近一轮都放不下时，
 * 调用方可以选择切换更小模型/拒绝任务，而不是让裁剪悄悄丢掉关键上下文。
 */
export interface FeasibilityReport {
  feasible: boolean
  /** 必保内容估算 token（system 全文 + 最近一轮 + 首尾锚点）。 */
  essentialTokens: number
  /** 可用 history 预算。 */
  available: number
  /** 差额（正数表示超出）。 */
  overflow: number
  /** 建议（可解释）。 */
  suggestions: string[]
}

export function analyzeBudgetFeasibility(
  messages: LoopMessage[],
  budget: ContextBudgetAllocation,
  opts: Pick<TrimOptions, 'profile' | 'keepRecentTurns' | 'foldThreshold'> = {},
): FeasibilityReport {
  const profile = opts.profile || DEFAULT_TOKEN_PROFILE
  const keepRecent = opts.keepRecentTurns ?? 2
  const suggestions: string[] = []

  if (messages.length === 0) {
    return { feasible: true, essentialTokens: 0, available: budget.history, overflow: 0, suggestions }
  }

  let bodyStart = 0
  let systemTokens = 0
  while (bodyStart < messages.length && classifyMessage(messages[bodyStart]) === 'system') {
    systemTokens += estimateMessageTokens(messages[bodyStart], profile)
    bodyStart++
  }
  const body = messages.slice(bodyStart)
  const firstUser = body.findIndex((m) => classifyMessage(m) === 'user')
  const turns = splitTurns(body)
  const recentStart = turns.length > keepRecent ? turns[turns.length - keepRecent].start : 0

  let foldedTokens = 0
  for (const m of body) {
    if (isFoldableToolMessage(m) && String(m.content).length > (opts.foldThreshold ?? TOOL_FOLD_THRESHOLD)) {
      const f = foldToolResult(String(m.content), opts.foldThreshold)
      foldedTokens += estimateMessageTokens({ ...m, content: f.text } as LoopMessage, profile)
    } else {
      foldedTokens += estimateMessageTokens(m, profile)
    }
  }

  const essentialBodyStart = Math.min(firstUser < 0 ? recentStart : firstUser, recentStart)
  let essential = 0
  for (let i = essentialBodyStart; i < body.length; i++) {
    if (i >= recentStart || i === body.length - 1 || i === firstUser) {
      essential += estimateMessageTokens(body[i], profile)
    }
  }
  const rawBodyTokens = estimateMessagesTokens(body, profile)
  const foldRatio = foldedTokens > 0 ? foldedTokens / Math.max(1, rawBodyTokens) : 1
  const essentialTokens = Math.ceil(systemTokens + essential * Math.min(1, foldRatio))
  const available = Math.max(0, budget.history + Math.max(0, budget.system - systemTokens))
  const overflow = Math.max(0, essentialTokens - available)

  if (overflow > 0) {
    suggestions.push(`必保上下文超出预算 ${overflow} token，建议折叠更多工具结果或降低最近保留轮数`)
    if (budget.total < 2000) suggestions.push('当前上下文窗口偏小，建议切换更大上下文模型')
  } else {
    suggestions.push('预算充足：最近轮与首尾锚点均可完整保留')
  }
  if (foldRatio < 0.8) suggestions.push(`工具结果折叠可节省约 ${Math.round((1 - foldRatio) * 100)}% 的历史 token`)

  return { feasible: overflow === 0, essentialTokens, available, overflow, suggestions }
}

/**
 * 生成"预算 × 裁剪效果"诊断表：在若干典型窗口规模下，对同一组消息试跑裁剪，
 * 报告每次保留/丢弃条数与预算使用比例。帮助调参——例如判断某个窗口下
 * 是否有必要折叠工具结果、最近轮保护是否过于激进。
 * 不修改消息，仅做估算与模拟。
 */
export function diagnoseTrimCurve(
  messages: LoopMessage[],
  analysis: TaskAnalysis,
  plan: ExecutionPlan | null,
  totals: number[] = [1000, 2000, 4000, 8000, 16000],
): Array<{ total: number; historyBudget: number; kept: number; dropped: number; utilization: number }> {
  const a = new ContextAssemblerImpl()
  return totals.map((total) => {
    const budget = a.allocate(total, analysis, plan)
    const trimmed = a.trim(messages, budget)
    const stats = getTrimStats(trimmed)
    const keptTokens = stats?.keptTokens ?? 0
    return {
      total,
      historyBudget: budget.history,
      kept: trimmed.length,
      dropped: Math.max(0, messages.length - trimmed.length),
      // 利用率：裁剪后 token / 可用 history 预算（>1 说明仍有溢出，<1 说明有余量）。
      utilization: budget.history > 0 ? Number((keptTokens / budget.history).toFixed(3)) : 0,
    }
  })
}

/** 工厂函数：创建默认配置的实现。 */
export function createAssembler(opts?: AssemblerOptions): ContextAssembler {
  return new ContextAssemblerImpl(opts)
}
