#!/usr/bin/env node
/**
 * jtcode —— 巨天agent 命令行客户端（Claude Code 式）
 *
 * 由桌面 App 一键安装（/usr/local/bin 或 ~/.local/bin）。零依赖单文件。
 * 走 /api/agent/run —— 与桌面端同一条 agent 循环：51 工具、巨天安全门禁、
 * 权限确认（y/n/a）、计划卡、密钥占位符全部同源。
 *
 * 关键语义：
 *   - 工作目录 = jtcode 启动时所在的文件夹（process.cwd()），在哪个目录打开就操作哪个目录
 *   - 巨天未运行时自动拉起（已安装的桌面 App）
 *
 * 用法：
 *   jtcode                    交互模式（REPL）
 *   jtcode "帮我写个快排"     单次提问
 *   jtcode status             查看服务状态与当前模型
 *   jtcode -m <model> "..."   指定模型
 */
import readline from 'node:readline'

const VERSION = '__APP_VERSION__'  // 安装时由 serve.cjs 注入真实版本(单一来源 package.json)
const PORT = Number(process.env.JUTIAN_PORT || 3211)
const BASE = `http://127.0.0.1:${PORT}`
const CWD = process.cwd()

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
}
const BANNER = `
${C.cyan('   ▄▄▄·  ▄▄· ')}  ${C.bold('jtcode')} ${C.dim('v' + VERSION)}
${C.cyan('  ▐█ ▀█ ▐█ ▌▪')}  ${C.dim('巨天agent 命令行客户端 · Claude Code 式')}
${C.cyan('  ▄▀▀▀▌ ██ ▄▄')}  ${C.dim('工作目录：' + CWD)}
${C.cyan('  ▐█▄▪▘ ▐███▌')}
${C.cyan('   ▀▀▀  ·▀▀▀ ')}
`

const args = process.argv.slice(2)
let modelOverride = null
const rest = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-m' || args[i] === '--model') { modelOverride = args[++i]; continue }
  if (args[i] === '-h' || args[i] === '--help') { printHelp(); process.exit(0) }
  if (args[i] === '-v' || args[i] === '--version') { console.log(VERSION); process.exit(0) }
  rest.push(args[i])
}
const command = rest[0] || ''

function printHelp() {
  console.log(BANNER)
  console.log(`  ${C.bold('用法')}`)
  console.log(`    jtcode                  ${C.dim('交互对话（在当前目录操作电脑）')}`)
  console.log(`    jtcode "你的问题"       ${C.dim('单次提问')}`)
  console.log(`    jtcode status           ${C.dim('服务状态 / 当前模型')}`)
  console.log(`    jtcode -m <model> "..." ${C.dim('指定模型')}`)
  console.log('')
  console.log(`  ${C.bold('交互命令')}`)
  console.log(`    /tools /status /security /pack /clear /help /exit`)
}

async function health() {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** 巨天未运行时拉起：优先已安装的桌面 App（其主进程自带后端） */
async function ensureServer() {
  const h = await health()
  if (h) return h
  const plat = process.platform
  const candidates = plat === 'darwin'
    ? ['/Applications/巨天agent.app', `${process.env.HOME}/Applications/巨天agent.app`]
    : plat === 'win32'
      ? [`${process.env.LOCALAPPDATA}\\Programs\\巨天agent\\巨天agent.exe`, `C:\\Program Files\\巨天agent\\巨天agent.exe`]
      : ['/opt/巨天agent/巨天agent']
  const { spawn } = await import('node:child_process')
  const { existsSync } = await import('node:fs')
  const found = candidates.find((p) => existsSync(p))
  if (found) {
    process.stdout.write(C.dim('巨天未运行 → 正在启动桌面 App…\n'))
    if (plat === 'darwin') spawn('open', ['-a', found], { detached: true, stdio: 'ignore' }).unref()
    else spawn(found, [], { detached: true, stdio: 'ignore' }).unref()
  } else {
    process.stdout.write(C.yellow('巨天未运行（未找到已安装的桌面 App，仅尝试等待服务）…\n'))
  }
  const t0 = Date.now()
  while (Date.now() - t0 < 90_000) {
    const h2 = await health()
    if (h2) return h2
    await new Promise((r) => setTimeout(r, 800))
  }
  return null
}

function sysPrompt(osName) {
  return `你叫巨天，是「巨天agent」的命令行客户端 jtcode，运行在${osName}。用户在终端里与你对话，你可以真实操作这台电脑：写文件、改文件、执行命令、打开网页和文件。不要说自己"无法操作计算机/受限环境"——你可以，工具都可用。

【关键语义】
- 工作目录：${CWD}（jtcode 在此目录启动，shell/读写默认都在此目录内进行；write_file 的 path 只放文件路径本身）
- 打开网页/URL 用 open_path（https://… 会用系统默认浏览器打开）；打开文件/文件夹也用 open_path
- 命令里可用 {{KEY}}/{{BASE}} 占位符引用已配置的密钥/地址，不要索要明文密钥
- 关机/重启/登出只能由用户手动操作，AI 不得用任何命令或脚本变体执行

【响应风格】
- 直接高效：先给结论/方案；不写客套话
- 终端宽度有限：回答紧凑，列表最多 5 点

【执行纪律】
◆ 一次说清：需要多个信息时一轮并行调用多个工具
◆ 先看后写：改文件前先 read_file 确认真实内容
◆ 小步验证：每改完一处就验证（读回/跑测试）
◆ 遇错即停：连续失败两次换方法
◆ 说人话：不贴工具原始输出，提炼成结论

【多步任务】≥3 步先调用 update_plan 列清单，每完成一步更新状态。`
}

async function getSettings() {
  try {
    const r = await fetch(`${BASE}/api/settings`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) return await r.json()
  } catch { /* ignore */ }
  return {}
}

/** 从服务拉取内置工具 schema（单一来源，与桌面/手机/TUI 一致） */
async function getTools() {
  try {
    const r = await fetch(`${BASE}/api/remote/tools`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) {
      const d = await r.json()
      return Array.isArray(d.tools) ? d.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) : []
    }
  } catch { /* ignore */ }
  return []
}

// ─── SSE ───
async function* sseLines(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      for (const line of buf.slice(0, idx).split('\n')) {
        if (line.startsWith('data: ')) yield line.slice(6)
      }
      buf = buf.slice(idx + 2)
    }
  }
}


/** 行级 Markdown → 终端 ANSI（零依赖精简版：标题/加粗/行内码/围栏/列表） */
function mdLine(s) {
  let t = s
  if (/^\s*```/.test(t)) return C.dim('  ─────')
  t = t.replace(/^\s*(#{1,6})\s+(.*)$/, (_, h, txt) => C.cyan(C.bold('  ' + txt)))
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, x) => C.bold(x))
  t = t.replace(/`([^`]+)`/g, (_, x) => C.yellow(x))
  t = t.replace(/^\s*[-*]\s+/, '  • ').replace(/^\s*\d+\.\s+/, (m) => '  ' + m)
  return t
}

function argsLine(name, argsStr) {
  let a = {}
  try { a = JSON.parse(argsStr || '{}') } catch { /* ignore */ }
  const pick = [a.command, a.path, a.file_path, a.query, a.pattern, a.url, a.name, a.topic].find((v) => typeof v === 'string' && v)
  return `${name}(${String(pick || JSON.stringify(a)).replace(/\s+/g, ' ').slice(0, 80)})`
}

/**
 * 一轮完整对话：走 /api/agent/run（服务端 agent 循环），
 * needs_client 时终端里问用户（y/n/a），与桌面端同一门禁。
 */
async function chatRun({ settings, messages, tools, hooks }) {
  let msgs = messages
  let resume
  let pendingTool
  const confirmations = {}
  const approvedScopes = []

  for (let hop = 0; hop < 30; hop++) {
    let res
    try {
      res = await fetch(`${BASE}/api/agent/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          tools,
          model: modelOverride || settings.model || '',
          apiBase: settings.apiBaseUrl || '',
          apiKey: '', // 留空 → 服务端回落本机存储的真实密钥（密钥不出电脑）
          contextWindow: Number(settings.contextWindow) || 0,
          hermesMode: settings.hermesProtocol,
          workDir: CWD,
          permissionLevel: settings.permissionLevel === 'full' ? 'full' : 'standard',
          resume, pendingTool, confirmations, approvedScopes,
        }),
        signal: AbortSignal.timeout(300_000),
      })
    } catch (e) { hooks.onError(`无法连接本地服务：${e.message || e}`); return '' }
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      hooks.onError(`agent 启动失败（HTTP ${res.status}）${t ? '：' + t.slice(0, 160) : ''}`)
      return ''
    }

    let needs = null
    for await (const data of sseLines(res.body)) {
      let ev
      try { ev = JSON.parse(data) } catch { continue }
      if (ev.type === 'needs_client') { needs = ev; break }
      if (ev.type === 'done') return ev.content || ''
      if (ev.type === 'error') { hooks.onError(ev.message || '未知错误'); return '' }
      if (ev.type === 'aborted') return ''
      hooks.onEvent?.(ev)
    }
    if (!needs) { hooks.onError('连接中断：服务端未返回结果'); return '' }
    msgs = needs.messages || msgs
    resume = needs.partial

    if (needs.kind === 'client_tool' && needs.tool) {
      let out = '{"ok":true}'
      if (needs.tool.name === 'update_plan') {
        try {
          const steps = JSON.parse(needs.tool.arguments || '{}').steps || []
          hooks.onPlan?.(steps)
        } catch { /* ignore */ }
      } else {
        out = '{"ok":false,"error":"该客户端工具需要在桌面端使用"}'
      }
      msgs = [...msgs, { role: 'tool', tool_call_id: needs.tool.id, content: out }]
      pendingTool = undefined
      continue
    }
    if (needs.kind === 'confirm' && needs.tool) {
      const verdict = await hooks.onConfirm?.(needs.tool, needs.scopeKey)
      if (verdict === 'deny') pendingTool = { toolCall: needs.tool, decision: '用户拒绝了此操作。不要尝试绕过，直接说明并继续。' }
      else {
        confirmations[needs.tool.id] = true
        pendingTool = { toolCall: needs.tool, decision: null }
        if (verdict === 'always' && needs.scopeKey) approvedScopes.push(needs.scopeKey)
      }
      continue
    }
    hooks.onError('agent 需要未知的客户端操作，已停止')
    return ''
  }
  hooks.onError('agent 续跑次数过多，已停止')
  return ''
}

function spinnerStart(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const timer = setInterval(() => { process.stdout.write(`\r${C.cyan(frames[i++ % frames.length])} ${C.dim(label)}`) }, 90)
  return () => { clearInterval(timer); process.stdout.write('\r\x1b[K') }
}

async function ask(settings, history, question, tools, store) {
  history.push({ role: 'user', content: question })
  const stopSpinner = spinnerStart('思考中…')
  let reasoningLine = false
  let lineBuf = ''
  try {
    // 会话落盘：首轮建会话（桌面端可见），之后每轮写用户/助手消息
    if (store && !store.sid) {
      try { const s2 = await fetch(`${BASE}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: question.slice(0, 18) || '终端对话' }) }).then((r) => r.json()); if (s2?.id) store.sid = s2.id } catch { /* 落盘失败不影响对话 */ }
    }
    const sid = store?.sid
    if (sid) { try { await fetch(`${BASE}/api/sessions/${encodeURIComponent(sid)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `jt-u-${Date.now()}`, role: 'user', content: question, created_at: new Date().toISOString() }) }) } catch {} }

    const flushLine = (final) => {
      if (!lineBuf) return
      process.stdout.write(mdLine(lineBuf) + '\n')
      lineBuf = ''
    }
    const reply = await chatRun({
      settings, messages: history, tools,
      hooks: {
      onEvent: (ev) => {
        if (!process.stdout.isTTY) return
        if (ev.type === 'chunk') {
          if (stopSpinner.done !== true) { stopSpinner(); stopSpinner.done = true }
          if (reasoningLine) { process.stdout.write(C.dim('└\n')); reasoningLine = false }
          lineBuf += ev.text || ''
          const nl = lineBuf.lastIndexOf('\n')
          if (nl >= 0) { process.stdout.write(mdLine(lineBuf.slice(0, nl)) + '\n'); lineBuf = lineBuf.slice(nl + 1) }
        } else if (ev.type === 'thinking') {
          if (stopSpinner.done !== true) { stopSpinner(); stopSpinner.done = true }
          if (!reasoningLine) { process.stdout.write(C.dim('\n┌ 思考 ')); reasoningLine = true }
          process.stdout.write(C.dim(String(ev.text || '').replace(/\n/g, ' ')))
        } else if (ev.type === 'tool_start' && ev.tool) {
          if (stopSpinner.done !== true) { stopSpinner(); stopSpinner.done = true }
          if (reasoningLine) { process.stdout.write(C.dim('└\n')); reasoningLine = false }
          flushLine(true)
          process.stdout.write(C.dim(`\n  ⚙ ${argsLine(ev.tool.name, ev.tool.arguments)} …\n`))
        } else if (ev.type === 'tool_end' && ev.tool) {
          const ok = ev.tool.status !== 'error'
          const preview = String(ev.tool.result || '').trim().split('\n')[0]?.slice(0, 100) || ''
          process.stdout.write(C.dim(`\r\x1b[K  ${ok ? C.green('✓') : C.red('✗')} ${argsLine(ev.tool.name, ev.tool.arguments)}${preview ? C.dim('  ' + preview) : ''}\n`))
        }
      },
      onConfirm: (tool, _scopeKey) => new Promise((resolve) => {
        if (reasoningLine) { process.stdout.write(C.dim('└\n')); reasoningLine = false }
        flushLine(true)
        console.log(C.yellow(`\n⚠ 需要确认：${tool.name}`))
        console.log(C.dim(`  ${argsLine(tool.name, tool.arguments)}`))
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout })
        rl2.question('  [y] 允许 · [n] 拒绝 · [a] 本会话始终允许 > ', (ans) => {
          rl2.close()
          const v = String(ans || '').trim().toLowerCase()
          resolve(v === 'y' ? 'allow' : v === 'a' ? 'always' : 'deny')
        })
      }),
      onPlan: (steps) => {
        console.log(C.dim('  ┌ 计划'))
        for (const s2 of steps) console.log(C.dim(`  │ ${s2.status === 'done' ? '☑' : '☐'} ${s2.content || ''}`))
        console.log(C.dim('  └'))
      },
      onError: (m) => { stopSpinner(); console.error(C.red(`✗ ${m}`)) },
      },
    })
    if (reasoningLine) process.stdout.write(C.dim('└\n'))
    flushLine(true)
    if (reply) { process.stdout.write('\n' + C.dim('(完成 · 已存入会话)' + '\x07\n')) }
    history.push({ role: 'assistant', content: reply })
    const sid2 = store?.sid
    if (sid2 && reply) { try { await fetch(`${BASE}/api/sessions/${encodeURIComponent(sid2)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `jt-a-${Date.now()}`, role: 'assistant', content: reply, created_at: new Date().toISOString() }) }) } catch {} }
  } catch (e) {
    stopSpinner()
    console.error(C.red(`✗ ${e.message || e}`))
    history.pop()
  }
}

async function cmdStatus() {
  const h = await ensureServer()
  if (!h) { console.error(C.red('✗ 后端启动超时')); process.exit(1) }
  const s = await getSettings()
  console.log(BANNER)
  console.log(`  ${C.green('●')} 服务在线 ${C.dim(`localhost:${PORT}`)}`)
  console.log(`  ${C.dim('工具数:')} ${h.tools ?? '?'}   ${C.dim('平台:')} ${h.platform ?? '?'}`)
  console.log(`  ${C.dim('模型:')}  ${C.bold(modelOverride || s.model || 'default')}`)
  console.log(`  ${C.dim('工作目录:')} ${CWD}${s.workDir ? C.dim(`  (桌面端工作区: ${s.workDir})`) : ''}`)
}

async function main() {
  const h = await ensureServer()
  if (!h) { console.error(C.red('✗ 巨天agent 服务启动失败')); process.exit(1) }
  const settings = await getSettings()
  const osName = h.platform === 'darwin' ? 'macOS' : h.platform === 'win32' ? 'Windows' : 'Linux'

  if (command === 'status') { await cmdStatus(); return }
  if (command) {
    const tools = await getTools()
    const history = [{ role: 'system', content: sysPrompt(osName) }]
    await ask(settings, history, rest.join(' '), tools)
    return
  }

  // 交互模式
  console.log(BANNER)
  console.log(`  ${C.green('●')} 已连接 ${C.dim(`localhost:${PORT} · ${settings.model || 'default'}`)}`)
  console.log(C.dim('  在当前目录操作电脑 · 权限操作会向你确认 · /exit 退出'))
  console.log(C.dim('  /tools 工具列表  /status 状态  /security 安全开关  /pack 更新防护库\n'))
  const tools = await getTools()
  const history = [{ role: 'system', content: sysPrompt(osName) }]
  const store = { sid: null }
  let busy = false
  const queue = []
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: C.cyan('❯ ') })
  const drain = async () => {
    if (busy || !queue.length) return
    busy = true
    const item = queue.shift()
    try { await ask(settings, history, item.q, tools, store) } finally { busy = false }
    if (queue.length) { console.log(C.dim(`\n继续处理队列（${queue.length} 条）`)); setTimeout(drain, 50) }
    rl.prompt()
  }
  rl.prompt()
  rl.on('line', async (line) => {
    const q = line.trim()
    if (!q) { rl.prompt(); return }
    if (q === '/exit' || q === '/quit' || q === 'exit') { rl.close(); return }
    if (q === '/clear') { history.length = 1; console.log(C.dim('已清空上下文')); rl.prompt(); return }
    if (q === '/help') { printHelp(); rl.prompt(); return }
    if (q === '/status') { await cmdStatus(); rl.prompt(); return }
    if (q === '/tools') {
      console.log(`  ${C.bold('可用工具')} ${tools.length} 个:`)
      for (const t of tools) console.log(`  ${C.green('·')} ${t.name} ${C.dim(String(t.description || '').slice(0, 60))}`)
      rl.prompt(); return
    }
    if (q === '/security') {
      try {
        const r = await fetch(`${BASE}/api/settings`).then((x) => x.json())
        console.log(`  巨天安全：危险命令拦截 ${r.security_cmd_guard !== '0' ? C.green('开') : C.red('关')} · 注入扫描 ${r.security_injection_scan !== '0' ? C.green('开') : C.red('关')} · 密钥屏蔽 ${r.security_key_shield !== '0' ? C.green('开') : C.red('关')}`)
      } catch { console.error(C.red('  读取失败')) }
      rl.prompt(); return
    }
    if (q === '/pack') {
      console.log(C.dim('  正在更新恶意命令库…'))
      try {
        const r = await fetch(`${BASE}/api/security/pack/update`, { method: 'POST' }).then((x) => x.json())
        console.log(r?.ok ? `  ${C.green('✓')} 防护库 v${r.version}（${r.count} 条，生效 ${r.active} 条）` : `  ${C.red('✗')} ${r?.error}`)
      } catch (e) { console.error(C.red('  ' + (e.message || e))) }
      rl.prompt(); return
    }
    if (q.startsWith('/model')) {
      const models = (() => { try { return JSON.parse(settings.models || '[]') } catch { return [] } })()
      if (!q.includes(' ')) {
        console.log(`  当前模型：${C.bold(settings.model || 'default')}`)
        if (models.length) console.log('  可选（/model <序号> 切换）：\n' + models.map((m, i) => `   ${m === settings.model ? C.green('●') : '○'} ${i + 1}. ${m}`).join('\n'))
        else console.log(C.dim('  无候选列表（在桌面端设置页拉取模型列表后可用）'))
        rl.prompt(); return
      }
      const arg = q.split(/\s+/)[1]
      const n = parseInt(arg, 10)
      const target = models[n - 1] && !arg.includes('.') ? models[n - 1] : arg
      try {
        await fetch(`${BASE}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'model', value: target }) })
        settings.model = target
        console.log(`  ${C.green('✓')} 模型已切换：${C.bold(target)}`)
      } catch (e) { console.error(C.red('  切换失败：' + (e.message || e))) }
      rl.prompt(); return
    }
    // 忙时排队（Claude Code 同款语义），完成后自动继续
    if (busy) { queue.push(q); console.log(C.dim(`  已排队（第 ${queue.length} 条）`)); return }
    queue.push(q)
    await drain()
  })
  rl.on('close', () => { console.log(C.dim('\n再见')); process.exit(0) })
}

main().catch((e) => { console.error(C.red('✗ ' + (e.message || e))); process.exit(1) })
