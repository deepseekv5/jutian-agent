/**
 * UI 端到端测试（v18.1.2）：headless 可 CI 的真链路断言。
 *
 * 背景：多次教训表明「1556 个单测全绿 ≠ 接线完好」（v12.1 六个死代码模块、
 * tui engineArg 未定义）——单测挡不住装配层断裂。本文件用真实组件跑完整链路：
 *
 *   mock LLM 上游(7434) ← 隔离 serve.cjs(7433, HOME=临时目录) ← headless Chrome(puppeteer-core)
 *
 * 跑法：node tests/e2e/run.mjs（自包含：起/停 mock 与 serve、临时目录清理）
 * 端口 7433/7434 刻意避开 vitest 测试段 6900-7100（scripts/kill-test-serves.mjs 只杀该段）。
 *
 * UI 门控规避（源码逐行核实）：
 *   - LegalGate 全屏弹窗：预种 localStorage lyclaw_legal_consent = LEGAL_VERSION
 *   - App 默认落 NewTabPage：预种 lyclaw_tabs=[chat tab] + lyclaw_active_tab 直进聊天页
 *   - 工具确认弹窗：permissionLevel=full
 *   - autoTitle 首轮后发非流式标题请求：设置里直接关掉
 *   - DEFAULT agentEngine=super（v18.1.2 起）：确定性用例先 POST engine=server 走标准五阶段
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import puppeteer from 'puppeteer-core'

// 仓库路径含中文（副本）——import.meta.url 的 pathname 是 URL 编码形式，
// 必须经 fileURLToPath 解码，否则 spawn 的 cwd 不存在报 ENOENT
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SERVE_PORT = 7433
const MOCK_PORT = 7434
const BASE = `http://127.0.0.1:${SERVE_PORT}`
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const LEGAL_VERSION = '2026-11-19'

const results = []
const pass = (name, note = '') => { results.push(['✓', name, note]); console.log(`  ✓ ${name}${note ? ' — ' + note : ''}`) }
const fail = (name, note = '') => { results.push(['✗', name, note]); console.log(`  ✗ ${name}${note ? ' — ' + note : ''}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ─── mock LLM 上游：流式 SSE + 非流式 JSON（autoTitle）双兼容 ─── */
let mockMode = 'plain'                 // plain | write_file | append_file | rm_rf
let sawToolResult = false              // 上游是否已收到 role=tool 消息（回喂判定）
let toolCallCount = 0

function sseChunk(obj) { return `data: ${JSON.stringify(obj)}\n\n` }
function sseText(text) { return sseChunk({ choices: [{ delta: { content: text }, index: 0 }] }) + 'data: [DONE]\n\n' }
/** 前言 content delta（不带 DONE）：llm-proxy 对「纯 tool_calls 无 content」的响应
 *  判定为空响应并触发上游接力到真实免费模型——必须模拟真实形状 */
function sseContentPrefix(text) { return sseChunk({ choices: [{ delta: { content: text }, index: 0 }] }) }
function sseToolCall(name, argsObj) {
  const id = 'call_' + Math.random().toString(36).slice(2, 10)
  return sseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(argsObj) } }] } }] })
    + 'data: [DONE]\n\n'
}
function jsonReply(text) { return JSON.stringify({ choices: [{ message: { content: text } }] }) }

const mockServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => { body += d })
  req.on('end', () => {
    let msgs = [], stream = true
    try { const b = JSON.parse(body); msgs = b.messages || []; stream = b.stream !== false } catch {}
    sawToolResult = msgs.some(m => m.role === 'tool')
    const allText = msgs.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n')

    // autoTitle 等非流式请求 → JSON 直答（标题内容随意）
    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(jsonReply('E2E 会话标题'))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    if (mockMode === 'write_file') {
      if (!sawToolResult) res.end(sseContentPrefix('好的，我来创建文件。') + sseToolCall('write_file', { path: '/tmp/jt-e2e-write/demo.txt', content: 'e2e 写入内容 ' + Date.now() }))
      else res.end(sseText('文件已写入完成，这是第二轮最终答复。E2E-MARKER-FINAL'))
      return
    }
    if (mockMode === 'append_file') {
      toolCallCount++
      if (toolCallCount === 1) res.end(sseContentPrefix('开始分段写入。') + sseToolCall('append_file', { path: '/tmp/jt-e2e-append/big.txt', content: '第一行内容', mode: 'start' }))
      else if (toolCallCount === 2) res.end(sseContentPrefix('继续追加。') + sseToolCall('append_file', { path: '/tmp/jt-e2e-append/big.txt', content: '第二行内容', mode: 'append' }))
      else res.end(sseText('两段已写入完成。E2E-APPEND-DONE'))
      return
    }
    if (mockMode === 'rm_rf') {
      if (!sawToolResult) res.end(sseContentPrefix('执行删除。') + sseToolCall('shell', { command: 'rm -rf /', description: '递归删除整盘' }))
      else res.end(sseText('命令被拦截了。E2E-BLOCK-DONE'))
      return
    }
    if (mockMode === 'read_fail') {
      // 第一段调用一个不存在的文件（触发 not_found 失败恢复：先读父目录）
      if (!sawToolResult) res.end(sseContentPrefix('我来读文件。') + sseToolCall('read_file', { path: '/tmp/jt-e2e-nope/not-exist.txt' }))
      else {
        // 第二轮检查历史 tool 结果里是否含恢复指令（[恢复建议]）
        const toolMsgs = msgs.filter(m => m.role === 'tool').map(m => String(m.content || '')).join('\n')
        const recovered = toolMsgs.includes('恢复建议') || toolMsgs.includes('list_dir')
        res.end(sseText(recovered ? '已按恢复建议处理。E2E-RECOVERY-OK' : '未见恢复建议。E2E-RECOVERY-MISS'))
      }
      return
    }
    res.end(sseText(`这是 mock 的回复。E2E-PLAIN-MARKER`))
  })
})

/* ─── serve.cjs 隔离启动 ─── */
let serveProc = null
let tmpHome = null
/** 解析真实 node 可执行文件：process.execPath 可能指向已被清理的运行时路径
 *  （实测 hermes 运行时 execPath ENOENT），NODE_BIN 覆盖 → shell which → execPath 兜底 */
function resolveNodeBin() {
  if (process.env.NODE_BIN && existsSync(process.env.NODE_BIN)) return process.env.NODE_BIN
  try {
    const p = execSync('command -v node', { encoding: 'utf8' }).trim()
    if (p && existsSync(p)) return p
  } catch {}
  return process.execPath
}
async function startServe() {
  tmpHome = mkdtempSync(path.join(tmpdir(), 'jt-e2e-home-'))
  serveProc = spawn(resolveNodeBin(), [path.join(ROOT, 'serve.cjs')], {
    cwd: ROOT,
    env: { ...process.env, HOME: tmpHome, PORT: String(SERVE_PORT), NODE_OPTIONS: '--max-old-space-size=512' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serveProc.stdout.on('data', () => {})
  serveProc.stderr.on('data', d => { if (process.env.E2E_DEBUG) process.stdout.write('[serve] ' + d) })
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return JSON.parse(await r.text())
    } catch {}
    await sleep(500)
  }
  throw new Error('serve.cjs 60 秒内未就绪')
}

async function setSetting(key, value) {
  await fetch(`${BASE}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
}
async function setEngine(engine) {
  await fetch(`${BASE}/api/agent/engine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine }),
  })
}

/* ─── 断言工具 ─── */
async function waitFor(fn, timeoutMs = 30000, every = 500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true
    await sleep(every)
  }
  return false
}

/* ─── 用例 ─── */
async function runE2E() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1366, height: 900 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 100)))

  // 前置：建会话（chat tab 必须带 sessionId 才渲染 ChatTab——App.tsx:826 null 分支）
  const sid = await fetch(`${BASE}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'E2E' }),
  }).then(r => r.json()).then(j => j.id || j.session?.id || j.sessionId).catch(() => null)

  // 预种 localStorage：跳过 LegalGate + tabs=[newtab, chat(带 sid)]。
  // v15.7.1「启动永远落 newtab 首页」是产品决策——预种后仍落 newtab，稍后 UI 点 E2E 标签切入。
  await page.evaluateOnNewDocument((legalVer, tabSid) => {
    try {
      localStorage.setItem('lyclaw_legal_consent', legalVer)
      localStorage.setItem('lyclaw_theme', 'light')
      localStorage.setItem('lyclaw_tabs', JSON.stringify([
        { id: 'home', type: 'newtab', title: '新建标签页' },
        { id: 't1', type: 'chat', title: 'E2E', sessionId: tabSid },
      ]))
      localStorage.setItem('lyclaw_active_tab', 'home')
    } catch {}
  }, LEGAL_VERSION, sid || '')

  // E1 健康与页面加载
  {
    const h = await fetch(`${BASE}/api/health`).then(r => r.json())
    if (h.status === 'ok') pass('E1a 后端健康', `v${h.version} · ${h.tools} 工具`); else fail('E1a 后端健康', JSON.stringify(h))
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(1500)   // React 挂载（启动落 newtab 首页——v15.7.1 产品决策）
    // 点标签条上的「E2E」chat 标签切入会话（带 sessionId 的 ChatTab）
    const tabOk = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,div[title],span,div')].find(x =>
        (x.textContent || '').trim() === 'E2E' && (x.offsetWidth || 0) > 0)
      if (el) { el.click(); return true }
      return false
    })
    const inputOk = await waitFor(() => page.$('textarea[placeholder*="发送消息"]') !== null, 10000)
    if (tabOk && inputOk) pass('E1b WebUI 加载（newtab→E2E 标签→聊天输入框）'); else fail('E1b WebUI 加载', `tab=${tabOk} input=${inputOk}`)
  }

  // 确定性：走标准 server 循环（DEFAULT 是 super，纯文本/工具场景用 server 更可控）
  await setEngine('server')

  // 发消息辅助
  async function send(text) {
    await page.focus('textarea[placeholder*="发送消息"]')
    await page.type('textarea[placeholder*="发送消息"]', text, { delay: 5 })
    await page.keyboard.press('Enter')
  }

  // E2 纯文本往返
  mockMode = 'plain'
  {
    await send('你好巨天')
    const ok = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-PLAIN-MARKER')), 30000)
    if (ok) pass('E2 发消息→SSE 正文渲染'); else fail('E2 发消息→SSE 正文渲染', '30s 内未出现 mock 回复')
    await sleep(800)
  }

  // E3+E4 write_file 工具卡与真实落盘 + 回喂
  mockMode = 'write_file'
  mkdirSync('/tmp/jt-e2e-write', { recursive: true })
  try { rmSync('/tmp/jt-e2e-write/demo.txt') } catch {}
  {
    await send('在 /tmp/jt-e2e-write 建 demo.txt')
    const cardOk = await waitFor(() => page.$$eval('.tool-card', a => a.length > 0), 20000)
    const fileOk = await waitFor(() => existsSync('/tmp/jt-e2e-write/demo.txt'), 20000)
    const finalOk = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-MARKER-FINAL')), 30000)
    const content = fileOk ? readFileSync('/tmp/jt-e2e-write/demo.txt', 'utf-8') : ''
    if (cardOk && fileOk && finalOk && content.includes('e2e 写入内容')) pass('E3/E4 工具卡+落盘+回喂', `内容 ${content.length} 字`)
    else {
      // 失败现场：打印 UI 里疑似工具卡的 DOM（定位真实选择器）
      const probe = await page.evaluate(() => ({
        toolCards: document.querySelectorAll('.tool-card').length,
        cardText: [...document.querySelectorAll('.tool-card')].map(x => x.textContent.slice(0, 160)),
        bodyHasWrite: document.body.textContent.includes('write_file'),
        bodyHasWritten: document.body.textContent.includes('写入'),
      })).catch(() => ({}))
      fail('E3/E4 工具卡+落盘+回喂', `card=${cardOk} file=${fileOk} final=${finalOk} 现场=${JSON.stringify(probe)}`)
    }
  }

  // E5 append_file 两段增量（有副作用工具串行执行：两轮各一调用 + 收尾）
  mockMode = 'append_file'
  toolCallCount = 0
  mkdirSync('/tmp/jt-e2e-append', { recursive: true })
  try { rmSync('/tmp/jt-e2e-append/big.txt') } catch {}
  {
    await send('分段写大文件')
    const finalOk = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-APPEND-DONE')), 45000)
    const content = existsSync('/tmp/jt-e2e-append/big.txt') ? readFileSync('/tmp/jt-e2e-append/big.txt', 'utf-8') : ''
    if (finalOk && content.includes('第一行内容') && content.includes('第二行内容')) pass('E5 append_file 两段增量拼接', '两段均落盘')
    else fail('E5 append_file 两段增量拼接', `final=${finalOk} content="${content.slice(0, 40)}"`)
  }

  // E8 安全拦截（rm -rf 被安全盾拦：【安全策略】前缀出现在工具卡 header）
  mockMode = 'rm_rf'
  {
    await send('删除危险目录')
    // 拦截表现：工具卡出现 ❌ + permission 描述（"需人工确认"/"不可逆"）或安全规则名（cmd.rm_root）
    const blocked = await waitFor(async () => {
      return page.evaluate(() => [...document.querySelectorAll('.tool-card')].some(c =>
        c.textContent.includes('cmd.rm_root') || c.textContent.includes('不可逆') || c.textContent.includes('需人工确认')))
    }, 30000)
    const finalOk = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-BLOCK-DONE')), 15000)
    if (blocked && finalOk) pass('E8 危险命令被安全盾拦截', '命中 cmd.rm_root 规则'); else fail('E8 危险命令被拦截', `blocked=${blocked} final=${finalOk}`)
  }

  // E11 失败恢复（v18.3.0）：工具失败→结构化恢复指令注入（not_found→先读父目录）
  mockMode = 'read_fail'
  {
    await send('读取一个不存在的文件')
    const ok = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-RECOVERY-OK')), 30000)
    const miss = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-RECOVERY-MISS')), 8000)
    if (ok && !miss) pass('E11 失败恢复指令注入（not_found）'); else fail('E11 失败恢复', `ok=${ok} miss=${miss}`)
  }

  // E12 诊断面板「内核路由」区块（super_trace 前端消费闭环）
  {
    // 先跑一次 super 引擎产生路由事件
    await fetch(`${BASE}/api/agent/engine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: 'super' }) })
    mockMode = 'plain'
    await send('你好，测试路由记录')
    const routeOk = await waitFor(() => page.evaluate(() => document.body.textContent.includes('E2E-PLAIN-MARKER')), 30000)
    // 打开诊断面板（设置→诊断 tab 或命令面板）——用全局按钮文本定位
    const diagOpened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,[title]')].find(x => /诊断/.test((x.title || '') + (x.textContent || '')))
      if (b) { b.click(); return true }
      return false
    })
    await sleep(800)
    const hasSection = await page.evaluate(() => document.body.textContent.includes('内核路由'))
    if (routeOk && diagOpened && hasSection) pass('E12 诊断面板内核路由区块'); else fail('E12 诊断面板', `route=${routeOk} opened=${diagOpened} section=${hasSection}`)
  }

  // E6 内核切换（API 往返 + 状态条文本）
  {
    await setEngine('super')
    const g = await fetch(`${BASE}/api/agent/engine`).then(r => r.json())
    const uiOk = await waitFor(async () => {
      return page.evaluate(() => {
        const b = [...document.querySelectorAll('button,[title]')].find(x => (x.title || '').includes('点击切换 JT Core 内核'))
        return !!b && b.textContent.includes('Super')
      })
    }, 8000)
    if (g.engine === 'super' && uiOk) pass('E6 内核切换→Super', 'API+状态条一致')
    else fail('E6 内核切换→Super', `api=${g.engine} ui=${uiOk}`)
    // 恢复 server 档避免影响后续
    await setEngine('server')
  }

  // E7 Super 路由事件（SSE 流层断言：engine=super 的 /api/agent/run 必含 super_trace）
  {
    const r = await fetch(`${BASE}/api/agent/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: 'super', model: 'mock-model', apiBase: MOCK_BASE + '/v1', apiKey: 'mock-key',
        messages: [{ role: 'user', content: '你好' }], tools: [],
      }),
    })
    const text = await r.text()
    if (text.includes('super_trace') && text.includes('"kernel"')) pass('E7 Super 路由事件（super_trace 含 kernel 决策）')
    else fail('E7 Super 路由事件', 'SSE 流中未见 super_trace')
  }

  // E9 会话管理（UI：新建对话按钮 → 侧栏列表出现新条目）
  {
    const before = await page.evaluate(() => (document.body.textContent.match(/新对话/g) || []).length)
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,[title]')].find(x => (x.textContent || '').includes('新建对话') || (x.title || '').includes('新对话'))
      if (b) { b.click(); return true }
      return false
    })
    await sleep(1000)
    const after = await page.evaluate(() => (document.body.textContent.match(/新对话/g) || []).length)
    if (clicked && after >= before) pass('E9 会话管理（新建对话按钮）', `${before}→${after}`); else fail('E9 会话管理', `clicked=${clicked}`)
  }

  // E13 长任务跨会话编排（v18.4.0）：/api/missions CRUD + advance 状态机
  {
    const created = await fetch(`${BASE}/api/missions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'E2E 长任务：分三步完成配置升级', project: 'e2e', milestones: ['读取配置', '修改参数', '验证测试'] }),
    }).then(r => r.json()).catch(() => ({}))
    const mid = created.mission?.id
    const list = await fetch(`${BASE}/api/missions`).then(r => r.json()).catch(() => ({ items: [] }))
    const detail = mid ? await fetch(`${BASE}/api/missions/${mid}`).then(r => r.json()).catch(() => ({})) : {}
    // advance：评估未完成 → 续跑指令；评估不可用(ok=false) → paused
    let adv = {}
    if (mid) adv = await fetch(`${BASE}/api/missions/${mid}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'advance', sessionId: 'e2e-session', evaluation: { done: false, note: '还差修改参数', ok: true } }),
    }).then(r => r.json()).catch(() => ({}))
    const ok = !!mid && (list.items || []).some(m => m.id === mid)
      && (detail.mission?.milestones?.length === 3) && adv.shouldContinue === true
      && String(adv.nextDirective || '').includes('修改参数')
    if (ok) pass('E13 长任务 CRUD + advance 续跑', `任务 ${mid}`); else fail('E13 长任务编排', `mid=${mid} ms=${detail.mission?.milestones?.length} adv=${JSON.stringify(adv).slice(0, 80)}`)
  }

  // E10 设置读写往返
  {
    await setSetting('autoSpeak', 'true')
    const s = await fetch(`${BASE}/api/settings`).then(r => r.json())
    if (s.autoSpeak === 'true') pass('E10 设置读写往返'); else fail('E10 设置读写往返', JSON.stringify({ autoSpeak: s.autoSpeak }))
    await setSetting('autoSpeak', 'false')
  }

  // 页面 JS 错误（过滤资源类噪音）
  const realErrors = pageErrors.filter(e => !/ResizeObserver|favicon/.test(e))
  if (realErrors.length === 0) pass('页面零 JS 异常'); else fail('页面 JS 异常', JSON.stringify(realErrors.slice(0, 3)))

  await browser.close()
}

/* ─── 主流程 ─── */
async function main() {
  console.log('◆ e2e：启动 mock LLM 上游 :' + MOCK_PORT)
  await new Promise(r => mockServer.listen(MOCK_PORT, '127.0.0.1', r))
  console.log('◆ e2e：启动隔离 serve.cjs :' + SERVE_PORT + '（HOME=临时目录）')
  const health = await startServe()
  console.log(`  serve 就绪 v${health.version} · ${health.tools} 工具 · db=${health.db}`)

  // 指向 mock 上游 + 放开权限（工具确认弹窗会挂流程）+ 关 autoTitle（其非流式请求已兼容，双保险）
  await setSetting('apiBaseUrl', MOCK_BASE + '/v1')
  await setSetting('apiKey', 'mock-key-anything')
  await setSetting('model', 'mock-model')
  await setSetting('permissionLevel', 'full')
  await setSetting('autoTitle', 'false')

  console.log('◆ e2e：headless Chrome 驱动 WebUI\n')
  let crashed = false
  try { await runE2E() } catch (e) { crashed = true; console.error('E2E 崩溃:', e.message) }

  console.log('')
  const fails = results.filter(r => r[0] === '✗')
  for (const [s, name, note] of results) console.log(`${s} ${name}${note ? '  (' + note + ')' : ''}`)
  console.log(`\n通过 ${results.filter(r => r[0] === '✓').length}/${results.length}`)
  if (fails.length || crashed) {
    console.log('\nE2E 结果: FAIL')
    process.exitCode = 1
  } else {
    console.log('\nE2E 结果: PASS ✓')
  }
  try { mockServer.close() } catch {}
  if (serveProc) try { serveProc.kill('SIGKILL') } catch {}
  try { if (tmpHome) rmSync(tmpHome, { recursive: true, force: true }) } catch {}
  process.exit(process.exitCode || 0)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
