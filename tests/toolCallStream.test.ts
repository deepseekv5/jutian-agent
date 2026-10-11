/**
 * 工具调用流式累积的回归测试
 *
 * 重点防的是 id/name 被误当增量拼接：部分兼容网关会在多个 chunk 里
 * 重复下发同一个 id，拼接后会得到 `call_abc123call_abc123` —— tool result
 * 的 tool_call_id 匹配不上，模型以为工具没执行过，表现为反复调同一工具。
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
})

describe('adoptNonStreamToolCalls', () => {
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
