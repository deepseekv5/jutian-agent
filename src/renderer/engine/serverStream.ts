/**
 * 服务端 agent 循环客户端（v14.3）
 *
 * 与 engine/stream.ts 同签名，但循环跑在服务端（/api/agent/run）：
 *   - 工具在服务端直接执行，不再每次 HTTP 回环
 *   - 定时任务 / Webhook 复用同一个循环（不再有第二份实现）
 *   - 渲染层只负责把 SSE 事件画出来
 *
 * 无状态续跑：遇到「需要用户确认」时，服务端把消息原样返回；这里收集用户的
 * 决定后带着 pendingTool 重新请求——服务端从那个工具继续，不会重发悬空
 * tool_calls 给上游。客户端工具（计划/子代理）同理：本地执行完把结果补进
 * messages 再续跑。
 */
import type { Settings, ToolCall } from '../types'
import { BUILTIN_TOOLS } from '../types'
import { effectiveApiKey } from '../store/storage'
import { ssePayloads } from '../../shared/sse'
import type { StreamCallbacks } from './stream'
import { isSessionApproved } from '../app/permissionGate'

interface ServerEvent {
  type: 'chunk' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_draft' | 'net' | 'perf' | 'done' | 'error' | 'aborted' | 'needs_client'
  text?: string
  name?: string
  tool?: ToolCall
  phase?: 'connecting' | 'first-token' | 'retrying'
  info?: { attempt?: number }
  report?: unknown
  content?: string
  thinking?: string
  toolCalls?: ToolCall[]
  message?: string
  kind?: 'confirm' | 'client_tool'
  scopeKey?: string
  messages?: unknown[]
  partial?: { content: string; thinking: string; toolCalls: ToolCall[] }
}

export async function streamChatViaServer(
  settings: Settings,
  messages: any[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  extraTools?: { name: string; description: string; parameters: unknown }[],
): Promise<void> {
  const disabled = (() => { try { return JSON.parse(localStorage.getItem('harness-disabled-tools') || '[]') } catch { return [] } })()
  const tools = [...BUILTIN_TOOLS, ...(extraTools || [])]
    .filter((t) => !disabled.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))

  let msgs: any[] = messages
  let resume: ServerEvent['partial'] | undefined
  let pendingTool: { toolCall: ToolCall; decision?: string | null } | undefined
  const confirmations: Record<string, unknown> = {}
  // 本会话已放行的操作（服务端按 scopeKey 判断，不再弹窗）
  const approvedScopes: string[] = []
  const seenToolEnd = new Set<string>()


  for (let hop = 0; hop < 30; hop++) {
    if (signal?.aborted) return

    let res: Response
    try {
      res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          tools,
          model: settings.model,
          apiBase: settings.apiBaseUrl,
          apiKey: effectiveApiKey(settings.apiKey),
          contextWindow: settings.contextWindow,
          hermesMode: settings.hermesProtocol,
          disabledTools: disabled,
          workDir: settings.workDir || undefined,
          permissionLevel: settings.permissionLevel,
          resume,
          pendingTool,
          confirmations,
          approvedScopes,
        }),
        signal,
      })
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err.name === 'AbortError') return
      await callbacks.onError(err.message || '无法连接本地服务')
      return
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      await callbacks.onError(`服务端 agent 启动失败（HTTP ${res.status}）${text ? '：' + text.slice(0, 200) : ''}`)
      return
    }

    let needs: ServerEvent | null = null
    for await (const data of ssePayloads(res.body)) {
      let ev: ServerEvent
      try { ev = JSON.parse(data) } catch { continue }
      switch (ev.type) {
        case 'chunk': callbacks.onChunk(ev.text || ''); break
        case 'thinking': callbacks.onThinking?.(ev.text || ''); break
        case 'tool_draft': callbacks.onToolDraft?.({ name: ev.name || '…' }); break
        case 'tool_start': if (ev.tool) callbacks.onToolStart(ev.tool); break
        case 'tool_end':
          if (ev.tool && !seenToolEnd.has(ev.tool.id)) {
            seenToolEnd.add(ev.tool.id)
            callbacks.onToolEnd(ev.tool)
          }
          break
        case 'net': callbacks.onNetStatus?.(ev.phase || 'connecting', ev.info); break
        case 'perf': callbacks.onPerf?.(ev.report as any); break
        case 'done':
          await callbacks.onDone(ev.content || '', ev.toolCalls || [], ev.thinking || undefined)
          return
        case 'error':
          await callbacks.onError(ev.message || '未知错误')
          return
        case 'aborted':
          return
        case 'needs_client':
          needs = ev
          break
      }
      if (needs) break
    }

    if (!needs) {
      // 流意外结束（无 done/error）——当作失败，避免界面永远转圈
      await callbacks.onError('连接中断：服务端未返回结果')
      return
    }

    // ─── 需要渲染层介入 ───
    msgs = (needs.messages as any[]) || msgs
    resume = needs.partial

    if (needs.kind === 'client_tool' && needs.tool) {
      let out = '{"ok":true}'
      try {
        out = (await callbacks.onClientTool?.(needs.tool)) || out
      } catch (e) {
        out = '{"ok":false,"error":"' + String((e as Error)?.message || e).replace(/"/g, "'") + '"}'
      }
      msgs = [...msgs, { role: 'tool', tool_call_id: needs.tool.id, content: out }]
      pendingTool = undefined
      continue
    }

    if (needs.kind === 'confirm' && needs.tool) {
      const denial = await callbacks.beforeTool?.(needs.tool)
      if (denial) {
        // 拒绝：由服务端把拒绝文案写进工具结果（保持历史完整）
        pendingTool = { toolCall: needs.tool, decision: denial }
      } else {
        confirmations[needs.tool.id] = true
        pendingTool = { toolCall: needs.tool, decision: null }
        // 用户选了「本会话允许」→ beforeTool 内部已记录，这里同步给服务端
        if (needs.scopeKey && isSessionApproved(needs.scopeKey)) approvedScopes.push(needs.scopeKey)
      }
      continue
    }

    // 未知介入类型：放弃，避免死循环
    await callbacks.onError('agent 需要未知的客户端操作，已停止')
    return
  }

  await callbacks.onError('agent 续跑次数过多，已停止（可能存在循环确认）')
}
