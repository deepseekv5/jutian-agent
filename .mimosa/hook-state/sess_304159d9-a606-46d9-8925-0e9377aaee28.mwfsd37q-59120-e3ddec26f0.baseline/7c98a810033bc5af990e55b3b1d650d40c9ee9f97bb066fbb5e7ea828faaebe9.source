/**
 * OpenCode Zen 免费车道测试
 *
 * 这个模块的价值全在"踩过的坑"上，所以测试也围绕坑：
 *  - 强制 stream（非流式 403 且报错误导）
 *  - session/request id 形状必须合法
 *  - 四个小写指纹工具必须齐
 *  - 两种 403 要能分辨（地区 vs 姿势）
 */
import { describe, it, expect } from 'vitest'
import {
  mintSessionId, mintRequestId, SESSION_RE, REQUEST_RE,
  isZenBase, zenEndpoint, zenHeaders, zenBody,
  withFingerprintTools, classifyZenError, FINGERPRINT_TOOLS,
  ZEN_FREE_MODELS, ZEN_KNOWN_DEAD, chatToResponsesShape,
} from '../src/shared/opencodeZen'

describe('session / request id 形状', () => {
  it('生成的 id 符合上游要求的形状', () => {
    expect(SESSION_RE.test(mintSessionId())).toBe(true)
    expect(REQUEST_RE.test(mintRequestId())).toBe(true)
  })

  it('连续生成不重复', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintSessionId()))
    expect(ids.size).toBe(200)
  })

  // 上游会校验低 12 位计数器要小；随机哈希虽然也是 hex 但过不了
  it('低 12 位计数器保持在合理范围', () => {
    const id = mintSessionId(1792000000000)
    const low = parseInt(id.slice(4 + 9, 4 + 12), 16)
    expect(0xfff - low).toBeLessThan(16)
  })
})

describe('isZenBase', () => {
  it('识别本车道', () => {
    expect(isZenBase('https://opencode.ai/zen/v1')).toBe(true)
    expect(isZenBase('https://opencode.ai/zen/v1/')).toBe(true)
  })

  it('不误判其他源', () => {
    expect(isZenBase('https://api.kilo.ai/api/gateway/v1')).toBe(false)
    expect(isZenBase('https://text.pollinations.ai/openai')).toBe(false)
    expect(isZenBase('')).toBe(false)
  })
})

describe('zenEndpoint', () => {
  it('muse-spark 走 /responses', () => {
    expect(zenEndpoint('muse-spark-1.3-contributor-free')).toBe('/responses')
  })

  it('其余走 /chat/completions', () => {
    expect(zenEndpoint('big-pickle')).toBe('/chat/completions')
    expect(zenEndpoint('mimo-v2.6-flash-free')).toBe('/chat/completions')
  })
})

describe('zenHeaders', () => {
  const h = zenHeaders('ses_abcdef012345AAAAAAAAAAAAAA', 'msg_abcdef012345BBBBBBBBBBBBBB', true)

  it('带齐上游指纹要求的头', () => {
    expect(h['x-opencode-client']).toBe('cli')
    expect(h['x-opencode-session']).toBeTruthy()
    expect(h['x-opencode-request']).toBeTruthy()
    expect(h['x-opencode-project']).toBe('global')
  })

  it('用 public 免密凭据', () => {
    expect(h['authorization']).toBe('Bearer public')
  })

  it('流式请求声明 event-stream', () => {
    expect(h['accept']).toBe('text/event-stream')
    expect(zenHeaders('a', 'b', false)['accept']).toBe('*/*')
  })
})

describe('zenBody — 强制流式', () => {
  // 这是最大的坑：同一个模型，stream:false 一律 403 FreeTierError
  it('即使调用方要求非流式也强制 stream:true', () => {
    const b = zenBody('big-pickle', { stream: false, messages: [] })
    expect(b.stream).toBe(true)
  })

  it('未指定 stream 时也置为 true', () => {
    expect(zenBody('big-pickle', {}).stream).toBe(true)
  })

  it('chat 端点补 stream_options.include_usage', () => {
    const b = zenBody('big-pickle', {})
    expect((b.stream_options as any).include_usage).toBe(true)
  })

  it('responses 端点不塞 stream_options', () => {
    const b = zenBody('muse-spark-1.3-contributor-free', {})
    expect(b.stream_options).toBeUndefined()
  })

  it('保留原有字段', () => {
    const b = zenBody('big-pickle', { messages: [{ role: 'user' }], max_tokens: 99 })
    expect(b.max_tokens).toBe(99)
    expect((b.messages as any[]).length).toBe(1)
  })
})

describe('withFingerprintTools', () => {
  const mk = (name: string) => ({ type: 'function', function: { name, description: 'placeholder' } })

  it('缺的指纹工具被补齐', () => {
    const out = withFingerprintTools([mk('custom')], mk)
    const names = out.map(t => t.function?.name)
    for (const n of FINGERPRINT_TOOLS) expect(names).toContain(n)
  })

  it('调用方已有的同名工具不被覆盖（保留真实能力）', () => {
    const real = { type: 'function', function: { name: 'bash', description: '真实 bash' } }
    const out = withFingerprintTools([real], mk)
    const bash = out.filter(t => t.function?.name === 'bash')
    expect(bash).toHaveLength(1)
    expect(bash[0].function?.description).toBe('真实 bash')
  })

  it('大小写不敏感（已有 Bash 也算占位）', () => {
    const out = withFingerprintTools([mk('Bash')], mk)
    const lower = out.filter(t => String(t.function?.name).toLowerCase() === 'bash')
    expect(lower.length).toBeGreaterThanOrEqual(1)
  })

  it('空工具表也补齐四个', () => {
    const out = withFingerprintTools([], mk)
    expect(out).toHaveLength(FINGERPRINT_TOOLS.length)
  })
})

describe('classifyZenError — 两种 403 必须分清', () => {
  it('地区限制', () => {
    const r = classifyZenError(403, '{"type":"error","error":{"type":"RegionError","message":"This model is not available in your country"}}')
    expect(r.kind).toBe('region')
    expect(r.message).toContain('地区')
  })

  it('模型不路由', () => {
    expect(classifyZenError(403, 'Upstream request failed: Endpoint is unavailable.').kind).toBe('unavailable')
  })

  it('免费额度/姿势问题', () => {
    expect(classifyZenError(403, '{"error":{"type":"FreeTierError"}}').kind).toBe('auth')
  })

  it('其他', () => {
    expect(classifyZenError(500, 'boom').kind).toBe('other')
  })
})

describe('模型清单', () => {
  it('离线兜底清单非空且 id 唯一', () => {
    expect(ZEN_FREE_MODELS.length).toBeGreaterThan(0)
    expect(new Set(ZEN_FREE_MODELS.map(m => m.id)).size).toBe(ZEN_FREE_MODELS.length)
  })

  // 已知不路由的 id 走"标记"而不是"隐藏"：面板要显示全部模型，
  // 但必须如实标注哪些在当前网络下用不了
  it('已知不可用的 id 都在标记表里，且不混进离线可用清单', () => {
    const usable = new Set(ZEN_FREE_MODELS.map(m => m.id))
    for (const id of Object.keys(ZEN_KNOWN_DEAD)) {
      expect(usable.has(id)).toBe(false)
      expect(ZEN_KNOWN_DEAD[id].length).toBeGreaterThan(0)
    }
  })

  it('标记表覆盖实测确认不可用的那几个', () => {
    for (const id of ['cat-jam-free', 'muse-spark-1.3-contributor-free']) {
      expect(ZEN_KNOWN_DEAD[id]).toBeTruthy()
    }
  })
})

// muse-spark 系列走 /responses 端点，但渲染层只会发 Chat 形状。
// 不转换即使不在地区限制名单里也会 400——input/max_output_tokens 形状不匹配。
describe('chatToResponsesShape — /responses 端点形状转换', () => {
  it('messages → input', () => {
    const r = chatToResponsesShape({ messages: [{ role: 'user', content: '你好' }] })
    expect(r.input).toBe('你好')
    expect(r.messages).toBeUndefined()
  })

  it('多轮拼接带角色前缀（system/assistant 可辨识）', () => {
    const r = chatToResponsesShape({
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '问题' },
        { role: 'assistant', content: '回答' },
      ],
    })
    expect(r.input).toBe('system: 你是助手\n\n问题\n\nassistant: 回答')
  })

  it('max_tokens → max_output_tokens', () => {
    const r = chatToResponsesShape({ messages: [], max_tokens: 512 })
    expect(r.max_output_tokens).toBe(512)
    expect(r.max_tokens).toBeUndefined()
  })

  it('stream_options 被删除（Responses 无此字段）', () => {
    const r = chatToResponsesShape({ messages: [], stream_options: { include_usage: true } })
    expect(r.stream_options).toBeUndefined()
  })

  it('无 max_tokens 时不产生 max_output_tokens', () => {
    const r = chatToResponsesShape({ messages: [{ role: 'user', content: 'x' }] })
    expect(r.max_output_tokens).toBeUndefined()
  })

  it('tools 从 Chat 嵌套形状剥平为 Responses 扁平形状', () => {
    const r = chatToResponsesShape({
      messages: [],
      tools: [{ type: 'function', function: { name: 'bash', description: 'd', parameters: {} } }],
    })
    expect(r.tools).toEqual([{ name: 'bash', description: 'd', parameters: {} }])
  })

  it('已是扁平形状的 tools 原样保留', () => {
    const flat = { name: 'read', description: 'x', parameters: {} }
    const r = chatToResponsesShape({ messages: [], tools: [flat] })
    expect(r.tools).toEqual([flat])
  })

  it('其余字段原样保留（temperature 等）', () => {
    const r = chatToResponsesShape({ messages: [], temperature: 0.7, stream: true })
    expect(r.temperature).toBe(0.7)
    expect(r.stream).toBe(true)
  })

  it('messages 缺失/非数组 → 不产生 input，不抛错', () => {
    const r = chatToResponsesShape({})
    expect(r.input).toBeUndefined()
  })
})
