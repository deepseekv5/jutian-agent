#!/usr/bin/env node
/**
 * 分层门禁·快速档（v18.4.1）
 *
 * 背景：全量门禁 tsc 80s + eslint 84s + test 36s ≈ 4 分钟，日常开发每次都跑太重。
 * 本脚本只验「本次改动影响到的范围」，目标 <40 秒：
 *   ① eslint 只查改动的 .ts/.tsx（全量是 84s，改动通常 1-5 个文件 <5s）
 *   ② vitest 只跑与改动文件关联的测试（按命名约定 + 共享前缀反查）
 *   ③ verify 契约校验始终跑（<1s，防 schema↔TOOLS 漂移这类致命问题）
 *
 * 不做全量 tsc（类型错误由编辑器/发版全门禁兜底）——这是快档与全档的核心取舍。
 *
 * 用法：
 *   npm run fast                       # 对比 HEAD（未提交改动）
 *   npm run fast -- --base origin/main # 对比指定分支（CI PR 用）
 *   node scripts/fast-gate.mjs --base HEAD~1
 *
 * 退出码：0 全过 / 1 有失败 / 2 无改动可验（视为通过）
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库路径含中文——import.meta.url 的 pathname 是 URL 编码形式，必须解码
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT)

const args = process.argv.slice(2)
const baseIdx = args.indexOf('--base')
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : 'HEAD'

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', cwd: ROOT })
    return { ok: true, out: String(out || '') }
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) }
  }
}

// ── 1. 改动文件 ──
function changedFiles() {
  const set = new Set()
  // 已提交改动（相对 base）
  const a = run(`git diff --name-only ${BASE} -- '*.ts' '*.tsx'`, { quiet: true })
  // 未提交改动（工作树 + 暂存）
  const b = run(`git diff --name-only HEAD -- '*.ts' '*.tsx'`, { quiet: true })
  const c = run(`git diff --cached --name-only -- '*.ts' '*.tsx'`, { quiet: true })
  for (const r of [a, b, c]) if (r.ok) for (const line of r.out.split('\n')) if (line.trim()) set.add(line.trim())
  // 新增未跟踪文件
  const d = run(`git ls-files --others --exclude-standard -- '*.ts' '*.tsx'`, { quiet: true })
  if (d.ok) for (const line of d.out.split('\n')) if (line.trim()) set.add(line.trim())
  return [...set].filter(f => existsSync(path.join(ROOT, f)))
}

// ── 2. 关联测试（命名约定反查）──
function allTests() {
  const out = []
  function walk(dir) {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p) }
      else if (/\.test\.ts$/.test(e.name)) out.push(path.relative(ROOT, p))
    }
  }
  walk(path.join(ROOT, 'tests'))
  return out
}

function relatedTests(changed, tests) {
  const hit = new Set()
  for (const f of changed) {
    // src/shared/agentLoop.ts → agentLoop；src/renderer/chat/Foo.tsx → Foo
    const stem = path.basename(f).replace(/\.(ts|tsx)$/, '')
    const lower = stem.toLowerCase()
    for (const t of tests) {
      const tLower = t.toLowerCase()
      // 测试文件名含源码 stem（agentLoop.test.ts / agentLoopPhases.test.ts）
      if (tLower.includes(lower)) hit.add(t)
      // 反向：源码文件名含测试 stem（少见的反向命名）
      else {
        const tStem = path.basename(t).replace(/\.test\.ts$/, '').toLowerCase()
        if (lower.includes(tStem) && tStem.length >= 5) hit.add(t)
      }
    }
  }
  // 核心契约测试始终跑（改动 serve/schema/内核时防致命漂移）
  const CORE = ['tests/auditFixes.test.ts', 'tests/securityScanFixes.test.ts']
  for (const c of CORE) if (tests.includes(c)) hit.add(c)
  // 若改动涉及 serve/schema，加跑 verify 相关契约测试
  if (changed.some(f => /serve\.ts|builtin-tools\.json|toolArgs\.ts/.test(f))) {
    for (const t of tests) if (/schema|tools|verify|contract/i.test(t)) hit.add(t)
  }
  return [...hit]
}

// ── 主流程 ──
const changed = changedFiles()
console.log(`◆ 快门禁：改动 ${changed.length} 个源文件（base=${BASE}）`)
if (changed.length) console.log('  ' + changed.slice(0, 8).join('  ') + (changed.length > 8 ? ` …+${changed.length - 8}` : ''))

let failed = false

// ① ESLint（只查改动文件）
const codeFiles = changed.filter(f => /\.(ts|tsx)$/.test(f))
if (codeFiles.length) {
  process.stdout.write(`  ESLint（${codeFiles.length} 文件）… `)
  const r = run(`npx eslint ${codeFiles.map(f => JSON.stringify(f)).join(' ')}`, { quiet: true })
  console.log(r.ok ? '✓' : '✗')
  if (!r.ok) { console.log(r.out.slice(-2000)); failed = true }
}

// ② vitest（关联测试；无关联时跑核心契约子集）
const tests = allTests()
const related = relatedTests(changed, tests)
if (related.length) {
  process.stdout.write(`  vitest（${related.length}/${tests.length} 测试文件）… `)
  const r = run(`npx vitest run ${related.map(f => JSON.stringify(f)).join(' ')}`, { quiet: true })
  console.log(r.ok ? '✓' : '✗')
  if (!r.ok) { console.log(r.out.slice(-3000)); failed = true }
} else {
  console.log('  vitest（无关联测试，跳过）')
}

// ③ 契约校验（始终跑，<1s）
process.stdout.write('  verify 契约… ')
const v = run('node scripts/verify.mjs', { quiet: true })
console.log(v.ok ? '✓' : '✗')
if (!v.ok) { console.log(v.out.slice(-2000)); failed = true }

if (failed) {
  console.log('\n快门禁 FAIL（发版前请跑 npm run check:full 全门禁）')
  process.exit(1)
}
console.log(`\n快门禁 PASS ✓（全门禁用 npm run check:full）`)
