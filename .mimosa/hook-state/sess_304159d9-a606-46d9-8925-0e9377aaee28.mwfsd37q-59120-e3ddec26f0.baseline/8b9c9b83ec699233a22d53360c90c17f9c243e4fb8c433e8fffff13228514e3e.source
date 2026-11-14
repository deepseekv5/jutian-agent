/**
 * 编辑可靠性回归（v16.1.0）—— 对齐 Claude Code fuzzy edit / 行号编辑
 *
 * 真服务打 /api/tools/execute：edit_file 在 oldText 精确匹配失败时必须
 * ① 尝试 CRLF 归一化 ② 尝试缩进/空白模糊匹配 ③ 支持 start_line/end_line 行号替换。
 * 前置：npm run build:server。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVE = path.join(ROOT, 'serve.cjs')
const PORT = 6900 + Math.floor(Math.random() * 200)
const BASE = `http://127.0.0.1:${PORT}`
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-edit-'))

let proc: ChildProcess | null = null
const ORIGIN = { 'Content-Type': 'application/json', Origin: `http://localhost:${PORT}` }

async function execTool(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/tools/execute`, { method: 'POST', headers: ORIGIN, body: JSON.stringify({ name, args }) })
  return r.json() as Promise<{ success: boolean; output?: string; error?: string }>
}
async function setWorkDir(dir: string) {
  // 工作目录经 /api/tools/execute 的 shell 无法设；改用 serve 的 x-work-dir 头（本机可信）
  const r = await fetch(`${BASE}/api/tools/execute`, {
    method: 'POST', headers: { ...ORIGIN, 'X-Work-Dir': encodeURIComponent(dir) },
    body: JSON.stringify({ name: 'get_file_info', args: { path: '.' } }),
  })
  return r.json()
}
const f = (name: string) => path.join(WORK, name)

beforeAll(async () => {
  if (!fs.existsSync(SERVE)) throw new Error('缺少 serve.cjs，请先执行 npm run build:server')
  proc = spawn(process.execPath, [SERVE], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break } catch { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 300))
  }
  await setWorkDir(WORK)
})
afterAll(() => { proc?.kill(); fs.rmSync(WORK, { recursive: true, force: true }) })

describe('edit_file 模糊匹配（缩进/空白差异）', () => {
  it('oldText 缩进与原文不一致时仍命中并保留原缩进', async () => {
    fs.writeFileSync(f('a.ts'), 'function main() {\n    const x = 1;\n    return x;\n}\n')
    // 模型抄写时把 4 空格缩进写成了 2 空格
    const r = await execTool('edit_file', { path: 'a.ts', oldText: 'function main() {\n  const x = 1;\n  return x;\n}', newText: 'function main() {\n  const x = 2;\n  return x;\n}' })
    expect(r.success).toBe(true)
    expect(r.output).toContain('模糊匹配')
    // 未匹配部分保留原缩进；被替换行按模型给的 newText 原样写入（内容与定位均正确）
    const after = fs.readFileSync(f('a.ts'), 'utf-8')
    expect(after).toContain('const x = 2;')
    expect(after).toContain('function main() {')
    expect(after).toContain('return x;')
    expect(after).not.toContain('const x = 1;')
  })
  it('行尾空格差异也能命中', async () => {
    fs.writeFileSync(f('b.ts'), 'const a = 1;   \nconst b = 2;\n')
    const r = await execTool('edit_file', { path: 'b.ts', oldText: 'const a = 1;\nconst b = 2;', newText: 'const a = 9;\nconst b = 2;' })
    expect(r.success).toBe(true)
    expect(fs.readFileSync(f('b.ts'), 'utf-8')).toContain('const a = 9;')
  })
  it('内容确实不同时仍然报错（不误伤）', async () => {
    fs.writeFileSync(f('c.ts'), 'alpha\nbeta\n')
    const r = await execTool('edit_file', { path: 'c.ts', oldText: 'gamma\ndelta', newText: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('未找到')
  })
})

describe('edit_file 行号编辑', () => {
  it('start_line/end_line 按行替换，无需 oldText', async () => {
    fs.writeFileSync(f('d.ts'), 'line1\nline2\nline3\nline4\n')
    const r = await execTool('edit_file', { path: 'd.ts', start_line: 2, end_line: 3, newText: 'REPLACED' })
    expect(r.success).toBe(true)
    expect(r.output).toContain('按行号')
    expect(fs.readFileSync(f('d.ts'), 'utf-8')).toBe('line1\nREPLACED\nline4\n')
  })
  it('行号范围无效时报错', async () => {
    fs.writeFileSync(f('e.ts'), 'a\nb\n')
    const r = await execTool('edit_file', { path: 'e.ts', start_line: 5, end_line: 2, newText: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('行号范围无效')
  })
})
