/**
 * 安全扫描复核回归（Mimosa 2026-11-20 / serve.ts）
 *
 * 本轮 38 个 finding 逐条人工核实后，唯一确认为真漏洞的是
 * PYTHON_BIN 环境变量决定 spawn/execFile 的可执行程序（82 / 3752，
 * 复核时另发现 6700 同一模式）。修复方式是统一收口到 safePythonBin() 白名单。
 *
 * 这里直接抽取 serve.ts 里的真实函数做行为测试，避免测试实现与源码漂移；
 * 另加源码形态断言，防止以后有人绕过辅助函数重新用回裸环境变量。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const src = fs.readFileSync(
  path.resolve(__dirname, '../src/server/serve.ts'), 'utf-8')

const extracted = src.match(/function safePythonBin\(raw\) \{[\s\S]*?\n\}/)
if (!extracted) throw new Error('serve.ts 缺少 safePythonBin 白名单辅助函数')

// 源码是 JS 兼容写法（无类型注解），注入 path 模块后即可直接执行
const safePythonBin = new Function('path', `${extracted[0]}; return safePythonBin`)(path) as (raw: unknown) => string

describe('PYTHON_BIN 白名单（环境变量注入恶意解释器）', () => {
  it('默认值、空值与非法类型回退 python3', () => {
    expect(safePythonBin(undefined)).toBe('python3')
    expect(safePythonBin('')).toBe('python3')
    expect(safePythonBin('   ')).toBe('python3')
    expect(safePythonBin(null)).toBe('python3')
    expect(safePythonBin(123)).toBe('python3')
  })

  it('放行已知解释器名（含版本后缀与 Windows 启动器）', () => {
    expect(safePythonBin('python')).toBe('python')
    expect(safePythonBin('python3')).toBe('python3')
    expect(safePythonBin('python3.11')).toBe('python3.11')
    expect(safePythonBin('py')).toBe('py')
    expect(safePythonBin('py.exe')).toBe('py.exe')
  })

  it('放行启动器注入的绝对路径（含带空格的应用安装目录）', () => {
    expect(safePythonBin('/usr/bin/python3')).toBe('/usr/bin/python3')
    expect(safePythonBin('/opt/venv/bin/python3.11')).toBe('/opt/venv/bin/python3.11')
    expect(safePythonBin('/Applications/My Agent.app/Contents/Resources/bin/python3')).toBe('/Applications/My Agent.app/Contents/Resources/bin/python3')
    expect(safePythonBin('C:\\Tools\\python-runtime\\Scripts\\python.exe')).toBe('C:\\Tools\\python-runtime\\Scripts\\python.exe')
  })

  it('拒绝指向非 python 程序的绝对路径', () => {
    expect(safePythonBin('/tmp/evil.sh')).toBe('python3')
    expect(safePythonBin('/usr/bin/bash')).toBe('python3')
    expect(safePythonBin('/usr/bin/python3wrapper')).toBe('python3')
  })

  it('拒绝参数拼接、shell 元字符与相对路径', () => {
    expect(safePythonBin('python3 -c "import os"')).toBe('python3')
    expect(safePythonBin('/usr/bin/python3;curl evil')).toBe('python3')
    expect(safePythonBin('/usr/bin/python3`id`')).toBe('python3')
    expect(safePythonBin('./python3')).toBe('python3')
    expect(safePythonBin('python3\n/usr/bin/evil')).toBe('python3')
  })

  it('三处调用点全部收口，无遗留裸环境变量回退', () => {
    expect(src).not.toMatch(/process\.env\.PYTHON_BIN\s*\|\|/)
    const calls = src.match(/safePythonBin\(process\.env\.PYTHON_BIN\)/g) || []
    // 79 行 STT spawn、3752 行 --version、3756 行状态显示、6700 行 STT 回退
    expect(calls.length).toBeGreaterThanOrEqual(4)
  })

  it('加固未改动安全三件套与工具 URL 的 SSRF 校验入口', () => {
    expect(src).toContain('SHIELD.checkDangerousCommand')
    expect(src).toContain('SHIELD.scanInjection')
    expect(src).toContain('SHIELD.maskSecrets')
    expect(src).toContain('fetchGuarded(url, init)')
    expect(src).toContain('await assertFetchableUrl(a.url)')
  })
})

describe('SSRF 复核：静态告警点均为配置驱动或固定主机', () => {
  it('web_fetch / http_request 的用户 URL 仍走统一校验', () => {
    // 两个工具的 a.url 在进入 fetch 之前都过 assertFetchableUrl + fetchGuarded
    expect(src).toMatch(/async function web_fetch\(a\) \{[\s\S]{0,200}await assertFetchableUrl\(a\.url\)/)
    expect(src).toMatch(/async function http_request\(a\) \{[\s\S]{0,200}await assertFetchableUrl\(a\.url\)/)
  })

  it('GitHub 市场取数主机固定为 api.github.com / raw.githubusercontent.com', () => {
    expect(src).toContain('https://api.github.com/repos/${repo}/contents/')
    expect(src).toContain('https://raw.githubusercontent.com/${repo}/HEAD/')
  })
})
