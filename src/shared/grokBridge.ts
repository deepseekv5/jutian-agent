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
import fs from 'node:fs'
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
  /** v16.8.1 模型自动接入：巨天当前模型（OpenAI 兼容）注入 grok，成为其默认模型 */
  modelBase?: string
  modelKey?: string
  contextWindow?: number
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

/** 定位 grok 二进制：GROK_BIN 环境变量 → 安装包 resources/grok（预装）→ ~/.lyclaw/grok/bin → PATH */
export function locateGrok(): string | null {
  const fromEnv = process.env.GROK_BIN
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv
  // v16.8.1 预装：Electron 打包后在 app/resources/grok/grok（eb-config extraResources）
  try {
    const rp = (process as any).resourcesPath
    if (rp) {
      for (const n of BIN_NAMES) {
        const p = path.join(rp, 'grok', n)
        if (fs.existsSync(p)) return p
      }
    }
  } catch { /* 非 Electron 环境（TUI）无 resourcesPath */ }
  const home = path.join(os.homedir(), '.lyclaw', 'grok', 'bin')
  for (const n of BIN_NAMES) {
    const p = path.join(home, n)
    if (fs.existsSync(p)) return p
  }
  // PATH 探测
  const dirs = String(process.env.PATH || '').split(path.delimiter)
  for (const d of dirs) {
    if (!d) continue
    for (const n of BIN_NAMES) {
      const p = path.join(d, n)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

/** 权限档位 → grok 参数（headless 专用 flags，实测 v1.0.77）：
 *  --allow "Bash" 匹配不上工具审批（run_terminal_command 仍被非交互审批拒绝），
 *  标准档用 --always-approve（巨天「标准」档语义=允许写文件不逐项批准，与 JT 内核一致） */
function permissionArgs(level: string): string[] {
  if (level === '完全访问' || level === 'yolo') return ['--yolo']
  if (level === '受限' || level === 'readonly') {
    return ['--tools', 'read_file,grep,list_dir,web_search']
  }
  // 标准：审批自动通过（等价 yolo；巨天侧的高危命令另有巨天安全拦截层兜底）
  return ['--always-approve']
}

/** 巨天管理的 grok 配置目录（不污染用户 ~/.grok） */
export function grokHomeDir(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), '.lyclaw', 'grok-home')
}

/**
 * v16.8.3 模型自动接入（源码直改版）：巨天编译的 grok 已内置 JUTIAN_COMPAT 补丁
 * （见 third_party/grok-build/patches/）——鉴权优先 XAI_API_KEY（=巨天模型 key），
 * [model.*] 表在外部鉴权模式下保留，default 模型即巨天当前模型。
 * 这里只写 config.toml（模型定义+default）与注入环境变量，不再需要 auth provider 脚本。
 */
function ensureGrokModelConfig(opts: GrokTurnOptions): string {
  const home = grokHomeDir()
  try {
    if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true })
    const lines: string[] = []
    const hasJutianModel = !!(opts.modelBase && opts.model)
    if (hasJutianModel) {
      // base_url 规范化：grok 自己拼 /chat/completions——尾部斜杠会产生双斜杠（讯飞网关实测 404）
      const base = String(opts.modelBase).replace(/[\\/]+$/, '')
      lines.push('[model.jutian-active]')
      lines.push(`model = ${JSON.stringify(opts.model)}`)
      lines.push(`base_url = ${JSON.stringify(base)}`)
      lines.push('name = "巨天当前模型"')
      if (opts.contextWindow && opts.contextWindow > 1000) lines.push(`context_window = ${Math.floor(opts.contextWindow)}`)
      lines.push('')
      lines.push('[models]')
      lines.push('default = "jutian-active"')
      lines.push('')
    }
    const target = path.join(home, 'config.toml')
    const tmp = target + '.tmp'
    fs.writeFileSync(tmp, lines.join('\n'))
    fs.renameSync(tmp, target)
    return home
  } catch {
    return process.env.GROK_HOME || path.join(os.homedir(), '.grok')
  }
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
    // 模型选择：grok-* 走 xAI 官方；其余不传 -m——default=jutian-active（巨天当前模型）生效
    if (opts.model && /^grok-/i.test(opts.model)) args.push('-m', opts.model)

    const env: Record<string, string> = { ...process.env as Record<string, string> }
    // v16.8.3 模型自动接入（源码直改版）：
    //  · XAI_API_KEY = 巨天模型 key（有巨天模型时）或用户填的 xAI key——补丁鉴权优先用它
    //  · JUTIAN_COMPAT = 1 —— 触发 grok 补丁：[model.*] 保留 + 鉴权优先 API-key（跳过 OAuth）
    //  · GROK_HOME = 巨天管理目录（config.toml 模型定义，default=jutian-active）
    const hasJutianModel = !!(opts.modelBase && opts.model)
    const keyForAuth = hasJutianModel ? (opts.modelKey || opts.xaiApiKey || '') : (opts.xaiApiKey || '')
    if (keyForAuth) env.XAI_API_KEY = keyForAuth
    env.JUTIAN_COMPAT = '1'
    env.GROK_HOME = ensureGrokModelConfig(opts)
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
      // 实测 grok 1.0.x streaming-json 的字段形态：文本在 ev.data（非 text）；工具事件用
      // toolCallId；usage 嵌套两层 ev.usage.input_tokens；未知事件（available_commands 等）忽略
      if (type === 'text') {
        const piece = String(ev.data ?? ev.text ?? ev.delta ?? ev.deltaText ?? '')
        if (piece) { finalText += piece; events.onDelta?.(piece) }
      } else if (type === 'thought') {
        const piece = String(ev.data ?? ev.thought ?? ev.text ?? ev.delta ?? '')
        if (piece) events.onThinking?.(piece)
      } else if (type === 'tool_call') {
        // grok 1.0.x 实测：工具名在 title/toolName，id 在 toolCallId，参数在 rawInput
        const name = String(ev.title || ev.toolName || ev.name || ev.kind || '')
        const id = String(ev.toolCallId || ev.id || ev.tool_call_id || '')
        const argsRaw = ev.rawInput ?? ev.arguments ?? ev.input ?? {}
        const argsStr = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw ?? {})
        if (id) toolOpen.set(id, { name, args: argsStr })
        events.onTool?.({ id, name, arguments: argsStr })
      } else if (type === 'tool_call_update') {
        const id = String(ev.toolCallId || ev.id || ev.tool_call_id || '')
        // 无 id 的帧（流末尾的汇总帧）不配对、不上报
        if (!id) return
        const open = toolOpen.get(id)
        const status = String(ev.status || ev.state || '')
        // 中间态（pending/running）只更新内存不发事件——实测同 id 会发多轮 update，
        // 早发会让 UI 先显示成功再显示失败的乱序结果；终态才发
        if (!/completed|failed|error|denied|cancelled/i.test(status)) {
          if (id && !open) toolOpen.set(id, { name: String(ev.title || ev.toolName || ''), args: '' })
          return
        }
        const ok = /completed/i.test(status)
        // 结果解析（grok 1.0.x 实测结构）：
        //  · content 条目：{type:'content', content:{type:'text', text:'...'}}（两层嵌套）或 diff
        //  · rawOutput 对象：{type:'Bash', command, output_for_prompt, output:[字节数组], ...}
        const content = Array.isArray(ev.content) ? ev.content : []
        const parts: string[] = []
        for (const c of content) {
          if (!c) continue
          if (c.type === 'diff') {
            parts.push(`${c.path}${c.oldText ? `:\n- ${String(c.oldText).slice(0, 200)}\n+ ${String(c.newText).slice(0, 200)}` : ` → ${String(c.newText).slice(0, 200)}`}`)
          } else {
            const inner: any = c.content
            const t = String(typeof inner === 'string' ? inner : (inner?.text ?? inner?.output ?? c.text ?? c.data ?? c.message ?? c.stdout ?? ''))
            if (t.trim()) parts.push(t.slice(0, 1500))
          }
        }
        const rO: any = ev.rawOutput
        const rawPieces: string[] = []
        if (rO && typeof rO === 'object') {
          if (rO.command) rawPieces.push('$ ' + String(rO.command).slice(0, 120))
          if (rO.output_for_prompt) rawPieces.push(String(rO.output_for_prompt).slice(0, 1500))
          if (!rO.output_for_prompt && Array.isArray(rO.output) && rO.output.length) {
            try { rawPieces.push(Buffer.from(rO.output as number[]).toString('utf-8').slice(0, 1500)) } catch {}
          }
        } else if (typeof rO === 'string' && rO.trim()) {
          rawPieces.push(rO.slice(0, 1500))
        }
        const result = [parts.join('\n'), rawPieces.join('\n')].filter(Boolean).join('\n').slice(0, 4000)
        events.onToolEnd?.({ id, name: open?.name || String(ev.title || ev.toolName || ''), ok, result })
        if (id) toolOpen.delete(id)
      } else if (type === 'usage') {
        const u: any = ev.usage && typeof ev.usage === 'object' ? ev.usage : ev
        usage = {
          inputTokens: Number(u.input_tokens ?? u.inputTokens ?? 0) || undefined,
          outputTokens: Number(u.output_tokens ?? u.outputTokens ?? 0) || undefined,
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
