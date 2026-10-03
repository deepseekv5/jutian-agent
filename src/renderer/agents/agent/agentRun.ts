/**
 * 员工 Agent 运行器：把一次对话请求跑在指定员工的人设上
 * 复用全局 streamChat（自动带全部 37 个内置工具），所以员工具备与主对话一致的工具能力。
 */
import { streamChat } from '../../engine/stream'
import type { Settings } from '../../types'

export interface AgentToolLine { name: string; args?: string; ok?: boolean }

export async function runAgent(opts: {
  settings: Settings
  system: string
  history: { role: string; content: string }[]
  onDelta: (d: string) => void
  onTool?: (t: AgentToolLine) => void
  onThinking?: (d: string) => void
  signal: AbortSignal
}): Promise<{ text: string; tools: AgentToolLine[]; error?: string }> {
  const tools: AgentToolLine[] = []
  let text = ''
  let error: string | undefined
  await streamChat(
    opts.settings,
    [{ role: 'system', content: opts.system }, ...opts.history],
    {
      onChunk: (d: string) => { text += d; opts.onDelta(d) },
      onThinking: (d: string) => opts.onThinking?.(d),
      onToolStart: (tc: any) => {
        const name = tc?.function?.name || tc?.name || 'tool'
        const args = tc?.function?.arguments || tc?.arguments || ''
        tools.push({ name, args: safeArgs(args) })
        opts.onTool?.({ name, args: safeArgs(args) })
      },
      onToolEnd: (tc: any) => {
        const name = tc?.function?.name || tc?.name || 'tool'
        const last = [...tools].reverse().find(t => t.name === name && t.ok === undefined)
        if (last) last.ok = tc?.status !== 'error'
      },
      onDone: (full: string) => { if (full) text = full },
      onError: (e: string) => { error = e },
    },
    opts.signal,
  )
  return { text, tools, error }
}

function safeArgs(a: string): string | undefined {
  if (!a) return undefined
  try {
    const o = JSON.parse(a)
    const s = JSON.stringify(o)
    return s.length > 90 ? s.slice(0, 90) + '…' : s
  } catch { return a.length > 90 ? a.slice(0, 90) + '…' : a }
}
