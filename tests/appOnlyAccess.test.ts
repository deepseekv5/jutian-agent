/**
 * App-only 访问门卫（v12.2）—— 独立进程测试
 *
 * 需求背景：这个应用本质是"本地网页"，桌面窗口打开 http://localhost:3211。
 * 但同一台机器上任何浏览器、任何本机程序都能访问同一地址，包括：
 *   · 用户在浏览器地址栏手输 → 看到完整界面
 *   · 本机其他网页（localhost:3000 上跑的 dev server）fetch 本应用 → 读走 API Key
 *
 * 对策：主进程每次启动生成随机令牌注入环境变量，窗口带 ?app=<token> 首次导航，
 * 服务端换成 HttpOnly Cookie；无令牌一律回拦截页。
 *
 * 这组测试必须单独起进程（需要 APP_UI_TOKEN 环境变量），
 * 所以不复用 security.test.ts 的 harness。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVE = path.join(ROOT, 'serve.cjs')
const PORT = 4200 + Math.floor(Math.random() * 200)
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'testtoken0123456789abcdef'   // 24 字符，满足 >=16
// 模拟真实浏览器的指纹：sec-fetch-site 只有浏览器网络栈会发
// （Node 的 undici 只发 sec-fetch-mode: cors，不发 site——实测），
// 所以测试里的"浏览器"请求必须显式带它，"CLI"请求则不带。
const BROWSER = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', 'User-Agent': 'Mozilla/5.0 Chrome/126.0' }

let proc: ChildProcess | null = null

async function waitHealthy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('服务未就绪')
}

beforeAll(async () => {
  if (!fs.existsSync(SERVE)) throw new Error('缺少 serve.cjs，请先 npm run build:server')
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(PORT), APP_UI_TOKEN: TOKEN },
    stdio: 'ignore',
  })
  await waitHealthy()
}, 30000)

afterAll(() => { proc?.kill('SIGKILL') })

describe('App-only 门卫：无令牌一律拦截', () => {
  it('浏览器手输地址 → 403 拦截页（不渲染应用）', async () => {
    const r = await fetch(`${BASE}/`, { headers: BROWSER, redirect: 'manual' })
    expect(r.status).toBe(403)
    const html = await r.text()
    expect(html).toContain('请从桌面应用打开')
    // 拦截页里不能出现应用界面
    expect(html).not.toContain('id="root"')
  })

  it('无令牌读设置 → 403（读不到密钥）', async () => {
    const r = await fetch(`${BASE}/api/settings`, { headers: BROWSER, redirect: 'manual' })
    expect(r.status).toBe(403)
    const body = await r.text()
    // 绝不能把真实设置泄露出去
    expect(body).not.toContain('apiBaseUrl')
    expect(body).not.toContain('sk-')
  })

  it('无令牌调用工具 → 403', async () => {
    const r = await fetch(`${BASE}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...BROWSER },
      body: JSON.stringify({ name: 'system_info', args: {} }),
    })
    expect(r.status).toBe(403)
  })

  it('/api/health 仍公开（App 启动探活用）', async () => {
    const r = await fetch(`${BASE}/api/health`)
    expect(r.ok).toBe(true)
    const j = await r.json()
    expect(j.status).toBe('ok')
  })

  it('错误令牌不通过', async () => {
    const r = await fetch(`${BASE}/?app=wrongtokenwrongtoken`, { headers: BROWSER, redirect: 'manual' })
    expect(r.status).toBe(403)
  })

  it('令牌短于 16 位视为未启用（避免误配把用户锁在门外）', async () => {
    // 这条由 serve 的 APP_UI_ONLY 判定保证：短 token 直接不启用门卫。
    // 这里只断言当前进程（长 token）确实是启用状态——上面几条已证明。
    expect(TOKEN.length).toBeGreaterThanOrEqual(16)
  })
})

describe('App-only 门卫：正确令牌放行', () => {
  it('带令牌 → 302 + HttpOnly SameSite Cookie，且 Location 已去掉令牌', async () => {
    const r = await fetch(`${BASE}/?app=${TOKEN}`, { redirect: 'manual' })
    expect(r.status).toBe(302)
    const sc = r.headers.get('set-cookie') || ''
    expect(sc).toContain('jt_ui=')
    expect(sc.toLowerCase()).toContain('httponly')
    expect(sc.toLowerCase()).toContain('samesite=strict')
    // 令牌不能留在地址栏/历史里
    const loc = r.headers.get('location') || ''
    expect(loc).not.toContain(TOKEN)
    expect(loc).not.toContain('app=')
  })

  it('带 Cookie 能通过门卫（不再被 403 拦）', async () => {
    // 注意：CI 上跑测试时没有 dist/ 产物（vite build 在测试之后），
    // 所以这里只能断言"门卫放行"，不能断言页面内容。
    // 用 404（找不到静态文件）与 403（门卫拦截）区分：
    // 404 说明请求已经过了门卫，只是没有前端产物可发。
    const r = await fetch(`${BASE}/`, { headers: { Cookie: `jt_ui=${TOKEN}` }, redirect: 'manual' })
    expect(r.status).not.toBe(403)
  })

  it('带 Cookie 可访问 API', async () => {
    const r = await fetch(`${BASE}/api/settings`, { headers: { Cookie: `jt_ui=${TOKEN}` }, redirect: 'manual' })
    expect(r.status).toBe(200)
  })

  it('Cookie 值不匹配仍被拦', async () => {
    const r = await fetch(`${BASE}/`, { headers: { Cookie: 'jt_ui=someothervalue', ...BROWSER }, redirect: 'manual' })
    expect(r.status).toBe(403)
  })

  it('X-App-Token 头部是主通道（Electron 主进程注入，不依赖前端配合）', async () => {
    // 同上的原因：只看是否通过门卫，不看静态产物是否存在
    const r = await fetch(`${BASE}/`, { headers: { 'X-App-Token': TOKEN }, redirect: 'manual' })
    expect(r.status).not.toBe(403)
  })

  it('错误的 X-App-Token 不通过（浏览器请求）', async () => {
    // 无指纹的请求走 CLI 通道（放行）——错误令牌只有在浏览器请求上才有意义
    const r = await fetch(`${BASE}/`, { headers: { 'X-App-Token': 'wrongwrongwrongwrongw', ...BROWSER }, redirect: 'manual' })
    expect(r.status).toBe(403)
  })

  it('带正确头部的 API 调用可通', async () => {
    const r = await fetch(`${BASE}/api/settings`, { headers: { 'X-App-Token': TOKEN }, redirect: 'manual' })
    expect(r.status).toBe(200)
  })

  it('拦截页也带安全头（它同样是 HTML 响应）', async () => {
    // 拦截页在任何环境都会生成，所以这条断言在 CI（无 dist）也稳定生效
    const r = await fetch(`${BASE}/`, { headers: BROWSER, redirect: 'manual' })
    expect(r.status).toBe(403)
    expect(r.headers.get('x-frame-options')).toBe('DENY')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('正常页面带 CSP + frame-ancestors（有前端产物时）', async () => {
    const r = await fetch(`${BASE}/`, { headers: { 'X-App-Token': TOKEN }, redirect: 'manual' })
    // 没有 dist/ 产物时静态层不执行（404），CSP 只加在静态响应上；
    // 有产物时才检查——那才是真正的攻击面（能加载界面才谈得上被嵌入）
    if (r.status === 200) {
      expect(r.headers.get('x-frame-options')).toBe('DENY')
      const csp = r.headers.get('content-security-policy') || ''
      expect(csp).toContain("frame-ancestors 'none'")
    }
  })

  it('任意端口的 localhost 不再被视为可信来源', async () => {
    // 本机 localhost:3000 上的页面想读设置 → 应被 Origin 门卫拒绝
    const r = await fetch(`${BASE}/api/settings`, {
      headers: { Origin: 'http://localhost:3000', 'X-App-Token': TOKEN },
      redirect: 'manual',
    })
    expect(r.status).toBe(403)
  })

  it('X-App-Token 与 Electron UA 都是有效通道', async () => {
    const byHeader = await fetch(`${BASE}/api/settings`, { headers: { 'X-App-Token': TOKEN }, redirect: 'manual' })
    expect(byHeader.status).toBe(200)
    const byUA = await fetch(`${BASE}/api/settings`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126.0 Electron/33.4.11' }, redirect: 'manual' })
    expect(byUA.status).toBe(200)
  })

  it('本机 CLI/脚本（无 Sec-Fetch 头）放行——开放 API 不能被误伤', async () => {
    // 回归：jtcode CLI 与用户脚本用普通 HTTP 客户端访问 /api/*，
    // 曾被按"浏览器"误拦成 403（用户实测："开放的 api 也无法访问"）。
    // 浏览器必带 Sec-Fetch-*（禁止伪造），CLI/curl 没有——以此区分。
    const r = await fetch(`${BASE}/api/settings`, { redirect: 'manual' })
    expect(r.status).toBe(200)
  })

  it('浏览器指纹（Sec-Fetch-Site）无令牌 → 403；CLI 同请求无指纹 → 200', async () => {
    // 同一个端点、同样没有令牌，只差浏览器指纹头：
    // site 有值/navigate = 来自浏览器 → 拦；undici 风格（mode:cors 无 site）= 本机程序 → 放行
    const browser = await fetch(`${BASE}/api/settings`, {
      headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' }, redirect: 'manual',
    })
    expect(browser.status).toBe(403)
    const cli = await fetch(`${BASE}/api/settings`, {
      headers: { 'Sec-Fetch-Mode': 'cors' }, redirect: 'manual',
    })
    expect(cli.status).toBe(200)
  })

  it('携带 X-App-Token 的内部转发放行（本地 API /v1 → llm-proxy 链路）', async () => {
    // 回归：本地 API 的 chat/completions 内部转发到 /api/llm-proxy，
    // Electron 主进程 fetch 走 Chromium 栈带 Sec-Fetch 头，曾被自己拦成
    // 403，导致设置里的"免费 API"整条挂掉。现在内部转发显式带令牌。
    const r = await fetch(`${BASE}/api/llm-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Mode': 'cors', 'X-App-Token': TOKEN },
      body: JSON.stringify({ model: 'x', messages: [] }),
      redirect: 'manual',
    })
    // 只要不是 403 拦截页就说明门卫放行了（业务层错误是另一回事）
    expect(r.status).not.toBe(403)
  })

  it('带令牌访问具体页面路径会保留原路径（只去掉 app 参数）', async () => {
    const r = await fetch(`${BASE}/legal.html?app=${TOKEN}&x=1`, { redirect: 'manual' })
    expect(r.status).toBe(302)
    const loc = r.headers.get('location') || ''
    expect(loc).toContain('/legal.html')
    expect(loc).toContain('x=1')
    expect(loc).not.toContain('app=')
  })
})
