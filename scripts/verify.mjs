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

// ─── 5. AI 角色聊天合规契约 ───
// 依据《人工智能拟人化互动服务管理暂行办法》(五部门令第21号,2026-07-15 施行)
// 与《人工智能生成合成内容标识办法》(2025-09-01 施行)。
// 这些是法定义务的落地实现，删除即违规，故纳入门禁。
section('AI 角色合规契约(拟人化办法 / 标识办法)')
try {
  const safety = fs.readFileSync(path.join(ROOT, 'src/shared/personaSafety.ts'), 'utf-8')
  const personas = fs.readFileSync(path.join(ROOT, 'src/shared/personas.ts'), 'utf-8')
  const chat = fs.readFileSync(path.join(ROOT, 'src/shared/personaChat.ts'), 'utf-8')

  // 第十八条 + 标识办法第四条：AI 身份提示与逐条标识
  if (safety.includes('AI_LABEL')) ok('AI 生成标识常量在列')
  else bad('AI_LABEL 丢失 — 缺少逐条生成标识(标识办法第四条)')
  if (safety.includes('EXPORT_LABEL_HEADER')) ok('导出显式标识在列(标识办法第四条第二款)')
  else bad('导出标识丢失 — 导出文件须含显式标识')

  // 第十三条：极端情境识别与干预
  if (/export function detectCrisis/.test(safety)) ok('危机情境识别函数在列')
  else bad('detectCrisis 丢失 — 第十三条强制干预失效')
  if (safety.includes('12356')) ok('危机干预含援助热线')
  else bad('危机干预未给出求助渠道')

  // 第十九条：不得阻碍用户退出
  if (safety.includes('EXIT_REPLY') && /export function detectExitIntent/.test(safety)) ok('退出识别与不挽留回复在列')
  else bad('退出处理丢失 — 第十九条禁止阻碍退出')

  // 第十四条：未成年人模式与虚拟亲密关系硬禁止
  if (safety.includes('MINOR_NOTICE')) ok('未成年人告知在列(虚拟亲密关系禁止)')
  else bad('未成年人告知丢失')

  // 第十六条：敏感交互数据不得用于训练
  if (safety.includes('NO_TRAINING_NOTICE')) ok('不用于训练承诺在列')
  else bad('缺少不用于训练的声明(拟人化办法第十六条)')

  // 角色边界：预置角色不得声称真人
  if (/不(?:是|对应)真人|非真人/.test(personas)) ok('预置角色非真人声明在列')
  else bad('预置角色缺少非真人声明')
  if (personas.includes('PRESET_PERSONAS') && personas.includes('ANTI_DEPENDENCY_RULES')) ok('预置角色与反依赖红线在列')
  else bad('反依赖红线丢失 — 第八条(五)诱导情感依赖')
  if (/2026-07-15/.test(personas) || /令第21号/.test(personas)) ok('合规依据标注令第21号')
  else bad('免责声明缺少令第21号依据')

  // 免费优先：未配置模型时回落免 key 网关
  if (chat.includes('FREE_FALLBACKS')) ok('免费模型回落配置在列(零配置可用)')
  else bad('免费回落丢失 — 未配置模型将无法对话')
} catch (e) { bad(`读取失败: ${e.message}`) }

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
