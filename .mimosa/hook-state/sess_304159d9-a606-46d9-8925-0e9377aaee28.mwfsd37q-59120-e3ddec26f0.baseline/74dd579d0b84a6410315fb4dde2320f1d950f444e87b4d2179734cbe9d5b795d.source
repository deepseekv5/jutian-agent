import { describe, it, expect } from 'vitest'
import { materialize } from '../src/renderer/store/ppt-layouts'

/** v16.2.0 新元素/新布局：materialize 产出正确 block 结构 */
describe('PPT 新元素（v16.2.0）', () => {
  it('flow 布局产出 flow block（竖向节点+箭头）', () => {
    const s = materialize({ layout: 'flow', title: '实施流程', flow: { nodes: [{ title: '需求', desc: '确认' }, { title: '开发' }, { title: '上线' }], numbered: true } }, 0)
    const flow = s.blocks.find(b => b.type === 'flow')
    expect(flow).toBeTruthy()
    expect((flow as any).nodes).toHaveLength(3)
    expect((flow as any).numbered).toBe(true)
  })
  it('flow 布局无 nodes 时用默认 4 节点兜底', () => {
    const s = materialize({ layout: 'flow', title: '流程' }, 0)
    const flow = s.blocks.find(b => b.type === 'flow') as any
    expect(flow.nodes.length).toBe(4)
  })
  it('code 布局产出 code block', () => {
    const s = materialize({ layout: 'code', title: '核心代码', code: { code: 'const a = 1', lang: 'typescript' } }, 0)
    const cd = s.blocks.find(b => b.type === 'code') as any
    expect(cd.code).toBe('const a = 1')
    expect(cd.lang).toBe('typescript')
  })
  it('iconGrid 布局产出 icon block', () => {
    const s = materialize({ layout: 'iconGrid', title: '核心能力', icons: [{ icon: 'M12 3l1.9 5.6L20 10l-5.1 2.4L16 18l-4-3-4 3 1.1-5.6L4 10l6.1-1.4L12 3z', text: '智能' }] }, 0)
    const icons = s.blocks.filter(b => b.type === 'icon')
    expect(icons.length).toBe(1)
    expect((icons[0] as any).text).toBe('智能')
  })
  it('shapes 布局产出 shape block', () => {
    const s = materialize({ layout: 'shapes', title: '视觉分区', shapes: [{ shape: 'rounded', fill: 'accent' }, { shape: 'circle', fill: 'accent2' }] }, 0)
    const shapes = s.blocks.filter(b => b.type === 'shape')
    expect(shapes.length).toBe(2)
    expect((shapes[0] as any).shape).toBe('rounded')
    expect((shapes[1] as any).fill).toBe('accent2')
  })
})
