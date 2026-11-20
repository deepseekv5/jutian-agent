/**
 * JT Core Ultra —— 高端 Agent 内核编排层（v15.0.0）
 *
 * gemini-cli（Apache-2.0）/ OpenHands SDK（MIT）核心子系统全量移植，
 * 拆分在 src/shared/ultra/ 模块族（各自可独立测试）：
 *
 *   types.ts            七态工具 FSM 类型 / 合法跃迁表
 *   toolScheduler.ts    state-manager + scheduler + tool-executor + policy + confirmation-bus
 *   loopDetection.ts    三层循环检测 + 一次性自救
 *   retry.ts            10 次抖动退避 / Retry-After / 内容重触发 / 有界模型回落
 *   chatCompression.ts  0.5 阈值 / 0.3 保留 / 3 轮保护 / 折叠 / 溢出预检
 *   nextSpeaker.ts      快速路径 + 结构化 LLM 判定 + 有序决策规则
 *   stuckDetector.ts    五场景卡死检测 + nudge 去重
 *   turn.ts             Turn 事件枚举 / MAX_TURNS=100 / 会话预算 / 退出条件
 *   tokenBudget.ts      模型上限表 / max_tokens 钳制 / 输入裁剪
 *   policy.ts           审批四态 / 沙箱升级 / 作用域键 / 权限档位映射
 *   context.ts          IDE 上下文 / gitignore 文件发现 / 工具输出折叠
 *
 * 本文件只负责把这些算法编排成一条与 JT Core Pro+（agentLoop.ts）完全同契约
 * 的循环（AgentLoopDeps / AgentEvents / NeedsClientError），由 serve.ts 按
 * engine 字段分发，原内核零改动、并存可切换。
 *
 * v18.0.0 内核重组：runUltraLoop 从约 220 行单闭包拆为六个阶段函数（与 agentLoop
 * 五阶段结构对齐），主循环只保留「轮次推进」骨架。拆分原则是行为等价——
 * 每段只是「移动代码 + 闭包变量改为 UltraContext/deps 显式传参」，判断逻辑、
 * 时序、事件顺序逐行保持；早退结果（aborted / error / overflow / 自然结束）
 * 由阶段函数以标记返回、骨架统一构造 UltraResult。runUltraLoop 签名与
 * UltraDeps 形状零改动（serve.cjs bundle 与测试都依赖）。
 */
import { ssePayloads } from './sse'
import { parseToolCallsFromDelta, accumulateToolCallDelta, adoptNonStreamToolCalls, toolCallsToArray } from './toolCallStream'
import { clampToolResult, buildUpstreamError } from './agentLoop'
import { checkRepeatCall, callSignature, bumpToolUse, toolUseHint } from './toolLoopGuard'
import { shouldInjectHermes, buildToolsBlock, parseHermesToolCalls, stripToolCallBlocks } from './hermesTools'
import { parseRetryAfter } from './retry'
import type { UltraToolCall, UltraMessage, UltraTool, ScheduledCall } from './ultra/types'
import { ToolCallStateMachine, yieldIfBlocked, decidePolicy, ConfirmationBus, SerialRequestQueue, normalizeOutcome } from './ultra/toolScheduler'
import { ToolLoopDetector, ContentLoopDetector, toolFingerprint, shouldSemanticCheck, LoopRecovery, STEP_BACK_MESSAGE } from './ultra/loopDetection'
import { LLM_CONFIDENCE_THRESHOLD, LLM_HISTORY_TURNS } from './ultra/loopDetection'
import { decideRetry, ModelFallback } from './ultra/retry'
import { compress, estimateMessagesTokens } from './ultra/chatCompression'
import { resolveNextSpeaker, CONTINUE_PROMPT } from './ultra/nextSpeaker'
import type { SpeakerContext } from './ultra/nextSpeaker'
import { StuckDetector } from './ultra/stuckDetector'
import { TurnBudget } from './ultra/turn'
import { resolveContextWindow, maxOutputTokens, trimToBudget } from './ultra/tokenBudget'
import { ApprovedScopes, SandboxEscalation, modeFromLevel } from './ultra/policy'
import type { ApprovalMode } from './ultra/policy'
import type { IdeContextStore } from './ultra/context'
import { IgnoreMatcher, clampOutput } from './ultra/context'

export type { UltraToolCall, UltraMessage, UltraTool } from './ultra/types'
export type { ToolState, ScheduledCall } from './ultra/types'
export { canTransition, TERMINAL_STATES } from './ultra/types'
export { ToolCallStateMachine, allReady } from './ultra/toolScheduler'
export { toolFingerprint, ToolLoopDetector, ContentLoopDetector, shouldSemanticCheck } from './ultra/loopDetection'
export { StuckDetector } from './ultra/stuckDetector'
export { fastNextSpeaker, parseNextSpeaker, resolveNextSpeaker } from './ultra/nextSpeaker'
export { needsCompression, findCompressSplitPoint } from './ultra/chatCompression'
export { delayWithJitter as ultraBackoff, quotaDelay as ultraQuotaDelay, isRetryableStatus as ultraRetryable } from './ultra/retry'
export { MAX_TURNS as ULTRA_MAX_TURNS } from './ultra/turn'

export interface UltraDeps {
  tools: UltraTool[]
  callLLM: (body: string, signal?: AbortSignal) => Promise<Response>
  runTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<{ success: boolean; output?: string; error?: string; changeId?: string; image?: string }>
  isClientTool: (name: string) => boolean
  runClientTool?: (tc: UltraToolCall) => Promise<string>
  confirmTool?: (tc: UltraToolCall) => Promise<string | null | undefined>
  needsClient?: (tc: UltraToolCall) => 'confirm' | 'client_tool' | null
  scopeKeyOf?: (tc: UltraToolCall) => string | undefined
  resume?: { content: string; thinking: string; toolCalls: UltraToolCall[] }
  pendingTool?: { toolCall: UltraToolCall; decision?: string | null }
  saveLargeOutput?: (toolName: string, text: string) => Promise<string | null>
  events: {
    onChunk?: (t: string) => void
    onThinking?: (t: string) => void
    onToolStart?: (tc: UltraToolCall) => void
    onToolEnd?: (tc: UltraToolCall) => void
    onToolDraft?: (name: string) => void
    onNetStatus?: (phase: 'connecting' | 'first-token' | 'retrying', info?: { attempt?: number }) => void
    onPerf?: (r: unknown) => void
  }
  signal?: AbortSignal
  model: string
  apiBase: string
  contextWindow?: number
  hermesMode?: string
  disabledTools?: string[]
  maxTokens?: number
  semanticLoopCheck?: (recent: UltraMessage[]) => Promise<boolean>
  fallbackModels?: string[]
  permissionLevel?: string
  ideContext?: IdeContextStore
  approvedScopes?: string[]
}
export interface UltraResult {
  content: string
  thinking: string
  toolCalls: UltraToolCall[]
  stopped?: 'round-limit' | 'aborted' | 'error' | 'loop-detected' | 'max-turns' | 'max-session-turns' | 'context-overflow'
  error?: string
}
export class UltraNeedsClientError extends Error {
  kind: 'confirm' | 'client_tool'
  toolCall: UltraToolCall
  scopeKey?: string
  messages: UltraMessage[]
  partial: { content: string; thinking: string; toolCalls: UltraToolCall[] }
  constructor(kind: 'confirm' | 'client_tool', toolCall: UltraToolCall, messages: UltraMessage[], partial: { content: string; thinking: string; toolCalls: UltraToolCall[] }, scopeKey?: string) {
    super(kind === 'confirm' ? '需要用户确认' : '需要客户端执行工具')
    this.name = 'NeedsClientError'
    this.kind = kind; this.toolCall = toolCall; this.messages = messages; this.partial = partial; this.scopeKey = scopeKey
  }
}

type ToolAccumMap = Map<number, { id: string; name: string; arguments: string }>
type ToolAccumSlot = { id: string; name: string; arguments: string }

interface UltraSSEEvent {
  choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: unknown[] }; finish_reason?: string; message?: { tool_calls?: unknown[] } }[]
}
const ULTRA_TOOL_TIMEOUT_MS = 180_000
const ULTRA_MAX_OUTPUT = 40_000
const READONLY = new Set([
  'read_file', 'list_dir', 'search_files', 'search_content', 'get_file_info',
  'web_search', 'web_fetch', 'system_info', 'process_list', 'port_check',
  'recall', 'text_tools', 'json_process', 'timestamp_tools', 'uuid_generate',
  'random_tools', 'color_tools', 'hash_tools', 'base64_tools', 'url_tools',
])

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}

function buildRequestBody(messages: UltraMessage[], toolsSchema: { type: 'function'; function: { name: string; description: string; parameters: unknown } }[], opts: { model: string; maxTokens?: number; toolChoice: boolean; wrapUp?: boolean; ideBlock?: string }): string {
  let msgs: UltraMessage[] = messages
  if (opts.ideBlock) {
    msgs = msgs[0]?.role === 'system'
      ? [{ ...msgs[0], content: String(msgs[0].content || '') + '\n\n' + opts.ideBlock }, ...msgs.slice(1)]
      : [{ role: 'system', content: opts.ideBlock }, ...msgs]
  }
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.wrapUp ? [...msgs, { role: 'user', content: '已接近本轮工具调用上限，请基于已有结果直接给出最终答复，不要再调用工具。' }] : msgs,
    stream: true,
  }
  if (toolsSchema.length) {
    body.tools = toolsSchema
    body.tool_choice = opts.toolChoice ? 'auto' : 'none'
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  return JSON.stringify(body)
}

async function execOne(deps: UltraDeps, tc: UltraToolCall, signal?: AbortSignal): Promise<{ text: string; image?: string }> {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(tc.arguments || '{}') } catch { /* 坏参数交工具层报错：args 保持空对象 */ }
  try {
    let outText: string
    let outImage: string | undefined
    if (deps.isClientTool(tc.name)) outText = deps.runClientTool ? await deps.runClientTool(tc) : '{"ok":true}'
    else {
      // v16.0.0：超时 timer 必须在结束后清除——此前工具正常返回后 timer 仍挂 180 秒，
      // 每工具泄漏一个定时器（长会话累积数十个）。
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          deps.runTool(tc.name, args, signal),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('工具执行超时（180 秒）')), ULTRA_TOOL_TIMEOUT_MS) }),
        ])
        outText = result.success ? (result.output ?? '') : ('❌ 错误: ' + (result.error || '工具执行失败'))
        if (result.changeId) tc.changeId = result.changeId
        // v16.3.6：截图等工具产出图片（dataUrl），随 tool 消息多模态发给模型
        if (result.image) outImage = String(result.image)
      } finally { if (timer) clearTimeout(timer) }
    }
    if (outText.length > ULTRA_MAX_OUTPUT) {
      outText = clampOutput(outText, ULTRA_MAX_OUTPUT)
      if (deps.saveLargeOutput) {
        try { const fname = await deps.saveLargeOutput(tc.name, outText); if (fname) outText = clampToolResult(outText, tc.name) + '\n[完整输出已保存到工作区: ' + fname + ']' } catch { /* 忽略 */ }
      }
    }
    return { text: outText, image: outImage }
  } catch (e) { return { text: '❌ 错误: ' + String((e as Error)?.message || e) } }
}

/* ═══ v18.0.0 内核重组：runUltraLoop 拆分为六个职责单一的阶段函数 ═══
 * 主循环只保留「轮次推进」骨架：组件实例化 → 消息准备（续跑/上下文/Hermes）→
 * 带重试请求 → 流式读取 → 循环检测+工具闸门 → 计划执行。
 * 跨轮状态集中在 UltraContext，不再散落在巨型闭包里。
 *
 * 行为等价性说明（对照原 185-406 行，逐段核对过）：
 *  - pendingTool 续跑在 turn 预算检查之前执行（prepareUltraMessages 'resume' 模式）；
 *  - 每轮上下文整理在 aborted 检查之后执行（'round' 模式），溢出退出保留在骨架；
 *  - retry / SSE / 闸门 / 执行四段代码逐行平移，只把闭包变量换成 ctx 显式取值；
 *  - 无工具分支（nextSpeaker / 语义检测 / 自然结束）随循环检测一起归入
 *    gateUltraToolCalls——它们在原实现中位于检测与闸门之间，时序不可拆开。 */

/** 跨轮上下文：算法组件实例化结果 + 请求缓存 + 累积输出（原散落在 runUltraLoop 闭包的局部变量） */
export interface UltraContext {
  /** 跨轮累积输出（resume 续跑起点，流式过程中持续追加） */
  fullContent: string
  fullThinking: string
  allToolCalls: UltraToolCall[]
  /** 算法组件（gemini-cli / OpenHands 全子系统实例） */
  repeatMap: Map<string, number>
  toolUseCounter: Map<string, number>
  toolLoop: ToolLoopDetector
  contentLoop: ContentLoopDetector
  recovery: LoopRecovery
  stuck: StuckDetector
  turnBudget: TurnBudget
  fallback: ModelFallback
  confirmationBus: ConfirmationBus
  requestQueue: SerialRequestQueue
  approvedScopes: ApprovedScopes
  sandbox: SandboxEscalation
  policyMode: ApprovalMode
  /** 预留：文件发现接入工作区扫描时启用 */
  ignoreMatcher: IgnoreMatcher
  ideBlock: string
  /** 语义循环检测的间隔游标 */
  lastSemanticCheck: number
  /** 收尾模式：接近轮次上限后禁用工具再问一轮 */
  wrappedUp: boolean
  /** 会话内不变的请求缓存（每轮/每次 attempt 重建纯属浪费） */
  tools: UltraTool[]
  toolsSchema: { type: 'function'; function: { name: string; description: string; parameters: unknown } }[]
  hermesBlock: string
  contextWindow: number
  maxTokens: number
}

/** 阶段零：组件实例化 + 缓存构建（原 191-222 行逐行平移） */
export function buildUltraContext(deps: UltraDeps): UltraContext {
  const ctx: UltraContext = {
    fullContent: deps.resume?.content || '',
    fullThinking: deps.resume?.thinking || '',
    allToolCalls: deps.resume?.toolCalls ? [...deps.resume.toolCalls] : [],
    repeatMap: new Map(),
    toolUseCounter: new Map(),
    toolLoop: new ToolLoopDetector(),
    contentLoop: new ContentLoopDetector(),
    recovery: new LoopRecovery(),
    stuck: new StuckDetector(),
    turnBudget: new TurnBudget(),
    fallback: new ModelFallback([deps.model, ...(deps.fallbackModels || [])]),
    confirmationBus: new ConfirmationBus(),
    requestQueue: new SerialRequestQueue(),
    approvedScopes: new ApprovedScopes(),
    sandbox: new SandboxEscalation(),
    policyMode: modeFromLevel(deps.permissionLevel || 'edit'),
    ignoreMatcher: new IgnoreMatcher(['node_modules', 'dist', 'release', '.git', '*.log']),
    ideBlock: deps.ideContext?.toPromptBlock() || '',
    lastSemanticCheck: 0,
    wrappedUp: false,
    tools: [],
    toolsSchema: [],
    hermesBlock: '',
    contextWindow: 0,
    maxTokens: 0,
  }
  ;(deps.approvedScopes || []).forEach(k => ctx.approvedScopes.approve(k))
  ctx.tools = deps.tools.filter(t => !(deps.disabledTools || []).includes(t.name))
  // v16.0.0：工具 schema 与 Hermes 文本块每轮/每次 attempt 重建纯属浪费——
  // deps.tools 在会话内不变，构建一次缓存进 ctx。
  ctx.toolsSchema = ctx.tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
  ctx.hermesBlock = (() => {
    if (!shouldInjectHermes(deps.model, deps.apiBase, deps.hermesMode) || !ctx.tools.length) return ''
    return buildToolsBlock(ctx.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })), { compact: true })
  })()
  ctx.contextWindow = resolveContextWindow(deps.model, deps.contextWindow)
  ctx.maxTokens = deps.maxTokens || maxOutputTokens(ctx.contextWindow)
  return ctx
}

export type PrepareMode = 'resume' | 'round'
export interface PreparedRound { reqMessages: UltraMessage[]; overflow: boolean }

/** 阶段一：消息准备。
 *  mode='resume'：无状态续跑，补齐悬空 tool_calls（原 224-229 行）——原实现位于
 *  turn 预算检查之前，骨架在预算检查前以 resume 模式调用一次，保持原时序。
 *  mode='round'：每轮上下文整理（溢出预检 / 压缩 / 裁剪，原 238-248 行）+ Hermes
 *  注入（原 250-256 行）；溢出以标记返回，骨架统一构造 context-overflow 结果。 */
export function prepareUltraMessages(ctx: UltraContext, messages: UltraMessage[], deps: UltraDeps, mode: PrepareMode): PreparedRound {
  if (mode === 'resume') {
    // 无状态续跑：补齐悬空 tool_calls
    const p = deps.pendingTool
    if (p) {
      messages.push({ role: 'tool', tool_call_id: p.toolCall.id, content: p.decision || p.toolCall.result || '' })
      if (!ctx.allToolCalls.some(t => t.id === p.toolCall.id)) ctx.allToolCalls.push({ ...p.toolCall, status: p.decision ? 'error' : 'done' })
    }
    return { reqMessages: messages, overflow: false }
  }

  // 上下文整理（v16.0.0 合并扫描）：此前 willOverflow + compress(needsCompression) + trimToBudget
  // 各全量扫一遍消息；现在一次 estimate 复用，压缩/裁剪各只在触发时执行。
  const tokenCount = estimateMessagesTokens(messages as Array<{ role: string; content?: string }>)
  if (tokenCount >= ctx.contextWindow * 0.92) return { reqMessages: messages, overflow: true }
  if (tokenCount / ctx.contextWindow >= 0.5) {
    const comp = compress(messages as Array<{ role: string; content?: string }>, ctx.contextWindow)
    if (comp.status === 'compressed') { messages.length = 0; messages.push(...(comp.messages as UltraMessage[])) }
  }
  // tokenBudget：输入裁剪（模块内已改单次遍历）
  const trimmed = trimToBudget(messages as Array<{ role: string; content?: string }>, ctx.contextWindow, estimateMessagesTokens)
  if (trimmed.dropped > 0) { messages.length = 0; messages.push(...(trimmed.messages as UltraMessage[])) }

  // Hermes 文本协议（block 已缓存在 ctx）
  let reqMessages = messages
  if (ctx.hermesBlock) {
    reqMessages = reqMessages[0]?.role === 'system'
      ? [{ ...reqMessages[0], content: String(reqMessages[0].content || '') + '\n\n' + ctx.hermesBlock }, ...reqMessages.slice(1)]
      : [{ role: 'system', content: ctx.hermesBlock }, ...reqMessages]
  }
  return { reqMessages, overflow: false }
}

export interface RequestRoundResult { res: Response | null; aborted?: boolean; error?: string }

/** 阶段二：带重试的 LLM 请求（抖动退避 + 有界模型回落，原 258-283 行逐行平移）。
 *  aborted / 失败以标记返回（error 保持原 lastErr 语义，可为空串），骨架统一
 *  构造 UltraResult——保持旧契约：循环内错误不向调用方抛出。 */
export async function requestUltraRound(ctx: UltraContext, reqMessages: UltraMessage[], deps: UltraDeps): Promise<RequestRoundResult> {
  const signal = deps.signal
  // retry：抖动退避 + 模型回落
  let res: Response | null = null
  let lastErr = ''
  for (let attempt = 1; attempt <= 10; attempt++) {
    if (signal?.aborted) return { res: null, aborted: true }
    deps.events.onNetStatus?.(attempt === 1 ? 'connecting' : 'retrying', { attempt })
    try {
      res = await deps.callLLM(buildRequestBody(reqMessages, ctx.toolsSchema, { model: ctx.fallback.current, maxTokens: ctx.maxTokens, toolChoice: !ctx.wrappedUp, wrapUp: ctx.wrappedUp, ideBlock: ctx.ideBlock }), signal)
      if (res.ok && res.body) break
      const status = res.status
      let bodyText = ''
      try { bodyText = (await res.text()).slice(0, 400) } catch { /* 读 body 失败：用空串走错误映射 */ }
      const decision = decideRetry(status, attempt, { shouldRetryOnContent: (c) => !c || !c.trim() }, { content: bodyText, serverDelayMs: parseRetryAfter(res.headers.get('retry-after')) })
      if (!decision.retry) {
        if (status === 429 && !ctx.fallback.exhausted && ctx.fallback.fallback()) { attempt = 0; continue }
        lastErr = status >= 400 ? buildUpstreamError(status, bodyText) : decision.reason
        res = null; break
      }
      await sleepAbortable(Math.min(decision.delayMs, 30000), signal)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { res: null, aborted: true }
      lastErr = String((e as Error)?.message || e)
      if (attempt < 10) await sleepAbortable(Math.min(5000 * Math.pow(2, attempt - 1), 30000), signal)
    }
  }
  if (!res || !res.ok || !res.body) return { res: null, error: lastErr }
  return { res }
}

export interface StreamRoundResult { toolCalls: UltraToolCall[]; roundContent: string; aborted?: boolean; error?: string }

/** 阶段三：SSE 收集（思考/正文/工具调用累积）+ Hermes 回退解析（原 285-312 行逐行平移）。
 *  累积写入 ctx.fullContent / ctx.fullThinking（原闭包变量的等价物）；onPerf 在
 *  Hermes 回退之后、循环检测之前发出——与原时序一致。 */
export async function streamUltraRound(res: Response, ctx: UltraContext, deps: UltraDeps, turn: number): Promise<StreamRoundResult> {
  // SSE 收集（res.ok && res.body 已由 requestUltraRound 保证；此处断言与非空检查等价）
  const toolCallMap: ToolAccumMap = new Map<number, ToolAccumSlot>()
  let roundContent = '', draftAnnounced = false
  const perf = { firstTokenMs: 0, t0: Date.now() }
  try {
    for await (const data of ssePayloads(res.body!)) {
      if (data === '[DONE]') continue
      let ev: UltraSSEEvent
      try { ev = JSON.parse(data) as UltraSSEEvent } catch { continue }
      const d = ev.choices?.[0]?.delta
      if (!d) continue
      if (d.reasoning_content || d.reasoning) { const t = String(d.reasoning_content || d.reasoning); ctx.fullThinking += t; deps.events.onThinking?.(t) }
      if (d.content) { if (!perf.firstTokenMs) perf.firstTokenMs = Date.now() - perf.t0; const t = String(d.content); roundContent += t; ctx.fullContent += t; deps.events.onChunk?.(t) }
      const parsed = parseToolCallsFromDelta(d)
      if (parsed) { for (const tc of parsed) accumulateToolCallDelta(toolCallMap, tc); if (!draftAnnounced) { draftAnnounced = true; deps.events.onToolDraft?.(parsed[0]?.function?.name || '…') } }
      if (ev.choices?.[0]?.finish_reason === 'tool_calls') adoptNonStreamToolCalls(toolCallMap, ev.choices[0].message?.tool_calls)
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { toolCalls: [], roundContent: '', aborted: true }
    return { toolCalls: [], roundContent: '', error: String((e as Error)?.message || e) }
  }

  let toolCalls = toolCallsToArray(toolCallMap) as unknown as UltraToolCall[]
  if (!toolCalls.length && roundContent.includes('<tool_call>')) {
    const hs = parseHermesToolCalls(roundContent)
    if (hs.length) { toolCalls = hs.map((h, i) => ({ id: 'hermes_' + i + '_' + Date.now(), name: h.name, arguments: h.arguments })); roundContent = stripToolCallBlocks(roundContent) }
  }
  deps.events.onPerf?.({ ...perf, turns: turn + 1, engine: 'ultra', toolCalls: toolCalls.length })
  return { toolCalls, roundContent }
}

export interface GateOutcome {
  plans: ScheduledCall[]
  /** 非空：骨架直接 return（循环硬停 / LLM 语义循环 / 自然结束） */
  exit?: UltraResult
  /** true：CONTINUE_PROMPT 已入列，骨架 continue 进入下一轮 */
  continueLoop?: boolean
}

/** 阶段四：三层循环检测（工具周期 / 内容复读 + 一次性自救）→ 无工具分支
 *  （nextSpeaker / 语义检测 / 自然结束）→ FSM 闸门（重复拦截 / needsClient /
 *  确认 / 策略）→ Stuck 提醒（原 314-366 行逐行平移，含 assistant 消息入列——
 *  它只在有工具调用时执行，且必须发生在闸门之前）。 */
export async function gateUltraToolCalls(ctx: UltraContext, deps: UltraDeps, messages: UltraMessage[], toolCalls: UltraToolCall[], roundContent: string, turn: number): Promise<GateOutcome> {
  // loopDetection：三层 + 一次性自救
  const toolHit = toolCalls.some(tc => ctx.toolLoop.add(toolFingerprint(tc.name, tc.arguments)))
  const signalRec = ctx.recovery.signal(toolHit || ctx.contentLoop.add(roundContent))
  if (signalRec === 'stop') return { plans: [], exit: { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'loop-detected', error: '循环检测硬停' } }
  if (signalRec === 'nudge') messages.push({ role: 'user', content: STEP_BACK_MESSAGE })

  // 无工具调用：nextSpeaker / 语义检测 / 自然结束
  if (!toolCalls.length) {
    const last = messages[messages.length - 1]
    const spkCtx: SpeakerContext = { pendingTools: 0, quotaError: false, skip: false, lastMessageRole: last?.role, lastMessageContent: typeof last?.content === 'string' ? last.content : '' }
    if (resolveNextSpeaker(spkCtx) === 'model') { messages.push({ role: 'user', content: CONTINUE_PROMPT }); return { plans: [], continueLoop: true } }
    if (deps.semanticLoopCheck && shouldSemanticCheck(turn, ctx.lastSemanticCheck, LLM_CONFIDENCE_THRESHOLD)) {
      ctx.lastSemanticCheck = turn
      if (await deps.semanticLoopCheck(messages.slice(-LLM_HISTORY_TURNS))) return { plans: [], exit: { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'loop-detected', error: 'LLM 判定为循环' } }
    }
    return { plans: [], exit: { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls } }
  }

  messages.push({ role: 'assistant', content: roundContent || undefined, tool_calls: toolCalls.map((tc, idx) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments }, index: idx })) })

  // stuckDetector + policy + 需要确认契约
  const plans: ScheduledCall[] = []
  for (const tc of toolCalls) {
    const obj: UltraToolCall = { ...tc, status: 'running', started_at: new Date().toISOString() }
    const fsm = new ToolCallStateMachine()
    const repeat = checkRepeatCall(ctx.repeatMap, callSignature(tc.name, tc.arguments))
    if (repeat.blocked) {
      obj.status = 'error'; obj.result = '❌ 错误: ' + (repeat.message || '重复调用被拦截')
      deps.events.onToolStart?.(obj); deps.events.onToolEnd?.(obj)
      ctx.stuck.push({ kind: 'error', sig: String(repeat.message || 'repeat'), ok: false })
      ctx.allToolCalls.push(obj); messages.push({ role: 'tool', tool_call_id: tc.id, content: obj.result }); continue
    }
    const need = deps.needsClient?.(obj) ?? null
    if (need) throw new UltraNeedsClientError(need, obj, messages, { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: [...ctx.allToolCalls, ...plans.map(p => p.tc)] }, deps.scopeKeyOf?.(obj))
    const denial = await deps.confirmTool?.(obj)
    if (denial) {
      obj.status = 'error'; obj.result = denial
      deps.events.onToolStart?.(obj); deps.events.onToolEnd?.(obj)
      ctx.allToolCalls.push(obj); messages.push({ role: 'tool', tool_call_id: tc.id, content: obj.result }); continue
    }
    const decision = decidePolicy(tc.name, { yolo: ctx.policyMode === 'never', confirmTools: new Set(['shell', 'delete_file']) })
    fsm.transition(decision === 'ask' ? 'awaiting_approval' : 'scheduled')
    if (decision === 'ask') {
      let a: Record<string, unknown> = {}
      try { a = JSON.parse(tc.arguments || '{}') } catch { /* 坏 JSON：参数为空 */ }
      const key = ctx.approvedScopes.scopeKeyOf(tc.name, a)
      if (ctx.approvedScopes.isApproved(key)) fsm.transition('scheduled')
      else { await ctx.confirmationBus.request(tc.id, '需要确认'); fsm.transition('scheduled') }
    }
    plans.push({ tc: obj, fsm, decision })
  }
  const stuckMsg = ctx.stuck.check()
  if (stuckMsg) messages.push({ role: 'user', content: '【卡死提醒】' + stuckMsg })
  return { plans }
}

export interface ExecuteResult { schedulerStuck?: boolean }

/** 阶段五：全就绪屏障 + 阻塞让出 + 串行请求队列（只读组并行 / 其余串行，
 *  原 368-399 行逐行平移）。调度器卡死以标记返回，骨架统一构造结果。 */
export async function executeUltraPlans(ctx: UltraContext, deps: UltraDeps, messages: UltraMessage[], plans: ScheduledCall[]): Promise<ExecuteResult> {
  const signal = deps.signal
  // toolScheduler：全就绪屏障 + 阻塞让出 + 串行请求队列
  const barrier = await yieldIfBlocked(plans)
  if (barrier.stuck && !plans.length) return { schedulerStuck: true }
  await ctx.requestQueue.submit(async () => {
    let i = 0
    while (i < plans.length) {
      if (signal?.aborted) return
      const group: ScheduledCall[] = []
      if (READONLY.has(plans[i].tc.name)) { while (i < plans.length && READONLY.has(plans[i].tc.name)) group.push(plans[i++]) }
      else group.push(plans[i++])
      await Promise.all(group.map(async (p) => {
        p.fsm.transition('executing', { liveOutput: '' })
        deps.events.onToolStart?.(p.tc)
        const __exec = await execOne(deps, p.tc, signal)
        const outText = __exec.text
        const failed = outText.startsWith('❌')
        p.tc.result = outText; p.tc.status = failed ? 'error' : 'done'; p.tc.finished_at = new Date().toISOString()
        p.fsm.transition(failed ? 'error' : 'success', failed ? { error: outText } : { result: outText })
        const outcome = normalizeOutcome(p.tc, outText, failed)
        bumpToolUse(ctx.toolUseCounter, p.tc.name)
        deps.events.onToolEnd?.(p.tc)
        ctx.allToolCalls.push(p.tc)
        ctx.stuck.push({ kind: failed ? 'error' : 'observation', sig: toolFingerprint(p.tc.name, outcome.output.slice(0, 80)), ok: !failed })
        if (failed) ctx.sandbox.onSandboxDenial()
        // v16.3.6：带图工具（截图）构造多模态 tool 消息，模型才看得到图
        const __content = __exec.image
          ? toolContentWithImage(outText + (toolUseHint(ctx.toolUseCounter, p.tc.name) ? '\n' + toolUseHint(ctx.toolUseCounter, p.tc.name) : ''), __exec.image)
          : outText + (toolUseHint(ctx.toolUseCounter, p.tc.name) ? '\n' + toolUseHint(ctx.toolUseCounter, p.tc.name) : '')
        messages.push({ role: 'tool', tool_call_id: p.tc.id, content: __content })
      }))
    }
  })
  return {}
}

/** JT Core Ultra 主循环：与 runAgentLoop 同签名/同事件/同 NeedsClientError 契约。
 *  v18.0.0 起只保留轮次推进骨架，各阶段实现见上方六个阶段函数。 */
export async function runUltraLoop(inputMessages: UltraMessage[], deps: UltraDeps): Promise<UltraResult> {
  const messages: UltraMessage[] = [...inputMessages]
  // 阶段零：组件实例化 + 缓存
  const ctx = buildUltraContext(deps)

  // 阶段一（续跑）：补齐悬空 tool_calls——原实现位于 turn 预算检查之前，时序保持
  prepareUltraMessages(ctx, messages, deps, 'resume')

  const maxTurns = ctx.turnBudget.next()
  if (maxTurns === 0) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'max-session-turns', error: '会话 turn 上限' }

  for (let turn = 0; turn < maxTurns; turn++) {
    ctx.turnBudget.consume()
    if (deps.signal?.aborted) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'aborted' }

    // 阶段一（每轮）：上下文整理 + Hermes 注入
    const prepared = prepareUltraMessages(ctx, messages, deps, 'round')
    if (prepared.overflow) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'context-overflow', error: '上下文窗口即将溢出' }

    // 阶段二：带重试请求（抖动退避 + 模型回落）
    const requested = await requestUltraRound(ctx, prepared.reqMessages, deps)
    if (requested.aborted) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'aborted' }
    if (!requested.res) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'error', error: requested.error ?? '' }

    // 阶段三：SSE 收集 + Hermes 回退解析
    const streamed = await streamUltraRound(requested.res, ctx, deps, turn)
    if (streamed.aborted) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'aborted' }
    if (streamed.error) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'error', error: streamed.error }

    // 阶段四：三层循环检测 + FSM 闸门 + Stuck
    const gate = await gateUltraToolCalls(ctx, deps, messages, streamed.toolCalls, streamed.roundContent, turn)
    if (gate.exit) return gate.exit
    if (gate.continueLoop) continue

    // 阶段五：串行队列 + 只读并行执行
    const executed = await executeUltraPlans(ctx, deps, messages, gate.plans)
    if (executed.schedulerStuck) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'error', error: '调度器卡死' }

    // turn：wrap-up + 预算
    if (turn >= maxTurns - 2 && !ctx.wrappedUp) ctx.wrappedUp = true
    if (ctx.wrappedUp && turn >= maxTurns - 1) return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'max-turns', error: '已达最大 turn 数' }
  }
  return { content: ctx.fullContent, thinking: ctx.fullThinking, toolCalls: ctx.allToolCalls, stopped: 'max-turns' }
}

/** v16.3.6：工具文本 + 图片 → 多模态 content（OpenAI 兼容 image_url） */
function toolContentWithImage(text: string, image: string): Array<{ type: string; text?: string; image_url?: { url: string } }> {
  const cleaned = String(text || '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim()
  return [
    { type: 'text', text: cleaned || '（工具产出）' },
    { type: 'image_url', image_url: { url: image } },
  ]
}
