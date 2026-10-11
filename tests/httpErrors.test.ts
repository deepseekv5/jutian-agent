/**
 * 上游 HTTP 错误映射测试
 *
 * 这组函数决定用户看到什么报错文案。原则是「不只报数字，要给出下一步」——
 * 用户看到「请求失败 (402)」无法判断是自己欠费、模型名写错还是网络问题。
 */
import { describe, it, expect } from 'vitest'
import { friendlyHttpError, extractErrorDetail, buildHttpErrorMessage } from '../src/renderer/engine/httpErrors'

describe('friendlyHttpError', () => {
  it('限流与欠费给出可操作建议', () => {
    expect(friendlyHttpError(429)).toMatch(/稍后重试|换一个模型/)
    expect(friendlyHttpError(402)).toMatch(/充值|免费模型/)
  })

  it('鉴权与权限问题指向设置或开通状态', () => {
    expect(friendlyHttpError(401)).toMatch(/密钥/)
    expect(friendlyHttpError(403)).toMatch(/无权|未开通|受限/)
  })

  it('地址类错误提示核对配置', () => {
    expect(friendlyHttpError(404)).toMatch(/模型名|接口地址/)
  })

  it('5xx 一律归为上游故障并给替代方案', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(friendlyHttpError(s)).toMatch(/上游|稍后重试/)
    }
  })

  it('413 提示减少附件或上下文', () => {
    expect(friendlyHttpError(413)).toMatch(/附件|上下文/)
  })

  it('未覆盖的状态码返回空串，由调用方回落通用文案', () => {
    expect(friendlyHttpError(418)).toBe('')
    expect(friendlyHttpError(200)).toBe('')
  })
})

describe('extractErrorDetail', () => {
  it('兼容 error / hint / detail 三种字段名', () => {
    expect(extractErrorDetail('{"error":"配额用尽"}')).toBe('配额用尽')
    expect(extractErrorDetail('{"hint":"换个模型"}')).toBe('换个模型')
    expect(extractErrorDetail('{"detail":"bad request"}')).toBe('bad request')
  })

  it('error 是对象时取 message', () => {
    expect(extractErrorDetail('{"error":{"message":"invalid key"}}')).toBe('invalid key')
  })

  it('非 JSON 时截断原文（避免把整页 HTML 塞进界面）', () => {
    const html = '<html>' + 'x'.repeat(500)
    const got = extractErrorDetail(html)
    expect(got.length).toBeLessThanOrEqual(200)
    expect(got.startsWith('<html>')).toBe(true)
  })

  it('空输入返回空串', () => {
    expect(extractErrorDetail('')).toBe('')
  })

  it('JSON 但无已知字段时返回空串，不抛错', () => {
    expect(extractErrorDetail('{"unrelated":1}')).toBe('')
    expect(extractErrorDetail('[]')).toBe('')
    expect(extractErrorDetail('null')).toBe('')
  })
})

describe('buildHttpErrorMessage', () => {
  it('已知状态码 + 有细节时用冒号连接', () => {
    const msg = buildHttpErrorMessage(429, '{"error":"rate limit exceeded"}')
    expect(msg).toContain('请求过于频繁')
    expect(msg).toContain('rate limit exceeded')
  })

  it('未知状态码回落到「请求失败 (码)」', () => {
    expect(buildHttpErrorMessage(418, '')).toBe('请求失败 (418)')
  })

  it('无细节时不留下多余冒号', () => {
    expect(buildHttpErrorMessage(500, '')).not.toContain('：')
  })
})
