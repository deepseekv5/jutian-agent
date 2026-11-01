/**
 * Agent 主循环（v14.3，内核迁移第一步）
 *
 * 为什么搬到 shared：此前循环写在渲染层（renderer/engine/stream.ts），
 * 工具要经 HTTP 回环调后端；更要命的是**无法 headless**——定时任务只能
 * 另写一份 runTaskAgent，两份循环必然漂移。现在循环是纯 TS、零 DOM 依赖，
 * 服务端与渲染层都能跑：服务端提供真实工具执行，渲染层只负责把事件画出来。
 *
 * 依赖全部注入（callLLM / runTool / 客户端工具桥），因此可测试、可替换。
 *
 * 行为与原渲染层循环保持一致（逐段移植，未改语义）：
 *   1. 每轮发 messages + tools，流式收 chunk / thinking / tool_call
 *   2. 没有工具调用 → 结束
 *   3. 有 → 先串行过权限闸门，再把连续只读工具并行执行
 *   4. 工具结果回填 messages，继续下一轮（受轮次上限与循环防护约束）
 */

import type { PerfReport } from './agentPerf'
import { createAgentPerf } from './agentPerf'
import { ssePayloads } from './sse'
import { extractReasoning } from './reasoning'
import {
  parseToolCallsFromDelta, accumulateToolCallDelta,
  adoptNonStreamToolCalls, toolCallsToArray,
  type ToolCallAccum,
} from './toolCallStream'
import { checkRoundLimit, checkRepeatCall, callSignature, bumpToolUse, toolUseHint, bumpToolFail, toolFailHint } from './toolLoopGuard'
import { shouldRetryHttp, backoffMs, MAX_ATTEMPTS } from './retry'
import { buildToolsBlock, parseHermesToolCalls, stripToolCallBlocks, shouldInjectHermes } from './hermesTools'
import { truncateForBudget, microcompact, totalTokens, isContextOverflowError, type BudgetMessage } from './contextBudget'

/* ─── 对外类型 ─── */

export interface LoopTool {
  name: string
  description: string
  parameters: unknown
}

export interface LoopToolCall {
  id: string
  name: string
  arguments: string
  status?: 'running' | 'done' | 'error' | 'pending'
  result?: string
  changeId?: string
  started_at?: string
  finished_at?: string
  preLen?: number
  thinkLen?: number
}

export interface LoopMessage {
  role: string
  content?: unknown
  tool_calls?: unknown[]
  tool_call_id?: string
  [k: string]: unknown
}

/** 需要渲染层介入（权限确认 / 客户端工具）。服务端捕获后把消息原样返回，
 *  渲染层处理完再带着新消息重新调用——不维持服务端会话状态，避免悬挂连接。 */
export class NeedsClientError extends Error {
  kind: 'confirm' | 'client_tool'
  toolCall: LoopToolCall
  scopeKey?: string
  messages: LoopMessage[]
  partial: { content: string; thinking: string; toolCalls: LoopToolCall[] }
  constructor(kind: 'confirm' | 'client_tool', toolCall: LoopToolCall, messages: LoopMessage[], partial: { content: string; thinking: string; toolCalls: LoopToolCall[] }, scopeKey?: string) {
    super(kind === 'confirm' ? '需要用户确认' : '需要客户端执行工具')
    this.name = 'NeedsClientError'
    this.kind = kind
    this.toolCall = toolCall
    this.messages = messages
    this.partial = partial
    this.scopeKey = scopeKey
  }
}

export interface ToolRunResult {
  success: boolean
  output?: string
  error?: string
  changeId?: string
}

export interface AgentEvents {
  onChunk?: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolStart?: (tc: LoopToolCall) => void
  onToolEnd?: (tc: LoopToolCall) => void
  onToolDraft?: (name: string) => void
  onNetStatus?: (phase: 'connecting' | 'first-token' | 'retrying', info?: { attempt?: number }) => void
  onPerf?: (r: PerfReport) => void
}

export interface AgentLoopDeps {
  /** 发给模型的工具（已按开关过滤） */
  tools: LoopTool[]
  /** 发一次流式补全请求，返回 SSE 响应（鉴权/代理在调用方处理） */
  callLLM: (body: string, signal?: AbortSignal) => Promise<Response>
  /** 执行工具（服务端注入 executeToolCore；渲染层注入 HTTP 调用） */
  runTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolRunResult>
  /** 客户端工具判定（如任务清单、计划）：不在服务端执行 */
  isClientTool: (name: string) => boolean
  /** 客户端工具执行（返回作为 tool result 的字符串） */
  runClientTool?: (tc: LoopToolCall) => Promise<string>
  /** 权限闸门：返回字符串=拒绝并作为结果；null/undefined=放行 */
  confirmTool?: (tc: LoopToolCall) => Promise<string | null | undefined>
  /** 该调用是否需要渲染层介入（确认弹窗 / 客户端工具）。返回 'confirm' | 'client_tool' | null */
  needsClient?: (tc: LoopToolCall) => 'confirm' | 'client_tool' | null
  /** 审批请求的作用域键（「本会话允许」用它记忆） */
  scopeKeyOf?: (tc: LoopToolCall) => string | undefined
  /** 续跑：上一段已累积的内容（服务端无状态，靠它把多段拼回整轮） */
  resume?: { content: string; thinking: string; toolCalls: LoopToolCall[] }
  /** 续跑：上一步因「需要确认」中断的调用。decision 为拒绝文案时直接记入结果。
   *  必须在发请求前执行——此时 messages 末尾是 assistant(tool_calls)，缺 tool 响应
   *  直接发给上游会因「悬空 tool_calls」被拒。 */
  pendingTool?: { toolCall: LoopToolCall; decision?: string | null }
  /** 大输出落盘，返回可引用的路径（失败返回 null） */
  saveLargeOutput?: (toolName: string, text: string) => Promise<string | null>
  events: AgentEvents
  signal?: AbortSignal
  model: string
  apiBase: string
  /** 上下文窗口（决定 max_tokens） */
  contextWindow?: number
  /** 输入 token 预算（缺省按 contextWindow 的 80% 估算）；超出时裁剪历史 */
  contextBudget?: number
  /** 是否启用老工具结果清空（默认开） */
  microcompact?: boolean
  /** Hermes 注入模式：auto / on / off */
  hermesMode?: string
  /** 已关闭的工具名（插件开关） */
  disabledTools?: string[]
  maxTokens?: number
}

export interface AgentLoopResult {
  content: string
  thinking: string
  toolCalls: LoopToolCall[]
  /** 是否因为轮次上限/中止提前结束 */
  stopped?: 'round-limit' | 'aborted' | 'error'
  error?: string
}

/* ─── 常量 ─── */

/** 只读工具：无副作用、相互独立，可并行 */
export const READONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'search_files', 'search_content', 'web_search', 'web_fetch',
  'system_info', 'process_list', 'port_check', 'recall',
  'text_tools', 'json_process', 'timestamp_tools', 'uuid_generate', 'random_tools',
  'color_tools', 'hash_tools', 'base64_tools', 'url_tools',
])

/** 单工具硬超时 */
export const TOOL_TIMEOUT_MS = 180_000

/** 命令/日志类输出保尾（错误堆栈在结尾） */
const TAIL_KEEP_TOOLS = new Set(['shell', 'npm_run', 'git_operation', 'run_tests', 'web_fetch'])

/** 工具结果截断：40K 对模型足够判断下一步；超限按工具类型决定保头还是保尾 */
export function clampToolResult(text: string, toolName?: string): string {
  const MAX = 40_000
  if (!text || text.length <= MAX) return text
  const head = Math.floor(MAX * 0.3)
  const tail = MAX - head
  if (toolName && TAIL_KEEP_TOOLS.has(toolName)) {
    return text.slice(0, head)
      + '\n\n…[中间 ' + (text.length - MAX) + ' 字符已省略；下方保留末尾 ' + tail + ' 字符（错误堆栈通常在结尾）]…\n\n'
      + text.slice(-tail)
  }
  return text.slice(0, MAX) + '\n\n[输出过长已截断：原始 ' + text.length + ' 字符，仅保留前 ' + MAX + '。如需完整内容，请用范围参数分段读取。]'
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))])
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/* ─── 主循环 ─── */

export async function runAgentLoop(messages: LoopMessage[], deps: AgentLoopDeps): Promise<AgentLoopResult> {
  const { events, signal } = deps
  const perf = createAgentPerf()
  perf.setModel(deps.model)

  let toolRound = 0
  let wrapUp = false
  let overflowRetried = false
  const callSignatures = new Map<string, number>()
  const toolUseCounts = new Map<string, number>()
  const failCounter = { n: 0 }
  // 思考跨轮累积：否则「思考→工具→再思考」时只剩最后一轮
  let fullThinking = deps.resume?.thinking || ''
  let fullContent = deps.resume?.content || ''
  const allToolCalls: LoopToolCall[] = [...(deps.resume?.toolCalls || [])]

  const maxTokens = deps.maxTokens ?? (Number(deps.contextWindow) >= 8000 ? 16384 : 8192)

  // 先补完中断的调用（确认后继续）：此刻 messages 末尾是 assistant(tool_calls)，
  // 必须先补上对应的 tool 消息，否则下一轮请求是非法历史
  if (deps.pendingTool) {
    const { toolCall, decision } = deps.pendingTool
    const obj: LoopToolCall = { ...toolCall, status: 'running', started_at: new Date().toISOString() }
    events.onToolStart?.(obj)
    if (decision) {
      obj.status = 'error'
      obj.result = String(decision)
      obj.finished_at = new Date().toISOString()
      events.onToolEnd?.(obj)
      allToolCalls.push(obj)
      messages.push({ role: 'tool', tool_call_id: obj.id, content: String(decision) })
    } else {
      let parsedArgs: Record<string, unknown> = {}
      try { parsedArgs = JSON.parse(toolCall.arguments || '{}') } catch { parsedArgs = {} }
      const t0 = Date.now()
      try {
        const result = await withTimeout(deps.runTool(toolCall.name, parsedArgs, signal), TOOL_TIMEOUT_MS,
          '工具 ' + toolCall.name + ' 执行超时（180 秒），已中止等待。')
        let outText = result.success ? (result.output || '') : ''
        if (outText.length > 50_000 && result.success && deps.saveLargeOutput) {
          try { const fname = await deps.saveLargeOutput(toolCall.name, outText); if (fname) outText = clampToolResult(outText, toolCall.name) + '\n[完整输出已保存到工作区: ' + fname + ']' } catch { /* 落盘失败退回纯截断 */ }
        }
        obj.status = result.success ? 'done' : 'error'
        obj.result = result.success ? clampToolResult(outText, toolCall.name) : ('❌ 错误: ' + result.error)
        if (result.changeId) obj.changeId = result.changeId
        messages.push({ role: 'tool', tool_call_id: obj.id, content: obj.result })
      } catch (te) {
        obj.status = 'error'
        obj.result = '❌ 错误: ' + (te instanceof Error ? te.message : String(te))
        messages.push({ role: 'tool', tool_call_id: obj.id, content: obj.result })
      }
      obj.finished_at = new Date().toISOString()
      events.onToolEnd?.(obj)
      allToolCalls.push(obj)
      perf.addTool(1, toolCall.name, Date.now() - t0, obj.status !== 'error')
    }
  }

  while (true) {
    if (signal?.aborted) {
      return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }
    }
    toolRound++
    perf.roundStart(toolRound)
    const roundCheck = checkRoundLimit(toolRound)
    if (roundCheck.exceeded) {
      // 硬停会丢掉整个 run 的成果。改为：禁用工具再问一轮，让它把已有信息
      // 总结成最终答复；收尾提示**只进本次请求**，不写回 messages——
      // 落库的幽灵指令会污染后续所有轮次（模型会一直以为「用户要求别调工具」）。
      if (!wrapUp) { wrapUp = true } else {
        events.onPerf?.(perf.finish())
        return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'round-limit', error: roundCheck.message }
      }
    }

    const disabled = new Set(deps.disabledTools || [])
    const tools = deps.tools.filter((t) => !disabled.has(t.name))

    // Hermes 文本协议按需注入（免费/小模型线路）
    const hermesEnabled = tools.length > 0 && shouldInjectHermes(deps.model, deps.apiBase, deps.hermesMode)
    const wireMessages = (() => {
      if (!hermesEnabled) return messages
      const block = buildToolsBlock(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), { compact: true })
      if (!block) return messages
      const copy = [...messages]
      if (copy[0] && copy[0].role === 'system') {
        copy[0] = { ...copy[0], content: String(copy[0].content ?? '') + block }
      } else {
        copy.unshift({ role: 'system', content: block })
      }
      return copy
    })()

    // 上下文预算（v14.5）：超预算先清老工具结果，再按 token 裁剪，
    // 切点会修复成合法历史（不以 tool 开头、不留悬空 tool_calls）
    const budget = deps.contextBudget || Math.floor((Number(deps.contextWindow) || 0) * 0.8) || 0
    let sendMessages = wireMessages as BudgetMessage[]
    if (budget > 0) {
      const used = totalTokens(sendMessages)
      if (used > budget * 0.8 && deps.microcompact !== false) {
        const mc = microcompact(sendMessages)
        if (mc.cleared > 0) sendMessages = mc.messages
      }
      if (totalTokens(sendMessages) > budget) {
        sendMessages = truncateForBudget(sendMessages, budget).messages
      }
    }

    if (wrapUp) {
      sendMessages = [...sendMessages, {
        role: 'user',
        content: '【系统】工具调用轮次已用尽。请立刻基于已有信息用文字给出最终答复，不要再调用任何工具。',
      }]
    }

    const makeBody = () => JSON.stringify({
      model: deps.model,
      messages: sendMessages,
      tools: wrapUp ? [] : tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: wrapUp ? 'none' : 'auto',
      stream: true,
      max_tokens: maxTokens,
    })

    // 重试循环：网络异常与 429/5xx 退避重试；只在「头到手、未读流」阶段重试
    let res: Response | null = null
    let lastErr: Error | null = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      events.onNetStatus?.(attempt === 1 ? 'connecting' : 'retrying', attempt > 1 ? { attempt } : undefined)
      perf.llmRequestStart()
      let netErr: Error | null = null
      try {
        res = await deps.callLLM(makeBody(), signal)
      } catch (e) {
        if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }
        netErr = e instanceof Error ? e : new Error(String(e))
      }
      if (netErr) {
        lastErr = netErr
        if (attempt >= MAX_ATTEMPTS) throw netErr
        await sleepAbortable(backoffMs(attempt), signal)
        continue
      }
      if (res && res.ok) break
      const errText = await res!.text().catch(() => '')
      // 上下文溢出（上游 400）：重试无用，必须裁剪后重放。
      // 只重放一次，避免和「模型确实超长」互相拉扯。
      if (isContextOverflowError(errText) && !overflowRetried) {
        overflowRetried = true
        const cur = budget || totalTokens(sendMessages)
        const tighter = Math.max(2000, Math.floor(cur * 0.5))
        sendMessages = truncateForBudget(sendMessages, tighter).messages
        attempt--
        continue
      }
      const msg = buildUpstreamError(res!.status, errText)
      const decision = shouldRetryHttp(res!.status, attempt, res!.headers.get('retry-after'))
      if (!decision.retry) throw new Error(msg)
      lastErr = new Error(msg)
      res = null
      await sleepAbortable(decision.delayMs, signal)
    }
    if (!res) throw lastErr ?? new Error('请求失败：未知原因')
    if (!res.body) throw new Error('No response body')

    let roundContent = ''
    const toolCallMap = new Map<number, ToolCallAccum>()
    let draftAnnounced = false

    for await (const data of ssePayloads(res.body)) {
      if (data === '[DONE]') break
      if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }
      try {
        const parsed = JSON.parse(data)
        const choice = parsed.choices?.[0]
        if (!choice) continue
        const delta = choice.delta

        const think = extractReasoning(delta)
        if (think) {
          perf.firstToken()
          fullThinking += think
          events.onThinking?.(think)
        }
        if (delta?.content) {
          perf.firstToken()
          roundContent += delta.content
          fullContent += delta.content
          events.onChunk?.(delta.content)
        }
        const parsedTcs = parseToolCallsFromDelta(delta)
        if (parsedTcs) {
          for (const tc of parsedTcs) accumulateToolCallDelta(toolCallMap, tc)
          if (!draftAnnounced) {
            draftAnnounced = true
            events.onToolDraft?.(parsedTcs[0]?.function?.name || '…')
          }
        }
        if (choice.finish_reason === 'tool_calls') {
          adoptNonStreamToolCalls(toolCallMap, choice.message?.tool_calls)
        }
      } catch { /* 忽略坏行 */ }
    }

    let toolCalls = toolCallsToArray(toolCallMap)

    // Hermes 文本协议回退
    if (toolCalls.length === 0 && roundContent.includes('<tool_call>')) {
      const hermes = parseHermesToolCalls(roundContent)
      if (hermes.length > 0) {
        toolCalls = hermes.map((h, i) => ({ id: 'hermes_' + i + '_' + Date.now(), name: h.name, arguments: h.arguments }))
        roundContent = stripToolCallBlocks(roundContent)
        fullContent = stripToolCallBlocks(fullContent)
      }
    }

    perf.llmStreamEnd()

    // 没有工具调用 → 完成。用跨轮累积的全文（与旧渲染层循环一致）：
    // 只取最后一轮会丢掉「我先看看 → 工具 → 结果如下」里前半句
    if (toolCalls.length === 0) {
      const content = stripToolCallBlocks(fullContent)
      events.onPerf?.(perf.finish())
      return { content, thinking: fullThinking, toolCalls: allToolCalls }
    }

    // 记入历史
    messages.push({
      role: 'assistant',
      content: roundContent || undefined,
      tool_calls: toolCalls.map((tc, idx) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
        index: idx,
      })),
    })

    // 第一遍：串行过闸门（确认弹窗必须一次一个）
    type Planned = { tc: (typeof toolCalls)[number]; obj: LoopToolCall }
    const plans: Planned[] = []
    for (const tc of toolCalls) {
      if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }

      const repeat = checkRepeatCall(callSignatures, callSignature(tc.name, tc.arguments))
      if (repeat.blocked) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: repeat.message })
        continue
      }

      const obj: LoopToolCall = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: 'running',
        started_at: new Date().toISOString(),
      }
      events.onToolStart?.(obj)

      // 需要渲染层介入（确认弹窗 / 客户端工具）：抛给调用方，由它处理后带着
      // 更新后的 messages 重新调用本循环（无状态续跑）
      const need = deps.needsClient?.(obj)
      if (need) {
        throw new NeedsClientError(need, obj, messages, { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls }, deps.scopeKeyOf?.(obj))
      }

      const denial = await deps.confirmTool?.(obj)
      if (denial) {
        obj.status = 'error'
        obj.result = denial
        obj.finished_at = new Date().toISOString()
        events.onToolEnd?.(obj)
        allToolCalls.push(obj)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: denial })
        continue
      }
      plans.push({ tc, obj })
    }

    const execOne = async (pl: Planned): Promise<string> => {
      const t0 = Date.now()
      let toolResult: string
      if (deps.isClientTool(pl.tc.name)) {
        toolResult = (await deps.runClientTool?.(pl.obj)) || '{"ok":true}'
        pl.obj.status = 'done'
      } else {
        let parsedArgs: Record<string, unknown> = {}
        try { parsedArgs = JSON.parse(pl.tc.arguments || '{}') } catch { parsedArgs = {} }
        try {
          const result = await withTimeout(
            deps.runTool(pl.tc.name, parsedArgs, signal),
            TOOL_TIMEOUT_MS,
            '工具 ' + pl.tc.name + ' 执行超时（180 秒），已中止等待。如确需继续请拆小任务。',
          )
          let outText = result.success ? (result.output || '') : ''
          if (outText.length > 50_000 && result.success && deps.saveLargeOutput) {
            try {
              const fname = await deps.saveLargeOutput(pl.tc.name, outText)
              if (fname) outText = clampToolResult(outText, pl.tc.name) + '\n[完整输出已保存到工作区: ' + fname + ']'
            } catch { /* 落盘失败退回纯截断 */ }
          }
          toolResult = result.success ? clampToolResult(outText, pl.tc.name) : ('❌ 错误: ' + result.error)
          pl.obj.status = result.success ? 'done' : 'error'
          if (result.changeId) pl.obj.changeId = result.changeId
        } catch (te) {
          toolResult = '❌ 错误: ' + (te instanceof Error ? te.message : String(te))
          pl.obj.status = 'error'
        }
      }
      const ms = Date.now() - t0
      pl.obj.result = toolResult
      pl.obj.finished_at = new Date().toISOString()
      events.onToolEnd?.(pl.obj)
      allToolCalls.push(pl.obj)
      perf.addTool(toolRound, pl.tc.name, ms, pl.obj.status !== 'error')

      const base = (pl.obj.result && String(pl.obj.result).trim())
        ? String(pl.obj.result)
        : (pl.obj.status === 'error'
          ? ('工具 ' + pl.tc.name + ' 执行失败（未返回具体错误信息）。')
          : ('工具 ' + pl.tc.name + ' 已执行，但返回空结果。'))
      const useN = bumpToolUse(toolUseCounts, pl.tc.name)
      void useN
      const failN = bumpToolFail(failCounter, pl.obj.status === 'error')
      return base + toolUseHint(toolUseCounts, pl.tc.name) + toolFailHint(failN, pl.tc.name)
    }

    let i = 0
    while (i < plans.length) {
      const group: Planned[] = []
      while (i < plans.length && READONLY_TOOLS.has(plans[i].tc.name)) { group.push(plans[i]); i++ }
      if (group.length === 0) { group.push(plans[i]); i++ } // 有副作用：单发串行
      const results = group.length === 1 ? [await execOne(group[0])] : await Promise.all(group.map(execOne))
      for (let k = 0; k < group.length; k++) {
        messages.push({ role: 'tool', tool_call_id: group[k].tc.id, content: results[k] })
      }
    }
  }
}

/** 上游错误 → 可操作中文提示（与渲染层 httpErrors 语义一致的精简版） */
export function buildUpstreamError(status: number, errText: string): string {
  const detail = (errText || '').slice(0, 300)
  if (status === 401 || status === 403) return `鉴权失败（${status}）：API Key 或权限不正确。请到 设置 → 推理 检查。${detail ? ' ' + detail : ''}`
  if (status === 402) return `余额或额度不足（402）。请换用免费模型或充值。${detail ? ' ' + detail : ''}`
  if (status === 404) return `接口不存在（404）：请检查 API 地址是否以 /v1 结尾、模型名是否正确。${detail ? ' ' + detail : ''}`
  if (status === 429) return `请求过于频繁（429），已自动重试仍未成功。稍后再试或换模型。${detail ? ' ' + detail : ''}`
  if (status >= 500) return `上游服务异常（${status}），已自动重试仍未成功。${detail ? ' ' + detail : ''}`
  return `请求失败（${status}）${detail ? '：' + detail : ''}`
}
