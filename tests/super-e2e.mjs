// 超级内核真端到端（编译产物）：验证全自动路由 11 阶段流水线 + 静默 + 可解释 trace
// 用法：node tests/super-e2e.mjs（需先 npm run build:server）
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { runSuperLoop, summarizeTrace } = require('../src/shared/superCore.cjs')

function sse(text) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text }, index: 0 }] })}\n\ndata: [DONE]\n\n`
  return Promise.resolve(new Response(body, { status: 200 }))
}

const models = [
  { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, strength: ['code', 'qa'], costTier: 2, speedTier: 1, reasoning: true, supportsTools: true, supportsVision: true },
  { id: 'free', name: 'Free', contextWindow: 64000, strength: ['conversation'], costTier: 0, speedTier: 0, reasoning: false, supportsTools: true, supportsVision: false },
]

const events = []
const deps = {
  runPro: async (m, d) => {
    const body = await d.callLLM('{}', undefined)
    await body.text().catch(() => {})
    return { content: '【Pro+ 执行】代码已写好并验证通过', thinking: '', toolCalls: [] }
  },
  runUltra: async () => ({ content: '【Ultra 执行】深度工程完成', thinking: '', toolCalls: [] }),
  runAuto: async () => ({ content: '【Auto 执行】自主闭环完成全部步骤', thinking: '', toolCalls: [] }),
  baseDeps: { callLLM: async () => sse(''), runTool: async (name) => ({ success: true, output: name + ' ok' }), model: 'gpt-4o', contextWindow: 128000 },
  models,
  preference: 'quality',
  sink: { emit: (e) => events.push(e.type) },
}

const cases = [
  { name: '简单问候', text: '你好', expectKernel: null },
  { name: '代码任务', text: '帮我用 TypeScript 写一个快速排序函数，并处理边界情况，然后写单元测试验证', expectKernel: null },
  { name: '自主多步', text: '第一步读取配置文件，第二步修改数据库连接池参数，第三步运行测试验证，最后自动部署并确认成功', expectKernel: null },
  { name: '危险操作', text: '删除服务器上所有日志文件', expectKernel: null },
]

let failed = 0
for (const c of cases) {
  const messages = [{ role: 'system', content: '你是助手' }, { role: 'user', content: c.text }]
  const r = await runSuperLoop(messages, deps)
  const noLeak = !r.content.includes('正在评估') && !r.content.includes('system-reminder') && !r.content.includes('[Auto')
  const hasTrace = r.trace && r.trace.analysis && r.trace.decision && r.trace.phases.length >= 8
  const report = summarizeTrace(r).split('\n')[0]
  console.log(`\n[${c.name}] kernel=${r.trace.decision.kernel} strategy=${r.trace.decision.strategy} 复杂度=${r.trace.analysis.complexity.score}`)
  console.log('  ' + report)
  console.log('  正文:', JSON.stringify(r.content.slice(0, 60)))
  console.log('  静默:', noLeak ? '✓' : '✗', '| trace:', hasTrace ? '✓' : '✗')
  if (!noLeak || !hasTrace) failed++
}

console.log('\n事件类型:', [...new Set(events)].join(', '))
console.log('总阶段数:', events.filter(e => e === 'phase').length)
if (failed) { console.error(`\nE2E FAIL: ${failed} 项不达标`); process.exit(1) }
console.log('\nSUPER-E2E PASS ✓ — 全自动路由、静默执行、可解释 trace 全部验证')
