import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// mcp.cjs 是 CJS 旁加载模块（serve.ts 用 require 引入），这里用 createRequire 取纯函数测试。
// 覆盖 v14 新增的三件事：传输类型推断、服务级权限判定、SSE 分帧解析。
const require = createRequire(import.meta.url)
const mcp = require('../src/shared/mcp.cjs') as {
  serverType: (cfg: Record<string, unknown>) => string
  wildcardMatch: (p: string, n: string) => boolean
  checkPermission: (cfg: Record<string, unknown>, tool: string, tools: unknown[] | null) => string | null
  parseSseChunk: (buf: string) => [{ event: string; data: string }[], string]
}

describe('serverType（传输类型推断）', () => {
  it('显式 type 优先', () => {
    expect(mcp.serverType({ type: 'http', url: 'x', command: 'y' })).toBe('http')
    expect(mcp.serverType({ type: 'sse' })).toBe('sse')
    expect(mcp.serverType({ type: 'stdio' })).toBe('stdio')
  })
  it('只有 url 判为 http，只有 command 判为 stdio', () => {
    expect(mcp.serverType({ url: 'https://x/mcp' })).toBe('http')
    expect(mcp.serverType({ command: 'npx' })).toBe('stdio')
  })
  it('空配置回退 stdio（不炸）', () => {
    expect(mcp.serverType({})).toBe('stdio')
  })
})

describe('wildcardMatch', () => {
  it('精确与全通配', () => {
    expect(mcp.wildcardMatch('read_file', 'read_file')).toBe(true)
    expect(mcp.wildcardMatch('*', 'anything')).toBe(true)
    expect(mcp.wildcardMatch('read_file', 'read_files')).toBe(false)
  })
  it('前缀/后缀通配', () => {
    expect(mcp.wildcardMatch('read_*', 'read_file')).toBe(true)
    expect(mcp.wildcardMatch('*_file', 'read_file')).toBe(true)
    expect(mcp.wildcardMatch('*write*', 'bulk_write_all')).toBe(true)
    expect(mcp.wildcardMatch('read_*', 'write_file')).toBe(false)
  })
  it('正则元字符按字面处理（不会被当成模式）', () => {
    expect(mcp.wildcardMatch('a.b', 'axb')).toBe(false)
    expect(mcp.wildcardMatch('a.b', 'a.b')).toBe(true)
  })
})

describe('checkPermission（服务级权限）', () => {
  const tools = [
    { rawName: 'read_thing', readOnlyHint: true },
    { rawName: 'write_thing', readOnlyHint: false },
  ]
  it('无规则时放行', () => {
    expect(mcp.checkPermission({}, 'write_thing', tools)).toBeNull()
  })
  it('禁用清单优先于允许清单', () => {
    const r = mcp.checkPermission({ allowTools: ['*'], denyTools: ['write_*'] }, 'write_thing', tools)
    expect(r).toContain('已禁用')
  })
  it('允许清单非空时只放行匹配项', () => {
    expect(mcp.checkPermission({ allowTools: ['read_*'] }, 'read_thing', tools)).toBeNull()
    expect(mcp.checkPermission({ allowTools: ['read_*'] }, 'write_thing', tools)).toContain('只允许')
  })
  it('只读模式按 readOnlyHint 过滤', () => {
    expect(mcp.checkPermission({ readOnly: true }, 'read_thing', tools)).toBeNull()
    expect(mcp.checkPermission({ readOnly: true }, 'write_thing', tools)).toContain('只读')
  })
  it('只读模式下未知工具一律拦（宁可保守）', () => {
    expect(mcp.checkPermission({ readOnly: true }, 'mystery', tools)).toContain('只读')
    expect(mcp.checkPermission({ readOnly: true }, 'mystery', null)).toContain('只读')
  })
})

describe('parseSseChunk（SSE 分帧）', () => {
  it('单事件解析，剩余留在 rest', () => {
    const [evs, rest] = mcp.parseSseChunk('event: endpoint\ndata: /messages?x=1\n\nevent: message\ndata: {"a"')
    expect(evs).toHaveLength(1)
    expect(evs[0]).toEqual({ event: 'endpoint', data: '/messages?x=1' })
    expect(rest).toContain('{"a"')
  })
  it('多行 data 合并为一条（规范行为）', () => {
    const [evs] = mcp.parseSseChunk('data: line1\ndata: line2\n\n')
    expect(evs[0].data).toBe('line1\nline2')
  })
  it('无 event 字段默认 message', () => {
    const [evs] = mcp.parseSseChunk('data: {}\n\n')
    expect(evs[0].event).toBe('message')
  })
  it('半截帧不产生事件（等待后续 chunk）', () => {
    const [evs, rest] = mcp.parseSseChunk('event: message\ndata: {"id":1}')
    expect(evs).toHaveLength(0)
    expect(rest).toContain('{"id":1}')
  })
})
