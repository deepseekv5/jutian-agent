/**
 * Stream chat completion with tool-use loop (function calling) v2
 * 
 * 修复：tool_calls 兼容性 + Skill 动态工具加载
 * 
 * Flow:
 *   1. 收集所有工具（内置 + 已加载 Skill 工具）
 *   2. 发送 messages + tools 给 LLM（streaming）
 *   3. 如果 LLM 返回 tool_calls → 执行 → 结果回传 → 继续循环
 *   4. 直到 LLM 返回纯文本（无 tool_calls）
 */

import type { Settings, ToolCall, ToolDef } from '../types'
import { effectiveApiKey } from '../store/storage'
import { BUILTIN_TOOLS } from '../types'
import { executeTool } from './tools'
import { ssePayloads } from '../../shared/sse'
import { extractReasoning } from '../../shared/reasoning'
import {
  parseToolCallsFromDelta, accumulateToolCallDelta,
  adoptNonStreamToolCalls, toolCallsToArray,
  type ToolCallAccum,
} from './toolCallStream'
import { buildHttpErrorMessage } from './httpErrors'
import { checkRoundLimit, checkRepeatCall, callSignature } from './toolLoopGuard'

export interface StreamCallbacks {
  onChunk: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolStart: (toolCall: ToolCall) => void
  onToolEnd: (toolCall: ToolCall) => void
  onDone: (full: string, toolCalls: ToolCall[], thinking?: string) => void | Promise<void>
  onError: (err: string) => void | Promise<void>
  /** 客户端工具：不走服务端执行，返回值作为 tool result 回传给模型 */
  onClientTool?: (tc: ToolCall) => string | Promise<string>
  /**
   * 权限闸门：返回 null 放行；返回字符串则拒绝执行并把该字符串作为 tool result。
   * 由调用方按当前权限档位决定——「需要我确认」档下敏感操作在这里被真正拦住，
   * 不依赖模型是否遵守提示词。
   */
  beforeTool?: (tc: ToolCall) => Promise<string | null> | string | null
}

/** 客户端处理的工具名（无服务端副作用，仅更新 UI 状态） */
const CLIENT_TOOLS = new Set(['dispatch_subagents', 'update_plan'])

/** OpenAI 兼容的 tool_call 线上格式（随 messages 直接序列化发给上游） */
interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  index?: number
}

/**
 * 主流式聊天函数，支持自动工具调用循环和 Skill 动态加载。
 */
export async function streamChat(
  settings: Settings,
  messages: { role: string; content?: string; tool_calls?: WireToolCall[]; tool_call_id?: string }[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  extraTools?: ToolDef[],  // 来自 Skill 的额外工具
): Promise<void> {
  // ─── 本地模型分支（走 LM Studio）───
  if (settings.provider === 'local') {
    const localMessages = messages
      .filter(m => m.role !== 'tool')
      .map(m => ({ role: m.role as string, content: m.content || '' }))

    try {
      const url = '/api/llm-proxy'
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.localModel || 'qwen/qwen3-vl-4b',
          messages: localMessages,
          stream: true,
          targetBase: 'http://localhost:1234/v1',
          apiKey: 'lm-studio',
        }),
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        callbacks.onError(`LM Studio 连接失败 (${res.status}): ${errText}`)
        return
      }

      if (!res.body) { callbacks.onError('无法读取响应流'); return }
      let fullContent = ''
      let fullThinking = ''

      for await (const data of ssePayloads(res.body)) {
        if (signal?.aborted) return
        if (data === '[DONE]') break
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          if (!delta) continue
          // 深度思考内容：字段名各家不同（reasoning_content / reasoning /
          // reasoning_details），归一化逻辑在 shared/reasoning（有测试）
          const think = extractReasoning(delta)
          if (think) {
            fullThinking += think
            callbacks.onThinking?.(think)
          }
          // 文本输出
          if (delta.content) {
            fullContent += delta.content
            callbacks.onChunk(delta.content)
          }
        } catch { /* 忽略解析错误 */ }
      }
      await callbacks.onDone(fullContent, [], fullThinking || undefined)
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e.name === 'AbortError') return
      callbacks.onError(e.message || 'LM Studio 连接错误')
    }
    return
  }

  // ─── API 模型分支 ───
  const url = '/api/llm-proxy'

  // 工具循环护栏（判据与文案见 toolLoopGuard）
  let toolRound = 0
  const callSignatures = new Map<string, number>()
  // 思考内容跨轮累积：放在循环外，否则"思考→调工具→再思考"时
  // 只有最后一轮的思考会落库，前面的全丢
  let fullThinking = ''

  while (true) {
    if (signal?.aborted) return
    toolRound++
    const roundCheck = checkRoundLimit(toolRound)
    if (roundCheck.exceeded) {
      await callbacks.onError(roundCheck.message)
      return
    }

    try {
      // 合并内置工具 + Skill 工具
      // LY HARNESS 插件开关:被关掉的工具不发给模型
      const __disabledTools = (() => { try { return JSON.parse(localStorage.getItem('harness-disabled-tools') || '[]') } catch { return [] } })()
      const allTools = [...BUILTIN_TOOLS, ...(extraTools || [])].filter(t => !__disabledTools.includes(t.name))

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Target-Base': settings.apiBaseUrl,
        'X-Api-Key': effectiveApiKey(settings.apiKey),
      }

      const makeBody = () => JSON.stringify({
        model: settings.model,
        messages,
        tools: allTools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: 'auto',
        stream: true,
      })

      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body: makeBody(), signal })
      } catch (e) {
        // 免费档上游偶发重置连接 → 自动重试一次（仅网络错误，非业务错误）
        if (signal?.aborted) throw e
        await new Promise(r => setTimeout(r, 1200))
        res = await fetch(url, { method: 'POST', headers, body: makeBody(), signal })
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        // 状态码 → 可操作中文提示（映射表在 httpErrors，含 402/403/5xx 等）
        throw new Error(buildHttpErrorMessage(res.status, errText))
      }

      if (!res.body) throw new Error('No response body')

      let fullContent = ''

      // 累积式 tool call 收集器
      const toolCallMap = new Map<number, ToolCallAccum>()
      for await (const data of ssePayloads(res.body)) {
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]
          if (!choice) continue

          const delta = choice.delta

          // 深度思考内容。字段名各家不同（reasoning_content / reasoning /
          // reasoning_details），归一化见 shared/reasoning。
          // 这里曾经漏掉：本地模型分支有处理、API 分支没有，导致接
          // OpenCode Zen 后它的思考过程一个字都不显示（上游推的是
          // delta.reasoning，OpenRouter 风格）。
          const think = extractReasoning(delta)
          if (think) {
            fullThinking += think
            callbacks.onThinking?.(think)
          }

          // 文本流式输出
          if (delta?.content) {
            fullContent += delta.content
            callbacks.onChunk(delta.content)
          }

          // 工具调用流式累积（解析/合并细节见 toolCallStream，含 id 重发防护）
          const parsedTcs = parseToolCallsFromDelta(delta)
          if (parsedTcs) {
            for (const tc of parsedTcs) accumulateToolCallDelta(toolCallMap, tc)
          }

          // 兼容：检查 finish_reason 是否为 tool_calls（非流式模式）
          if (choice.finish_reason === 'tool_calls') {
            // 有些模型在完整响应中返回 tool_calls 而非 delta 中
            adoptNonStreamToolCalls(toolCallMap, choice.message?.tool_calls)
          }
        } catch {
          // 忽略格式错误的 SSE 行
        }
      }

      // 将累积的 tool calls 转为数组（按 index 升序，与模型给出的调用顺序一致）
      const toolCalls = toolCallsToArray(toolCallMap)

      // 没有 tool_calls → 完成，返回最终文本（带思考内容，供落库与界面展示）
      if (toolCalls.length === 0) {
        await callbacks.onDone(fullContent, [], fullThinking || undefined)
        return
      }

      // ─── 执行工具 ───
      
      // 添加 assistant message（含 tool_calls）到历史
      messages.push({
        role: 'assistant',
        content: fullContent || undefined,
        tool_calls: toolCalls.map((tc, idx) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
          index: idx,
        })),
      })

      // 逐个执行工具并收集结果
      for (const tc of toolCalls) {
        if (signal?.aborted) return

        // 重复调用检测（判据见 toolLoopGuard）
        const repeat = checkRepeatCall(callSignatures, callSignature(tc.name, tc.arguments))
        if (repeat.blocked) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: repeat.message })
          continue
        }

        let args: Record<string, unknown>
        try { args = JSON.parse(tc.arguments || '{}') } catch { args = {} }

        const toolCallObj: ToolCall = {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          status: 'running',
          started_at: new Date().toISOString(),
        }

        callbacks.onToolStart(toolCallObj)

        let toolResult: string
        // 权限闸门：先问调用方是否允许（「需要我确认」档在这里真正拦截）
        const denial = await callbacks.beforeTool?.(toolCallObj)
        if (denial) {
          toolCallObj.status = 'error'
          toolCallObj.result = denial
          toolCallObj.finished_at = new Date().toISOString()
          callbacks.onToolEnd(toolCallObj)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: denial })
          continue
        }
        if (CLIENT_TOOLS.has(tc.name)) {
          // 客户端工具：由 UI 层处理（如任务清单），并把确认结果回传给模型
          toolResult = (await callbacks.onClientTool?.(toolCallObj)) || '{"ok":true}'
          toolCallObj.status = 'done'
          toolCallObj.result = toolResult
        } else {
          // 通过后端代理执行工具（工作区实时生效）；传 signal 让长命令可被用户中止
          const result = await executeTool({ name: tc.name, args }, settings.workDir || undefined, signal)
          toolResult = result.success ? result.output : `❌ 错误: ${result.error}`
          toolCallObj.status = result.success ? 'done' : 'error'
          toolCallObj.result = toolResult
          if (result.changeId) toolCallObj.changeId = result.changeId
        }
        toolCallObj.finished_at = new Date().toISOString()

        callbacks.onToolEnd(toolCallObj)

        // 添加 tool result 到对话历史
        // result 必须是有内容的字符串：undefined/空串会让模型以为工具没执行，
        // 于是声称「我无法调用工具」然后换个方式再试一遍（Windows 上观感极差）
        const toolResultText = (toolCallObj.result && String(toolCallObj.result).trim())
          ? String(toolCallObj.result)
          : (toolCallObj.status === 'error'
              ? `工具 ${tc.name} 执行失败（未返回具体错误信息）。`
              : `工具 ${tc.name} 已执行，但返回空结果。`);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResultText,
        })
      }

      // 循环回到顶部，将所有消息（含工具结果）发回 LLM

    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e.name === 'AbortError') return
      callbacks.onError(e.message || 'Unknown error')
      return
    }
  }
}
