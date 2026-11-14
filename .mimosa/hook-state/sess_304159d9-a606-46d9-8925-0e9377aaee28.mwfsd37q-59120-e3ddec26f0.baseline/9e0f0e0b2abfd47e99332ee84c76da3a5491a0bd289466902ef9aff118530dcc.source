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
  runTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<{ success: boolean; output?: string; error?: string; changeId?: string }>
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

async function execOne(deps: UltraDeps, tc: UltraToolCall, signal?: AbortSignal): Promise<string> {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(tc.arguments || '{}') } catch { /* 坏参数交工具层报错：args 保持空对象 */ }
  try {
    let outText: string
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
      } finally { if (timer) clearTimeout(timer) }
    }
    if (outText.length > ULTRA_MAX_OUTPUT) {
      outText = clampOutput(outText, ULTRA_MAX_OUTPUT)
      if (deps.saveLargeOutput) {
        try { const fname = await deps.saveLargeOutput(tc.name, outText); if (fname) outText = clampToolResult(outText, tc.name) + '\n[完整输出已保存到工作区: ' + fname + ']' } catch { /* 忽略 */ }
      }
    }
    return outText
  } catch (e) { return '❌ 错误: ' + String((e as Error)?.message || e) }
}

/** JT Core Ultra 主循环：与 runAgentLoop 同签名/同事件/同 NeedsClientError 契约 */
export async function runUltraLoop(inputMessages: UltraMessage[], deps: UltraDeps): Promise<UltraResult> {
  const messages: UltraMessage[] = [...inputMessages]
  let fullContent = deps.resume?.content || ''
  let fullThinking = deps.resume?.thinking || ''
  const allToolCalls: UltraToolCall[] = deps.resume?.toolCalls ? [...deps.resume.toolCalls] : []

  // 算法组件实例化（gemini-cli 全子系统）
  const repeatMap = new Map<string, number>()
  const toolUseCounter = new Map<string, number>()
  const toolLoop = new ToolLoopDetector()
  const contentLoop = new ContentLoopDetector()
  const recovery = new LoopRecovery()
  const stuck = new StuckDetector()
  const turnBudget = new TurnBudget()
  const fallback = new ModelFallback([deps.model, ...(deps.fallbackModels || [])])
  const confirmationBus = new ConfirmationBus()
  const requestQueue = new SerialRequestQueue()
  const approvedScopes = new ApprovedScopes()
  ;(deps.approvedScopes || []).forEach(k => approvedScopes.approve(k))
  const sandbox = new SandboxEscalation()
  const policyMode: ApprovalMode = modeFromLevel(deps.permissionLevel || 'edit')
  const ignoreMatcher = new IgnoreMatcher(['node_modules', 'dist', 'release', '.git', '*.log'])
  const ideBlock = deps.ideContext?.toPromptBlock() || ''
  let lastSemanticCheck = 0
  let wrappedUp = false

  const signal = deps.signal
  const tools = deps.tools.filter(t => !(deps.disabledTools || []).includes(t.name))
  // v16.0.0：工具 schema 与 Hermes 文本块每轮/每次 attempt 重建纯属浪费——
  // deps.tools 在会话内不变，提到循环外构建一次。
  const toolsSchema = tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }))
  const hermesBlock = (() => {
    if (!shouldInjectHermes(deps.model, deps.apiBase, deps.hermesMode) || !tools.length) return ''
    return buildToolsBlock(tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })), { compact: true })
  })()
  const contextWindow = resolveContextWindow(deps.model, deps.contextWindow)
  const maxTokens = deps.maxTokens || maxOutputTokens(contextWindow)
  void ignoreMatcher // 预留：文件发现接入工作区扫描时启用

  // 无状态续跑：补齐悬空 tool_calls
  if (deps.pendingTool) {
    const p = deps.pendingTool
    messages.push({ role: 'tool', tool_call_id: p.toolCall.id, content: p.decision || p.toolCall.result || '' })
    if (!allToolCalls.some(t => t.id === p.toolCall.id)) allToolCalls.push({ ...p.toolCall, status: p.decision ? 'error' : 'done' })
  }

  const maxTurns = turnBudget.next()
  if (maxTurns === 0) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'max-session-turns', error: '会话 turn 上限' }

  for (let turn = 0; turn < maxTurns; turn++) {
    turnBudget.consume()
    if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }

    // 上下文整理（v16.0.0 合并扫描）：此前 willOverflow + compress(needsCompression) + trimToBudget
    // 各全量扫一遍消息；现在一次 estimate 复用，压缩/裁剪各只在触发时执行。
    const tokenCount = estimateMessagesTokens(messages as Array<{ role: string; content?: string }>)
    if (tokenCount >= contextWindow * 0.92) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'context-overflow', error: '上下文窗口即将溢出' }
    if (tokenCount / contextWindow >= 0.5) {
      const comp = compress(messages as Array<{ role: string; content?: string }>, contextWindow)
      if (comp.status === 'compressed') { messages.length = 0; messages.push(...(comp.messages as UltraMessage[])) }
    }
    // tokenBudget：输入裁剪（模块内已改单次遍历）
    const trimmed = trimToBudget(messages as Array<{ role: string; content?: string }>, contextWindow, estimateMessagesTokens)
    if (trimmed.dropped > 0) { messages.length = 0; messages.push(...(trimmed.messages as UltraMessage[])) }

    // Hermes 文本协议（block 已缓存）
    let reqMessages = messages
    if (hermesBlock) {
      reqMessages = reqMessages[0]?.role === 'system'
        ? [{ ...reqMessages[0], content: String(reqMessages[0].content || '') + '\n\n' + hermesBlock }, ...reqMessages.slice(1)]
        : [{ role: 'system', content: hermesBlock }, ...reqMessages]
    }

    // retry：抖动退避 + 模型回落
    let res: Response | null = null
    let lastErr = ''
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (signal?.aborted) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }
      deps.events.onNetStatus?.(attempt === 1 ? 'connecting' : 'retrying', { attempt })
      try {
        res = await deps.callLLM(buildRequestBody(reqMessages, toolsSchema, { model: fallback.current, maxTokens, toolChoice: !wrappedUp, wrapUp: wrappedUp, ideBlock }), signal)
        if (res.ok && res.body) break
        const status = res.status
        let bodyText = ''
        try { bodyText = (await res.text()).slice(0, 400) } catch { /* 读 body 失败：用空串走错误映射 */ }
        const decision = decideRetry(status, attempt, { shouldRetryOnContent: (c) => !c || !c.trim() }, { content: bodyText, serverDelayMs: parseRetryAfter(res.headers.get('retry-after')) })
        if (!decision.retry) {
          if (status === 429 && !fallback.exhausted && fallback.fallback()) { attempt = 0; continue }
          lastErr = status >= 400 ? buildUpstreamError(status, bodyText) : decision.reason
          res = null; break
        }
        await sleepAbortable(Math.min(decision.delayMs, 30000), signal)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }
        lastErr = String((e as Error)?.message || e)
        if (attempt < 10) await sleepAbortable(Math.min(5000 * Math.pow(2, attempt - 1), 30000), signal)
      }
    }
    if (!res || !res.ok || !res.body) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'error', error: lastErr }

    // SSE 收集
    const toolCallMap: ToolAccumMap = new Map<number, ToolAccumSlot>()
    let roundContent = '', draftAnnounced = false
    const perf = { firstTokenMs: 0, t0: Date.now() }
    try {
      for await (const data of ssePayloads(res.body)) {
        if (data === '[DONE]') continue
        let ev: UltraSSEEvent
        try { ev = JSON.parse(data) as UltraSSEEvent } catch { continue }
        const d = ev.choices?.[0]?.delta
        if (!d) continue
        if (d.reasoning_content || d.reasoning) { const t = String(d.reasoning_content || d.reasoning); fullThinking += t; deps.events.onThinking?.(t) }
        if (d.content) { if (!perf.firstTokenMs) perf.firstTokenMs = Date.now() - perf.t0; const t = String(d.content); roundContent += t; fullContent += t; deps.events.onChunk?.(t) }
        const parsed = parseToolCallsFromDelta(d)
        if (parsed) { for (const tc of parsed) accumulateToolCallDelta(toolCallMap, tc); if (!draftAnnounced) { draftAnnounced = true; deps.events.onToolDraft?.(parsed[0]?.function?.name || '…') } }
        if (ev.choices?.[0]?.finish_reason === 'tool_calls') adoptNonStreamToolCalls(toolCallMap, ev.choices[0].message?.tool_calls)
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'aborted' }
      return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'error', error: String((e as Error)?.message || e) }
    }

    let toolCalls = toolCallsToArray(toolCallMap) as unknown as UltraToolCall[]
    if (!toolCalls.length && roundContent.includes('<tool_call>')) {
      const hs = parseHermesToolCalls(roundContent)
      if (hs.length) { toolCalls = hs.map((h, i) => ({ id: 'hermes_' + i + '_' + Date.now(), name: h.name, arguments: h.arguments })); roundContent = stripToolCallBlocks(roundContent) }
    }
    deps.events.onPerf?.({ ...perf, turns: turn + 1, engine: 'ultra', toolCalls: toolCalls.length })

    // loopDetection：三层 + 一次性自救
    const toolHit = toolCalls.some(tc => toolLoop.add(toolFingerprint(tc.name, tc.arguments)))
    const signalRec = recovery.signal(toolHit || contentLoop.add(roundContent))
    if (signalRec === 'stop') return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'loop-detected', error: '循环检测硬停' }
    if (signalRec === 'nudge') messages.push({ role: 'user', content: STEP_BACK_MESSAGE })

    // 无工具调用：nextSpeaker / 语义检测 / 自然结束
    if (!toolCalls.length) {
      const last = messages[messages.length - 1]
      const ctx: SpeakerContext = { pendingTools: 0, quotaError: false, skip: false, lastMessageRole: last?.role, lastMessageContent: typeof last?.content === 'string' ? last.content : '' }
      if (resolveNextSpeaker(ctx) === 'model') { messages.push({ role: 'user', content: CONTINUE_PROMPT }); continue }
      if (deps.semanticLoopCheck && shouldSemanticCheck(turn, lastSemanticCheck, LLM_CONFIDENCE_THRESHOLD)) {
        lastSemanticCheck = turn
        if (await deps.semanticLoopCheck(messages.slice(-LLM_HISTORY_TURNS))) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'loop-detected', error: 'LLM 判定为循环' }
      }
      return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls }
    }

    messages.push({ role: 'assistant', content: roundContent || undefined, tool_calls: toolCalls.map((tc, idx) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments }, index: idx })) })

    // stuckDetector + policy + 需要确认契约
    const plans: ScheduledCall[] = []
    for (const tc of toolCalls) {
      const obj: UltraToolCall = { ...tc, status: 'running', started_at: new Date().toISOString() }
      const fsm = new ToolCallStateMachine()
      const repeat = checkRepeatCall(repeatMap, callSignature(tc.name, tc.arguments))
      if (repeat.blocked) {
        obj.status = 'error'; obj.result = '❌ 错误: ' + (repeat.message || '重复调用被拦截')
        deps.events.onToolStart?.(obj); deps.events.onToolEnd?.(obj)
        stuck.push({ kind: 'error', sig: String(repeat.message || 'repeat'), ok: false })
        allToolCalls.push(obj); messages.push({ role: 'tool', tool_call_id: tc.id, content: obj.result }); continue
      }
      const need = deps.needsClient?.(obj) ?? null
      if (need) throw new UltraNeedsClientError(need, obj, messages, { content: fullContent, thinking: fullThinking, toolCalls: [...allToolCalls, ...plans.map(p => p.tc)] }, deps.scopeKeyOf?.(obj))
      const denial = await deps.confirmTool?.(obj)
      if (denial) {
        obj.status = 'error'; obj.result = denial
        deps.events.onToolStart?.(obj); deps.events.onToolEnd?.(obj)
        allToolCalls.push(obj); messages.push({ role: 'tool', tool_call_id: tc.id, content: obj.result }); continue
      }
      const decision = decidePolicy(tc.name, { yolo: policyMode === 'never', confirmTools: new Set(['shell', 'delete_file']) })
      fsm.transition(decision === 'ask' ? 'awaiting_approval' : 'scheduled')
      if (decision === 'ask') {
        let a: Record<string, unknown> = {}
        try { a = JSON.parse(tc.arguments || '{}') } catch { /* 坏 JSON：参数为空 */ }
        const key = approvedScopes.scopeKeyOf(tc.name, a)
        if (approvedScopes.isApproved(key)) fsm.transition('scheduled')
        else { await confirmationBus.request(tc.id, '需要确认'); fsm.transition('scheduled') }
      }
      plans.push({ tc: obj, fsm, decision })
    }
    const stuckMsg = stuck.check()
    if (stuckMsg) messages.push({ role: 'user', content: '【卡死提醒】' + stuckMsg })

    // toolScheduler：全就绪屏障 + 阻塞让出 + 串行请求队列
    const barrier = await yieldIfBlocked(plans)
    if (barrier.stuck && !plans.length) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'error', error: '调度器卡死' }
    await requestQueue.submit(async () => {
      let i = 0
      while (i < plans.length) {
        if (signal?.aborted) return
        const group: ScheduledCall[] = []
        if (READONLY.has(plans[i].tc.name)) { while (i < plans.length && READONLY.has(plans[i].tc.name)) group.push(plans[i++]) }
        else group.push(plans[i++])
        await Promise.all(group.map(async (p) => {
          p.fsm.transition('executing', { liveOutput: '' })
          deps.events.onToolStart?.(p.tc)
          const outText = await execOne(deps, p.tc, signal)
          const failed = outText.startsWith('❌')
          p.tc.result = outText; p.tc.status = failed ? 'error' : 'done'; p.tc.finished_at = new Date().toISOString()
          p.fsm.transition(failed ? 'error' : 'success', failed ? { error: outText } : { result: outText })
          const outcome = normalizeOutcome(p.tc, outText, failed)
          bumpToolUse(toolUseCounter, p.tc.name)
          deps.events.onToolEnd?.(p.tc)
          allToolCalls.push(p.tc)
          stuck.push({ kind: failed ? 'error' : 'observation', sig: toolFingerprint(p.tc.name, outcome.output.slice(0, 80)), ok: !failed })
          if (failed) sandbox.onSandboxDenial()
          messages.push({ role: 'tool', tool_call_id: p.tc.id, content: outText + (toolUseHint(toolUseCounter, p.tc.name) ? '\n' + toolUseHint(toolUseCounter, p.tc.name) : '') })
        }))
      }
    })

    // turn：wrap-up + 预算
    if (turn >= maxTurns - 2 && !wrappedUp) wrappedUp = true
    if (wrappedUp && turn >= maxTurns - 1) return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'max-turns', error: '已达最大 turn 数' }
  }
  return { content: fullContent, thinking: fullThinking, toolCalls: allToolCalls, stopped: 'max-turns' }
}
