#!/usr/bin/env node
/**
 * verify.mjs — 契约与完整性校验(CI 与本地跑,零依赖)
 *
 * 守护四件事:
 *   1. builtin-tools.json — 39 个工具 schema 单一来源的结构合法
 *   2. guidance/rules.json — 约束知识库结构合法,无重复 id
 *   3. 品牌/版本单一来源 — package.json 与关键引用一致
 *   4. 免 key 源常量 — llm-proxy 的哨兵与网关地址未被误改
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { console.error(`  ✗ ${m}`); failed++ }
const section = (m) => console.log(`\n■ ${m}`)

// ─── 1. builtin-tools.json ───
section('工具 schema(src/shared/builtin-tools.json)')
try {
  const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/shared/builtin-tools.json'), 'utf-8'))
  if (!Array.isArray(tools) || tools.length < 35) bad(`工具数异常: ${tools?.length}`)
  else ok(`${tools.length} 个工具`)
  const ids = new Set()
  for (const t of tools) {
    if (!t.name) bad('存在无 name 的工具')
    if (ids.has(t.name)) bad(`重复工具: ${t.name}`)
    ids.add(t.name)
    if (!t.description) bad(`${t.name}: 缺 description`)
    if (t.parameters?.type !== 'object') bad(`${t.name}: parameters.type != object`)
  }
  for (const need of ['shell', 'write_file', 'consult_guidance', 'dispatch_subagents', 'web_search']) {
    if (!ids.has(need)) bad(`缺少关键工具: ${need}`)
  }
  if (!ids.has('consult_guidance')) bad('约束知识库工具 consult_guidance 缺失')
  else ok('consult_guidance 在列')
} catch (e) { bad(`解析失败: ${e.message}`) }

// ─── 2. guidance/rules.json ───
section('约束知识库(src/shared/guidance/rules.json)')
try {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/shared/guidance/rules.json'), 'utf-8'))
  if (!Array.isArray(g.domains) || g.domains.length < 8) bad(`领域数异常: ${g.domains?.length}`)
  else ok(`${g.domains.length} 个领域`)
  const ruleIds = new Set()
  let count = 0
  for (const d of g.domains) {
    if (!d.id || !d.title) bad(`领域缺 id/title`)
    for (const r of d.rules || []) {
      count++
      if (ruleIds.has(r.id)) bad(`重复规则 id: ${r.id}`)
      ruleIds.add(r.id)
      if (!['hard', 'soft'].includes(r.level)) bad(`${r.id}: level 非法(${r.level})`)
      if (!r.rule || r.rule.length < 10) bad(`${r.id}: rule 过短或缺失`)
    }
  }
  if (count < 35) bad(`规则总数异常: ${count}`)
  else ok(`${count} 条规则,无重复 id`)
  const core = g.domains.find((d) => d.id === 'core')
  if (!core || (core.rules || []).length < 5) bad('core 铁律不足 5 条(主提示词注入依赖)')
  else ok('core 铁律齐备')
} catch (e) { bad(`解析失败: ${e.message}`) }

// ─── 3. 版本/品牌单一来源 ───
section('版本与品牌(package.json)')
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) bad(`版本号非法: ${pkg.version}`)
  else ok(`v${pkg.version}`)
  if (pkg.license !== 'MIT') bad('license 非 MIT')
  else ok('MIT')
  if (!pkg.scripts?.check) bad('缺少 check 脚本(tsc 门禁)')
  else ok('check 脚本在列')
} catch (e) { bad(`解析失败: ${e.message}`) }

// ─── 4. 免 key 网关常量(llm-proxy)───
section('免 key 网关常量(serve.cjs 源)')
try {
  const serveSrc = fs.readFileSync(path.join(ROOT, 'src/server/serve.ts'), 'utf-8')
  if (serveSrc.includes('apiKey === "free"')) ok('free 哨兵在列(免鉴权网关)')
  else bad('free 哨兵丢失 — Kilo/Pollinations 免 key 链路会 401')
  if (serveSrc.includes('/openai$/.test(targetBase)')) ok('Pollinations /openai 端点特判在列')
  else bad('Pollinations /openai 特判丢失')
  if (serveSrc.includes('kilo_api_key')) ok('Kilo 账户密钥(kilo_api_key)解析在列')
  else bad('kilo_api_key 解析丢失 — 付费档无法鉴权')
  if (/openrouter\/free/.test(serveSrc)) ok('默认免费模型 openrouter/free 排序在列')
  else bad('openrouter/free 默认排序丢失')
} catch (e) { bad(`读取失败: ${e.message}`) }

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
