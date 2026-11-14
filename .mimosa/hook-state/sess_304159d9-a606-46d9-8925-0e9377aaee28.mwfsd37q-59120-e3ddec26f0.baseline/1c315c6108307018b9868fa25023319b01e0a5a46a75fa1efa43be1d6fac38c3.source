/**
 * 计划文本解析测试
 *
 * 模型输出计划的格式不可控：有序/无序列表、"步骤N"前缀、标题混在正文里、
 * 空行、装饰符。要能宽松提取，也不要把普通叙述误判成计划。
 */
import { describe, it, expect } from 'vitest'
import { parsePlanFromText, looksLikePlan } from '../src/renderer/engine/planParse'

describe('parsePlanFromText', () => {
  it('有序列表', () => {
    const r = parsePlanFromText('1. 读取入口文件\n2. 定位渲染路径\n3. 修复并验证')
    expect(r!.steps.map(s => s.title)).toEqual(['读取入口文件', '定位渲染路径', '修复并验证'])
  })

  it('无序列表(- 与 *)', () => {
    const r = parsePlanFromText('计划如下:\n- 先加类型\n- 再改调用点\n* 最后补测试')
    expect(r!.steps).toHaveLength(3)
  })

  it('中文序号 一、二、', () => {
    const r = parsePlanFromText('一、梳理现状\n二、设计方案\n三、落地')
    expect(r!.steps.map(s => s.title)).toEqual(['梳理现状', '设计方案', '落地'])
  })

  it('"步骤N / 第N步" 前缀', () => {
    const r = parsePlanFromText('步骤 1: 备份\n步骤2：改造\n第 3 步：回归')
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[1].title).toBe('改造')
  })

  it('去掉 markdown 强调与反引号', () => {
    const r = parsePlanFromText('1. **重构** `serve.ts`')
    expect(r!.steps[0].title).toBe('重构 serve.ts')
  })

  it('跳过标题与叙述性文字', () => {
    const r = parsePlanFromText('实施计划\n以下是我的方案。\n1. 第一步\n说明：这是补充。')
    expect(r!.steps.map(s => s.title)).toEqual(['第一步'])
  })

  it('去重(大小写不敏感)', () => {
    const r = parsePlanFromText('1. Fix bug\n2. fix bug')
    expect(r!.steps).toHaveLength(1)
  })

  it('截断超长项', () => {
    const r = parsePlanFromText('1. ' + 'x'.repeat(500))
    expect(r!.steps[0].title.length).toBeLessThanOrEqual(300)
  })

  it('纯叙述无列表 → null', () => {
    expect(parsePlanFromText('我觉得应该先看看代码。')).toBeNull()
  })

  it('空/非法输入 → null,不抛错', () => {
    expect(parsePlanFromText('')).toBeNull()
    expect(parsePlanFromText(undefined as any)).toBeNull()
  })
})

describe('looksLikePlan', () => {
  it('含"计划"标题且有步骤 → true', () => {
    expect(looksLikePlan('## 计划\n1. 做 a\n2. 做 b')).toBe(true)
  })

  it('无"计划"字样 → false', () => {
    expect(looksLikePlan('1. 做 a\n2. 做 b')).toBe(false)
  })

  it('有标题无步骤 → false', () => {
    expect(looksLikePlan('这是计划，但没有列出来。')).toBe(false)
  })
})
