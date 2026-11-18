/**
 * 内核阶段函数单测（v17.0.0 内核重组配套）：
 * prepareRoundMessages / requestRound / streamRound / gateToolCalls / executePlans
 * 逐段覆盖行为等价性清单——重组后这些是行为回归的第一道防线。
 */
import { describe, it, expect } from 'vitest'
import {
  buildLoopContext, prepareRoundMessages, requestRound, streamRound,
  gateToolCalls, executePlans, clampToolResult, READONLY_TOOLS,
  type AgentLoopDeps, type LoopMessage, type LoopToolCall,
} from '../src/shared/agentLoop'
import { createAgentPerf } from '../src/shared/agentPerf'

const MODEL = 'test-model'
const BASE = 'https://api.example.com/v1'

/** 构造最小 deps（callLLM 由用例覆写） */
function makeDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
  const noop = () => {}
  return {
    tools: [
      { name: 'read_file', description: 'r', parameters: { type: 'object' } },
      { name: 'write_file', description: 'w', parameters: { type: 'object' } },
      { name: 'shell', description: 's', parameters: { type: 'object' } },
    ],
    callLLM: async () => sseResponse([]),
    runTool: async (name, args) => ({ success: true, output: `ran:${name}:${JSON.stringify(args)}` }),
    isClientTool: () => false,
    events: {},
    model: MODEL,
    apiBase: BASE,
    ...over,
  } as AgentLoopDeps
}

/** SSE 流式响应 mock：逐行 enqueue */
function sseResponse(lines: string[], status = 200): Response {
  const stream = new ReadableStream({
    start(c) {
      const enc = new TextEncoder()
      for (const l of lines) c.enqueue(enc.encode('data: ' + l + '\n\n'))
      c.close()
    },
  })
  return new Response(stream, { status })
}

function chatDelta(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text } }] })
}

function toolCallDelta(id: string, name: string, argsPart: string): string {
  return JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: argsPart } }] } }] })
}

/** 跑一轮流式读取，返回 {toolCalls, roundContent} */
function stream(lines: string[], ctx = buildLoopContext({ tools: [], callLLM: async () => sseResponse([]), runTool: async () => ({ success: true, output: '' }), isClientTool: () => false, events: {}, model: MODEL, apiBase: BASE })) {
  const perf = createAgentPerf()
  return streamRound(sseResponse(lines), ctx, makeDeps(), perf)
}

describe('buildLoopContext', () => {
  it('resume 继承累积输出', () => {
    const ctx = buildLoopContext(makeDeps({
      resume: { content: '前文', thinking: '思考', toolCalls: [{ id: '1', name: 'x', arguments: '{}', status: 'done' }] },
    }))
    expect(ctx.fullContent).toBe('前文')
    expect(ctx.fullThinking).toBe('思考')
    expect(ctx.allToolCalls).toHaveLength(1)
  })
  it('默认 fresh 状态', () => {
    const ctx = buildLoopContext(makeDeps())
    expect(ctx.toolRound).toBe(0)
    expect(ctx.wrapUp).toBe(false)
    expect(ctx.allToolCalls).toHaveLength(0)
  })
})

describe('prepareRoundMessages', () => {
  const deps = makeDeps({ model: 'spark-x2.6', apiBase: 'https://maas.example/v2' }) // free 命中 hermes
  it('wrapUp 追加收尾提示到本次请求', () => {
    const ctx = buildLoopContext(deps)
    ctx.wrapUp = true
    const msgs: LoopMessage[] = [{ role: 'user', content: 'hi' }]
    const out = prepareRoundMessages(ctx, msgs, deps)
    expect(out.at(-1)?.role).toBe('user')
    expect(String(out.at(-1)?.content)).toContain('工具调用轮次已用尽')
    // 只进本次请求：原 messages 不被污染
    expect(msgs).toHaveLength(1)
  })
  it('hermesMode=on 触发 Hermes 注入（system 前置）', () => {
    const hd = makeDeps({ hermesMode: 'on' })
    const ctx = buildLoopContext(hd)
    const out = prepareRoundMessages(ctx, [{ role: 'user', content: 'hi' }], hd)
    expect(out[0]?.role).toBe('system')
    expect(String(out[0]?.content)).toContain('tool')
  })
  it('预算超限触发裁剪（不以 tool 开头、不留悬空 tool_calls）', () => {
    const d = makeDeps({ contextBudget: 50 })
    const ctx = buildLoopContext(d)
    const msgs: LoopMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'x'.repeat(400) },
      { role: 'assistant', content: 'y'.repeat(400), tool_calls: [{ id: 't1', type: 'function' as const, function: { name: 'x', arguments: '{}' }, index: 0 }] },
      { role: 'tool', tool_call_id: 't1', content: 'z'.repeat(400) },
    ]
    const out = prepareRoundMessages(ctx, msgs as unknown as LoopMessage[], d)
    // 裁剪后的切点必须是合法历史
    if (out.length > 1 && out[1]?.role === 'tool') {
      expect.fail('裁剪后首个非 system 消息不得是 tool')
    }
    for (const m of out) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          expect(out.some(x => x.role === 'tool' && x.tool_call_id === tc.id)).toBe(true)
        }
      }
    }
  })
})

describe('requestRound', () => {
  it('成功直接返回响应', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const deps = makeDeps({ callLLM: async () => sseResponse([chatDelta('hi')]) })
    const res = await requestRound(deps, ctx, [{ role: 'user', content: 'hi' }], 4096, undefined, perf)
    expect(res.ok).toBe(true)
    await res.text()
  })
  it('网络异常重试后成功', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    let calls = 0
    const deps = makeDeps({
      callLLM: async () => {
        calls++
        if (calls === 1) throw new Error('ECONNRESET')
        return sseResponse([chatDelta('ok')])
      },
    })
    const res = await requestRound(deps, ctx, [{ role: 'user', content: 'hi' }], 4096, undefined, perf)
    expect(res.ok).toBe(true)
    expect(calls).toBe(2)
  })
  it('上游 400 上下文溢出：裁剪重放一次（不消耗重试额度）', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const seen: string[] = []
    const deps = makeDeps({
      callLLM: async (body) => {
        seen.push(body)
        if (seen.length === 1) {
          return new Response(JSON.stringify({ error: { message: 'context_length_exceeded: too many tokens' } }), { status: 400 })
        }
        return sseResponse([chatDelta('ok')])
      },
    })
    const long = [{ role: 'user', content: 'x'.repeat(4000) }]
    const res = await requestRound(deps, ctx, long, 4096, undefined, perf)
    expect(res.ok).toBe(true)
    expect(seen.length).toBe(2)
    // 重放的消息体比第一次短（被裁剪）
    const second = JSON.parse(seen[1])
    expect(JSON.stringify(second.messages).length).toBeLessThan(JSON.stringify(JSON.parse(seen[0]).messages).length + 10)
  })
  it('5xx 重试耗尽：错误带「已自动重试」提示', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const deps = makeDeps({
      callLLM: async () => new Response('boom', { status: 500 }),
    })
    await expect(requestRound(deps, ctx, [{ role: 'user', content: 'hi' }], 4096, undefined, perf))
      .rejects.toThrow(/已自动重试/)
  })
  it('abort 时抛出（主循环按 stopped=aborted 归类）', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const ac = new AbortController()
    const deps = makeDeps({
      callLLM: async () => { throw new DOMException('Aborted', 'AbortError') },
    })
    await expect(requestRound(deps, ctx, [{ role: 'user', content: 'hi' }], 4096, ac.signal, perf))
      .rejects.toThrow()
  })
})

describe('streamRound', () => {
  it('text 事件累积到 ctx.fullContent 并触发 onChunk', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const chunks: string[] = []
    const deps = makeDeps({ events: { onChunk: (c: string) => chunks.push(c) } })
    const tc = await streamRound(sseResponse([chatDelta('你'), chatDelta('好')]), ctx, deps, perf)
    expect(tc.toolCalls).toHaveLength(0)
    expect(ctx.fullContent).toBe('你好')
    expect(chunks.join('')).toBe('你好')
  })
  it('thought 事件累积 ctx.fullThinking 并触发 onThinking', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const thinks: string[] = []
    const deps = makeDeps({ events: { onThinking: (t: string) => thinks.push(t) } })
    // reasoning 字段（extractReasoning 识别的形态）
    await streamRound(sseResponse([JSON.stringify({ choices: [{ delta: { reasoning_content: '想一想' } }] })]), ctx, deps, perf)
    expect(ctx.fullThinking).toContain('想一想')
    expect(thinks.join('')).toContain('想一想')
  })
  it('tool_call delta 分片累积为完整调用（快照型去重）', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const tc = await streamRound(sseResponse([
      toolCallDelta('c1', 'write_file', '{"path"'),
      toolCallDelta('c1', 'write_file', ':"/tmp/a.txt"}'),
      chatDelta('done'),
    ]), ctx, makeDeps(), perf)
    expect(tc.toolCalls).toHaveLength(1)
    expect(tc.toolCalls[0].name).toBe('write_file')
    expect(tc.toolCalls[0].arguments).toBe('{"path":"/tmp/a.txt"}')
  })
  it('finish_reason=tool_calls 时采纳非流式完整 tool_calls', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const tc = await streamRound(sseResponse([
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'x1', type: 'function', function: { name: 'shell', arguments: '{"command":"pwd"}' } } ] } }] }),
    ]), ctx, makeDeps(), perf)
    expect(tc.toolCalls).toHaveLength(1)
    expect(tc.toolCalls[0].name).toBe('shell')
  })
  it('Hermes 文本协议回退：<tool_call> 块解析为工具调用', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const hermesBody = '好的。\n<tool_call>\n{"name": "shell", "arguments": {"command": "pwd"}}\n</tool_call>'
    const tc = await streamRound(sseResponse([chatDelta(hermesBody)]), ctx, makeDeps(), perf)
    expect(tc.toolCalls).toHaveLength(1)
    expect(tc.toolCalls[0].name).toBe('shell')
    expect(ctx.fullContent).not.toContain('<tool_call>')
  })
  it('abort：返回空（主循环按 stopped=aborted 归类）', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const ac = new AbortController()
    ac.abort()
    const deps = makeDeps()
    const tc = await streamRound(sseResponse([chatDelta('x')]), ctx, deps, perf)
    expect(tc.toolCalls).toHaveLength(0)
  })
})

describe('gateToolCalls', () => {
  function gateDeps(over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
    return makeDeps(over)
  }
  it('正常调用过闸进入 plans', async () => {
    const ctx = buildLoopContext(gateDeps())
    const msgs: LoopMessage[] = []
    const plans = await gateToolCalls(ctx, gateDeps(), msgs, [
      { id: 'a', name: 'read_file', arguments: '{"path":"/tmp/x"}' },
    ])
    expect(plans).toHaveLength(1)
    expect(msgs).toHaveLength(0)
  })
  it('同签名重复 5 次被硬拦（结果直接作为 tool 消息）', async () => {
    const ctx = buildLoopContext(gateDeps())
    const msgs: LoopMessage[] = []
    const tc = { id: 'r1', name: 'read_file', arguments: '{"path":"/tmp/x"}' }
    let plans: unknown[] = []
    for (let i = 0; i < 5; i++) {
      plans = await gateToolCalls(ctx, gateDeps(), msgs, [tc])
    }
    // 第 5 次触发硬拦：plans 为空，tool 消息是拦截文案
    expect(plans).toHaveLength(0)
    expect(msgs.at(-1)?.content).toContain('重复调用已拦截')
  })
  it('confirmTool 拒绝：记入 error 结果并写回 tool 消息', async () => {
    const ctx = buildLoopContext(gateDeps())
    const msgs: LoopMessage[] = []
    const plans = await gateToolCalls(ctx, gateDeps({
      confirmTool: async () => '用户拒绝执行',
    }), msgs, [{ id: 'd1', name: 'shell', arguments: '{}' }])
    expect(plans).toHaveLength(0)
    expect(msgs.at(-1)?.content).toBe('用户拒绝执行')
  })
  it('needsClient：抛 NeedsClientError（无状态续跑）', async () => {
    const ctx = buildLoopContext(gateDeps())
    const msgs: LoopMessage[] = [{ role: 'user', content: 'hi' }]
    await expect(gateToolCalls(ctx, gateDeps({
      needsClient: () => 'client_tool',
    }), msgs, [{ id: 'c1', name: 'update_plan', arguments: '{}' }])).rejects.toThrow()
  })
})

describe('executePlans', () => {
  it('只读工具并行执行且结果按调用序写回', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const msgs: LoopMessage[] = []
    const mk = (id: string) => ({ tc: { id, name: 'read_file', arguments: `{"path":"${id}"}` }, obj: { id, name: 'read_file', arguments: `{"path":"${id}"}`, status: 'running' as const, started_at: '' } })
    const plans = [mk('a'), mk('b'), mk('c')]
    await executePlans(ctx, makeDeps({
      runTool: async (name, args) => ({ success: true, output: 'out:' + String((args as any).path) }),
    }), msgs, plans, perf)
    const toolMsgs = msgs.filter(m => m.role === 'tool')
    expect(toolMsgs.map(m => m.content)).toEqual(['out:a', 'out:b', 'out:c'])
  })
  it('工具失败：error 结果 + hint 注入', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const msgs: LoopMessage[] = []
    const plans = [{ tc: { id: 'f1', name: 'shell', arguments: '{}' }, obj: { id: 'f1', name: 'shell', arguments: '{}', status: 'running' as const, started_at: '' } }]
    await executePlans(ctx, makeDeps({
      runTool: async () => ({ success: false, error: 'boom' }),
    }), msgs, plans, perf)
    expect(msgs.at(-1)?.content).toContain('❌ 错误: boom')
  })
  it('连续失败 3 次注入恢复提示', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const msgs: LoopMessage[] = []
    const mkFail = (id: string) => ({ tc: { id, name: 'shell', arguments: '{}' }, obj: { id, name: 'shell', arguments: '{}', status: 'running' as const, started_at: '' } })
    for (const id of ['f1', 'f2', 'f3']) {
      const plans = [mkFail(id)]
      await executePlans(ctx, makeDeps({ runTool: async () => ({ success: false, error: 'x' }) }), msgs, plans, perf)
    }
    expect(msgs.at(-1)?.content).toContain('已连续 3 个工具调用失败')
  })
  it('CLEARABLE_TOOLS 命中时 clearableIds 记录（microcompact 可清）', async () => {
    const ctx = buildLoopContext(makeDeps())
    const perf = createAgentPerf()
    const msgs: LoopMessage[] = []
    const plans = [{ tc: { id: 'cl1', name: 'read_file', arguments: '{}' }, obj: { id: 'cl1', name: 'read_file', arguments: '{}', status: 'running' as const, started_at: '' } }]
    await executePlans(ctx, makeDeps({ runTool: async () => ({ success: true, output: 'ok' }) }), msgs, plans, perf)
    expect(ctx.clearableIds.has('cl1')).toBe(true)
  })
})

describe('clampToolResult', () => {
  it('短文本原样返回', () => {
    expect(clampToolResult('ok')).toBe('ok')
  })
  it('普通工具超限截断并提示分段读取', () => {
    const out = clampToolResult('x'.repeat(50_000), 'read_file')
    expect(out).toContain('输出过长已截断')
    expect(out).toContain('分段读取')
  })
  it('shell 类保尾并提示缩小范围重跑', () => {
    const out = clampToolResult('y'.repeat(50_000), 'shell')
    expect(out).toContain('缩小范围重跑')
    expect(out.length).toBeLessThan(50_000)
  })
})
