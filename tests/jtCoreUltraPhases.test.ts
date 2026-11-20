import { describe, it, expect } from 'vitest'
import {
  buildUltraContext, prepareUltraMessages, gateUltraToolCalls,
} from '../src/shared/jtCoreUltra'
import type { UltraDeps, UltraMessage, UltraToolCall } from '../src/shared/jtCoreUltra'
import { toolFingerprint, STEP_BACK_MESSAGE } from '../src/shared/ultra/loopDetection'
import { CONTINUE_PROMPT } from '../src/shared/ultra/nextSpeaker'
import { checkRepeatCall, callSignature } from '../src/shared/toolLoopGuard'
import { maxOutputTokens } from '../src/shared/ultra/tokenBudget'
import { estimateMessagesTokens } from '../src/shared/ultra/chatCompression'

/* v18.0.0 阶段函数单测：mock 最小 deps，只测阶段边界行为（不跑完整循环）。
 * 完整编排回归由 tests/jtCoreUltra.test.ts 的 runUltraLoop 端到端用例兜底。 */

const TOOL_READ = { name: 'read_file', description: '读文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
const TOOL_SHELL = { name: 'shell', description: 'shell', parameters: {} }

const baseDeps = (over: Partial<UltraDeps> = {}): UltraDeps => ({
  tools: [],
  callLLM: async () => new Response(''),
  runTool: async () => ({ success: true, output: '' }),
  isClientTool: () => false,
  model: 'gpt-4',
  apiBase: 'https://api.openai.com/v1',
  events: {},
  ...over,
} as UltraDeps)

describe('buildUltraContext / 阶段零：组件实例化 + 缓存', () => {
  it('disabledTools 过滤进 schema；非免费线路不缓存 Hermes 块；游标初始为零', () => {
    const ctx = buildUltraContext(baseDeps({ tools: [TOOL_READ, TOOL_SHELL], disabledTools: ['shell'] }))
    expect(ctx.tools).toHaveLength(1)
    expect(ctx.toolsSchema).toHaveLength(1)
    expect(ctx.toolsSchema[0].function.name).toBe('read_file')
    expect(ctx.hermesBlock).toBe('')
    expect(ctx.wrappedUp).toBe(false)
    expect(ctx.lastSemanticCheck).toBe(0)
    expect(ctx.ideBlock).toBe('')
  })

  it('免费线路缓存 Hermes 块（含工具名）；contextWindow 透传；maxTokens 显式优先、缺省按上限表', () => {
    const ctx = buildUltraContext(baseDeps({ tools: [TOOL_READ], model: 'glm-4:free', contextWindow: 12345, maxTokens: 4096 }))
    expect(ctx.hermesBlock).toContain('read_file')
    expect(ctx.contextWindow).toBe(12345)
    expect(ctx.maxTokens).toBe(4096)
    const ctx2 = buildUltraContext(baseDeps({ tools: [TOOL_READ], model: 'glm-4:free', contextWindow: 64000 }))
    expect(ctx2.hermesBlock).toContain('read_file')
    expect(ctx2.maxTokens).toBe(maxOutputTokens(64000))
  })

  it('approvedScopes 预授权落库；permissionLevel 映射审批档位（full → never）', () => {
    const ctx = buildUltraContext(baseDeps({ approvedScopes: ['shell::{"command":"ls"}'], permissionLevel: 'full' }))
    expect(ctx.policyMode).toBe('never')
    const key = ctx.approvedScopes.scopeKeyOf('shell', { command: 'ls' })
    expect(key).toBe('shell::{"command":"ls"}')
    expect(ctx.approvedScopes.isApproved(key)).toBe(true)
  })
})

describe('prepareUltraMessages / 阶段一：续跑补消息 + 上下文整理 + Hermes 注入', () => {
  it('resume：补齐悬空 tool_calls——有 decision 记 error、无 decision 回填 result 记 done；同 id 已在 resume 中则不重复', () => {
    const deps = baseDeps({ pendingTool: { toolCall: { id: 'c1', name: 'shell', arguments: '{"command":"ls"}' }, decision: '用户拒绝了本次执行' } })
    const ctx = buildUltraContext(deps)
    const messages: UltraMessage[] = [{ role: 'user', content: 'ls' }]
    prepareUltraMessages(ctx, messages, deps, 'resume')
    expect(messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: '用户拒绝了本次执行' })
    expect(ctx.allToolCalls).toHaveLength(1)
    expect(ctx.allToolCalls[0].status).toBe('error')

    const deps2 = baseDeps({ pendingTool: { toolCall: { id: 'c2', name: 'read_file', arguments: '{}', result: '文件内容' } } })
    const ctx2 = buildUltraContext(deps2)
    const messages2: UltraMessage[] = []
    prepareUltraMessages(ctx2, messages2, deps2, 'resume')
    expect(messages2[0]).toMatchObject({ role: 'tool', tool_call_id: 'c2', content: '文件内容' })
    expect(ctx2.allToolCalls[0].status).toBe('done')

    const deps3 = baseDeps({
      pendingTool: { toolCall: { id: 'c1', name: 'shell', arguments: '{}' } },
      resume: { content: '', thinking: '', toolCalls: [{ id: 'c1', name: 'shell', arguments: '{}' }] },
    })
    const ctx3 = buildUltraContext(deps3)
    const messages3: UltraMessage[] = []
    prepareUltraMessages(ctx3, messages3, deps3, 'resume')
    expect(messages3).toHaveLength(1)
    expect(ctx3.allToolCalls).toHaveLength(1) // resume 已含同 id：只补 tool 消息，不重复入列表
  })

  it('round：Hermes 块注入为独立 system 消息；已有 system 头则追加；原 messages 数组不被污染', () => {
    const deps = baseDeps({ tools: [TOOL_READ], model: 'glm-4:free' })
    const ctx = buildUltraContext(deps)
    expect(ctx.hermesBlock).not.toBe('')
    const messages: UltraMessage[] = [{ role: 'user', content: 'hi' }]
    const prepared = prepareUltraMessages(ctx, messages, deps, 'round')
    expect(prepared.overflow).toBe(false)
    expect(prepared.reqMessages).toHaveLength(2)
    expect(prepared.reqMessages[0].role).toBe('system')
    expect(prepared.reqMessages[0].content).toBe(ctx.hermesBlock)
    expect(messages).toHaveLength(1)

    const messages2: UltraMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]
    const prepared2 = prepareUltraMessages(ctx, messages2, deps, 'round')
    expect(prepared2.reqMessages).toHaveLength(2)
    expect(prepared2.reqMessages[0].content).toBe('sys\n\n' + ctx.hermesBlock)
    expect(prepared2.reqMessages[1]).toBe(messages2[1])
  })

  it('round：无 Hermes 块时 reqMessages 与 messages 同引用（零拷贝路径）', () => {
    const deps = baseDeps()
    const ctx = buildUltraContext(deps)
    expect(ctx.hermesBlock).toBe('')
    const messages: UltraMessage[] = [{ role: 'user', content: 'hi' }]
    const prepared = prepareUltraMessages(ctx, messages, deps, 'round')
    expect(prepared.reqMessages).toBe(messages)
    expect(prepared.overflow).toBe(false)
  })

  it('round：溢出预检（≥0.92 窗口）标记 overflow 且消息原样返回（不压缩不裁剪）', () => {
    const deps = baseDeps({ contextWindow: 1000 })
    const ctx = buildUltraContext(deps)
    const messages = Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(2000) }))
    const prepared = prepareUltraMessages(ctx, messages, deps, 'round')
    expect(prepared.overflow).toBe(true)
    expect(messages).toHaveLength(5)
    expect(messages[0].content).toBe('x'.repeat(2000))
  })

  it('round：0.5 阈值触发压缩（消息数下降、token 下降），不触发溢出', () => {
    const deps = baseDeps({ contextWindow: 20000 })
    const ctx = buildUltraContext(deps)
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: '长'.repeat(500) + i }))
    const before = estimateMessagesTokens(messages)
    const prepared = prepareUltraMessages(ctx, messages, deps, 'round')
    expect(prepared.overflow).toBe(false)
    expect(messages.length).toBeLessThan(20)
    expect(estimateMessagesTokens(messages)).toBeLessThan(before)
  })
})

describe('gateUltraToolCalls / 阶段四：三层循环检测 + FSM 闸门 + Stuck', () => {
  it('循环检测：首次命中注入 STEP_BACK 自救且闸门照常放行；再次命中 exit 硬停', async () => {
    const deps = baseDeps({ tools: [TOOL_READ] })
    const ctx = buildUltraContext(deps)
    const fp = toolFingerprint('read_file', '{"path":"a.txt"}')
    for (let i = 0; i < 4; i++) ctx.toolLoop.add(fp)
    const messages: UltraMessage[] = []
    const gate = await gateUltraToolCalls(ctx, deps, messages, [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }], '', 0)
    expect(messages[0].content).toBe(STEP_BACK_MESSAGE)
    expect(gate.exit).toBeUndefined()
    expect(gate.continueLoop).toBeUndefined()
    expect(gate.plans).toHaveLength(1) // 自救轮不拦截执行
    expect(messages[1].role).toBe('assistant')

    const gate2 = await gateUltraToolCalls(ctx, deps, messages, [{ id: 'c2', name: 'read_file', arguments: '{"path":"a.txt"}' }], '', 1)
    expect(gate2.plans).toHaveLength(0)
    expect(gate2.exit).toMatchObject({ stopped: 'loop-detected', error: '循环检测硬停' })
  })

  it('无工具调用：assistant 有实质内容 → 自然结束 exit（无 stopped）；上一条是 tool 结果 → CONTINUE_PROMPT 续跑', async () => {
    const deps = baseDeps()
    const ctx = buildUltraContext(deps)
    const messages: UltraMessage[] = [{ role: 'assistant', content: '已完成全部修改' }]
    const gate = await gateUltraToolCalls(ctx, deps, messages, [], '', 0)
    expect(gate.exit).toMatchObject({ content: '', thinking: '', toolCalls: [] })
    expect(gate.exit!.stopped).toBeUndefined()
    expect(gate.continueLoop).toBeUndefined()

    const ctx2 = buildUltraContext(deps)
    const messages2: UltraMessage[] = [{ role: 'tool', tool_call_id: 'c1', content: '结果' }]
    const gate2 = await gateUltraToolCalls(ctx2, deps, messages2, [], '', 0)
    expect(gate2.continueLoop).toBe(true)
    expect(gate2.exit).toBeUndefined()
    expect(messages2[1].content).toBe(CONTINUE_PROMPT)
  })

  it('FSM 闸门：普通只读工具放行（decision=allow / scheduled）+ 第 5 次同签名调用被硬拦截', async () => {
    const deps = baseDeps()
    const ctx = buildUltraContext(deps)
    const messages: UltraMessage[] = [{ role: 'user', content: '读' }]
    const gate = await gateUltraToolCalls(ctx, deps, messages, [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }], '', 0)
    expect(gate.plans).toHaveLength(1)
    expect(gate.plans[0].decision).toBe('allow')
    expect(gate.plans[0].fsm.state).toBe('scheduled')
    expect(gate.plans[0].tc.status).toBe('running')
    expect(messages[1].tool_calls).toHaveLength(1) // assistant 入列在闸门之前

    // 首次闸门已计数 1 次，再补 4 次到硬阈值 5
    const sig = callSignature('read_file', '{"path":"a.txt"}')
    for (let i = 0; i < 4; i++) checkRepeatCall(ctx.repeatMap, sig)
    const gate2 = await gateUltraToolCalls(ctx, deps, messages, [{ id: 'c2', name: 'read_file', arguments: '{"path":"a.txt"}' }], '', 1)
    expect(gate2.plans).toHaveLength(0)
    expect(ctx.allToolCalls[0]).toMatchObject({ id: 'c2', status: 'error' })
    expect(String(ctx.allToolCalls[0].result)).toContain('❌')
    expect(messages[messages.length - 1].role).toBe('tool')
  })

  it('需要客户端契约：needsClient 命中抛 UltraNeedsClientError（messages/partial 随行）；confirmTool 拒绝走 error 分支不进 plans', async () => {
    const deps = baseDeps({ needsClient: () => 'confirm' as const })
    const ctx = buildUltraContext(deps)
    const messages: UltraMessage[] = [{ role: 'user', content: '读' }]
    const tcs: UltraToolCall[] = [
      { id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' },
      { id: 'c2', name: 'read_file', arguments: '{"path":"b.txt"}' },
    ]
    await expect(gateUltraToolCalls(ctx, deps, messages, tcs, '', 0)).rejects.toMatchObject({ name: 'NeedsClientError', kind: 'confirm' })
    expect(messages[1].role).toBe('assistant') // 抛出前 assistant 已入列（与原实现一致）

    const deps2 = baseDeps({ confirmTool: async () => '用户拒绝了本次执行' })
    const ctx2 = buildUltraContext(deps2)
    const gate2 = await gateUltraToolCalls(ctx2, deps2, [{ role: 'user', content: 'x' }], [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }], '', 0)
    expect(gate2.plans).toHaveLength(0)
    expect(gate2.exit).toBeUndefined()
    expect(ctx2.allToolCalls[0]).toMatchObject({ id: 'c1', status: 'error', result: '用户拒绝了本次执行' })
  })
})
