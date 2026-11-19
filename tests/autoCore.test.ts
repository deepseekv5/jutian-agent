/**
 * JT Core Auto 自主内核单测（v17.1.0）：
 * 目标抽取 / 轨迹签名 / 三态评估 / 停滞与封顶/自动续跑闭环。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  extractGoal, trajectorySignature, evaluateGoalAuto, runAutoLoop,
  AUTO_SYSTEM_PROMPT, withAutoPrompt, type AutoDeps,
} from '../src/shared/autoCore'
import type { LoopMessage, LoopToolCall, AgentLoopDeps } from '../src/shared/agentLoop'

const MODEL = 'auto-test-model'

function sseResponse(chunks: string[]): Response {
  const body = chunks.map(c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

function makeDeps(over: Partial<AutoDeps> = {}): AutoDeps {
  return {
    tools: [{ name: 'write_file', description: 'w', parameters: { type: 'object' } }],
    callLLM: async () => sseResponse(['done']),
    runTool: async () => ({ success: true, output: 'ok' }),
    isClientTool: () => false,
    events: {},
    model: MODEL,
    apiBase: 'https://api.example.com/v1',
    ...over,
  }
}

describe('extractGoal', () => {
  it('取最后一条 user 文本', () => {
    expect(extractGoal([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '第一个目标' },
      { role: 'user', content: '最终目标' },
    ])).toBe('最终目标')
  })

  it('剥离 Auto 续跑提示，保留原目标', () => {
    expect(extractGoal([
      { role: 'user', content: '写个网站' },
      { role: 'user', content: '<system-reminder>目标尚未完成：还差样式，请继续</system-reminder>' },
    ])).toBe('写个网站')
  })

  it('支持数组型多模态 content 里的 text', () => {
    expect(extractGoal([
      { role: 'user', content: [{ type: 'text', text: '看图改代码' }, { type: 'image_url' }] },
    ])).toBe('看图改代码')
  })
})

describe('trajectorySignature', () => {
  it('忽略结果只看调用本身，参数空白归一化', () => {
    const a: LoopToolCall[] = [{ id: '1', name: 'write_file', arguments: '{ "path": "a.txt" }', status: 'done' }]
    const b: LoopToolCall[] = [{ id: '2', name: 'write_file', arguments: '{"path":"a.txt"}', status: 'done', result: 'different' }]
    expect(trajectorySignature(a)).toBe(trajectorySignature(b))
  })

  it('不同参数产生不同签名', () => {
    const a: LoopToolCall[] = [{ id: '1', name: 'write_file', arguments: '{"path":"a.txt"}' }]
    const b: LoopToolCall[] = [{ id: '2', name: 'write_file', arguments: '{"path":"b.txt"}' }]
    expect(trajectorySignature(a)).not.toBe(trajectorySignature(b))
  })
})

describe('withAutoPrompt', () => {
  it('system 首条时追加自主提示', () => {
    const r = withAutoPrompt([{ role: 'system', content: 'base' }, { role: 'user', content: 'go' }])
    expect(r[0].content).toContain('base')
    expect(r[0].content).toContain(AUTO_SYSTEM_PROMPT)
    expect(r[1]).toEqual({ role: 'user', content: 'go' })
  })

  it('无 system 时补一条', () => {
    const r = withAutoPrompt([{ role: 'user', content: 'go' }])
    expect(r[0].role).toBe('system')
    expect(r[1]).toEqual({ role: 'user', content: 'go' })
  })
})

describe('evaluateGoalAuto 三态', () => {
  const goal = '写个网站'

  it('done=true 且 ok=true', async () => {
    const deps = makeDeps({ callLLM: async () => jsonResponse({ choices: [{ message: { content: '{"done":true,"note":"已完成"}' } }] }) })
    expect(await evaluateGoalAuto(deps, goal, '网站写好了')).toEqual({ done: true, note: '已完成', ok: true })
  })

  it('done=false 但 ok=true（未完成，可续跑）', async () => {
    const deps = makeDeps({ callLLM: async () => jsonResponse({ choices: [{ message: { content: '{"done":false,"note":"还差样式"}' } }] }) })
    expect(await evaluateGoalAuto(deps, goal, '写了骨架')).toEqual({ done: false, note: '还差样式', ok: true })
  })

  it('HTTP 失败 → ok=false，绝不当未完成', async () => {
    const deps = makeDeps({ callLLM: async () => jsonResponse({}, 500) })
    expect((await evaluateGoalAuto(deps, goal, 'x')).ok).toBe(false)
  })

  it('无法解析 JSON → ok=false', async () => {
    const deps = makeDeps({ callLLM: async () => jsonResponse({ choices: [{ message: { content: 'no json here' } }] }) })
    expect((await evaluateGoalAuto(deps, goal, 'x')).ok).toBe(false)
  })

  it('无目标 → ok=false', async () => {
    expect((await evaluateGoalAuto(makeDeps(), '', 'x')).ok).toBe(false)
  })
})

describe('runAutoLoop 闭环', () => {
  const messages: LoopMessage[] = [
    { role: 'system', content: 'base' },
    { role: 'user', content: '造个东西' },
  ]

  // runAutoLoop 内部调用 runAgentLoop；这里用 vi.mock 之外的方式——通过 callLLM 返回
  // 「无工具调用」的纯文本，让每轮 runAgentLoop 直接产出答复后进入评估。
  it('评估器不可用 → 只跑一轮就停（不空转）', async () => {
    let evals = 0
    const deps = makeDeps({
      callLLM: async (body: string) => {
        const parsed = JSON.parse(body)
        // 主循环请求（stream）正常返回正文；评估请求（stream:false）返回 500
        if (parsed.stream === false) { evals++; return jsonResponse({}, 500) }
        return sseResponse(['已做了一部分'])
      },
      maxAutonomousRounds: 5,
    })
    const r = await runAutoLoop([...messages], deps)
    // 评估失败即停：不拿「评估失败」当「未完成」续跑，evals 只发生一次
    expect(evals).toBe(1)
    expect(r.content).toContain('已做了一部分')
    expect(r.content.split('已做了一部分').length - 1).toBe(1) // 正文只出现一次 = 只跑一轮
  })

  it('首轮即完成 → 不续跑', async () => {
    let rounds = 0
    const deps = makeDeps({
      // SSE 给正文（主循环），评估器判完成
      callLLM: async (body: string) => {
        const parsed = JSON.parse(body)
        if (parsed.stream === false) { rounds++; return jsonResponse({ choices: [{ message: { content: '{"done":true,"note":"完成"}' } }] }) }
        return sseResponse(['已完成全部工作'])
      },
      maxAutonomousRounds: 5,
    })
    const r = await runAutoLoop([...messages], deps)
    expect(rounds).toBe(1) // 评估只调用一次
    expect(r.content).toContain('已完成全部工作')
    expect(r.stopped).toBeUndefined()
  })

  it('未完成则续跑，到封顶轮数停止', async () => {
    let evals = 0
    const deps = makeDeps({
      callLLM: async (body: string) => {
        const parsed = JSON.parse(body)
        if (parsed.stream === false) { evals++; return jsonResponse({ choices: [{ message: { content: '{"done":false,"note":"继续"}' } }] }) }
        return sseResponse(['一段进展'])
      },
      maxAutonomousRounds: 3,
    })
    const r = await runAutoLoop([...messages], deps)
    // 3 轮执行，前 2 轮评估后判定未完成，第 3 轮到顶直接 break（不再评估）
    expect(evals).toBe(2)
    expect(r.content.split('一段进展').length - 1).toBe(3)
  })

  it('abort 信号 → 立即停止', async () => {
    const ac = new AbortController()
    ac.abort()
    const deps = makeDeps({ signal: ac.signal })
    const r = await runAutoLoop([...messages], deps)
    expect(r.stopped).toBe('aborted')
  })
})
