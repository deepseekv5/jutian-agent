/**
 * 办公 / 编程双形态的契约测试
 *
 * chatModes.ts 是这两个形态的唯一定义处。这里固化的是「两种形态必须
 * 真的不同」这件事：人格提示词各自的关键约束不能丢、空态引导不能串、
 * 视觉信号必须区分。否则改文案时很容易把两套写成一模一样，
 * 又退回到「同一个助手换两行提示词」。
 */
import { describe, it, expect } from 'vitest'
import { buildCodingPersona, OFFICE_MODE_SUFFIX, WELCOME, MODE_ACCENT } from '../src/shared/chatModes'

describe('编程形态人格', () => {
  const p = buildCodingPersona('/Users/me/proj')

  it('把工作目录写进边界约束（越界是本应用最在意的红线）', () => {
    expect(p).toContain('/Users/me/proj')
    expect(p).toContain('工作目录')
  })

  it('未指定工作目录时给出明确措辞，不留空', () => {
    const noDir = buildCodingPersona('')
    expect(noDir).toContain('未指定')
  })

  it('保留「动手改文件为先」的核心取向', () => {
    expect(p).toContain('动手')
    expect(p).toMatch(/edit_file|write_file/)
  })

  it('保留「先读后改」铁律', () => {
    expect(p).toContain('先读')
  })

  it('保留「改完能跑就跑」的验证要求', () => {
    expect(p).toMatch(/跑|验证/)
  })

  it('保留报错排查的四步路径', () => {
    expect(p).toContain('根因')
    expect(p).toContain('最小修复')
  })

  it('保留破坏性操作先说明风险的要求', () => {
    expect(p).toContain('破坏性')
  })
})

describe('办公形态补充段', () => {
  it('点明产出面向「能直接交付」', () => {
    expect(OFFICE_MODE_SUFFIX).toMatch(/交付|落盘/)
  })

  it('明确代码/终端操作克制（这是与编程形态的分界）', () => {
    expect(OFFICE_MODE_SUFFIX).toMatch(/克制|明确要求/)
  })

  it('涵盖文档/调研/PPT 等办公主场景', () => {
    expect(OFFICE_MODE_SUFFIX).toMatch(/文档|PPT/)
  })

  it('与编程人格不重复：不含工程 Agent 的动手改文件指令', () => {
    expect(OFFICE_MODE_SUFFIX).not.toContain('edit_file')
    expect(OFFICE_MODE_SUFFIX).not.toContain('先读后改')
  })
})

describe('两种形态确实不同', () => {
  it('人格提示词不相等', () => {
    expect(buildCodingPersona('/tmp')).not.toBe(OFFICE_MODE_SUFFIX)
  })

  it('空态标题不同', () => {
    expect(WELCOME.general.title).not.toBe(WELCOME.coding.title)
  })

  it('空态副标题不同', () => {
    expect(WELCOME.general.subtitle).not.toBe(WELCOME.coding.subtitle)
  })

  it('快捷提示互不重叠（办公不出现代码类、编程不出现文档类）', () => {
    const g = WELCOME.general.prompts.map(p => p.label)
    const c = WELCOME.coding.prompts.map(p => p.label)
    for (const l of c) expect(g).not.toContain(l)
    expect(g).toContain('写周报')
    expect(c).toContain('修 bug')
  })

  it('两种形态各有足够多的快捷提示（空态不能只有一两个按钮）', () => {
    expect(WELCOME.general.prompts.length).toBeGreaterThanOrEqual(4)
    expect(WELCOME.coding.prompts.length).toBeGreaterThanOrEqual(4)
  })

  it('每条快捷提示都同时有中文与英文（语言切换不能出现空白按钮）', () => {
    for (const mode of ['general', 'coding'] as const) {
      for (const p of WELCOME[mode].prompts) {
        expect(p.label.trim()).not.toBe('')
        expect(p.labelEn.trim()).not.toBe('')
        expect(p.text.trim()).not.toBe('')
        expect(p.textEn.trim()).not.toBe('')
      }
    }
  })

  it('视觉信号区分明显（两个模式不能同色）', () => {
    expect(MODE_ACCENT.general.color).not.toBe(MODE_ACCENT.coding.color)
    expect(MODE_ACCENT.general.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(MODE_ACCENT.coding.color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
