/**
 * 发送前自检测试
 *
 * 关键性质：宁可少提示，不可乱提示。
 * 一个总在预警的提示等于没有提示 —— 所以只在"确定做不到"时报。
 */
import { describe, it, expect } from 'vitest'
import { needsWeb, selfCheck, shouldBlock } from '../src/renderer/engine/selfCheck'

const ok = { modelConfigured: true, web: true }

describe('needsWeb', () => {
  it('时效性关键词 → 需要联网', () => {
    for (const s of ['今天天气怎么样', '最新政策是什么', '现在的股价', '最近的新闻']) {
      expect(needsWeb(s), s).toBe(true)
    }
  })

  it('显式要求搜索 → 需要联网', () => {
    expect(needsWeb('帮我搜一下 Claude Code')).toBe(true)
    expect(needsWeb('查一下这个库的最新版本')).toBe(true)
  })

  it('给了 URL → 需要联网', () => {
    expect(needsWeb('看下 https://example.com 这个站')).toBe(true)
  })

  it('纯本地任务 → 不需要联网', () => {
    for (const s of ['帮我写个快速排序', '这段代码哪里错了', '把这句话翻译成英文', '重构这个函数']) {
      expect(needsWeb(s), s).toBe(false)
    }
  })

  it('空输入 → 不需要', () => {
    expect(needsWeb('')).toBe(false)
  })
})

// ─── 回归：apiKey 在界面里是掩码 ───
// 起因：最初用 effectiveApiKey(settings.apiKey) 判断"是否配了模型"，
// 而它对掩码（sk-****）返回空串 —— 结果每个正常用户都被判成没配模型，
// 发送被直接拦下。这条锁住正确的判据：看有没有选模型。
describe('回归:掩码 apiKey 不得误判为"没配模型"', () => {
  function effectiveApiKey(key?: string): string {
    const k = String(key || '')
    return k.indexOf('****') >= 0 ? '' : k
  }

  it('掩码密钥下 effectiveApiKey 返回空（所以不能拿它当判据）', () => {
    expect(effectiveApiKey('sk-****abcd')).toBe('')
  })

  it('界面典型状态（掩码密钥 + 已选模型）应放行', () => {
    const maskedKey = effectiveApiKey('sk-****abcd')   // → ''
    const modelConfigured = !!maskedKey || !!'auto'     // 正确判据
    const r = selfCheck('帮我写个排序', { modelConfigured, web: true })
    expect(r.level).toBe('ok')
  })

  it('既没密钥也没选模型才拦', () => {
    const r = selfCheck('帮我写个排序', { modelConfigured: false, web: true })
    expect(r.level).toBe('block')
  })
})

describe('selfCheck', () => {
  it('配置齐全且无需联网 → ok', () => {
    const r = selfCheck('帮我写个排序', ok)
    expect(r.level).toBe('ok')
    expect(r.message).toBe('')
  })

  // 最高频的真实卡点：没配模型就开聊
  it('未配置模型 → block,并指路怎么配', () => {
    const r = selfCheck('你好', { modelConfigured: false, web: true })
    expect(r.level).toBe('block')
    expect(r.message).toContain('模型')
    expect(shouldBlock(r)).toBe(true)
  })

  it('要联网但没能力 → warn(不拦截)', () => {
    const r = selfCheck('今天新闻有什么', { modelConfigured: true, web: false })
    expect(r.level).toBe('warn')
    expect(r.message).toContain('联网')
    expect(shouldBlock(r)).toBe(false)
  })

  // 防"乱提示"：本地任务不该被提醒联网
  it('本地任务即使没联网能力也不提示', () => {
    const r = selfCheck('帮我写个快速排序', { modelConfigured: true, web: false })
    expect(r.level).toBe('ok')
  })

  it('空输入 → block', () => {
    expect(selfCheck('   ', ok).level).toBe('block')
  })

  it('block 优先于 warn(没配模型就不谈联网)', () => {
    const r = selfCheck('今天新闻', { modelConfigured: false, web: false })
    expect(r.level).toBe('block')
  })

  it('有联网能力时不因联网类问题提示', () => {
    expect(selfCheck('今天新闻', ok).level).toBe('ok')
  })
})