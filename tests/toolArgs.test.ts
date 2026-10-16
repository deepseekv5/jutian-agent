/**
 * 工具参数校验测试
 *
 * 这一层的存在理由是实测踩过的坑：
 *  · write_file 缺 content → 文件被写成字符串 "undefined"
 *  · move_file 目标已存在 → rename 静默覆盖，原文件没了
 *  · 参数类型错（传数字当路径）→ 一路走到 fs 层才炸，模型看不懂报错
 */
import { describe, it, expect } from 'vitest'
import { validateArgs, overwriteWarning, TOOL_SPECS, type FieldSpec } from '../src/shared/toolArgs'

describe('validateArgs — 必填', () => {
  const spec: FieldSpec[] = [{ name: 'path', type: 'string', required: true }]

  it('缺失必填 → 报错并指明字段名', () => {
    const r = validateArgs({}, spec)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('path')
  })

  it('null 等同缺失', () => {
    expect(validateArgs({ path: null }, spec).ok).toBe(false)
  })

  it('空字符串算缺失（默认）', () => {
    expect(validateArgs({ path: '' }, spec).ok).toBe(false)
  })

  it('allowEmpty 时空串放行（write_file 的 content 要允许清空文件）', () => {
    const s: FieldSpec[] = [{ name: 'content', type: 'string', required: true, allowEmpty: true }]
    expect(validateArgs({ content: '' }, s).ok).toBe(true)
  })

  it('可选字段缺失 → 通过', () => {
    const s: FieldSpec[] = [{ name: 'path', type: 'string', required: true }, { name: 'limit', type: 'number' }]
    expect(validateArgs({ path: '/a' }, s).ok).toBe(true)
  })
})

describe('validateArgs — 类型', () => {
  it('字符串字段收到数字 → 报错含实际类型', () => {
    const r = validateArgs({ path: 123 }, [{ name: 'path', type: 'string', required: true }])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('number')
  })

  it('数字字段接受数字字符串并转换', () => {
    const r = validateArgs({ limit: '50' }, [{ name: 'limit', type: 'number' }])
    expect(r.ok).toBe(true)
    expect(r.value!.limit).toBe(50)
  })

  it('布尔字段收到字符串 → 报错（不静默转换）', () => {
    const r = validateArgs({ replaceAll: 'true' }, [{ name: 'replaceAll', type: 'boolean' }])
    expect(r.ok).toBe(false)
  })

  it('数组当参数对象 → 报错', () => {
    expect(validateArgs([], [{ name: 'path', type: 'string' }]).ok).toBe(false)
  })

  it('null / 字符串当参数对象 → 报错', () => {
    expect(validateArgs(null, []).ok).toBe(false)
    expect(validateArgs('x', []).ok).toBe(false)
  })
})

describe('validateArgs — 范围与枚举', () => {
  it('低于最小值 → 报错', () => {
    const r = validateArgs({ n: 0 }, [{ name: 'n', type: 'number', min: 1 }])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('1')
  })

  it('高于最大值 → 报错', () => {
    expect(validateArgs({ n: 999 }, [{ name: 'n', type: 'number', max: 600 }]).ok).toBe(false)
  })

  it('枚举外取值 → 报错并列出允许值', () => {
    const r = validateArgs({ mode: 'x' }, [{ name: 'mode', type: 'string', enum: ['a', 'b'] }])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('a')
  })

  it('枚举内取值 → 通过', () => {
    expect(validateArgs({ mode: 'a' }, [{ name: 'mode', type: 'string', enum: ['a', 'b'] }]).ok).toBe(true)
  })
})

describe('validateArgs — 透传', () => {
  it('未在规格中的字段原样保留（不丢参数）', () => {
    const r = validateArgs({ path: '/a', extra: 'keep' }, [{ name: 'path', type: 'string', required: true }])
    expect(r.ok).toBe(true)
    expect(r.value!.extra).toBe('keep')
  })

  it('只报第一个错误（一次说清一个问题）', () => {
    const r = validateArgs({}, [
      { name: 'a', type: 'string', required: true },
      { name: 'b', type: 'string', required: true },
    ])
    expect(r.error).toContain('a')
    expect(r.error).not.toContain('"b"')
  })
})

describe('TOOL_SPECS — 覆盖真实踩坑点', () => {
  it('write_file 的 content 是必填（否则会写成 "undefined"）', () => {
    const spec = TOOL_SPECS.write_file
    const content = spec.find(s => s.name === 'content')
    expect(content?.required).toBe(true)
    expect(content?.allowEmpty).toBe(true)   // 但允许清空文件
  })

  it('edit_file 的 oldText / newText 都是必填', () => {
    const names = TOOL_SPECS.edit_file.filter(s => s.required).map(s => s.name)
    expect(names).toContain('oldText')
    expect(names).toContain('newText')
  })

  it('move_file 的 src / dest 都是必填', () => {
    const names = TOOL_SPECS.move_file.filter(s => s.required).map(s => s.name)
    expect(names).toEqual(['src', 'dest'])
  })

  it('写类工具的 content 允许空串，读类工具不允许', () => {
    expect(TOOL_SPECS.write_file.find(s => s.name === 'content')?.allowEmpty).toBe(true)
    expect(TOOL_SPECS.read_file.find(s => s.name === 'path')?.allowEmpty).toBeUndefined()
  })
})

describe('overwriteWarning — 覆盖提醒', () => {
  it('新建文件不提示', () => {
    expect(overwriteWarning(false, 0, 100)).toBeNull()
  })

  it('正常覆盖不提示', () => {
    expect(overwriteWarning(true, 100, 120)).toBeNull()
  })

  // 实测风险：模型误传空 content 把文件清空
  it('把有内容的文件清空 → 提示', () => {
    const w = overwriteWarning(true, 500, 0)
    expect(w).toBeTruthy()
    expect(w).toContain('清空')
  })

  it('内容大幅缩水 → 提示（可能是误覆盖）', () => {
    const w = overwriteWarning(true, 3000, 100)
    expect(w).toBeTruthy()
    expect(w).toContain('大幅减少')
  })

  it('原文件本就是空的 → 不提示', () => {
    expect(overwriteWarning(true, 0, 0)).toBeNull()
  })
})
