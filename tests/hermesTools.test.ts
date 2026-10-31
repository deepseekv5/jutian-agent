import { describe, it, expect } from 'vitest'
import {
  buildToolsBlock, parseHermesToolCalls, stripToolCallBlocks,
} from '../src/shared/hermesTools'

// Hermes 文本协议（v13.9.2，移植自 NousResearch/Hermes-Function-Calling 语义）：
// 免费小模型多被 Hermes 格式训练过，标准 tool_calls 用不了时走文本协议。
// 解析器必须容错：坏 JSON 单条跳过、缺引号键补齐、正文剥离干净。

describe('buildToolsBlock', () => {
  it('空工具返回空串（不注入）', () => {
    expect(buildToolsBlock([])).toBe('')
  })
  it('工具 schema 以 JSON 注入 <tools> 块', () => {
    const block = buildToolsBlock([{ name: 'list_dir', description: '列出目录', parameters: { type: 'object' } }])
    expect(block).toContain('<tools>')
    expect(block).toContain('"list_dir"')
    expect(block).toContain('<tool_call>')
  })
})

describe('parseHermesToolCalls', () => {
  it('标准单调用解析', () => {
    const calls = parseHermesToolCalls('好的。<tool_call>{"name": "list_dir", "arguments": {"path": "."}}</tool_call>')
    expect(calls).toEqual([{ name: 'list_dir', arguments: '{"path":"."}' }])
  })
  it('多调用解析（参数为对象时序列化）', () => {
    const text = '<tool_call>{"name":"a","arguments":{"x":1}}</tool_call>\n<tool_call>{"name":"b","arguments":{"y":2}}</tool_call>'
    expect(parseHermesToolCalls(text).map(c => c.name)).toEqual(['a', 'b'])
  })
  it('键没加引号的伪 JSON 可容错解析', () => {
    const calls = parseHermesToolCalls('<tool_call>{name: "shell", arguments: {command: "ls"}}</tool_call>')
    expect(calls[0]?.name).toBe('shell')
  })
  it('坏 JSON 单条跳过不炸整轮', () => {
    const calls = parseHermesToolCalls('<tool_call>{{{坏}}</tool_call>\n<tool_call>{"name":"ok","arguments":{}}</tool_call>')
    expect(calls.map(c => c.name)).toEqual(['ok'])
  })
  it('无 name 的调用跳过', () => {
    expect(parseHermesToolCalls('<tool_call>{"arguments":{}}</tool_call>')).toEqual([])
  })
  it('无 <tool_call> 的正文返回空', () => {
    expect(parseHermesToolCalls('普通回复，没有任何调用')).toEqual([])
  })
})

describe('stripToolCallBlocks', () => {
  it('剥离调用块并压缩空行', () => {
    const out = stripToolCallBlocks('答案开头\n<tool_call>{"name":"a","arguments":{}}</tool_call>\n\n\n答案结尾')
    expect(out).toBe('答案开头\n\n答案结尾')
  })
  it('无调用块的正文原样返回', () => {
    expect(stripToolCallBlocks('普通正文')).toBe('普通正文')
  })
})
