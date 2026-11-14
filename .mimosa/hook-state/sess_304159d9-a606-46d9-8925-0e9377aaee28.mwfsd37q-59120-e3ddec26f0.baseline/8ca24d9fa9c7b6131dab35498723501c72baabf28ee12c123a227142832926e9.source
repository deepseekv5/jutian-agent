/**
 * 任务清单（update_plan）解析测试
 *
 * 参数直接来自模型输出，形状不可信：可能少字段、类型错、超长、
 * steps 为空、JSON 根本不合法。这里确保任何输入都不抛错，
 * 且非法输入被拒时回给模型的错误是可理解的（模型会据此重试）。
 */
import { describe, it, expect } from 'vitest'
import {
  parsePlanArgs, planAck, planReject, planProgress, planAllDone,
} from '../src/shared/planTool'

describe('parsePlanArgs', () => {
  it('正常解析', () => {
    const { plan, error } = parsePlanArgs(JSON.stringify({
      explanation: '进行中',
      steps: [{ title: '读代码', status: 'completed' }, { title: '改 bug', status: 'in_progress' }],
    }))
    expect(error).toBeUndefined()
    expect(plan!.steps).toHaveLength(2)
    expect(plan!.explanation).toBe('进行中')
  })

  it('非法 JSON 返回错误而不抛', () => {
    expect(parsePlanArgs('{oops').error).toBeTruthy()
    expect(parsePlanArgs('').error).toBeTruthy()
  })

  it('steps 缺失/空数组被拒', () => {
    expect(parsePlanArgs('{}').error).toBeTruthy()
    expect(parsePlanArgs('{"steps":[]}').error).toBeTruthy()
    expect(parsePlanArgs('{"steps":"not-array"}').error).toBeTruthy()
  })

  it('非法 status 归一为 pending（不让一个错字段毁掉整份清单）', () => {
    const { plan } = parsePlanArgs(JSON.stringify({ steps: [{ title: 'A', status: 'wat' }] }))
    expect(plan!.steps[0].status).toBe('pending')
  })

  it('无 title 的条目被丢弃；全空则整体拒绝', () => {
    expect(parsePlanArgs(JSON.stringify({ steps: [{ title: '', status: 'pending' }] })).error).toBeTruthy()
    const { plan } = parsePlanArgs(JSON.stringify({ steps: [{ title: 'ok' }, { title: '  ' }] }))
    expect(plan!.steps).toHaveLength(1)
  })

  it('超长字段被截断（防塞进提示词后爆上下文）', () => {
    const { plan } = parsePlanArgs(JSON.stringify({
      explanation: 'x'.repeat(1000),
      steps: [{ title: 'y'.repeat(1000), status: 'pending' }],
    }))
    expect(plan!.explanation!.length).toBeLessThanOrEqual(300)
    expect(plan!.steps[0].title.length).toBeLessThanOrEqual(200)
  })

  it('status 缺省视为 pending', () => {
    const { plan } = parsePlanArgs(JSON.stringify({ steps: [{ title: 'A' }] }))
    expect(plan!.steps[0].status).toBe('pending')
  })

  it('数组元素为 null 不抛错', () => {
    expect(() => parsePlanArgs('{"steps":[null,{"title":"A","status":"pending"}]}')).not.toThrow()
    expect(parsePlanArgs('{"steps":[null]}').error).toBeTruthy()
  })
})

describe('planAck / planReject', () => {
  it('应答是合法 JSON 且带进度', () => {
    const ack = planAck({ steps: [{ title: 'a', status: 'completed' }, { title: 'b', status: 'pending' }] })
    const j = JSON.parse(ack)
    expect(j.ok).toBe(true)
    expect(j.progress).toBe('1/2')
  })

  it('拒绝应答可被模型解析', () => {
    const j = JSON.parse(planReject('steps 为空'))
    expect(j.ok).toBe(false)
    expect(j.error).toContain('steps')
  })
})

describe('planProgress / planAllDone', () => {
  const plan = { steps: [
    { title: 'a', status: 'completed' as const },
    { title: 'b', status: 'completed' as const },
    { title: 'c', status: 'in_progress' as const },
  ] }

  it('统计完成数与标签', () => {
    expect(planProgress(plan)).toEqual({ done: 2, total: 3, label: '2/3' })
  })

  it('未全部完成时 allDone=false', () => {
    expect(planAllDone(plan)).toBe(false)
  })

  it('全部完成时 allDone=true', () => {
    expect(planAllDone({ steps: [{ title: 'a', status: 'completed' }] })).toBe(true)
  })

  it('空/ null 计划不误报完成', () => {
    expect(planAllDone(null)).toBe(false)
    expect(planAllDone({ steps: [] })).toBe(false)
  })
})
