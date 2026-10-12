/**
 * 标题清洗测试
 *
 * 这些用例全部来自实测：模型确实会返回过这些话，
 * 而它们一旦显示在顶栏 tab / 侧栏上就是明显的脏数据。
 */
import { describe, it, expect } from 'vitest'
import { sanitizeTitle, fallbackTitle } from '../src/renderer/utils/titleSanitize'

describe('sanitizeTitle', () => {
  it('正常标题原样通过', () => {
    expect(sanitizeTitle('官网首页改版')).toBe('官网首页改版')
  })

  it('剥掉包裹引号与书名号', () => {
    expect(sanitizeTitle('「AI 标题」')).toBe('AI 标题')
    expect(sanitizeTitle('《官网改版》')).toBe('官网改版')
    expect(sanitizeTitle('"官网改版"')).toBe('官网改版')
  })

  it('剥掉「标题：」前缀', () => {
    expect(sanitizeTitle('标题：官网改版')).toBe('官网改版')
    expect(sanitizeTitle('标题是 官网改版')).toBe('官网改版')
  })

  it('剥掉结尾句号', () => {
    expect(sanitizeTitle('官网改版。')).toBe('官网改版')
  })

  // 实测症状：模型把客套话当标题返回，直接显示在 tab 上
  it('客套开场白 → 空(让调用方回退)', () => {
    expect(sanitizeTitle('您好！')).toBe('')
    expect(sanitizeTitle('你好，很高兴见到你。')).toBe('')
    expect(sanitizeTitle('作为一个AI助手，我不能')).toBe('')
    expect(sanitizeTitle('抱歉，我无法完成这个请求')).toBe('')
  })

  it('元叙述长句 → 空', () => {
    expect(sanitizeTitle('在我们当前的对话中，我并没有看到之前提到的内容')).toBe('')
    expect(sanitizeTitle('请提供更多信息以便我理解您的需求')).toBe('')
    expect(sanitizeTitle('综上所述，我们需要先重构数据层')).toBe('')
  })

  it('多行时取那条像标题的', () => {
    const raw = '您好！我理解您的需求。\n官网首页改版'
    expect(sanitizeTitle(raw)).toBe('官网首页改版')
  })

  it('超长截断到 20 字', () => {
    expect(sanitizeTitle('一'.repeat(50)).length).toBe(20)
  })

  it('空输入 → 空', () => {
    expect(sanitizeTitle('')).toBe('')
    expect(sanitizeTitle('   ')).toBe('')
  })

  it('短标题带句号仍保留(不像完整句子)', () => {
    expect(sanitizeTitle('修 bug')).toBe('修 bug')
  })
})

describe('fallbackTitle', () => {
  it('取首行并去 markdown 装饰', () => {
    expect(fallbackTitle('**帮我改**首页\n第二行')).toBe('帮我改首页')
  })

  it('空内容 → 新对话', () => {
    expect(fallbackTitle('')).toBe('新对话')
    expect(fallbackTitle('   \n  ')).toBe('新对话')
  })

  it('超长截断', () => {
    expect(fallbackTitle('一'.repeat(80)).length).toBe(20)
  })
})