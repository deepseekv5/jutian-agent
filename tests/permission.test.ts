import { describe, it, expect } from 'vitest'
import { buildPermissionRequest, isOutsideWorkDir, isSystemDir, denialMessage } from '../src/shared/permission'

// 权限审批（v14.4，参考 ClerkBox 的判定语义）：
// 以前「需要我确认」是硬拒绝，现在要生成结构化审批请求交给 UI。
// 判定必须保守但准确——漏判会放行危险操作，误判会烦死用户。

describe('路径判定', () => {
  it('工作目录内/外', () => {
    expect(isOutsideWorkDir('/Users/a/work/x.txt', '/Users/a/work')).toBe(false)
    expect(isOutsideWorkDir('/Users/a/other/x.txt', '/Users/a/work')).toBe(true)
    expect(isOutsideWorkDir('/Users/a/work', '/Users/a/work')).toBe(false)
  })
  it('相对路径视为工作目录内', () => {
    expect(isOutsideWorkDir('src/a.ts', '/Users/a/work')).toBe(false)
  })
  it('工作目录为空时不限制', () => {
    expect(isOutsideWorkDir('/etc/passwd', '')).toBe(false)
  })
  it('系统目录识别', () => {
    expect(isSystemDir('/etc/passwd')).toBe(true)
    expect(isSystemDir('/usr/local/bin/x')).toBe(true)
    expect(isSystemDir('/Users/a/x')).toBe(false)
  })
})

describe('buildPermissionRequest', () => {
  const wd = '/Users/a/work'
  it('普通读/写工作目录内文件不询问', () => {
    expect(buildPermissionRequest('1', 'read_file', { path: '/Users/a/work/a.ts' }, wd)).toBeNull()
    expect(buildPermissionRequest('2', 'write_file', { path: '/Users/a/work/a.ts', content: 'x' }, wd)).toBeNull()
  })
  it('危险命令 → dangerous-command（高风险）', () => {
    const r = buildPermissionRequest('3', 'shell', { command: 'rm -rf /tmp/x' }, wd)!
    expect(r.reason).toBe('dangerous-command')
    expect(r.risk).toBe('dangerous')
    expect(r.preview).toContain('rm -rf')
    expect(r.scopeKey).toContain('cmd:shell')
  })
  it('写系统目录 → system-dir', () => {
    const r = buildPermissionRequest('4', 'write_file', { path: '/etc/hosts', content: 'x' }, wd)!
    expect(r.reason).toBe('system-dir')
    expect(r.risk).toBe('dangerous')
  })
  it('写工作目录外 → outside-cwd', () => {
    const r = buildPermissionRequest('5', 'write_file', { path: '/Users/a/other.txt', content: 'x' }, wd)!
    expect(r.reason).toBe('outside-cwd')
    expect(r.risk).toBe('normal')
  })
  it('清空文件 → empty-overwrite', () => {
    const r = buildPermissionRequest('6', 'write_file', { path: '/Users/a/work/a.ts', content: '' }, wd)!
    expect(r.reason).toBe('empty-overwrite')
  })
  it('删文件 → sensitive-tool', () => {
    const r = buildPermissionRequest('7', 'delete_file', { path: '/Users/a/work/a.ts' }, wd)!
    expect(r.reason).toBe('sensitive-tool')
    expect(r.risk).toBe('dangerous')
  })
  it('命令里出现系统目录 → system-dir', () => {
    const r = buildPermissionRequest('8', 'shell', { command: 'cp x /etc/nginx/nginx.conf' }, wd)!
    expect(r.reason).toBe('system-dir')
  })
  it('scopeKey 稳定：同一命令同一键（本会话允许靠它记忆）', () => {
    const a = buildPermissionRequest('9', 'shell', { command: 'rm -rf /tmp/x' }, wd)!
    const b = buildPermissionRequest('10', 'shell', { command: 'rm -rf /tmp/x' }, wd)!
    expect(a.scopeKey).toBe(b.scopeKey)
  })
})

describe('denialMessage', () => {
  it('明确告诉模型被拒并引导换方案', () => {
    const r = buildPermissionRequest('1', 'delete_file', { path: '/x' }, '')!
    const msg = denialMessage(r)
    expect(msg).toContain('用户拒绝')
    expect(msg).toContain('非破坏性')
  })
})
