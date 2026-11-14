import { describe, it, expect } from 'vitest'
import { baseName, baseNameOr, dirName, stripTrailingSep } from '../src/renderer/utils/pathName'

// 这些路径以前只 split('/')，在 Windows 上会把整条路径当文件名显示，
// 或者把整条路径当父目录（拖文件进来会建错项目根）。
describe('baseName', () => {
  it('认正斜杠(macOS/Linux)', () => {
    expect(baseName('/Users/me/proj/src/a.ts')).toBe('a.ts')
    expect(baseName('/Users/me/proj/')).toBe('proj')
  })

  it('认反斜杠(Windows)——回归点', () => {
    expect(baseName('C:\\Users\\me\\proj\\a.ts')).toBe('a.ts')
    expect(baseName('C:\\Users\\me\\proj')).toBe('proj')
  })

  it('容忍混合分隔符', () => {
    expect(baseName('C:\\Users/me\\proj/a.ts')).toBe('a.ts')
  })

  it('盘符根返回盘符本身，不留空', () => {
    expect(baseName('C:\\')).toBe('C:')
  })

  it('空值安全', () => {
    expect(baseName('')).toBe('')
    expect(baseName(null)).toBe('')
    expect(baseName(undefined)).toBe('')
    expect(baseName('   ')).toBe('   ')
  })

  it('baseNameOr 为空时回退到原值', () => {
    expect(baseNameOr('/a/b.ts', 'x')).toBe('b.ts')
    expect(baseNameOr('', 'x')).toBe('x')
    expect(baseNameOr(null, 'x')).toBe('x')
  })
})

describe('dirName', () => {
  it('保留原分隔符风格', () => {
    expect(dirName('/a/b/c.ts')).toBe('/a/b')
    expect(dirName('C:\\a\\b\\c.ts')).toBe('C:\\a\\b')
  })

  it('Windows 盘符根不能被削掉反斜杠', () => {
    // 这是关键：naive 实现会给出 'C:'，命令行里 'C:' 是"当前目录"而不是根
    expect(dirName('C:\\c.ts')).toBe('C:\\')
  })

  it('没有父目录时返回空串', () => {
    expect(dirName('c.ts')).toBe('')
    expect(dirName('')).toBe('')
    expect(dirName(null)).toBe('')
  })

  it('根目录的父目录是它自己', () => {
    expect(dirName('/a')).toBe('/')
  })

  it('忽略结尾分隔符', () => {
    expect(dirName('/a/b/')).toBe('/a')
    expect(dirName('C:\\a\\b\\')).toBe('C:\\a')
  })

  it('与 baseName 拼回原路径', () => {
    for (const p of ['/Users/me/proj/a.ts', 'C:\\Users\\me\\proj\\a.ts']) {
      const sep = p.includes('\\') ? '\\' : '/'
      expect(`${dirName(p)}${sep}${baseName(p)}`).toBe(p)
    }
  })
})

describe('stripTrailingSep', () => {
  it('去掉所有结尾分隔符', () => {
    expect(stripTrailingSep('/a/b///')).toBe('/a/b')
    expect(stripTrailingSep('C:\\a\\')).toBe('C:\\a')
  })
})
