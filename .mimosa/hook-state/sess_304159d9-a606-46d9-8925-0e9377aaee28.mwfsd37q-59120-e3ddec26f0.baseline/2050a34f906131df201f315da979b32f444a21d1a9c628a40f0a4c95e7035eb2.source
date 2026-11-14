/**
 * 命令注入回归 —— 静态扫源码 + 实打接口两层
 *
 * 背景：serve.ts 里多个工具把「模型给的字符串」直接拼进 shell 命令文本。
 * 例如全局搜索原先写的是
 *     `find ${JSON.stringify(target)} ... | grep -Il ${JSON.stringify(query)}`
 * JSON.stringify 只是包了一层双引号——shell 在双引号里照样展开 `$(...)`
 * 和反引号，所以 query 传 `"$(whoami)"` 会被真的执行。
 *
 * 约定：凡是来自模型/请求的参数，一律通过环境变量传给子进程，
 * 不拼进命令字符串。env 的值不会再被 shell 求值，也就没有转义问题。
 *
 * 为什么用静态扫描而不是逐个打接口：真正的回归点是「写法」，
 * 新加一个工具时最容易再犯同样的错，静态扫描能立刻抓到；
 * 实打接口只能覆盖当下已存在的那几个。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/server/serve.ts'), 'utf-8')
const LINES = SRC.split('\n')

describe('命令注入防线（serve.ts 静态扫描）', () => {
  /** 取出所有把变量插进 shell 命令文本的行 */
  function interpolationHits() {
    const hits: { ln: number; text: string }[] = []
    // 模板插值的开记号：$ 后面紧跟 {
    const interpOpen = /[$][{]/
    LINES.forEach((text, i) => {
      // 只看藏着 shell 调用的那些行：命令行里出现 ${...} 且是 shell 调用
      const isShellCall = /execAsync\(\s*["'](?:zsh|bash|sh|cmd\.exe|powershell\.exe)["']/.test(text)
      const hasInterp = interpOpen.test(text)
      if (isShellCall && hasInterp) hits.push({ ln: i + 1, text: text.trim() })
    })
    return hits
  }

  it('不存在「变量插值 + shell 调用」同一行的写法', () => {
    const hits = interpolationHits()
    // 白名单：值由代码自产（不是模型输入）的插值。
    // - excludeDirs：本文件里写死的 node_modules/.git 等 prune 串
    // - port/timeoutSec/command：port 已强制 Number.isInteger；
    //   timeoutSec 是内部秒数；command 是 shell 工具本体（其职责就是执行任意命令，
    //   由 BLOCKED 黑名单负责拦危险命令）
    const allowed = hits.filter(h => !/\$\{(excludeDirs|port|timeoutSec|command)\b/.test(h.text))
    expect(
      allowed.map(h => `${h.ln}: ${h.text.slice(0, 120)}`),
    ).toEqual([])
  })

  it('全局搜索不再用 JSON.stringify 直接拼进命令（旧写法）', () => {
    // 旧写法长这样（已修）：find ${JSON.stringify(target)} ... grep -Il ${JSON.stringify(query)}
    expect(SRC).not.toContain('find ' + '$' + '{JSON.stringify')
    expect(SRC).not.toContain('grep -Il ' + '$' + '{JSON.stringify')
  })

  it('全局搜索在 Windows 上有分支（不能只有 zsh）', () => {
    // 修之前这条路径固定 execAsync('zsh')，Windows 上必然 ENOENT，
    // 全局搜索整个功能不可用。
    const codeSearch = SRC.slice(SRC.indexOf('/api/code/search'))
    const block = codeSearch.slice(0, codeSearch.indexOf('/api/code/select-directory'))
    expect(block).toMatch(/IS_WIN/)
    expect(block).toMatch(/powershell\.exe/)
  })

  it('search_files / search_content / process_list 的参数走 env', () => {
    // 每个都应有对应的 JT_ 环境变量注入，而不是字符串插值
    for (const name of ['JT_DIR', 'JT_PATTERN', 'JT_FILTER', 'JT_QUERY']) {
      expect(SRC, `应注入 ${name}`).toContain(name)
    }
  })

  it('powershell 调用统一带 shellEnv()（PATH 补全，Windows 上找不到命令的根因）', () => {
    const missing: number[] = []
    LINES.forEach((text, i) => {
      if (!/execAsync\(\s*["']powershell\.exe["']/.test(text)) return
      // 往前后各看 12 行找 shellEnv（调用参数常跨行）
      const window = LINES.slice(Math.max(0, i - 4), i + 13).join('\n')
      if (!window.includes('shellEnv()')) missing.push(i + 1)
    })
    // 唯一允许的例外是 shellEnv() 自己的实现（它去读注册表拼 PATH）
    const realMissing = missing.filter(ln => {
      const window = LINES.slice(Math.max(0, ln - 12), ln + 6).join('\n')
      return !window.includes('_shellEnvCache')
    })
    expect(realMissing).toEqual([])
  })
})

describe('port_check 端口号校验', () => {
  it('端口号被强制转整数后再进命令（挡 & 拼接）', () => {
    const idx = SRC.indexOf('async function port_check')
    const block = SRC.slice(idx, idx + 1400)
    expect(block).toMatch(/Number\.isInteger|Number\(a\.port\)/)
  })
})
