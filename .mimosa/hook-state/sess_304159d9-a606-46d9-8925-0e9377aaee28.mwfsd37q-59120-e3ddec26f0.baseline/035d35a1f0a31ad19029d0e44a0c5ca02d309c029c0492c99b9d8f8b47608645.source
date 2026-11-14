import { describe, it, expect } from 'vitest'
import { MCP_PRESETS, buildPresetServer, isOneClick } from '../src/shared/mcpPresets'

// MCP 推荐服务（v14）：一键装官方 server。数据层面的契约——
// 预设字段必须与 /api/mcp/servers 的入参一致，否则「一键」会静默失败。

describe('MCP_PRESETS 数据完整性', () => {
  it('id 唯一', () => {
    const ids = MCP_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('每个预设都有名称与说明', () => {
    for (const p of MCP_PRESETS) {
      expect(p.name, p.id).toBeTruthy()
      expect(p.description.length, p.id).toBeGreaterThan(4)
    }
  })
  it('stdio 预设必须有 command，远程预设必须有 url', () => {
    for (const p of MCP_PRESETS) {
      if (p.type === 'stdio') expect(p.command, p.id).toBeTruthy()
      else expect(p.url, p.id).toBeTruthy()
    }
  })
  it('远程预设的 url 是 http(s)', () => {
    for (const p of MCP_PRESETS.filter(x => x.type !== 'stdio')) {
      expect(p.url!.startsWith('https://') || p.url!.startsWith('http://'), p.id).toBe(true)
    }
  })
})

describe('buildPresetServer', () => {
  it('输出与 /api/mcp/servers 入参一致', () => {
    const p = MCP_PRESETS.find(x => x.id === 'fetch')!
    const payload = buildPresetServer(p)
    expect(payload).toEqual({
      name: 'fetch', type: 'stdio', command: 'npx',
      args: '-y @modelcontextprotocol/server-fetch', url: '',
      readOnly: true, enabled: true,
    })
  })
  it('远程预设带 url、command 为空', () => {
    const p = MCP_PRESETS.find(x => x.id === 'github-remote')!
    const payload = buildPresetServer(p)
    expect(payload.url).toContain('https://')
    expect(payload.command).toBe('')
  })
})

describe('isOneClick', () => {
  it('无参数需求的可一键添加，需要参数的返回 false', () => {
    expect(isOneClick(MCP_PRESETS.find(x => x.id === 'fetch')!)).toBe(true)
    expect(isOneClick(MCP_PRESETS.find(x => x.id === 'filesystem')!)).toBe(false)
    expect(isOneClick(MCP_PRESETS.find(x => x.id === 'github-remote')!)).toBe(false)
  })
})
