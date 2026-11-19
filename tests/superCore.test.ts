/**
 * Super Core 主编排单测（v18.0.0）：
 * 验证全自动路由流水线——信号→分析→规划→路由→选模→上下文→护栏→执行→反馈
 * 各阶段被正确串联，trace 可解释，底层内核按决策被调用，静默（不往正文塞内部标记）。
 */
import { describe, it, expect, vi } from 'vitest'
import { runSuperLoop, summarizeTrace } from '../src/shared/superCore'
import type { SuperDeps } from '../src/shared/super/types'
import type { LoopMessage } from '../src/shared/agentLoop'

function makeDeps(over: Partial<SuperDeps> = {}): SuperDeps {
  return {
    runPro: vi.fn(async () => ({ content: 'pro-answer', thinking: '', toolCalls: [] })),
    runUltra: vi.fn(async () => ({ content: 'ultra-answer', thinking: '', toolCalls: [] })),
    runAuto: vi.fn(async () => ({ content: 'auto-answer', thinking: '', toolCalls: [] })),
    baseDeps: { model: 'test', callLLM: async () => new Response(), runTool: async () => ({ success: true }) },
    models: [],
    ...over,
  }
}

const msgs = (text: string): LoopMessage[] => [
  { role: 'system', content: 'base' },
  { role: 'user', content: text },
]

describe('runSuperLoop 主编排', () => {
  it('简单对话任务：全程无异常，返回正文 + 可解释 trace', async () => {
    const deps = makeDeps()
    const r = await runSuperLoop(msgs('你好'), deps)
    expect(typeof r.content).toBe('string')
    expect(r.trace).toBeTruthy()
    expect(r.trace.phases.length).toBeGreaterThan(5)
    expect(r.trace.signals).toBeTruthy()
    expect(r.trace.analysis).toBeTruthy()
    expect(r.trace.decision).toBeTruthy()
    expect(typeof r.trace.durationMs).toBe('number')
  })

  it('恰好调用一个底层内核', async () => {
    const deps = makeDeps()
    await runSuperLoop(msgs('帮我写一段 Python 代码并运行测试'), deps)
    const calls = [deps.runPro, deps.runUltra, deps.runAuto].filter(f => (f as any).mock?.calls?.length)
    expect(calls.length).toBe(1)
  })

  it('复杂多步任务会生成执行计划', async () => {
    const deps = makeDeps()
    const r = await runSuperLoop(msgs('第一步读取配置文件，第二步修改数据库连接，第三步运行测试验证，最后部署到服务器'), deps)
    expect(r.trace.plan).toBeTruthy()
    expect(r.trace.plan!.steps.length).toBeGreaterThan(0)
    expect(r.trace.analysis.complexity.score).toBeGreaterThan(0)
  })

  it('模型选择：有候选模型时产出 choice 与 alternatives', async () => {
    const deps = makeDeps({
      models: [
        { id: 'm1', name: 'Model 1', contextWindow: 128000, strength: ['code'], costTier: 1, speedTier: 1, reasoning: true, supportsTools: true, supportsVision: false },
        { id: 'm2', name: 'Model 2', contextWindow: 64000, strength: ['writing'], costTier: 0, speedTier: 0, reasoning: false, supportsTools: true, supportsVision: false },
      ],
    })
    const r = await runSuperLoop(msgs('写一段代码'), deps)
    expect(r.trace.model).toBeTruthy()
    expect(r.trace.model!.model).toBeTruthy()
  })

  it('事件汇收到 phase/route 事件', async () => {
    const events: string[] = []
    const deps = makeDeps({ sink: { emit: e => events.push(e.type) } })
    await runSuperLoop(msgs('你好'), deps)
    expect(events).toContain('phase')
    expect(events).toContain('route')
    expect(events).toContain('metric')
  })

  it('自适应引擎：record 与 adjust 被调用', async () => {
    const record = vi.fn()
    const adjust = vi.fn((d) => d)
    const deps = makeDeps({ adaptation: { record, adjust, stats: () => ({}) } })
    await runSuperLoop(msgs('你好'), deps)
    expect(record).toHaveBeenCalledTimes(1)
    expect(adjust).toHaveBeenCalledTimes(1)
  })

  it('底层内核抛错时原样上抛（needs_client 交给 serve 处理）', async () => {
    const err: any = new Error('need confirm')
    err.name = 'NeedsClientError'
    const deps = makeDeps({ runPro: vi.fn(async () => { throw err }) })
    await expect(runSuperLoop(msgs('删掉一个重要文件'), deps)).rejects.toMatchObject({ name: 'NeedsClientError' })
  })

  it('护栏拦截危险工具：runTool 返回失败而非执行', async () => {
    const runTool = vi.fn(async () => ({ success: true, output: 'ok' }))
    // 让底层 Pro 内核真的调用一次 runTool
    const deps = makeDeps({
      baseDeps: { model: 'test', callLLM: async () => new Response(), runTool },
      runPro: vi.fn(async (_m, d: any) => {
        const r = await d.runTool('shell', { command: 'rm -rf /' })
        return { content: r.success ? 'done' : 'blocked', thinking: '', toolCalls: [] }
      }),
    })
    const r = await runSuperLoop(msgs('执行危险命令'), deps)
    // 危险命令应被护栏拦截（结果 success=false，底层返回 blocked）
    expect(r.content).toBe('blocked')
  })

  it('静默：trace/事件里不出现正文方括号标记', async () => {
    const events: any[] = []
    const deps = makeDeps({ sink: { emit: e => events.push(e) } })
    const r = await runSuperLoop(msgs('帮我做事'), deps)
    const allText = JSON.stringify([r.content, events])
    expect(allText).not.toContain('正在评估')
    expect(allText).not.toContain('Auto 自主内核')
  })
})

describe('summarizeTrace', () => {
  it('产出人类可读路由报告', async () => {
    const r = await runSuperLoop(makeDeps() && msgs('写个文件'), makeDeps())
    const s = summarizeTrace(r)
    expect(s).toContain('内核')
    expect(s).toContain('策略')
    expect(s).toContain('复杂度')
    expect(s).toContain('路由理由')
  })
})
