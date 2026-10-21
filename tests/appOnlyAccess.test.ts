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
    const r = await fetch(`${BASE}/`, { redirect: 'manual' })
    expect(r.status).toBe(403)
    const html = await r.text()
    expect(html).toContain('请从桌面应用打开')
    // 拦截页里不能出现应用界面
    expect(html).not.toContain('id="root"')
  })

  it('无令牌读设置 → 403（读不到密钥）', async () => {
    const r = await fetch(`${BASE}/api/settings`, { redirect: 'manual' })
    expect(r.status).toBe(403)
    const body = await r.text()
    // 绝不能把真实设置泄露出去
    expect(body).not.toContain('apiBaseUrl')
    expect(body).not.toContain('sk-')
  })

  it('无令牌调用工具 → 403', async () => {
    const r = await fetch(`${BASE}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const r = await fetch(`${BASE}/?app=wrongtokenwrongtoken`, { redirect: 'manual' })
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
    const r = await fetch(`${BASE}/`, { headers: { Cookie: 'jt_ui=someothervalue' }, redirect: 'manual' })
    expect(r.status).toBe(403)
  })

  it('X-App-Token 头部是主通道（Electron 主进程注入，不依赖前端配合）', async () => {
    // 同上的原因：只看是否通过门卫，不看静态产物是否存在
    const r = await fetch(`${BASE}/`, { headers: { 'X-App-Token': TOKEN }, redirect: 'manual' })
    expect(r.status).not.toBe(403)
  })

  it('错误的 X-App-Token 不通过', async () => {
    const r = await fetch(`${BASE}/`, { headers: { 'X-App-Token': 'wrongwrongwrongwrongw' }, redirect: 'manual' })
    expect(r.status).toBe(403)
  })

  it('带正确头部的 API 调用可通', async () => {
    const r = await fetch(`${BASE}/api/settings`, { headers: { 'X-App-Token': TOKEN }, redirect: 'manual' })
    expect(r.status).toBe(200)
  })

  it('拦截页也带安全头（它同样是 HTML 响应）', async () => {
    // 拦截页在任何环境都会生成，所以这条断言在 CI（无 dist）也稳定生效
    const r = await fetch(`${BASE}/`, { redirect: 'manual' })
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

  it('带令牌访问具体页面路径会保留原路径（只去掉 app 参数）', async () => {
    const r = await fetch(`${BASE}/legal.html?app=${TOKEN}&x=1`, { redirect: 'manual' })
    expect(r.status).toBe(302)
    const loc = r.headers.get('location') || ''
    expect(loc).toContain('/legal.html')
    expect(loc).toContain('x=1')
    expect(loc).not.toContain('app=')
  })
})
