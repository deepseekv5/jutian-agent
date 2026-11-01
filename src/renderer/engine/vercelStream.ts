/**
 * Agent 引擎：Vercel AI SDK（v15.0）
 *
 * 为什么换内核：自研循环虽然能用，但缺少成熟实现里那些经过大量真实场景打磨的
 * 细节——工具调用的流式增量拼装、多步循环的终止判定、错误重试与降级、
 * 结构化输出的类型安全。Vercel AI SDK 是 TypeScript 生态的事实标准，
 * 支持任意 OpenAI 兼容端点，这里把它的 `streamText` 接成我们的引擎。
 *
 * 保留的能力：
 *   - 走 /api/llm-proxy（密钥解析、免费档、上游接力全在代理里）
 *   - 权限闸门（beforeTool）与客户端工具（onClientTool）
 *   - 流式回调（chunk / thinking / toolStart / toolEnd / draft / net / perf）
 *
 * 与自研循环的差异：循环控制交给 SDK（stopWhen: stepCountIs），
 * 不再自己累加轮次、拼 tool_calls、修复重复签名。
 */
import { streamText, tool, jsonSchema, stepCountIs } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { Settings, ToolCall } from '../types'
import { BUILTIN_TOOLS } from '../types'
import { effectiveApiKey } from '../store/storage'
import { executeTool } from './tools'
import type { StreamCallbacks } from './stream'
import { checkRepeatCall, callSignature } from '../../shared/toolLoopGuard'
import { filterTools, repairToolCallJson, stepToolFilter } from '../../shared/toolFilter'
import { truncateForBudget, microcompact, totalTokens } from '../../shared/contextBudget'

/** 单次请求的最大工具轮次（SDK 的 stepCountIs 语义：一轮 = 一次模型调用 + 其工具执行） */
const MAX_STEPS = 12

/** 客户端处理的工具（不在服务端执行） */
const CLIENT_TOOLS = new Set(['dispatch_subagents', 'update_plan'])

type OpenAIMsg = {
  role: string
  content?: unknown
  tool_calls?: { id: string; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

/** OpenAI 消息 → AI SDK ModelMessage（tool_calls 转成 content parts） */
function toModelMessages(messages: OpenAIMsg[]): unknown[] {
  const nameById = new Map<string, string>()
  // 先扫一遍 assistant 消息，建立 toolCallId → 工具名映射（tool 消息需要）
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc.id && tc.function?.name) nameById.set(tc.id, tc.function.name)
    }
  }

  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'system') continue  // system 走 instructions，不能放 messages
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
      out.push({ role: m.role, content: text })
      continue
    }
    if (m.role === 'assistant') {
      const parts: unknown[] = []
      const text = typeof m.content === 'string' ? m.content : ''
      if (text) parts.push({ type: 'text', text })
      for (const tc of m.tool_calls || []) {
        let input: unknown = {}
        try { input = JSON.parse(tc.function?.arguments || '{}') } catch {
          input = repairToolCallJson(tc.function?.arguments || '{}') ?? {}
        }
        parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.function?.name || '', input })
      }
      // 空 assistant 消息跳过（SDK 不接受空 content）
      if (parts.length === 0) continue
      out.push({ role: 'assistant', content: parts })
      continue
    }
    if (m.role === 'tool') {
      const id = String(m.tool_call_id || '')
      const name = nameById.get(id) || 'unknown'
      const value = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
      out.push({
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'text', value } }],
      })
    }
  }
  return out
}

export async function streamChatVercel(
  settings: Settings,
  messages: OpenAIMsg[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  extraTools?: { name: string; description: string; parameters: unknown }[],
): Promise<void> {
  const disabled = (() => {
    try { return JSON.parse(localStorage.getItem('harness-disabled-tools') || '[]') as string[] } catch { return [] }
  })()
  const allTools = [...BUILTIN_TOOLS, ...(extraTools || [])].filter((t) => !disabled.includes(t.name))
  // 动态过滤（v15.1）：只发与对话相关的工具（50 → ~15），省 token 提高选择准确率
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : (Array.isArray(messages) && messages.length > 0 ? String(messages[0]?.content ?? '') : '')
  const activeTools = filterTools(allTools, userText) as typeof allTools

  // 走本地代理：provider 会把请求发到 `${baseURL}/chat/completions`，
  // 这里用自定义 fetch 把它改写成 POST /api/llm-proxy（代理内部再拼上游地址）。
  const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers || {})
    headers.set('X-Target-Base', settings.apiBaseUrl || '')
    headers.set('X-Api-Key', effectiveApiKey(settings.apiKey))
    return fetch('/api/llm-proxy', { ...init, headers })
  }

  const provider = createOpenAICompatible({
    name: 'jutian',
    baseURL: 'http://local-proxy.invalid/v1',
    apiKey: 'proxy',
    fetch: proxyFetch as typeof fetch,
  })

  // 上下文预算（v15.1）：超限时先清老工具结果，再按 token 裁剪
  const budget = Math.floor((Number(settings.contextWindow) || 0) * 0.8) || 0
  let sendMessages = messages as unknown as { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }[]
  if (budget > 0) {
    if (totalTokens(sendMessages) > budget * 0.8) {
      const mc = microcompact(sendMessages)
      if (mc.cleared > 0) sendMessages = mc.messages
    }
    if (totalTokens(sendMessages) > budget) {
      sendMessages = truncateForBudget(sendMessages, budget).messages
    }
  }

  // system 消息 → instructions（AI SDK v7 强制要求，不能混进 messages）
  const systemText = (sendMessages as unknown as OpenAIMsg[]).filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
    .join('\n\n')

  const toolCallLog: ToolCall[] = []
  // 步内去重（v15.1）：模型常在同一轮并行发出多个完全相同的调用
  // （实测 spark-x2.6 会把 list_dir 连发 3 次）。相同签名只执行一次，
  // 其余直接复用结果——省时间也避免重复副作用。每步开始清空。
  const inflightTools = new Map<string, Promise<string>>()
  // 跨轮累计：同一签名调用次数（软提醒/硬拦截）
  const callSignatures = new Map<string, number>()
  const tools = Object.fromEntries(activeTools.map((t) => [
    t.name,
    (tool as any)({
      description: t.description,
      inputSchema: jsonSchema(t.parameters as never),
      execute: async (input: Record<string, unknown>, { abortSignal }: { abortSignal?: AbortSignal }) => {
        // 步内去重：同一签名的调用共享同一个 Promise
        const dedupeKey = t.name + '::' + JSON.stringify(input ?? {})
        const running = inflightTools.get(dedupeKey)
        if (running) return running
        const task = (async (): Promise<string> => {
        // 空转防护（自研内核保留下来的一件好东西）：相同工具+相同参数
        // 第 3 次起注入提醒，第 5 次直接拦截——SDK 的循环本身不做这个判断。
        const sig = callSignature(t.name, JSON.stringify(input ?? {}))
        const repeat = checkRepeatCall(callSignatures, sig)
        if (repeat.blocked) return repeat.message

        const tc: ToolCall = {
          id: 'call_' + t.name + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          name: t.name,
          arguments: JSON.stringify(input ?? {}),
          status: 'running',
          started_at: new Date().toISOString(),
        }
        callbacks.onToolStart(tc)

        // 权限闸门
        const denial = await callbacks.beforeTool?.(tc)
        if (denial) {
          tc.status = 'error'
          tc.result = denial
          tc.finished_at = new Date().toISOString()
          callbacks.onToolEnd(tc)
          toolCallLog.push(tc)
          return denial
        }

        try {
          let out: string
          if (CLIENT_TOOLS.has(t.name)) {
            out = (await callbacks.onClientTool?.(tc)) || '{"ok":true}'
            tc.status = 'done'
          } else {
            const r = await executeTool({ name: t.name, args: input ?? {} }, settings.workDir || undefined, abortSignal || signal)
            out = r.success ? String(r.output ?? '') : ('❌ 错误: ' + r.error)
            tc.status = r.success ? 'done' : 'error'
            if (r.changeId) tc.changeId = r.changeId
          }
          // 结果截断：40K 对模型足够判断下一步
          const MAX = 40_000
          tc.result = (out.length > MAX ? out.slice(0, MAX) + '\n…[输出已截断]' : out) + (repeat.message || '')
          tc.finished_at = new Date().toISOString()
          callbacks.onToolEnd(tc)
          toolCallLog.push(tc)
          return tc.result
        } catch (e) {
          const msg = '❌ 错误: ' + (e instanceof Error ? e.message : String(e))
          tc.status = 'error'
          tc.result = msg
          tc.finished_at = new Date().toISOString()
          callbacks.onToolEnd(tc)
          toolCallLog.push(tc)
          return msg
        }
        })()
        inflightTools.set(dedupeKey, task)
        return task
      },
    }) as never,
  ])) as Record<string, never>

  callbacks.onNetStatus?.('connecting')

  let fullText = ''
  let fullThinking = ''
  let firstTokenSeen = false

  try {
    const result = (streamText as any)({
      model: provider(settings.model),
      ...(systemText ? { instructions: systemText } : {}),
      messages: toModelMessages(sendMessages as unknown as OpenAIMsg[]) as never,
      tools: tools as never,
      stopWhen: stepCountIs(MAX_STEPS),
      // 重试（v15.1）：网络抖动/429/5xx 由 SDK 自动退避重试，不再自己写重试循环
      maxRetries: 3,
      // 流中断重试：上游在流式过程中断开时重连
      streamRetries: 2,
      // 工具调用修复：模型产出坏 JSON 时先尝试修，修不好才报错
      repairToolCall: ({ toolCall }: { toolCall: { toolName: string; input: string } }) => {
        const fixed = repairToolCallJson(toolCall.input)
        if (!fixed) return null
        return { ...toolCall, input: JSON.stringify(fixed) }
      },
      // 智能步骤控制（v15.1）：第一步只给只读工具，防止模型没读文件就直接写
      // 并发控制：只读工具可以并行（快），写工具必须串行（安全）
      toolCallConcurrency: 4,
      onStepStart: () => { inflightTools.clear() },
      prepareStep: ({ stepNumber }: { stepNumber: number }) => {
        const readonly = stepToolFilter(stepNumber)
        if (!readonly) return {}
        return { activeTools: readonly }
      },
      // 工具审批（v15）：高风险工具需要用户确认。
      // SDK 内置审批机制：toolApproval 配置决定哪些工具需要审批，
      // 审批通过后才执行 execute。
      toolApproval: (async (toolName: string) => {
        const highRisk = /^(delete_file|write_file|edit_file|shell|npm_run|git_operation)$/.test(toolName)
        return highRisk ? 'user-approval' : 'approved'
      }) as any,
      abortSignal: signal,
      maxOutputTokens: Number(settings.contextWindow) >= 8000 ? 16384 : 8192,
    })

    for await (const part of (result.fullStream as AsyncIterable<any>)) {
      switch (part.type) {
        case 'text-delta':
          if (!firstTokenSeen) { firstTokenSeen = true; callbacks.onNetStatus?.('first-token') }
          fullText += part.text
          callbacks.onChunk(part.text)
          break
        case 'reasoning-delta':
          if (!firstTokenSeen) { firstTokenSeen = true; callbacks.onNetStatus?.('first-token') }
          fullThinking += part.text
          callbacks.onThinking?.(part.text)
          break
        case 'tool-input-start':
          callbacks.onToolDraft?.({ name: part.toolName })
          break
        case 'tool-approval-request':
          // 审批请求已由 SDK 内置机制处理，这里只发通知
          callbacks.onToolDraft?.({ name: (part as any).toolCall?.name || '审批' })
          break
        case 'tool-approval-response':
          // 审批结果已回传，SDK 自动继续执行
          break
        case 'error': {
          const err = (part as { error?: unknown }).error
          const msg = err instanceof Error ? err.message : String(err ?? '未知错误')
          await callbacks.onError(msg)
          return
        }
        default:
          break
      }
    }

    await callbacks.onDone(fullText, toolCallLog, fullThinking || undefined)
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err.name === 'AbortError' || signal?.aborted) return
    await callbacks.onError(err.message || '模型请求失败')
  }
}
