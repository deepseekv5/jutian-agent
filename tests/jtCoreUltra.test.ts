import { describe, it, expect } from 'vitest'
import {
  ToolCallStateMachine, canTransition, TERMINAL_STATES, allReady,
  ultraBackoff, ultraQuotaDelay, ultraRetryable,
  ToolLoopDetector, ContentLoopDetector, toolFingerprint, shouldSemanticCheck,
  StuckDetector,
  fastNextSpeaker, parseNextSpeaker, resolveNextSpeaker,
  needsCompression, findCompressSplitPoint, ULTRA_MAX_TURNS,
} from '../src/shared/jtCoreUltra'
import {
  delayWithJitter, quotaDelay, decideRetry, isRetryableStatus, ModelFallback, DEFAULT_MAX_ATTEMPTS,
} from '../src/shared/ultra/retry'
import { LoopRecovery, STEP_BACK_MESSAGE, semanticInterval } from '../src/shared/ultra/loopDetection'
import { ToolCallStateMachine as FSM2, decidePolicy, ConfirmationBus, SerialRequestQueue, yieldIfBlocked, normalizeOutcome, LiveOutputBuffer } from '../src/shared/ultra/toolScheduler'
import { compress, collapseFunctionResponse, willOverflow, estimateTokens } from '../src/shared/ultra/chatCompression'
import { TurnBudget, boundedTurns, stopReasonOf, GeminiEventType, MAX_TURNS } from '../src/shared/ultra/turn'
import { resolveContextWindow, maxOutputTokens, trimToBudget, inputBudget } from '../src/shared/ultra/tokenBudget'
import { approvalFor, ApprovedScopes, SandboxEscalation, modeFromLevel } from '../src/shared/ultra/policy'
import { IdeContextStore, IgnoreMatcher, discoverFiles, clampOutput } from '../src/shared/ultra/context'

describe('toolScheduler / 七态 FSM（gemini-cli scheduler/state-manager）', () => {
  it('合法链 validating→scheduled→executing→success', () => {
    const f = new FSM2()
    f.transition('scheduled'); f.transition('executing', { liveOutput: '' }); f.transition('success', { result: 'ok' })
    expect(f.state).toBe('success'); expect(f.terminal).toBe(true); expect(f.history).toHaveLength(3)
  })
  it('非法跃迁 / 缺附属数据均抛错', () => {
    expect(() => new ToolCallStateMachine().transition('success', { result: 'x' })).toThrow(/非法/)
    expect(() => new FSM2().transition('executing')).toThrow() // validating→executing 本身即非法跃迁
  })
  it('TERMINAL_STATES 与 canTransition', () => {
    expect(TERMINAL_STATES.has('cancelled')).toBe(true)
    expect(canTransition('awaiting_approval', 'scheduled')).toBe(true)
    expect(canTransition('success', 'executing')).toBe(false)
  })
  it('全就绪屏障 + 阻塞让出 + 串行队列 + 确认总线', async () => {
    const mk = (state: any) => ({ tc: { id: '1', name: 'x', arguments: '{}' }, fsm: { state, terminal: TERMINAL_STATES.has(state as any) }, decision: 'allow' as const })
    expect(allReady([mk('scheduled'), mk('success')])).toBe(true)
    expect(allReady([mk('scheduled'), mk('awaiting_approval')])).toBe(false)
    const b = await yieldIfBlocked([mk('awaiting_approval')] as any, 1)
    expect(b.yielded).toBe(true)
    const bus = new ConfirmationBus()
    const p = bus.request('c1', '需要确认')
    expect(bus.size).toBe(1); bus.approve('c1'); expect(await p).toBe(true)
    const q = new SerialRequestQueue()
    const order: number[] = []
    await q.submit(async () => { order.push(1) }); await q.submit(async () => { order.push(2) })
    expect(order).toEqual([1, 2])
  })
  it('策略判定 / 实时输出 / 结果归一化', () => {
    expect(decidePolicy('shell', { confirmTools: new Set(['shell']) })).toBe('ask')
    expect(decidePolicy('shell', { yolo: true })).toBe('allow')
    expect(decidePolicy('shell', { denyTools: new Set(['shell']) })).toBe('deny')
    const lo = new LiveOutputBuffer(); lo.append('a'); lo.append('b'); expect(lo.text).toBe('ab')
    expect(normalizeOutcome({ id: 'i', name: 'n', arguments: '{}' }, 'o', false).state).toBe('success')
  })
})

describe('retry / 10 次抖动退避（gemini-cli utils/retry）', () => {
  it('5s→10s→20s→30s 封顶（rng=0.5 无抖动）', () => {
    const o = { rng: () => 0.5 }
    expect(ultraBackoff(1, o)).toBe(5000)
    expect(delayWithJitter(2, o)).toBe(10000)
    expect(delayWithJitter(3, o)).toBe(20000)
    expect(delayWithJitter(4, o)).toBe(30000)
    expect(delayWithJitter(9, o)).toBe(30000)
  })
  it('抖动上下界 ±30%', () => {
    expect(delayWithJitter(1, { rng: () => 0 })).toBeGreaterThanOrEqual(3500)
    expect(delayWithJitter(1, { rng: () => 1 })).toBeLessThanOrEqual(6500)
  })
  it('配额延迟尊重下限并向上 +20%', () => {
    expect(ultraQuotaDelay(null, { rng: () => 0.5 })).toBeGreaterThanOrEqual(5000)
    expect(quotaDelay(20000, { rng: () => 0 })).toBe(20000)
    expect(quotaDelay(20000, { rng: () => 1 })).toBeGreaterThan(20000)
  })
  it('429/499/5xx 可重试，400 永不重试 / 次数上限', () => {
    for (const s of [429, 499, 500, 502, 503, 504, 529]) expect(ultraRetryable(s)).toBe(true)
    for (const s of [400, 401, 403, 404, 422]) expect(ultraRetryable(s)).toBe(false)
    expect(isRetryableStatus(429)).toBe(true)
    expect(decideRetry(400, 1).retry).toBe(false)
    expect(decideRetry(429, DEFAULT_MAX_ATTEMPTS).retry).toBe(false)
    expect(decideRetry(429, 1, { rng: () => 0.5 }).delayMs).toBeGreaterThan(0)
  })
  it('模型回落有界', () => {
    const f = new ModelFallback(['a', 'b', 'c'], 2)
    expect(f.current).toBe('a'); expect(f.fallback()).toBe(true); expect(f.current).toBe('b')
    expect(f.fallback()).toBe(true) // 3 个模型可回落 2 次，第 3 次才 false
  })
})

describe('loopDetection / 三层 + 自救（gemini-cli loopDetectionService）', () => {
  it('工具周期：同一指纹连续 5 次触发', () => {
    const d = new ToolLoopDetector()
    const fp = toolFingerprint('shell', '{"command":"ls"}')
    for (let i = 0; i < 4; i++) expect(d.add(fp)).toBe(false)
    expect(d.add(fp)).toBe(true)
  })
  it('不同参数不误判 / reset 重新计数', () => {
    const d = new ToolLoopDetector()
    for (let i = 0; i < 5; i++) expect(d.add(toolFingerprint('shell', `ls ${i}`))).toBe(false)
    d.reset()
    const fp = toolFingerprint('shell', 'ls')
    for (let i = 0; i < 4; i++) d.add(fp)
    expect(d.add(fp)).toBe(true)
  })
  it('内容复读 10 次 / 不同内容不误判', () => {
    const d = new ContentLoopDetector(), chunk = 'x'.repeat(50)
    for (let i = 0; i < 9; i++) expect(d.add(chunk)).toBe(false)
    expect(d.add(chunk)).toBe(true)
    const e = new ContentLoopDetector()
    for (let i = 0; i < 12; i++) expect(e.add(String(i).repeat(50))).toBe(false)
  })
  it('LLM 层：30 轮后按动态间隔（置信度 0.9 → 11 轮）', () => {
    expect(semanticInterval(0.9)).toBe(11)
    expect(shouldSemanticCheck(29, 0, 0.9)).toBe(false)
    expect(shouldSemanticCheck(30, 0, 0.9)).toBe(true)
    expect(shouldSemanticCheck(35, 30, 0.9)).toBe(false)
    expect(shouldSemanticCheck(41, 30, 0.9)).toBe(true)
  })
  it('自救控制器：首次 nudge、第二次 stop', () => {
    const r = new LoopRecovery()
    expect(r.signal(false)).toBeNull()
    expect(r.signal(true)).toBe('nudge')
    expect(r.signal(true)).toBe('stop')
    expect(STEP_BACK_MESSAGE).toContain('换一种方法')
  })
})

describe('stuckDetector / 五场景（OpenHands SDK）', () => {
  it('重复 action / 同类错误（nudge 去重）/ 独白 / 交替 / 上下文溢出', () => {
    const a = new StuckDetector()
    for (let i = 0; i < 4; i++) a.push({ kind: 'action', sig: 'same', ok: true })
    expect(a.check()).toMatch(/重复/)
    const b = new StuckDetector()
    for (let i = 0; i < 3; i++) b.push({ kind: 'error', sig: 'ENOENT', ok: false })
    expect(b.check()).toMatch(/报错/)
    b.push({ kind: 'error', sig: 'ENOENT', ok: false }); expect(b.check()).toBeNull()
    const c = new StuckDetector()
    for (let i = 0; i < 3; i++) c.push({ kind: 'message', sig: 'm', ok: true })
    expect(c.check()).toMatch(/文字/)
    const d = new StuckDetector()
    for (let i = 0; i < 8; i++) d.push({ kind: i % 2 ? 'observation' : 'action', sig: 'x', ok: true })
    expect(d.check()).toMatch(/交替/)
    const e = new StuckDetector()
    for (let i = 0; i < 10; i++) e.push({ kind: 'error', sig: 'context window overflow', ok: false })
    expect(e.check()).toMatch(/溢出/)
  })
  it('正常混合不误判', () => {
    const d = new StuckDetector()
    d.push({ kind: 'action', sig: 'a', ok: true }); d.push({ kind: 'observation', sig: 'b', ok: true }); d.push({ kind: 'message', sig: 'c', ok: true })
    expect(d.check()).toBeNull()
  })
})

describe('nextSpeaker（gemini-cli nextSpeakerChecker）', () => {
  it('工具结果 / 空模型填充 → model；待处理工具 / 配额错误 / skip → null', () => {
    expect(fastNextSpeaker({ pendingTools: 0, quotaError: false, skip: false, lastMessageRole: 'tool' })).toBe('model')
    expect(fastNextSpeaker({ pendingTools: 0, quotaError: false, skip: false, lastMessageRole: 'assistant', lastMessageContent: '' })).toBe('model')
    expect(fastNextSpeaker({ pendingTools: 1, quotaError: false, skip: false, lastMessageRole: 'tool' })).toBeNull()
    expect(fastNextSpeaker({ pendingTools: 0, quotaError: true, skip: false, lastMessageRole: 'tool' })).toBeNull()
  })
  it('结构化解析 / 保守兜底 user', () => {
    expect(parseNextSpeaker('{"next_speaker":"model"}')).toBe('model')
    expect(parseNextSpeaker('model')).toBe('model')
    expect(parseNextSpeaker('bad')).toBeNull()
    expect(resolveNextSpeaker({ pendingTools: 0, quotaError: false, skip: false, lastMessageRole: 'assistant', lastMessageContent: 'done' })).toBe('user')
  })
})

describe('chatCompression（gemini-cli chatCompressionService）', () => {
  it('阈值触发 / 切分保护 3 轮 / 折叠 / 溢出预检', () => {
    expect(needsCompression(Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: '短' + i })), 100000)).toBe(false)
    const long = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: '长'.repeat(2000) + i }))
    expect(needsCompression(long, 10000)).toBe(true)
    const msgs = Array.from({ length: 20 }, (_, i) => ({ role: i % 5 === 0 ? 'user' : 'assistant', content: 'x' }))
    expect(findCompressSplitPoint(msgs)).toBeLessThanOrEqual(6)
    expect(collapseFunctionResponse('x'.repeat(10000)).length).toBeLessThan(3000)
    const r = compress(long, 10000)
    expect(r.status).toBe('compressed'); expect(r.messages.length).toBeLessThan(10)
    expect(willOverflow(long, 10000, 0)).toBe(true)
    expect(estimateTokens('中文abc')).toBeGreaterThan(0)
  })
})

describe('turn / tokenBudget / policy / context', () => {
  it('MAX_TURNS=100 / 会话预算 / 退出映射', () => {
    expect(ULTRA_MAX_TURNS).toBe(100); expect(MAX_TURNS).toBe(100)
    expect(boundedTurns(500)).toBe(100)
    const b = new TurnBudget(2)
    expect(b.next()).toBe(100); b.consume(); b.consume(); expect(b.next()).toBe(0); expect(b.exhausted).toBe(true)
    expect(stopReasonOf(GeminiEventType.LoopDetected)).toBe('loop-detected')
    expect(stopReasonOf(GeminiEventType.UserCancelled)).toBe('aborted')
  })
  it('模型上限表 / max_tokens / 输入裁剪', () => {
    expect(resolveContextWindow('gemini-2.5-pro')).toBe(1048576)
    expect(resolveContextWindow('unknown', 64000)).toBe(64000)
    expect(maxOutputTokens(128000)).toBeGreaterThan(1024)
    expect(inputBudget(100)).toBe(80)
    const msgs = [{ role: 'system', content: 's' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: 'x'.repeat(500) + i }))]
    const t = trimToBudget(msgs, 1000, arr => arr.reduce((s, m) => s + m.content.length, 0))
    expect(t.dropped).toBeGreaterThan(0); expect(t.messages[0].role).toBe('system')
  })
  it('审批四态 / 沙箱升级一次 / 作用域键 / 档位映射', () => {
    const dangerous = new Set(['shell'])
    expect(approvalFor('shell', 'always', dangerous, new Set())).toBe('NeedsApproval')
    expect(approvalFor('shell', 'never', dangerous, new Set())).toBe('Skip')
    expect(approvalFor('x', 'on-failure', dangerous, new Set(['x']))).toBe('Forbidden')
    const s = new SandboxEscalation()
    expect(s.firstAttempt().level).toBe('standard'); expect(s.onSandboxDenial()?.level).toBe('full'); expect(s.onSandboxDenial()).toBeNull()
    const a = new ApprovedScopes()
    const k = a.scopeKeyOf('shell', { command: 'ls' }); a.approve(k); expect(a.isApproved(k)).toBe(true)
    expect(modeFromLevel('full')).toBe('never'); expect(modeFromLevel('ask')).toBe('always')
  })
  it('IDE 上下文 / gitignore / 文件发现 / 输出折叠', () => {
    const ide = new IdeContextStore()
    ide.set({ path: 'src/a.ts', isActive: true, cursor: { line: 3, character: 0 }, selectedText: 'foo' })
    expect(ide.toPromptBlock()).toContain('src/a.ts')
    const m = new IgnoreMatcher(['node_modules', '*.log'])
    expect(m.isIgnored('node_modules/x/index.js')).toBe(true)
    expect(m.isIgnored('app.log')).toBe(true)
    expect(m.isIgnored('src/a.ts')).toBe(false)
    expect(discoverFiles(['src/a.ts', 'node_modules/x', 'app.log'], m)).toEqual(['src/a.ts'])
    expect(clampOutput('x'.repeat(50000), 1000)).toContain('省略')
  })
})

describe('runUltraLoop 端到端（mock SSE，真实编排）', () => {
  it('一轮带工具调用 → 工具结果回灌 → 第二轮自然收尾，事件齐全', async () => {
    const { runUltraLoop } = await import('../src/shared/jtCoreUltra')
    let call = 0
    const events: string[] = []
    const enc = new TextEncoder()
    const sse = (chunks: any[]) => new Response(new ReadableStream({
      start(c) { for (const ch of chunks) c.enqueue(enc.encode('data: ' + JSON.stringify(ch) + '\n\n')); c.close() },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    const deps = {
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
      model: 'test-model', apiBase: 'http://x', contextWindow: 128000,
      callLLM: async () => {
        call++
        if (call === 1) return sse([
          { choices: [{ delta: { content: '先读文件' } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] }, finish_reason: 'tool_calls' }] },
        ])
        return sse([{ choices: [{ delta: { content: '文件内容是 OK' } }] }])
      },
      runTool: async (name: string, args: any) => ({ success: true, output: `内容:${args.path}` }),
      isClientTool: () => false,
      needsClient: () => null,
      events: {
        onChunk: (t: string) => events.push('chunk:' + t),
        onToolStart: () => events.push('tool_start'),
        onToolEnd: () => events.push('tool_end'),
        onToolDraft: () => events.push('draft'),
        onPerf: () => events.push('perf'),
      },
    } as any
    const r = await runUltraLoop([{ role: 'user', content: '读 a.txt' }], deps)
    expect(call).toBeGreaterThanOrEqual(2)
    expect(r.content).toContain('先读文件')
    expect(r.content).toContain('文件内容是 OK')
    expect(r.toolCalls).toHaveLength(1)
    expect(r.toolCalls[0].result).toContain('内容:a.txt')
    expect(events).toContain('tool_start')
    expect(events).toContain('tool_end')
    expect(r.stopped).toBeUndefined()
  })

  it('needs_client 契约：危险工具抛 UltraNeedsClientError（name=NeedsClientError）', async () => {
    const { runUltraLoop } = await import('../src/shared/jtCoreUltra')
    const enc = new TextEncoder()
    const sse = () => new Response(new ReadableStream({
      start(c) { c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'shell', arguments: '{"command":"ls"}' } }] }, finish_reason: 'tool_calls' }] }) + '\n\n')); c.close() },
    }), { status: 200 })
    const deps = {
      tools: [{ name: 'shell', description: 'sh', parameters: {} }],
      model: 'm', apiBase: 'x',
      callLLM: async () => sse(),
      runTool: async () => ({ success: true, output: '' }),
      isClientTool: () => false,
      needsClient: () => 'confirm' as const,
      events: {},
    } as any
    await expect(runUltraLoop([{ role: 'user', content: 'ls' }], deps)).rejects.toMatchObject({ name: 'NeedsClientError', kind: 'confirm' })
  })
})

describe('prompts / 系统提示词全量移植（gemini-cli prompts/）', () => {
  it('buildUltraSystemPrompt 含全部关键段落', async () => {
    const P = await import('../src/shared/ultra/prompts')
    const p = P.buildUltraSystemPrompt({ model: 'gemini-3-pro', workDir: '/w', skills: [{ name: 'pdf', description: 'PDF skill' }], memory: '偏好中文', interactive: true })
    expect(p).toContain('Core Mandates')
    expect(p).toContain('安全与系统完整性')
    expect(p).toContain('上下文效率')
    expect(p).toContain('工程规范')
    expect(p).toContain('Operational Guidelines')
    expect(p).toContain('工具结果响应规则')
    expect(p).toContain('指令与记忆文件')
    expect(p).toContain('文件路径规则')
    expect(p).toContain('Primary Workflows')
    expect(p).toContain('Contextual Instructions')
    expect(p).toContain('/w')
    expect(p).toContain('偏好中文')
    expect(p).toContain('pdf')
    expect(p).not.toContain('Final Reminder') // modern 模型分支
  })
  it('legacy 分支含 Final Reminder；Plan Mode 替换工作流', async () => {
    const P = await import('../src/shared/ultra/prompts')
    expect(P.buildUltraSystemPrompt({ modern: false })).toContain('Final Reminder')
    const plan = P.buildUltraSystemPrompt({ planMode: true })
    expect(plan).toContain('Active Approval Mode: Plan')
    expect(plan).not.toContain('Primary Workflows')
    expect(P.renderPlanningWorkflow()).toContain('只读')
  })
  it('逐段开关 / 上下文优先级 / 工具名表', async () => {
    const P = await import('../src/shared/ultra/prompts')
    const p = P.buildUltraSystemPrompt({ disabledSections: new Set(['tone', 'git']) })
    expect(p).not.toContain('语气与风格')
    expect(p).toContain('Core Mandates')
    expect(P.ALL_BUILTIN_TOOL_NAMES).toContain('grep_search')
    expect(P.PLAN_MODE_TOOLS).toContain('glob')
    expect(P.TOOLS_REQUIRING_NARROWING.has('replace')).toBe(true)
    expect(P.formatToolName('glob')).toBe('`glob`')
  })
  it('三个 utility 提示词 + 字面量', async () => {
    const P = await import('../src/shared/ultra/prompts')
    expect(P.NEXT_SPEAKER_CHECK_PROMPT).toContain('Model Continues')
    expect(P.NEXT_SPEAKER_RESPONSE_SCHEMA.required).toContain('next_speaker')
    expect(P.LOOP_DETECTION_SYSTEM_PROMPT).toContain('What is NOT an unproductive state')
    expect(P.LOOP_DETECTION_TASK_PROMPT).toContain('batch work')
    expect(P.getCompressionPrompt()).toContain('<state_snapshot>')
    expect(P.getCompressionPrompt('p.md')).toContain('APPROVED PLAN PRESERVATION')
    expect(P.compressionAnchorInstruction(true)).toContain('integrate')
    expect(P.COMPRESSION_PROBE_PROMPT).toContain('Critically evaluate')
    expect(P.stepBackMessage('Repeated tool call')).toContain('take a step back')
    expect(P.PLEASE_CONTINUE).toBe('Please continue.')
    expect(P.supportsModernFeatures('gemini-3-pro')).toBe(true)
    expect(P.supportsModernFeatures('old')).toBe(false)
  })
})

describe('tools / gemini-cli 工具集移植', () => {
  it('21 个工具定义 + 别名 + 参数归一化', async () => {
    const T = await import('../src/shared/ultra/tools')
    expect(T.GEMINI_TOOL_DEFS.length).toBe(21)
    expect(T.GEMINI_TOOL_DEFS.find(t => t.name === 'replace')).toBeTruthy()
    expect(T.GEMINI_TOOL_DEFS.find(t => t.name === 'run_shell_command')).toBeTruthy()
    expect(Object.keys(T.TOOL_ALIASES).length).toBe(21)
    expect(T.getToolSet('gemini-3').length).toBe(21)
    expect(T.ultraToolsForModel().length).toBe(21)
    expect(T.normalizeArgs('replace', { file_path: 'a.ts', old_string: 'x', new_string: 'y', allow_multiple: true }))
      .toMatchObject({ path: 'a.ts', oldText: 'x', newText: 'y', replaceAll: true })
    expect(T.normalizeArgs('read_file', { file_path: 'a', start_line: 3, end_line: 7 }))
      .toMatchObject({ path: 'a', offset: 2, limit: 5 })
  })
})
