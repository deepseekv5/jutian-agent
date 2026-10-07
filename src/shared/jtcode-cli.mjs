#!/usr/bin/env node
/**
 * jtcode —— 巨天agent 命令行客户端
 *
 * 由桌面 App 一键安装（/usr/local/bin 或 ~/.local/bin）。
 * 连接本机运行的巨天agent 服务（localhost:3211/3210），在终端直接对话。
 *
 * 用法：
 *   jtcode                    交互模式（REPL）
 *   jtcode "帮我写个快排"     单次提问
 *   jtcode status             查看服务状态与当前模型
 *   jtcode -m <model>         指定模型
 *   jtcode --help             帮助
 */
import readline from 'node:readline'

const VERSION = '__APP_VERSION__'  // 安装时由 serve.cjs 注入真实版本(单一来源 package.json)
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
}
const BANNER = `
${C.cyan('   ▄▄▄·  ▄▄· ')}  ${C.bold('jtcode')} ${C.dim('v' + VERSION)}
${C.cyan('  ▐█ ▀█ ▐█ ▌▪')}  ${C.dim('巨天agent 命令行客户端')}
${C.cyan('  ▄▀▀▀▌ ██ ▄▄')}  ${C.dim('连接本机桌面服务，终端直接对话')}
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
  console.log(`    jtcode                  ${C.dim('交互对话（REPL，可用工具）')}`)
  console.log(`    jtcode "你的问题"       ${C.dim('单次提问')}`)
  console.log(`    jtcode status           ${C.dim('服务状态 / 当前模型')}`)
  console.log(`    jtcode -m <model> "..." ${C.dim('指定模型')}`)
  console.log('')
  console.log(`  ${C.bold('交互模式命令')}`)
  console.log(`    /tools ${C.dim('查看可用工具')}   /clear ${C.dim('清空上下文')}   /status ${C.dim('查看状态')}   /exit ${C.dim('退出')}`)
}

async function findServer() {
  for (const port of [3211, 3210]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1200) })
      if (r.ok) return port
    } catch { /* 下一端口 */ }
  }
  return null
}

async function getSettings(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/settings`, { signal: AbortSignal.timeout(2000) })
    if (r.ok) return await r.json()
  } catch { /* ignore */ }
  return {}
}

async function cmdStatus() {
  const port = await findServer()
  if (!port) {
    console.error(C.red('✗ 未检测到巨天agent 服务（localhost:3211/3210 均不可达）'))
    console.error(C.dim('  请先启动巨天agent 桌面应用'))
    process.exit(1)
  }
  const h = await fetch(`http://localhost:${port}/api/health`).then((r) => r.json()).catch(() => ({}))
  const s = await getSettings(port)
  console.log(BANNER)
  console.log(`  ${C.green('●')} 服务在线 ${C.dim(`localhost:${port}`)}`)
  console.log(`  ${C.dim('工具数:')} ${h.tools ?? '?'}   ${C.dim('平台:')} ${h.platform ?? '?'}`)
  console.log(`  ${C.dim('模型:')}  ${C.bold(s.model || 'default')}${s.provider ? C.dim(` (${s.provider})`) : ''}`)
  if (h.workDir) console.log(`  ${C.dim('工作区:')} ${h.workDir}`)
}

/** 从服务拉取内置工具 schema(单一来源,与桌面端/手机端一致) */
async function getTools(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/remote/tools`, { signal: AbortSignal.timeout(2000) })
    if (r.ok) {
      const d = await r.json()
      return Array.isArray(d.tools) ? d.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) : []
    }
  } catch { /* 忽略,工具不可用 */ }
  return []
}

/** 执行一个工具调用,结果回给模型 */
async function execTool(port, name, args, cwd) {
  try {
    const r = await fetch(`http://localhost:${port}/api/tools/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cwd ? { 'X-Work-Dir': encodeURIComponent(cwd) } : {}) },
      body: JSON.stringify({ name, args: typeof args === 'string' ? JSON.parse(args || '{}') : (args || {}) }),
      signal: AbortSignal.timeout(120000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.success === false || r.status >= 400) {
      return typeof (j.error || j.output) === 'string' ? (j.error || j.output) : JSON.stringify(j)
    }
    return typeof j.output === 'string' ? j.output : JSON.stringify(j)
  } catch (e) { return `工具执行失败: ${e.message || e}` }
}

/** 调 /api/llm-proxy 流式对话，返回完整回复 */
async function chatStream(port, settings, messages, onDelta, tools, workDir) {
  const isLocal = settings.provider === 'local'
  const targetBase = isLocal ? 'http://localhost:1234/v1' : (settings.apiBaseUrl || 'https://openrouter.ai/api/v1')
  const apiKey = isLocal ? 'lm-studio' : (settings.apiKey || '')
  const model = modelOverride || settings.model || 'default'

  const body = { model, messages, stream: true }
  if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = 'auto' }

  const res = await fetch(`http://localhost:${port}/api/llm-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Target-Base': targetBase, 'X-Api-Key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    let friendly = `请求失败 (${res.status})`
    try {
      const j = JSON.parse(t)
      if (res.status === 429) friendly = '今日 API 免费额度已用完，请明天再试'
      else if (res.status === 401) friendly = 'API 密钥无效或已过期，请在桌面 App 设置中检查'
      if (j.error) friendly = typeof j.error === 'string' ? j.error : JSON.stringify(j.error)
    } catch {}
    throw new Error(friendly)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  const toolCalls = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        const d = j.choices?.[0]?.delta
        if (d?.content) { full += d.content; onDelta?.(d.content, false) }
        if (d?.reasoning_content || d?.reasoning) onDelta?.(d.reasoning_content || d.reasoning, true)
        for (const tc of d?.tool_calls || []) {
          const i = tc.index ?? 0
          if (!toolCalls[i]) toolCalls[i] = { id: tc.id || '', name: '', argStr: '' }
          if (tc.id) toolCalls[i].id = tc.id
          if (tc.function?.name) toolCalls[i].name += tc.function.name
          if (tc.function?.arguments) toolCalls[i].argStr += tc.function.arguments
        }
      } catch { /* 忽略非 JSON 行 */ }
    }
  }
  return { text: full, toolCalls: toolCalls.filter(Boolean) }
}

function spinnerStart(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const timer = setInterval(() => {
    process.stdout.write(`\r${C.cyan(frames[i++ % frames.length])} ${C.dim(label)}`)
  }, 90)
  return () => { clearInterval(timer); process.stdout.write('\r\x1b[K') }
}

/** 一轮完整对话:模型可调工具,循环执行直到给出最终文本(v9.0:与桌面端同构) */
async function chatOnce(port, settings, history, onDelta) {
  const tools = await getTools(port)
  const workDir = settings.workDir || ''
  for (let turn = 0; turn < 10; turn++) {
    const r = await chatStream(port, settings, history, onDelta, tools, workDir)
    if (r.toolCalls.length === 0) return r.text
    // 模型要求调工具:执行,把结果回传,继续下一轮
    for (const tc of r.toolCalls) {
      history.push({ role: 'assistant', tool_calls: [{ id: tc.id || ('call_' + Math.random().toString(36).slice(2, 8)), type: 'function', function: { name: tc.name, arguments: tc.argStr || '{}' } }] })
      let args = {}
      try { args = JSON.parse(tc.argStr || '{}') } catch { /* 模型偶发输出半个 JSON */ }
      const result = await execTool(port, tc.name, args, workDir)
      if (process.stdout.isTTY) process.stdout.write(C.dim(`\n  ⚙ ${tc.name}\n`))
      history.push({ role: 'tool', tool_call_id: tc.id || ('call_' + Math.random().toString(36).slice(2, 8)), content: result.slice(0, 12000) })
    }
  }
  return '(达到工具调用轮数上限)'
}

async function ask(port, settings, history, question) {
  history.push({ role: 'user', content: question })
  const stopSpinner = process.stdout.isTTY ? spinnerStart('思考中…') : () => {}
  let reasoningLine = false
  try {
    const reply = await chatOnce(port, settings, history, (delta, reasoning) => {
      if (!process.stdout.isTTY) return
      if (!stopSpinner.done) { stopSpinner(); stopSpinner.done = true }
      if (reasoning) {
        if (!reasoningLine) { process.stdout.write(C.dim('\n┌ 思考')); reasoningLine = true }
        process.stdout.write(C.dim(reasoning.replace(/\n/g, ' ')))
        return
      }
      if (reasoningLine) { process.stdout.write(C.dim('\n└\n')); reasoningLine = false }
      process.stdout.write(delta)
    })
    if (reasoningLine) { if (process.stdout.isTTY) process.stdout.write(C.dim('\n└\n')); reasoningLine = false }
    if (!process.stdout.isTTY && reply) console.log(reply)
    else if (reply) process.stdout.write('\n')
    history.push({ role: 'assistant', content: reply })
    return reply
  } catch (e) {
    stopSpinner()
    console.error(C.red(`✗ ${e.message}`))
    history.pop()
    return null
  }
}

async function main() {
  const port = await findServer()
  if (!port) {
    console.error(C.red('✗ 未检测到巨天agent 服务，请先启动桌面 App'))
    process.exit(1)
  }
  const settings = await getSettings(port)

  // 单次提问
  if (command && command !== 'status') {
    const history = []
    await ask(port, settings, history, rest.join(' '))
    return
  }
  if (command === 'status') { await cmdStatus(); return }

  // 交互模式
  console.log(BANNER)
  console.log(`  ${C.green('●')} 已连接 ${C.dim(`localhost:${port} · ${settings.model || 'default'}`)}`)
  console.log(C.dim('  输入问题开始对话(模型可调用工具),/exit 退出'))
  console.log(C.dim('  /tools 查看可用工具 /status 查看状态\n'))
  const history = []
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: C.cyan('❯ ') })
  rl.prompt()
  rl.on('line', async (line) => {
    const q = line.trim()
    if (!q) { rl.prompt(); return }
    if (q === '/exit' || q === '/quit' || q === 'exit') { rl.close(); return }
    if (q === '/clear') { history.length = 0; console.log(C.dim('已清空上下文')); rl.prompt(); return }
    if (q === '/status') { await cmdStatus(); rl.prompt(); return }
    if (q === '/tools') {
      const tools = await getTools(port)
      console.log(`  ${C.bold('可用工具')} ${tools.length} 个:`)
      for (const t of tools) console.log(`  ${C.green('·')} ${t.function.name} ${C.dim(t.function.description.slice(0, 60))}`)
      rl.prompt(); return
    }
    await ask(port, settings, history, q)
    rl.prompt()
  })
  rl.on('close', () => { console.log(C.dim('\n再见')); process.exit(0) })
}

main().catch((e) => { console.error(C.red('✗ ' + (e.message || e))); process.exit(1) })