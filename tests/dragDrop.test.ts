/**
 * 拖拽入图逻辑测试
 *
 * 重点是"坏输入不会变成坏附件"：空文件、超限、重复、不支持的
 * 类型必须被挡在附件列表之外——否则它们会一路流到模型请求里才失败。
 */
import { describe, it, expect } from 'vitest'
import { pickDroppedFiles, isSupported, dragHint, MAX_ATTACH_BYTES, SUPPORTED_EXT } from '../src/renderer/utils/dragDrop'

const f = (name: string, size: number, type = '') => ({ name, size, type })

describe('pickDroppedFiles', () => {
  it('正常文件全部收下', () => {
    const r = pickDroppedFiles([f('a.ts', 100, 'text/plain'), f('b.png', 200, 'image/png')])
    expect(r.accepted.map(x => x.name)).toEqual(['a.ts', 'b.png'])
    expect(r.rejected).toEqual([])
  })

  it('空文件拒绝', () => {
    const r = pickDroppedFiles([f('empty.txt', 0, 'text/plain')])
    expect(r.accepted).toEqual([])
    expect(r.rejected[0]).toEqual({ name: 'empty.txt', reason: 'empty' })
  })

  it('超限拒绝', () => {
    const r = pickDroppedFiles([f('big.mp4', MAX_ATTACH_BYTES + 1, 'video/mp4')])
    expect(r.accepted).toEqual([])
    expect(r.rejected[0].reason).toBe('too-large')
  })

  it('边界：正好等于上限可通过', () => {
    const r = pickDroppedFiles([f('ok.txt', MAX_ATTACH_BYTES, 'text/plain')])
    expect(r.accepted).toHaveLength(1)
  })

  it('不支持的类型拒绝', () => {
    const r = pickDroppedFiles([f('movie.mkv', 5000, 'video/x-matroska')])
    expect(r.accepted).toEqual([])
    expect(r.rejected[0].reason).toBe('unsupported')
  })

  it('与已有附件重名拒绝', () => {
    const r = pickDroppedFiles([f('a.ts', 100, 'text/plain')], ['a.ts'])
    expect(r.accepted).toEqual([])
    expect(r.rejected[0].reason).toBe('duplicate')
  })

  it('同一次拖入里重名也只收第一个', () => {
    const r = pickDroppedFiles([f('a.ts', 1, 'text/plain'), f('a.ts', 2, 'text/plain')])
    expect(r.accepted).toHaveLength(1)
    expect(r.rejected[0].reason).toBe('duplicate')
  })

  it('MIME 缺失时按扩展名兜底', () => {
    const r = pickDroppedFiles([f('code.py', 100)])   // type 为空
    expect(r.accepted).toHaveLength(1)
  })

  it('MIME 缺失且扩展名不支持 → 拒绝', () => {
    const r = pickDroppedFiles([f('thing.bin', 100)])
    expect(r.accepted).toEqual([])
  })

  it('未命名文件拒绝(不产生无名附件)', () => {
    const r = pickDroppedFiles([{ name: '', size: 100, type: 'text/plain' }])
    expect(r.accepted).toEqual([])
    expect(r.rejected[0].name).toBe('(未命名)')
  })

  it('混合场景：好收坏挡,互不影响', () => {
    const r = pickDroppedFiles([
      f('good.ts', 10, 'text/plain'),
      f('zero.txt', 0, 'text/plain'),        // 空
      f('bad.mkv', 10, 'video/x-matroska'),  // 不支持
      f('dup.ts', 5, 'text/plain'),          // 重复
    ], ['dup.ts'])
    expect(r.accepted.map(x => x.name)).toEqual(['good.ts'])
    expect(r.rejected).toHaveLength(3)
  })
})

describe('isSupported', () => {
  it('MIME 前缀命中即支持', () => {
    expect(isSupported('x.unknown', 'text/html')).toBe(true)
    expect(isSupported('x.unknown', 'application/json')).toBe(true)
  })

  it('白名单扩展名支持', () => {
    expect(isSupported('README.md', '')).toBe(true)
    expect(isSupported('shot.PNG', '')).toBe(true)   // 大小写不敏感
  })

  it('不在白名单且 MIME 不符 → 不支持', () => {
    expect(isSupported('a.zip', '')).toBe(false)
    expect(isSupported('a.exe', '')).toBe(false)
  })
})

describe('dragHint', () => {
  it('空结果 → 空串', () => {
    expect(dragHint(null)).toBe('')
    expect(dragHint({ accepted: [], rejected: [] })).toBe('')
  })

  it('全部被拒 → 说明首个原因', () => {
    const r = pickDroppedFiles([f('x.mkv', 10, 'video/x-matroska')])
    expect(dragHint(r)).toContain('不支持的类型')
  })

  it('部分被拒 → 说明跳过数量', () => {
    const r = pickDroppedFiles([f('a.ts', 1, 'text/plain'), f('b.mkv', 1, 'video/x-matroska')])
    expect(dragHint(r)).toContain('已添加 1 个')
    expect(dragHint(r)).toContain('跳过 1 个')
  })
})

describe('SUPPORTED_EXT', () => {
  it('覆盖常见代码/文本/图片/PDF', () => {
    for (const e of ['.ts', '.tsx', '.py', '.go', '.md', '.json', '.png', '.pdf']) {
      expect(SUPPORTED_EXT.has(e)).toBe(true)
    }
  })

  // .sh 是有意放行的：Shell 脚本是常见的"贴给 AI 看"的代码文件，
  // 与可执行文件(.exe/.app/.dmg)不同——附件只被读取，不会被运行。
  it('不含可执行文件/压缩包(脚本是故意放行的)', () => {
    for (const e of ['.exe', '.zip', '.dmg', '.app']) {
      expect(SUPPORTED_EXT.has(e)).toBe(false)
    }
    expect(SUPPORTED_EXT.has('.sh')).toBe(true)
  })
})