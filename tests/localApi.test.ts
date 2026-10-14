/**
 * 开放本地 API 测试
 *
 * 这是一个"开入口"的功能，安全判据必须钉死：
 *  · 未开启 → 一律拒绝
 *  · 无 Key / Key 错 → 401
 *  · 局域网 Key 不能从本机顶替，本机 Key 也不能从外部顶替
 *  · 局域网范围未开时，外部请求一律拒绝
 */
import { describe, it, expect } from 'vitest'
import {
  authorizeLocalApi, bindAddress, validateConfig, endpointInfo, mintApiKey,
  LOCAL_API_DEFAULT_PORT, type LocalApiConfig,
} from '../src/shared/localApi'

const cfg = (over: Partial<LocalApiConfig> = {}): LocalApiConfig => ({
  enabled: true,
  port: LOCAL_API_DEFAULT_PORT,
  scope: 'local',
  key: 'ly-aaaa',
  lanKey: 'ly-bbbb',
  ...over,
})

describe('authorizeLocalApi — 关闭时必须全拒', () => {
  it('未开启 → 403（即使 Key 正确）', () => {
    const r = authorizeLocalApi('Bearer ly-aaaa', true, cfg({ enabled: false }))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })
})

describe('authorizeLocalApi — 本机访问', () => {
  it('本机 Key 正确 → 放行', () => {
    expect(authorizeLocalApi('Bearer ly-aaaa', true, cfg()).ok).toBe(true)
  })

  it('缺 Key → 401', () => {
    expect(authorizeLocalApi(undefined, true, cfg()).status).toBe(401)
    expect(authorizeLocalApi('', true, cfg()).status).toBe(401)
  })

  it('Key 错 → 401', () => {
    expect(authorizeLocalApi('Bearer wrong', true, cfg()).status).toBe(401)
  })

  // 关键安全性质：局域网 Key 不能在本机顶替本机 Key
  it('拿局域网 Key 从本机访问 → 拒绝', () => {
    expect(authorizeLocalApi('Bearer ly-bbbb', true, cfg()).ok).toBe(false)
  })

  it('接受裸 Key（不带 Bearer 前缀）', () => {
    expect(authorizeLocalApi('ly-aaaa', true, cfg()).ok).toBe(true)
  })

  it('Bearer 大小写不敏感', () => {
    expect(authorizeLocalApi('bearer ly-aaaa', true, cfg()).ok).toBe(true)
  })
})

describe('authorizeLocalApi — 局域网访问', () => {
  it('局域网范围开启 + 局域网 Key → 放行', () => {
    expect(authorizeLocalApi('Bearer ly-bbbb', false, cfg({ scope: 'lan' })).ok).toBe(true)
  })

  it('局域网范围未开 → 外部一律拒绝（即便 Key 对）', () => {
    const r = authorizeLocalApi('Bearer ly-bbbb', false, cfg({ scope: 'local' }))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  // 关键安全性质：本机 Key 不能从外部使用
  it('拿本机 Key 从外部访问 → 拒绝', () => {
    expect(authorizeLocalApi('Bearer ly-aaaa', false, cfg({ scope: 'lan' })).ok).toBe(false)
  })

  it('未生成局域网 Key 时外部访问被拒', () => {
    expect(authorizeLocalApi('Bearer anything', false, cfg({ scope: 'lan', lanKey: '' })).ok).toBe(false)
  })
})

describe('bindAddress', () => {
  it('本机范围只绑回环', () => {
    expect(bindAddress('local')).toBe('127.0.0.1')
  })

  it('局域网范围绑全部接口', () => {
    expect(bindAddress('lan')).toBe('0.0.0.0')
  })
})

describe('validateConfig', () => {
  it('端口越界报错', () => {
    expect(validateConfig({ port: 80 }).ok).toBe(false)
    expect(validateConfig({ port: 99999 }).ok).toBe(false)
    expect(validateConfig({ port: 3000 }).ok).toBe(true)
  })

  it('开局域网但没局域网 Key → 报错', () => {
    expect(validateConfig({ enabled: true, scope: 'lan', lanKey: '' }).ok).toBe(false)
  })

  it('本机范围不需要局域网 Key', () => {
    expect(validateConfig({ enabled: true, scope: 'local', lanKey: '' }).ok).toBe(true)
  })
})

describe('endpointInfo', () => {
  it('本机范围给回环地址', () => {
    expect(endpointInfo(cfg()).baseUrl).toBe(`http://127.0.0.1:${LOCAL_API_DEFAULT_PORT}/v1`)
  })

  it('局域网范围提示替换 IP', () => {
    const i = endpointInfo(cfg({ scope: 'lan' }))
    expect(i.baseUrl).toContain('0.0.0.0')
    expect(i.hint).toContain('局域网')
  })
})

describe('mintApiKey', () => {
  it('带前缀且含随机部分', () => {
    const k = mintApiKey((n) => 'a'.repeat(n))
    expect(k.startsWith('ly-')).toBe(true)
    expect(k.length).toBe(35)
  })
})
