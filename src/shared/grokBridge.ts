/**
 * Grok 内核桥（v16.8.0）—— 接入 xai-org/grok-build（Apache-2.0）。
 *
 * 定位：完全使用 grok 官方代码（预编译二进制，我们不改它的任何一行），
 * 巨天只做「接入兼容」：把会话 prompt 交给 grok headless，把它的
 * streaming-json 事件流映射成巨天的事件（onDelta/onTool/…）渲染进现有 UI。
 *
 * 协议（grok --output-format streaming-json，逐行 JSON，type 分派）：
 *   text / thought / tool_call / tool_call_update / usage / end / error
 *
 * 认证：XAI_API_KEY 环境变量（console.x.ai）；或用户已 grok login（~/.grok/auth.json）。
 * 权限：受限→只读工具白名单；标准→--allow 常规+deny 危险；完全→--yolo。
 * 会话：--session-id 固定 UUID（巨天 session ↔ grok session 一一映射，历史由 grok 管理）。
 *
 * 二进制定位顺序：环境变量 GROK_BIN → ~/.lyclaw/grok/bin/grok → PATH。
 * 安卓不启用（Rust 二进制无法在 nodejs-mobile 环境运行）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface GrokEvents {
  onDelta?: (text: string) => void
  onThinking?: (text: string) => void
  onTool?: (call: { id?: string; name: string; arguments: string }) => void
  onToolEnd?: (call: { id?: string; name: string; ok: boolean; result: string }) => void
  onUsage?: (u: { inputTokens?: number; outputTokens?: number }) => void
  onNetStatus?: (phase: 'connecting' | 'retrying' | 'first-token', info?: { attempt?: number }) => void
}

export interface GrokTurnOptions {
  prompt: string
  workDir: string
  /** 巨天 session id → grok --session-id（固定 UUID 保证会话连续） */
  sessionId: string
  model?: string
  /** 受限 / 标准 / 完全访问 → grok 工具白名单与审批策略 */
  permissionLevel?: string
  xaiApiKey?: string
  /** 本轮新增的用户消息历史（拼进 prompt 前缀，grok 侧用 session 记忆上下文） */
  signal?: AbortSignal
}

export interface GrokTurnResult {
  ok: boolean
  text: string
  stopped?: 'aborted'
  error?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

const BIN_NAMES = process.platform === 'win32' ? ['grok.exe', 'grok.bat'] : ['grok']

/** 定位 grok 二进制：GROK_BIN 环境变量 → ~/.lyclaw/grok/bin → PATH */
export function locateGrok(): string | null {
  const fromEnv = process.env.GROK_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const home = path.join(os.homedir(), '.lyclaw', 'grok', 'bin')
  for (const n of BIN_NAMES) {
    const p = path.join(home, n)
    if (existsSync(p)) return p
  }
  // PATH 探测
  const dirs = String(process.env.PATH || '').split(path.delimiter)
  for (const d of dirs) {
    if (!d) continue
    for (const n of BIN_NAMES) {
      const p = path.join(d, n)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** 权限档位 → grok 参数（headless 专用 flags） */
function permissionArgs(level: string): string[] {
  if (level === '完全访问' || level === 'yolo') return ['--yolo']
  if (level === '受限' || level === 'readonly') {
    return ['--tools', 'read_file,grep,list_dir,web_search']
  }
  // 标准：放开常规工具，明确拒绝高危 shell 模式（deny 优先于 allow）
  return ['--allow', 'Bash', '--deny', 'Bash(rm -rf*)', '--deny', 'Bash(shutdown*)', '--deny', 'Bash(sudo*)']
}

/** 跑一轮 grok headless：prompt → streaming-json 事件流 → 结果 */
export function runGrokTurn(opts: GrokTurnOptions, events: GrokEvents = {}): Promise<GrokTurnResult> {
  return new Promise((resolve) => {
    const bin = locateGrok()
    if (!bin) {
      resolve({ ok: false, text: '', error: '未找到 grok 二进制。可在终端运行官方安装脚本：curl -fsSL https://x.ai/cli/install.sh | bash' })
      return
    }
    const args = [
      '-p', opts.prompt,
      '--output-format', 'streaming-json',
      '--include-partial-messages',
      '--cwd', opts.workDir || process.cwd(),
      '--session-id', opts.sessionId,
      ...permissionArgs(opts.permissionLevel || '标准'),
    ]
    if (opts.model) args.push('-m', opts.model)

    const env: Record<string, string> = { ...process.env as Record<string, string> }
    if (opts.xaiApiKey) env.XAI_API_KEY = opts.xaiApiKey
    events.onNetStatus?.('connecting')

    let child: ChildProcess
    try {
      child = spawn(bin, args, { cwd: opts.workDir || process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ ok: false, text: '', error: String((e as Error).message || e) })
      return
    }

    let buf = ''
    let finalText = ''
    let errText = ''
    let usage: { inputTokens?: number; outputTokens?: number } | undefined
    let settled = false
    const toolOpen = new Map<string, { name: string; args: string }>()

    const finish = (ok: boolean, error?: string) => {
      if (settled) return
      settled = true
      resolve({ ok, text: finalText, stopped: aborted ? 'aborted' : undefined, error, usage })
    }

    let aborted = false
    const onAbort = () => { aborted = true; try { child.kill('SIGINT') } catch {} }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const handleLine = (line: string) => {
      const t = line.trim()
      if (!t || !t.startsWith('{')) return
      let ev: any
      try { ev = JSON.parse(t) } catch { return }
      const type = String(ev.type || '')
      if (type === 'text') {
        const piece = String(ev.text ?? ev.delta ?? '')
        if (piece) { finalText += piece; events.onDelta?.(piece) }
      } else if (type === 'thought') {
        const piece = String(ev.text ?? ev.thought ?? ev.delta ?? '')
        if (piece) events.onThinking?.(piece)
      } else if (type === 'tool_call') {
        const name = String(ev.name || ev.tool_name || '')
        const id = String(ev.id || ev.tool_call_id || '')
        const argsStr = typeof ev.arguments === 'string' ? ev.arguments : JSON.stringify(ev.arguments ?? ev.input ?? {})
        if (id) toolOpen.set(id, { name, args: argsStr })
        events.onTool?.({ id, name, arguments: argsStr })
      } else if (type === 'tool_call_update') {
        const id = String(ev.id || ev.tool_call_id || '')
        const open = toolOpen.get(id)
        const status = String(ev.status || ev.state || '')
        const ok = !(/fail|error|denied/i.test(status)) && ev.error == null
        const result = String(ev.output ?? ev.result ?? ev.content ?? status)
        events.onToolEnd?.({ id, name: open?.name || String(ev.name || ''), ok, result: result.slice(0, 4000) })
        if (id) toolOpen.delete(id)
      } else if (type === 'usage') {
        usage = {
          inputTokens: Number(ev.input_tokens ?? ev.inputTokens ?? 0) || undefined,
          outputTokens: Number(ev.output_tokens ?? ev.outputTokens ?? 0) || undefined,
        }
        events.onUsage?.(usage)
      } else if (type === 'error') {
        errText = String(ev.message || ev.error || 'grok 内核报错')
      } else if (type === 'end') {
        // end 总是最后一条：stopReason 在 ev.stop_reason
      }
    }

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        handleLine(line)
      }
    })
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (c: string) => { errText += c })

    child.on('error', (e) => finish(false, String(e.message || e)))
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (buf.trim()) handleLine(buf)
      if (aborted) return finish(true)
      if (code === 0) return finish(true)
      finish(false, errText.trim() || `grok 退出码 ${code}`)
    })
    // 首个事件后标记连通（排队感知由 UI 的 netPhase 兜底）
    const firstTimer = setTimeout(() => events.onNetStatus?.('first-token'), 300)
    firstTimer.unref?.()
  })
}

/** 会话连续性说明：grok 用 --session-id 管理自己的历史，巨天侧不需要重放消息。
 *  连续对话时传同一个 sessionId 即可（新的用户内容在 prompt 前缀里说明角色）。 */
export function grokStatus(): { available: boolean; path: string | null } {
  const p = locateGrok()
  return { available: !!p, path: p }
}
