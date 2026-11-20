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

  it('中英混合多段目标（帮我…然后…再…）返回完整原文，不做截断或拆段', () => {
    const goal = '帮我重构这个 auth module，然后用 vitest 补齐 unit tests，再把 README 翻译成英文'
    expect(extractGoal([
      { role: 'system', content: 'sys' },
      { role: 'user', content: goal },
    ])).toBe(goal)
  })

  it('中英混合多段目标藏在多模态数组 content 里也返回完整原文', () => {
    const goal = 'Fix the login bug，然后帮我加上 e2e 测试，再更新 CHANGELOG'
    expect(extractGoal([
      { role: 'user', content: [{ type: 'text', text: goal }, { type: 'image_url' }] },
    ])).toBe(goal)
  })

  it('纯图片无文本的多模态消息：单条时返回空串，且不遮蔽更早的文本目标', () => {
    // 只有纯图片消息 → 无文本可用，返回空串。
    expect(extractGoal([
      { role: 'user', content: [{ type: 'image_url' }, { type: 'image_url' }] },
    ])).toBe('')
    // 纯图片消息在最后 → 跳过它继续向前找真正的文本目标。
    expect(extractGoal([
      { role: 'user', content: '先把部署脚本修好' },
      { role: 'user', content: [{ type: 'image_url' }] },
    ])).toBe('先把部署脚本修好')
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

  it('note 超长按 code point 截断，不切断 emoji 代理对', async () => {
    // 155 个 ASCII + 10 个 emoji（每个占 2 个 UTF-16 码元）：整串 175 码元 / 165 码点。
    // 旧的按码元 slice(0,160) 会正好切在第 3 个 emoji 的高低代理之间，产生非法孤立代理；
    // 按码点截断应得到 160 个码点 = 155 个字符 + 5 个完整 emoji。
    const emoji = '🚀'
    const rawNote = 'a'.repeat(155) + emoji.repeat(10)
    const deps = makeDeps({
      callLLM: async () => jsonResponse({
        choices: [{ message: { content: `{"done":false,"note":"${rawNote}"}` } }],
      }),
    })
    const ev = await evaluateGoalAuto(deps, '写个网站', '写了一半')
    expect(ev.ok).toBe(true)
    // 截断后恰为 160 个 code point。
    expect(Array.from(ev.note).length).toBe(160)
    // 结尾是完整的 emoji，而不是被切半的代理对。
    expect(ev.note.endsWith(emoji)).toBe(true)
    // 结尾不得是孤立的高代理（码元层面切半的标志）。
    expect(/[\uD800-\uDBFF]$/.test(ev.note)).toBe(false)
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

  it('连续零工具轮（纯文本答复）不触发停滞检测：空签名不参与判定', async () => {
    // 每轮 runAgentLoop 都只产出纯文本（无任何工具调用），轨迹签名为空串。
    // 空签名不应被当成「重复操作」判空转：应跑满封顶轮数并正常收尾。
    const deps = makeDeps({
      callLLM: async (body: string) => {
        const parsed = JSON.parse(body)
        if (parsed.stream === false) {
          return jsonResponse({ choices: [{ message: { content: '{"done":false,"note":"继续"}' } }] })
        }
        return sseResponse(['纯文本进展'])
      },
      maxAutonomousRounds: 4,
    })
    const r = await runAutoLoop([{ role: 'user', content: '目标' }], deps)
    expect(r.stopped).toBeUndefined()
    expect(r.error).toBeUndefined()
    // 4 轮纯文本答复全部保留（若误判停滞会在第 2 轮提前停并带 error）。
    expect(r.content.split('纯文本进展').length - 1).toBe(4)
  })
})
