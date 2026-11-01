import { describe, it, expect } from 'vitest'
import {
  validateWorkflow, renderTemplate, renderToolArgs, collectInputs, summarizeRun,
  type Workflow, type RenderContext,
} from '../src/shared/workflow'

// 工作流引擎（v14.1）：步骤间用占位符传值。最容易出错的是「多行输出塞进 JSON 参数」——
// 早期实现先替换整段文本再 JSON.parse，会被换行/引号撑破（实测踩到）。

const baseCtx = (): RenderContext => ({ inputs: { topic: '日报' }, steps: { s1: '第一步结果' }, prev: '第一步结果' })

describe('validateWorkflow', () => {
  const wf = (over: Partial<Workflow> = {}): Partial<Workflow> => ({
    name: '测试', inputs: [], steps: [{ id: 'a', type: 'tool', tool: 'system_info', args: '{}' }], ...over,
  })
  it('合法工作流通过', () => {
    expect(validateWorkflow(wf())).toBeNull()
  })
  it('缺名称 / 缺步骤', () => {
    expect(validateWorkflow(wf({ name: '' }))).toContain('名称')
    expect(validateWorkflow(wf({ steps: [] }))).toContain('至少需要一个步骤')
  })
  it('步骤 id 非法或重复', () => {
    expect(validateWorkflow(wf({ steps: [{ id: '1abc', type: 'tool', tool: 'x', args: '{}' }] }))).toContain('不合法')
    expect(validateWorkflow(wf({ steps: [
      { id: 'a', type: 'tool', tool: 'x', args: '{}' },
      { id: 'a', type: 'tool', tool: 'y', args: '{}' },
    ] }))).toContain('重复')
  })
  it('prompt 步骤缺提示词、tool 步骤缺工具名', () => {
    expect(validateWorkflow(wf({ steps: [{ id: 'p', type: 'prompt', prompt: '  ' }] }))).toContain('提示词')
    expect(validateWorkflow(wf({ steps: [{ id: 't', type: 'tool', tool: '' }] }))).toContain('工具名')
  })
  it('工具参数必须是对象', () => {
    expect(validateWorkflow(wf({ steps: [{ id: 't', type: 'tool', tool: 'x', args: '[1,2]' }] }))).toContain('对象')
    expect(validateWorkflow(wf({ steps: [{ id: 't', type: 'tool', tool: 'x', args: '{bad' }] }))).toContain('JSON')
  })
  it('占位符出现在参数里不误判', () => {
    expect(validateWorkflow(wf({ steps: [{ id: 't', type: 'tool', tool: 'write_file', args: '{"path":"{{input.out}}","content":"{{step.a.output}}"}' }] }))).toBeNull()
  })
  it('输入 key 重复/非法', () => {
    expect(validateWorkflow(wf({ inputs: [{ key: 'x' }, { key: 'x' }] }))).toContain('重复')
    expect(validateWorkflow(wf({ inputs: [{ key: '9x' }] }))).toContain('不合法')
  })
})

describe('renderTemplate', () => {
  it('输入 / 步骤 / 上一步三种占位符', () => {
    const r = renderTemplate('主题={{input.topic}} 上一步={{prev}} 步骤1={{step.s1.output}}', baseCtx())
    expect(r.text).toBe('主题=日报 上一步=第一步结果 步骤1=第一步结果')
    expect(r.warnings).toEqual([])
  })
  it('缺失的值替换成空串并给出警告（不留下原始占位符）', () => {
    const r = renderTemplate('A{{input.nope}}B{{step.nope.output}}', baseCtx())
    expect(r.text).toBe('AB')
    expect(r.warnings.length).toBe(2)
  })
  it('空输入也警告', () => {
    const ctx = baseCtx(); ctx.inputs.topic = ''
    expect(renderTemplate('{{input.topic}}', ctx).warnings[0]).toContain('为空')
  })
})

describe('renderToolArgs', () => {
  it('字符串叶子节点替换（多行输出不破坏 JSON）', () => {
    const ctx = baseCtx()
    ctx.steps.info = 'line1\nline2 "quoted" \\ backslash'
    const r = renderToolArgs('{"path":"a.txt","content":"{{step.info.output}}"}', ctx)
    expect(r.error).toBeUndefined()
    expect(r.args!.content).toBe('line1\nline2 "quoted" \\ backslash')
  })
  it('整串是占位符时保留数字/布尔类型', () => {
    const ctx: RenderContext = { inputs: { n: '42', b: 'true' }, steps: {}, prev: '' }
    const r = renderToolArgs('{"count":"{{input.n}}","flag":"{{input.b}}"}', ctx)
    expect(r.args!.count).toBe(42)
    expect(r.args!.flag).toBe(true)
  })
  it('嵌套对象与数组递归替换', () => {
    const ctx = baseCtx()
    const r = renderToolArgs('{"a":{"b":["{{input.topic}}","x"]}}', ctx)
    expect((r.args as any).a.b).toEqual(['日报', 'x'])
  })
  it('非法 JSON 给出明确错误', () => {
    expect(renderToolArgs('{bad', baseCtx()).error).toContain('JSON')
    expect(renderToolArgs('[1]', baseCtx()).error).toContain('对象')
  })
})

describe('collectInputs', () => {
  const wf: Workflow = {
    id: 'w', name: 'n', inputs: [
      { key: 'a', label: '必填项', required: true },
      { key: 'b', label: '有默认', default: 'dv' },
    ], steps: [],
  }
  it('补默认值', () => {
    expect(collectInputs(wf, { a: 'x' }).values).toEqual({ a: 'x', b: 'dv' })
  })
  it('缺必填报错', () => {
    expect(collectInputs(wf, {}).error).toContain('必填项')
  })
})

describe('summarizeRun', () => {
  it('统计成功/失败/跳过与耗时', () => {
    const s = summarizeRun([
      { id: 'a', title: 'A', type: 'tool', status: 'done', output: '', ms: 600 },
      { id: 'b', title: 'B', type: 'tool', status: 'error', output: '', ms: 400 },
      { id: 'c', title: 'C', type: 'prompt', status: 'skipped', output: '' },
    ])
    expect(s).toContain('1 成功')
    expect(s).toContain('1 失败')
    expect(s).toContain('1 跳过')
    expect(s).toContain('1.0s')
  })
})
