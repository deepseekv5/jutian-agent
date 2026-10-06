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
import { executeTool, checkToolServer } from './tools'

export interface StreamCallbacks {
  onChunk: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolStart: (toolCall: ToolCall) => void
  onToolEnd: (toolCall: ToolCall) => void
  onDone: (full: string, toolCalls: ToolCall[], thinking?: string) => void
  onError: (err: string) => void
  /** 客户端工具：不走服务端执行，返回值作为 tool result 回传给模型 */
  onClientTool?: (tc: ToolCall) => string | Promise<string>
}

/** 客户端处理的工具名（无服务端副作用，仅更新 UI 状态） */
const CLIENT_TOOLS = new Set(['dispatch_subagents'])

/**
 * 解析 SSE chunk 中的 delta，兼容不同模型的 tool_calls 格式。
 * 
 * OpenAI 格式：delta.tool_calls[{index, id, function: {name, arguments}}]
 * 某些模型可能用 delta.function_call 或其他格式
 */
function parseToolCallsFromDelta(delta: any): Array<{index: number; id?: string; name?: string; args?: string}> | null {
  // 标准 OpenAI 格式
  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
    return delta.tool_calls.map((tc: any) => ({
      index: tc.index ?? 0,
      id: tc.id || undefined,
      name: tc.function?.name || undefined,
      args: tc.function?.arguments || undefined,
    }))
  }
  // 兼容：某些模型用 function_call（单函数）
  if (delta.function_call) {
    return [{
      index: 0,
      id: delta.function_call.id || undefined,
      name: delta.function_call.name || undefined,
      args: delta.function_call.arguments || undefined,
    }]
  }
  
  // 兼容：有些模型在 choices 层直接返回 tool_calls
  return null
}

/**
 * 主流式聊天函数，支持自动工具调用循环和 Skill 动态加载。
 */
export async function streamChat(
  settings: Settings,
  messages: { role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }[],
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

      const reader = res.body?.getReader()
      if (!reader) { callbacks.onError('无法读取响应流'); return }
      const decoder = new TextDecoder()
      let fullContent = ''
      let fullThinking = ''
      let buffer = ''

      while (true) {
        if (signal?.aborted) return
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (!delta) continue
            // 深度思考内容
            if (delta.reasoning_content) {
              fullThinking += delta.reasoning_content
              callbacks.onThinking?.(delta.reasoning_content)
            }
            // 文本输出
            if (delta.content) {
              fullContent += delta.content
              callbacks.onChunk(delta.content)
            }
          } catch { /* 忽略解析错误 */ }
        }
      }
      callbacks.onDone(fullContent, [], fullThinking || undefined)
    } catch (err: any) {
      if (err.name === 'AbortError') return
      callbacks.onError(err.message || 'LM Studio 连接错误')
    }
    return
  }

  // ─── API 模型分支 ───
  const url = '/api/llm-proxy'

  while (true) {
    if (signal?.aborted) return

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
        // v7.0：llm-proxy 已透传上游真实状态码与原因，优先展示上游 message
        let detail = ''
        try { const j = JSON.parse(errText); detail = j.error || j.hint || j.detail || '' } catch { detail = errText.slice(0, 200) }
        let friendly = ''
        if (res.status === 429) friendly = '⚠️ 请求过于频繁或额度/限流'
        else if (res.status === 401) friendly = '🔑 API 密钥无效或已过期'
        else if (res.status === 404) friendly = '🔍 模型或地址不存在'
        else if (res.status === 400) friendly = '请求格式错误'
        const head = friendly || `请求失败 (${res.status})`
        throw new Error(detail ? `${head}：${detail}` : head)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let fullContent = ''
      
      // 累积式 tool call 收集器
      const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') break
          
          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]
            if (!choice) continue
            
            const delta = choice.delta

            // 文本流式输出
            if (delta?.content) {
              fullContent += delta.content
              callbacks.onChunk(delta.content)
            }

            // 工具调用流式累积 — 使用兼容性解析函数
            const parsedTcs = parseToolCallsFromDelta(delta)
            if (parsedTcs) {
              for (const tc of parsedTcs) {
                const idx = tc.index ?? 0
                if (!toolCallMap.has(idx)) {
                  toolCallMap.set(idx, { id: '', name: '', arguments: '' })
                }
                const existing = toolCallMap.get(idx)!
                if (tc.id) existing.id += tc.id
                if (tc.name) existing.name += tc.name
                if (tc.args) existing.arguments += tc.args
              }
            }

            // 兼容：检查 finish_reason 是否为 tool_calls（非流式模式）
            if (choice.finish_reason === 'tool_calls' && toolCallMap.size === 0) {
              // 有些模型在完整响应中返回 tool_calls 而非 delta 中
              const msg = choice.message
              if (msg?.tool_calls) {
                for (const tc of msg.tool_calls) {
                  const idx = tc.index ?? 0
                  toolCallMap.set(idx, {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  })
                }
              }
            }
          } catch {
            // 忽略格式错误的 SSE 行
          }
        }
      }

      // 将累积的 tool calls 转为数组
      const toolCalls = Array.from(toolCallMap.values()).map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }))

      // 没有 tool_calls → 完成，返回最终文本
      if (toolCalls.length === 0) {
        callbacks.onDone(fullContent, [])
        return
      }

      // ─── 执行工具 ───
      
      // 添加 assistant message（含 tool_calls）到历史
      messages.push({
        role: 'assistant',
        content: fullContent || null,
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

        let args: Record<string, any>
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
        if (CLIENT_TOOLS.has(tc.name)) {
          // 客户端工具：由 UI 层处理（如任务清单），并把确认结果回传给模型
          toolResult = (await callbacks.onClientTool?.(toolCallObj)) || '{"ok":true}'
          toolCallObj.status = 'done'
          toolCallObj.result = toolResult
        } else {
          // 通过后端代理执行工具（工作区实时生效）
          const result = await executeTool({ name: tc.name, args }, settings.workDir || undefined)
          toolResult = result.success ? result.output : `❌ 错误: ${result.error}`
          toolCallObj.status = result.success ? 'done' : 'error'
          toolCallObj.result = toolResult
          if ((result as any).changeId) (toolCallObj as any).changeId = (result as any).changeId
        }
        toolCallObj.finished_at = new Date().toISOString()

        callbacks.onToolEnd(toolCallObj)

        // 添加 tool result 到对话历史
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolCallObj.result,
        })
      }

      // 循环回到顶部，将所有消息（含工具结果）发回 LLM

    } catch (err: any) {
      if (err.name === 'AbortError') return
      callbacks.onError(err.message || 'Unknown error')
      return
    }
  }
}
