import { describe, it, expect } from 'vitest'
import { extractSymbols, kindLabel, kindGlyph } from '../src/renderer/code/outline'

// 代码大纲提取：正则实现覆盖主流语言高频符号。
// 错判会把注释当符号（噪声），漏判则大纲空着没用。

describe('extractSymbols · JS/TS', () => {
  const code = [
    '// function fakeInComment() {}',
    'export function realFn(a, b) {',
    '  return a + b',
    '}',
    'export const arrowFn = async (x) => x * 2',
    'export class MyClass {',
    '  methodOne() {',
    '    return 1',
    '  }',
    '}',
    'export interface Foo {',
    '  a: string',
    '}',
    'export type Bar = string | number',
    'export enum Color { Red }',
  ].join('\n')

  it('提取函数/箭头函数/类/接口/类型/枚举', () => {
    const syms = extractSymbols(code, 'typescript')
    const names = syms.map(s => s.name)
    expect(names).toContain('realFn')
    expect(names).toContain('arrowFn')
    expect(names).toContain('MyClass')
    expect(names).toContain('Foo')
    expect(names).toContain('Bar')
    expect(names).toContain('Color')
  })

  it('不把注释里的 function 当符号', () => {
    const syms = extractSymbols(code, 'typescript')
    expect(syms.map(s => s.name)).not.toContain('fakeInComment')
  })

  it('行号从 1 开始且准确', () => {
    const syms = extractSymbols('const a = 1\nexport function target() {}\n', 'typescript')
    expect(syms.find(s => s.name === 'target')?.line).toBe(2)
  })

  it('类方法带缩进层级', () => {
    const syms = extractSymbols(code, 'typescript')
    const m = syms.find(s => s.name === 'methodOne')
    expect(m?.kind).toBe('method')
    expect(m?.depth).toBeGreaterThan(0)
  })
})

describe('extractSymbols · Python', () => {
  it('def 与 class', () => {
    const syms = extractSymbols('def top():\n    pass\n\nclass Model:\n    def fit(self):\n        pass\n', 'python')
    expect(syms.map(s => s.name)).toEqual(['top', 'Model', 'fit'])
    expect(syms[1].kind).toBe('class')
  })
  it('async def', () => {
    expect(extractSymbols('async def fetch_all():\n    pass\n', 'python')[0].name).toBe('fetch_all')
  })
})

describe('extractSymbols · Go / Rust', () => {
  it('Go func 与 type', () => {
    const syms = extractSymbols('func main() {}\ntype Server struct {\n}\ntype Handler interface {\n}\n', 'go')
    expect(syms.map(s => s.name)).toEqual(['main', 'Server', 'Handler'])
    expect(syms[1].kind).toBe('struct')
  })
  it('Rust fn/struct/enum/trait', () => {
    const syms = extractSymbols('pub fn run() {}\npub struct Cfg {}\npub enum Mode {}\npub trait Job {}\n', 'rust')
    expect(syms.map(s => s.name)).toEqual(['run', 'Cfg', 'Mode', 'Job'])
  })
})

describe('extractSymbols · Markdown', () => {
  it('按标题层级提取', () => {
    const syms = extractSymbols('# 标题一\n正文\n## 小节\n### 更小\n', 'markdown')
    expect(syms.map(s => s.name)).toEqual(['标题一', '小节', '更小'])
    expect(syms.every(s => s.kind === 'heading')).toBe(true)
  })
})

describe('extractSymbols · 边界', () => {
  it('空内容返回空数组', () => {
    expect(extractSymbols('', 'typescript')).toEqual([])
  })
  it('超长文件截断到 500 条（防大纲卡死）', () => {
    const big = Array.from({ length: 900 }, (_, i) => `export function fn${i}() {}`).join('\n')
    expect(extractSymbols(big, 'typescript')).toHaveLength(500)
  })
  it('符号名过长丢弃（防误匹配整行）', () => {
    const long = 'export function ' + 'a'.repeat(120) + '() {}'
    expect(extractSymbols(long, 'typescript')).toEqual([])
  })
})

describe('kindLabel / kindGlyph', () => {
  it('中英标签与字形', () => {
    expect(kindLabel('function', 'zh')).toBe('函数')
    expect(kindLabel('function', 'en')).toBe('fn')
    expect(kindGlyph('class')).toBe('C')
    expect(kindGlyph('interface')).toBe('I')
  })
})
