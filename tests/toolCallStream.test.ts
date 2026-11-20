/**
 * 工具调用流式累积的回归测试
 *
 * 重点防的是 id/name 被误当增量拼接：部分兼容网关会在多个 chunk 里
 * 重复下发同一个 id，拼接后会得到 `call_abc123call_abc123` —— tool result
 * 的 tool_call_id 匹配不上，模型以为工具没执行过，表现为反复调同一工具。
 *
 * v18.1.1 追加：畸形 delta 容错（undefined/空串/已解析对象 arguments）、
 * 非流式快照路径的非法 JSON 容错（跳过坏调用、保留其它）、
 * 同一 chunk 多索引混序到达的分桶正确性。
 */
import { describe, it, expect } from 'vitest'
import {
  parseToolCallsFromDelta,
  accumulateToolCallDelta,
  adoptNonStreamToolCalls,
  toolCallsToArray,
  type ToolCallAccum,
} from '../src/renderer/engine/toolCallStream'

const map = () => new Map<number, ToolCallAccum>()

describe('parseToolCallsFromDelta', () => {
  it('解析标准 OpenAI 的 delta.tool_calls', () => {
    const r = parseToolCallsFromDelta({
      tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"pa' } }],
    })
    expect(r).toHaveLength(1)
    expect(r![0].id).toBe('call_a')
    expect(r![0].function?.name).toBe('read_file')
  })

  it('兼容单函数 function_call 格式（无 index，按 0 处理）', () => {
    const r = parseToolCallsFromDelta({
      function_call: { name: 'shell', arguments: '{}' },
    })
    expect(r).toEqual([{ index: 0, id: undefined, function: { name: 'shell', arguments: '{}' } }])
  })

  it('无工具字段时返回 null', () => {
    expect(parseToolCallsFromDelta({ content: 'hello' })).toBeNull()
    expect(parseToolCallsFromDelta(null)).toBeNull()
    expect(parseToolCallsFromDelta(undefined)).toBeNull()
  })

  it('同一 delta 携带多个 tool_calls（并行调用首块）', () => {
    // 并行多工具的首块常在一个 delta 里同时带 0/1/2 号调用
    const r = parseToolCallsFromDelta({
      tool_calls: [
        { index: 0, id: 'c0', function: { name: 'read_file', arguments: '' } },
        { index: 1, id: 'c1', function: { name: 'shell', arguments: '' } },
        { index: 2, id: 'c2', function: { name: 'write_file', arguments: '' } },
      ],
    })
    expect(r).toHaveLength(3)
    expect(r!.map(t => t.index)).toEqual([0, 1, 2])
  })
})

describe('accumulateToolCallDelta', () => {
  it('首块给 id 与 name，后续块补 arguments', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'call_a', function: { name: 'write_file', arguments: '' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: '{"path":' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: '"a.txt"}' } })
    expect(m.get(0)).toEqual({ id: 'call_a', name: 'write_file', arguments: '{"path":"a.txt"}' })
  })

  it('id 被网关重复下发时不拼接（回归：曾产生 call_xxcall_xx）', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'call_abc123', function: { name: 'shell' } })
    // 兼容网关常见的重发
    accumulateToolCallDelta(m, { index: 0, id: 'call_abc123', function: { arguments: '{"cmd"' } })
    accumulateToolCallDelta(m, { index: 0, id: 'call_abc123', function: { arguments: ':"ls"}' } })
    expect(m.get(0)!.id).toBe('call_abc123')
    expect(m.get(0)!.arguments).toBe('{"cmd":"ls"}')
  })

  it('函数名重复下发时不被覆盖或拼接', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 0, function: { name: 'read_file' } })
    accumulateToolCallDelta(m, { index: 0, function: { name: 'read_file', arguments: '{}' } })
    expect(m.get(0)!.name).toBe('read_file')
  })

  it('并行多工具按 index 分槽，互不串扰', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'c0', function: { name: 'read_file', arguments: '{"p":"a"' } })
    accumulateToolCallDelta(m, { index: 1, id: 'c1', function: { name: 'shell', arguments: '{"c":"ls"' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: '}' } })
    accumulateToolCallDelta(m, { index: 1, function: { arguments: '}' } })
    expect(m.get(0)).toEqual({ id: 'c0', name: 'read_file', arguments: '{"p":"a"}' })
    expect(m.get(1)).toEqual({ id: 'c1', name: 'shell', arguments: '{"c":"ls"}' })
  })

  it('缺 index 的片段落到 0 号槽', () => {
    const m = map()
    accumulateToolCallDelta(m, { function: { name: 'shell', arguments: '{}' } })
    expect(m.get(0)!.name).toBe('shell')
  })

  it('index 为非数字（如字符串 "0"）回落到 0 号槽，不产生幽灵分桶', () => {
    // 个别网关把 index 下发成字符串：若照收会造出独立的 '0' 槽，参数全丢
    const m = map()
    accumulateToolCallDelta(m, { index: '0' as unknown as number, id: 'c', function: { name: 'shell', arguments: '{}' } })
    expect(m.size).toBe(1)
    expect(m.get(0)!.name).toBe('shell')
  })

  it('tool_calls 片段为 null / 非对象时不崩、不影响已有槽位', () => {
    // 个别上游会在 tool_calls 数组里混入坏项，绝不能让整轮崩掉
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'c0', function: { name: 'shell', arguments: '{}' } })
    accumulateToolCallDelta(m, null as unknown as never)
    accumulateToolCallDelta(m, undefined as unknown as never)
    accumulateToolCallDelta(m, 'garbage' as unknown as never)
    expect(m.get(0)!.arguments).toBe('{}')
    expect(m.size).toBe(1)
  })
})

describe('accumulateToolCallDelta：arguments 畸形形态容错', () => {
  it('arguments 为 undefined / 空串 / 缺 function 时不产生 "undefined" 拼接', () => {
    // 三种空片在真实上游都见过：缺 function 的首块、显式 undefined、空串补位
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'call_x', function: { name: 'shell' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: undefined } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: '' } })
    accumulateToolCallDelta(m, { index: 0 })
    expect(m.get(0)).toEqual({ id: 'call_x', name: 'shell', arguments: '' })
    expect(m.get(0)!.arguments).not.toContain('undefined')
  })

  it('arguments 为已解析对象（个别网关快照）→ 序列化后整体替换', () => {
    // 若按字符串拼接会得到 "[object Object]" 或触发数字相加，参数全毁
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'c', function: { name: 'shell' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: { command: 'ls -la' } as unknown as string } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: { command: 'pwd' } as unknown as string } })
    const slot = m.get(0)!
    expect(JSON.parse(slot.arguments)).toEqual({ command: 'pwd' })
    expect(slot.arguments).not.toContain('Object')
  })

  it('对象快照之后到达的字符串快照仍按快照替换（argsComplete 生效）', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'c', function: { name: 'shell' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: { command: 'a' } as unknown as string } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: '{"command":"b"}' } })
    expect(JSON.parse(m.get(0)!.arguments)).toEqual({ command: 'b' })
  })
})

describe('adoptNonStreamToolCalls 容错（全量快照路径）', () => {
  it('累积表为空时采用非流式 message.tool_calls', () => {
    const m = map()
    adoptNonStreamToolCalls(m, [{ index: 0, id: 'x', function: { name: 'shell', arguments: '{}' } }])
    expect(m.get(0)!.id).toBe('x')
  })

  it('累积表已有内容时不覆盖（流式优先）', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'streamed', function: { name: 'a', arguments: '{}' } })
    adoptNonStreamToolCalls(m, [{ index: 0, id: 'ignored', function: { name: 'b', arguments: '{}' } }])
    expect(m.get(0)!.id).toBe('streamed')
  })

  it('非数组输入安全忽略', () => {
    const m = map()
    adoptNonStreamToolCalls(m, undefined)
    adoptNonStreamToolCalls(m, 'nope')
    expect(m.size).toBe(0)
  })

  it('非法 JSON arguments → 跳过该调用、保留其它调用（整轮不崩）', () => {
    // 历史教训（spark-x2.6 快照损坏）：损坏参数的调用执行必然失败，
    // 正确做法是跳过它，绝不能让同批可用的调用陪葬
    const m = map()
    adoptNonStreamToolCalls(m, [
      { index: 0, id: 'ok1', function: { name: 'shell', arguments: '{"command":"ls"}' } },
      { index: 1, id: 'bad', function: { name: 'shell', arguments: '{"command":ls}' } },
      { index: 2, id: 'ok2', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
    ])
    expect([...m.keys()].sort()).toEqual([0, 2])
    expect(m.get(0)!.name).toBe('shell')
    expect(m.get(2)!.name).toBe('read_file')
  })

  it('数组混入 null / 非对象 / 无函数名项 → 跳过不崩，保留其它', () => {
    const m = map()
    adoptNonStreamToolCalls(m, [
      null,
      'garbage',
      { index: 0, id: 'noname', function: { arguments: '{}' } },
      { index: 1, id: 'ok', function: { name: 'shell', arguments: '{}' } },
    ] as unknown[])
    expect(m.size).toBe(1)
    expect(m.get(1)!.id).toBe('ok')
  })

  it('arguments 为已解析对象 → 序列化采用', () => {
    const m = map()
    adoptNonStreamToolCalls(m, [{ index: 0, id: 'c', function: { name: 'shell', arguments: { command: 'ls' } as unknown as string } }])
    expect(JSON.parse(m.get(0)!.arguments)).toEqual({ command: 'ls' })
  })

  it('空串 arguments 的无参工具保留（不误判为损坏）', () => {
    // 无参工具（如 time）合法 arguments 就是空串，不能被 JSON 校验误杀
    const m = map()
    adoptNonStreamToolCalls(m, [{ index: 0, id: 't', function: { name: 'time', arguments: '' } }])
    expect(m.get(0)!.arguments).toBe('')
    expect(m.get(0)!.name).toBe('time')
  })

  it('缺 index 的多个调用按数组位置分桶（旧实现全挤 0 号槽互相覆盖）', () => {
    // message.tool_calls 常不带 index：旧行为 index ?? 0 会让三个调用只剩最后一个
    const m = map()
    adoptNonStreamToolCalls(m, [
      { id: 'a', function: { name: 'first', arguments: '{}' } },
      { id: 'b', function: { name: 'second', arguments: '{}' } },
      { id: 'c', function: { name: 'third', arguments: '{}' } },
    ])
    expect(toolCallsToArray(m).map(t => t.name)).toEqual(['first', 'second', 'third'])
  })
})

describe('多索引并发混序（同一 chunk / 相邻 chunk 乱序到达）', () => {
  it('index 0/1/2 混序到达，按 index 分桶累积正确', () => {
    const m = map()
    // 乱序：先 1、再 0、再 2，随后各槽的后续分片继续乱序补齐
    accumulateToolCallDelta(m, { index: 1, id: 'c1', function: { name: 'shell', arguments: '{"c"' } })
    accumulateToolCallDelta(m, { index: 0, id: 'c0', function: { name: 'read_file', arguments: '{"p"' } })
    accumulateToolCallDelta(m, { index: 2, id: 'c2', function: { name: 'write_file', arguments: '' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: ':"a.txt"}' } })
    accumulateToolCallDelta(m, { index: 1, function: { arguments: ':"ls -la"}' } })
    accumulateToolCallDelta(m, { index: 2, function: { arguments: '{"path":"x.txt"}' } })
    expect(m.get(0)).toEqual({ id: 'c0', name: 'read_file', arguments: '{"p":"a.txt"}' })
    expect(m.get(1)).toEqual({ id: 'c1', name: 'shell', arguments: '{"c":"ls -la"}' })
    expect(m.get(2)).toEqual({ id: 'c2', name: 'write_file', arguments: '{"path":"x.txt"}' })
  })

  it('id/name 晚于 arguments 到达（首块只给 args 的网关）', () => {
    // 少数网关首块不带 id/name，只在中间某块补发：整值语义按首次非空采纳
    const m = map()
    accumulateToolCallDelta(m, { index: 0, function: { arguments: '{"c"' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: ':"ls"}' } })
    accumulateToolCallDelta(m, { index: 0, id: 'late_id', function: { name: 'late_name' } })
    const slot = m.get(0)!
    expect(slot.id).toBe('late_id')
    expect(slot.name).toBe('late_name')
    expect(slot.arguments).toBe('{"c":"ls"}')
  })

  it('parse + accumulate 全链路：一个 chunk 多索引混序 → toolCallsToArray 顺序正确', () => {
    // 模拟 agentLoop 的真实消费路径：parseToolCallsFromDelta → accumulate 循环
    const m = map()
    const delta = {
      tool_calls: [
        { index: 2, id: 'c2', function: { name: 'third', arguments: '{"z"' } },
        { index: 0, id: 'c0', function: { name: 'first', arguments: '{"a":1}' } },
        { index: 1, id: 'c1', function: { name: 'second', arguments: '{"b"' } },
      ],
    }
    for (const tc of parseToolCallsFromDelta(delta)!) accumulateToolCallDelta(m, tc)
    accumulateToolCallDelta(m, { index: 2, function: { arguments: ':2}' } })
    accumulateToolCallDelta(m, { index: 1, function: { arguments: ':2}' } })
    expect(toolCallsToArray(m).map(t => t.name)).toEqual(['first', 'second', 'third'])
    expect(JSON.parse(m.get(2)!.arguments)).toEqual({ z: 2 })
    expect(JSON.parse(m.get(1)!.arguments)).toEqual({ b: 2 })
    expect(JSON.parse(m.get(0)!.arguments)).toEqual({ a: 1 })
  })

  it('混序 + 快照型上游：1 号槽快照替换不影响 0 号槽增量', () => {
    // 并行调用里两家行为不同：0 号增量分片、1 号全量快照，互不串扰
    const m = map()
    accumulateToolCallDelta(m, { index: 0, id: 'c0', function: { name: 'a', arguments: '{"x"' } })
    accumulateToolCallDelta(m, { index: 1, id: 'c1', function: { name: 'b', arguments: '{"y":1}' } })
    accumulateToolCallDelta(m, { index: 0, function: { arguments: ':1}' } })
    accumulateToolCallDelta(m, { index: 1, function: { arguments: '{"y":1, "z":2}' } })
    expect(JSON.parse(m.get(0)!.arguments)).toEqual({ x: 1 })
    expect(JSON.parse(m.get(1)!.arguments)).toEqual({ y: 1, z: 2 })
  })
})

describe('toolCallsToArray', () => {
  it('按 index 升序输出，保证与模型给出的调用顺序一致', () => {
    const m = map()
    accumulateToolCallDelta(m, { index: 2, id: 'c2', function: { name: 'third' } })
    accumulateToolCallDelta(m, { index: 0, id: 'c0', function: { name: 'first' } })
    accumulateToolCallDelta(m, { index: 1, id: 'c1', function: { name: 'second' } })
    expect(toolCallsToArray(m).map(t => t.name)).toEqual(['first', 'second', 'third'])
  })

  it('空表返回空数组', () => {
    expect(toolCallsToArray(map())).toEqual([])
  })
})

describe('快照型上游（spark-x2.6 实测）：每个 delta 都是完整 arguments', () => {
  it('重复全量快照 → 取最后一份完整对象，不拼接', () => {
    const map = new Map()
    accumulateToolCallDelta(map, { index: 0, id: 'call_1', function: { name: 'shell', arguments: '{"command":"echo jt-ok"}' } })
    accumulateToolCallDelta(map, { index: 0, function: { arguments: '{"command": "echo jt-ok"}' } })
    accumulateToolCallDelta(map, { index: 0, function: { arguments: '{"command":"echo jt-ok"}' } })
    const acc = toolCallsToArray(map)[0]
    expect(acc.name).toBe('shell')
    expect(() => JSON.parse(acc.arguments)).not.toThrow()
    expect(JSON.parse(acc.arguments).command).toBe('echo jt-ok')
  })

  it('正常增量分片不受影响', () => {
    const map = new Map()
    accumulateToolCallDelta(map, { index: 0, id: 'call_2', function: { name: 'shell', arguments: '{"comm' } })
    accumulateToolCallDelta(map, { index: 0, function: { arguments: 'and":"ls -la"}' } })
    const acc = toolCallsToArray(map)[0]
    expect(JSON.parse(acc.arguments).command).toBe('ls -la')
  })

  it('嵌套对象开头的分片不被误判为快照', () => {
    const map = new Map()
    accumulateToolCallDelta(map, { index: 0, id: 'c', function: { name: 'write_file', arguments: '{"path":"a.json","content":{"x"' } })
    accumulateToolCallDelta(map, { index: 0, function: { arguments: ':1}' } })
    accumulateToolCallDelta(map, { index: 0, function: { arguments: '}' } })
    const acc = toolCallsToArray(map)[0]
    expect(JSON.parse(acc.arguments).content.x).toBe(1)
  })
})
