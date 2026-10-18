/**
 * 安全路径回归测试 —— 起真实服务打端点
 *
 * 覆盖路径穿越、目录白名单边界、SSRF 与跨站门卫。选集成测试而不是单测，
 * 是因为 serve.ts 是从打包产物反推重建的单文件后端，把内部函数拆出来
 * 测要先动这个 4000 行的文件，风险远高于收益；而起真服务打端点测的
 * 恰恰是攻击者真正会走的那条路。
 *
 * 前置：需要先 npm run build:server 生成 serve.cjs（CI 里排在 test 之前）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVE = path.join(ROOT, 'serve.cjs')
// 随机高位端口，避开开发时可能已在跑的 3211
const PORT = 3900 + Math.floor(Math.random() * 200)
const BASE = `http://127.0.0.1:${PORT}`

let proc: ChildProcess | null = null

/** 同源请求必须带本机 Origin，否则会被跨站门卫 403 */
const ORIGIN = { 'Content-Type': 'application/json', Origin: `http://localhost:${PORT}` }

async function waitHealthy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error('服务在超时内没有就绪')
}

async function execTool(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/tools/execute`, {
    method: 'POST', headers: ORIGIN, body: JSON.stringify({ name, args }),
  })
  return r.json()
}

beforeAll(async () => {
  if (!fs.existsSync(SERVE)) {
    throw new Error('缺少 serve.cjs，请先执行 npm run build:server')
  }
  proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  })
  await waitHealthy()
}, 30000)

afterAll(() => {
  proc?.kill('SIGKILL')
})

describe('技能名称路径穿越', () => {
  it('拒绝带 ../ 的技能名', async () => {
    const r = await fetch(`${BASE}/api/skills/uninstall`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ skillName: '../../../../tmp/victim' }),
    }).then(r => r.json())
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法技能名称')
  })

  it('拒绝带斜杠的技能名', async () => {
    const r = await fetch(`${BASE}/api/skills/uninstall`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ skillName: 'a/b' }),
    }).then(r => r.json())
    expect(r.success).toBe(false)
  })

  it('拒绝空技能名', async () => {
    const r = await fetch(`${BASE}/api/skills/uninstall`, {
      method: 'POST', headers: ORIGIN, body: JSON.stringify({ skillName: '' }),
    }).then(r => r.json())
    expect(r.success).toBe(false)
  })

  it('合法但不存在的技能名正常返回成功，且不动磁盘', async () => {
    const r = await fetch(`${BASE}/api/skills/uninstall`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ skillName: 'regression-probe-does-not-exist' }),
    }).then(r => r.json())
    expect(r.success).toBe(true)
  })
})

describe('工具层目录白名单', () => {
  it('get_file_info 拒绝 /etc/passwd', async () => {
    const r = await execTool('get_file_info', { path: '/etc/passwd' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('路径不允许')
  })

  it('get_file_info 拒绝带 .. 的相对穿越', async () => {
    const r = await execTool('get_file_info', { path: path.join(os.tmpdir(), '..', 'etc', 'passwd') })
    expect(r.success).toBe(false)
  })

  it('get_file_info 放行系统临时目录下的真实文件', async () => {
    // 用 os.tmpdir() 而不是硬编码 /tmp：Windows 上没有 /tmp，
    // 硬编码会让这个用例在 Windows 上必然失败（CI 实测踩过）
    const probe = path.join(os.tmpdir(), `jutian-probe-${process.pid}.txt`)
    fs.writeFileSync(probe, 'x')
    try {
      const r = await execTool('get_file_info', { path: probe })
      expect(r.success).toBe(true)
      expect(JSON.parse(r.output).type).toBe('file')
    } finally {
      fs.unlinkSync(probe)
    }
  })

  it('json_process 拒绝 file: 指向的越界路径', async () => {
    const r = await execTool('json_process', { data: 'file:/etc/hosts', query: 'keys' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('路径不允许')
  })
})

describe('ok() 前缀边界', () => {
  it('与 /Users 同前缀但不属于它的路径不被放行', async () => {
    // /UsersShared 这类名字 startsWith("/Users") 为真但并非其子目录。
    // 用错误信息区分：被拦是「路径不允许」，放行则会是 ENOENT
    const r = await execTool('get_file_info', { path: '/UsersShared jutian probe' })
    expect(r.error).toContain('路径不允许')
  })
})

describe('web_fetch SSRF 防护', () => {
  const cases: [string, string][] = [
    ['云元数据地址', 'http://169.254.169.254/latest/meta-data/'],
    ['本机回环', 'http://127.0.0.1/'],
    ['内网 192.168', 'http://192.168.1.1/'],
    ['内网 10.x', 'http://10.0.0.1/'],
    ['内网 172.16', 'http://172.16.0.1/'],
    ['CGNAT 100.64', 'http://100.64.0.1/'],
    ['IPv6 回环', 'http://[::1]/'],
  ]
  for (const [label, url] of cases) {
    it(`拦截${label}`, async () => {
      const r = await execTool('web_fetch', { url })
      expect(r.success).toBe(false)
    })
  }

  it('拒绝非 http/https 协议', async () => {
    const r = await execTool('web_fetch', { url: 'file:///etc/passwd' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('http/https')
  })

  it('拒绝畸形 URL', async () => {
    const r = await execTool('web_fetch', { url: 'not-a-url' })
    expect(r.success).toBe(false)
  })

  it('http_request 同样受约束', async () => {
    const r = await execTool('http_request', { url: 'http://169.254.169.254/' })
    expect(r.success).toBe(false)
  })
})

describe('跨站与异常请求', () => {
  it('拒绝跨站 Origin', async () => {
    const r = await fetch(`${BASE}/api/skills/uninstall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ skillName: 'x' }),
    })
    expect(r.status).toBe(403)
  })

  it('超大请求体被拒且服务存活', async () => {
    const big = JSON.stringify({ skillName: 'x', pad: 'A'.repeat(33 * 1024 * 1024) })
    // 服务端应在读满 32MB 前断连；客户端会看到连接错误或非 2xx
    await fetch(`${BASE}/api/skills/uninstall`, {
      method: 'POST', headers: ORIGIN, body: big,
    }).catch(() => null)
    const h = await fetch(`${BASE}/api/health`).then(r => r.json())
    expect(h.status).toBe('ok')
  }, 30000)
})

describe('通知桥与作用域回归', () => {
  // serve.ts 曾把 pushServerNotice / 通知桥 / 公告 / 调度器整段定义在
  // http.createServer(...).listen(PORT, () => { ... }) 的回调里——那段代码
  // 在请求处理器创建之后才声明，且回调作用域对处理器不可见，于是
  // POST /api/notices 直接 ReferenceError（500）、GET 静默回空数组：
  // v7.0 的「手机已连接远程」通知从来没弹出来过。这里锁死可用。
  it('POST /api/notices 真实写入通知文件（不再 ReferenceError）', async () => {
    const r = await fetch(`${BASE}/api/notices`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ type: 'system', title: '测试通知', body: '回归' }),
    })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    const list = await fetch(`${BASE}/api/notices`, { headers: ORIGIN }).then(x => x.json())
    expect(Array.isArray(list)).toBe(true)
    expect(list.some(n => n.title === '测试通知')).toBe(true)
  })

  it('GET /api/announcement 返回结构合法（公告或 null，不能 500）', async () => {
    const r = await fetch(`${BASE}/api/announcement`, { headers: ORIGIN })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.ok).toBe(true)
    if (j.announcement) {
      expect(j.announcement.id).toBeTruthy()
      expect(typeof j.announcement.title).toBe('string')
      expect(['info', 'warn', 'critical']).toContain(j.announcement.level)
    }
  })
})

describe('技能安装路径穿越', () => {
  // 最危险的一条：install-from-github 会先 rm -rf 目标目录再 clone。
  // 修复前 "https://github.com/x/../../.." 得到 repoName=".."，
  // 目标变成 ~/.lyclaw 本身 —— 一次调用删掉用户全部数据。
  it('install-from-github 拒绝 ../ 型仓库名', async () => {
    const r = await fetch(`${BASE}/api/skills/install-from-github`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ githubUrl: 'https://github.com/x/../../..' }),
    }).then(r => r.json())
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/仓库名/)
  })

  it('install-from-github 拒绝 URL 解析失败的输入', async () => {
    const r = await fetch(`${BASE}/api/skills/install-from-github`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ githubUrl: 'not a url at all' }),
    }).then(r => r.json())
    expect(r.success).toBe(false)
  })

  it('install-from-market 拒绝非法 skillId', async () => {
    const r = await fetch(`${BASE}/api/skills/install-from-market`, {
      method: 'POST', headers: ORIGIN,
      body: JSON.stringify({ skillId: '../../../evil' }),
    }).then(r => r.json())
    expect(r.success).toBe(false)
  })

  it('load_skill 拒绝穿越名称（否则可读任意目录的 skill.json）', async () => {
    const r = await execTool('load_skill', { name: '../../../etc' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法技能名称')
  })
})

describe('调研历史 API', () => {
  it('列表返回 items 数组', async () => {
    const d = await fetch(`${BASE}/api/research/history`, { headers: ORIGIN }).then(r => r.json())
    expect(Array.isArray(d.items)).toBe(true)
  })

  it('路径穿越文件名被拒', async () => {
    const r = await fetch(`${BASE}/api/research/history/${encodeURIComponent('../../etc/passwd')}`, { headers: ORIGIN })
    expect(r.status).toBe(400)
  })

  it('非 .md 扩展名被拒', async () => {
    const r = await fetch(`${BASE}/api/research/history/data.db`, { headers: ORIGIN })
    expect(r.status).toBe(400)
  })

  it('不存在的合法文件名返回 404', async () => {
    const r = await fetch(`${BASE}/api/research/history/nope-1234.md`, { headers: ORIGIN })
    expect(r.status).toBe(404)
  })
})
