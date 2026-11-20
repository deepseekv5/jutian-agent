/**
 * 思考内容字段归一化测试
 *
 * 回归背景：接了 OpenCode Zen 后思考过程完全不显示——上游推的是
 * `delta.reasoning`（OpenRouter 风格），而代码只认 `reasoning_content`。
 * 模型明明在思考，界面看起来像"不推理"。
 *
 * v18.1.1 追加：<think> 标签容错 —— 部分网关把标签原样混进思考字段；
 * 标签被网络分片切碎（<thi + nk>）属于跨 chunk 问题，无状态的
 * extractReasoning 只能剥完整标签，跨 chunk 交给 createThinkTagStream。
 */
import { describe, it, expect } from 'vitest'
import { extractReasoning, hasReasoning, stripThinkTags, createThinkTagStream } from '../src/shared/reasoning'

describe('extractReasoning', () => {
  it('reasoning_content（DeepSeek / step 系列）', () => {
    expect(extractReasoning({ reasoning_content: '先算乘法' })).toBe('先算乘法')
  })

  // 这条就是本次修的 bug
  it('reasoning（OpenCode Zen / OpenRouter 风格）', () => {
    expect(extractReasoning({ reasoning: 'The user' })).toBe('The user')
  })

  it('thinking（部分网关）', () => {
    expect(extractReasoning({ thinking: '让我想想' })).toBe('让我想想')
  })

  it('reasoning_details（OpenRouter 结构化形式）', () => {
    const d = { reasoning_details: [{ type: 'reasoning.text', text: '第一段' }, { text: '第二段' }] }
    expect(extractReasoning(d)).toBe('第一段第二段')
  })

  it('优先级：reasoning_content 先于 reasoning', () => {
    expect(extractReasoning({ reasoning_content: 'A', reasoning: 'B' })).toBe('A')
  })

  it('空字符串不算有内容', () => {
    expect(extractReasoning({ reasoning: '' })).toBe('')
    expect(extractReasoning({ reasoning_content: '' })).toBe('')
  })

  it('没有思考字段 → 空串', () => {
    expect(extractReasoning({ content: '正文' })).toBe('')
  })

  it('非法输入不抛错', () => {
    expect(extractReasoning(null)).toBe('')
    expect(extractReasoning(undefined)).toBe('')
    expect(extractReasoning('str')).toBe('')
    expect(extractReasoning(123)).toBe('')
  })

  it('reasoning_details 里非对象项被跳过', () => {
    expect(extractReasoning({ reasoning_details: [null, 'x', { text: 'ok' }] })).toBe('ok')
  })
})

describe('extractReasoning：<think> 标签容错（无状态，剥完整标签）', () => {
  it('网关把 <think> 包裹原样混进 reasoning_content → 剥标签留内部文本', () => {
    expect(extractReasoning({ reasoning_content: '<think>先算乘法再算加法</think>' })).toBe('先算乘法再算加法')
  })

  it('只有开标签的首块（网关逐字下发标签）→ 剥完为空，不产出垃圾', () => {
    // 旧行为会把 "<think>" 本身当思考文本吐进思考面板
    expect(extractReasoning({ reasoning_content: '<think>' })).toBe('')
    expect(extractReasoning({ reasoning: '</think>' })).toBe('')
  })

  it('标签与文本混合：开标签后的思考文本保留', () => {
    expect(extractReasoning({ reasoning: '<think>用户想算 17*3' })).toBe('用户想算 17*3')
  })

  it('reasoning_details 里夹带标签同样被剥', () => {
    expect(extractReasoning({ reasoning_details: [{ text: '<think>' }, { text: '想' }, { text: '</think>' }] })).toBe('想')
  })

  it('剥完为空的 details 不算有思考内容', () => {
    expect(hasReasoning({ reasoning_details: [{ text: '<think></think>' }] })).toBe(false)
  })

  it('被切碎的标签残片（无状态域内的合法文本）原样保留，不丢字', () => {
    // 单个 chunk 里的 '<thi' 无法与真文本区分（可能是 "a < b" 的 '<'），
    // 无状态函数宁可保留 —— 跨 chunk 的完整剥离由 createThinkTagStream 负责
    expect(extractReasoning({ reasoning_content: '<thi' })).toBe('<thi')
  })
})

describe('stripThinkTags（无状态整段剥离）', () => {
  it('剥离成对的完整标签', () => {
    expect(stripThinkTags('<think>思考</think>')).toBe('思考')
  })

  it('多处标签一并剥掉', () => {
    expect(stripThinkTags('<think>一</think>中<think>二</think>')).toBe('一中二')
  })

  it('无标签文本原样返回（含裸 < 不受影响）', () => {
    expect(stripThinkTags('普通文本 a < b')).toBe('普通文本 a < b')
    expect(stripThinkTags('')).toBe('')
  })
})

describe('createThinkTagStream：跨 chunk 标签剥离（核心边界）', () => {
  it('无标签的纯思考文本原样通过', () => {
    const s = createThinkTagStream()
    expect(s.push('让我想想')).toBe('让我想想')
    expect(s.push('，再想想')).toBe('，再想想')
    expect(s.flush()).toBe('')
  })

  it('完整开标签被剥掉，内部思考文本产出', () => {
    const s = createThinkTagStream()
    expect(s.push('<think>开始思考')).toBe('开始思考')
    expect(s.push('</think>后续')).toBe('')
  })

  it('开标签被切成 <thi + nk> 跨 chunk → 照样识别，不泄漏残片', () => {
    // 任务场景：网络分片把 <think> 切在中间，按 chunk 独立匹配必漏
    const s = createThinkTagStream()
    expect(s.push('前言<thi')).toBe('前言')
    expect(s.push('nk>真正的思考')).toBe('真正的思考')
  })

  it('开标签切成更碎的三段（< / think / >）也不丢不漏', () => {
    const s = createThinkTagStream()
    expect(s.push('<')).toBe('')
    expect(s.push('think')).toBe('')
    expect(s.push('>')).toBe('')
    expect(s.push('思考内容')).toBe('思考内容')
  })

  it('闭标签被切成 </thi + nk> → 思考在那里停住，之后不再产出', () => {
    const s = createThinkTagStream()
    expect(s.push('想一半</thi')).toBe('想一半')
    expect(s.push('nk>这是答案不是思考')).toBe('')
    expect(s.push('继续答案')).toBe('')
  })

  it('裸 < 非标签（如 "a < b"）不被误吞', () => {
    const s = createThinkTagStream()
    expect(s.push('判断 a < b 是否成立')).toBe('判断 a < b 是否成立')
    // '<' 在 chunk 尾、下一块不是标签 → 补回，不丢字
    expect(s.push('x < ')).toBe('x < ')
    expect(s.push('y')).toBe('y')
  })

  it('正文态再遇 <think> 重开（多段思考）→ 重新产出', () => {
    const s = createThinkTagStream()
    s.push('第一段</think>')
    expect(s.push('答案中间')).toBe('')
    expect(s.push('<think>第二段思考')).toBe('第二段思考')
  })

  it('flush 冲刷未完成的前缀残包（思考态按文本保留）', () => {
    const s = createThinkTagStream()
    s.push('想到最后 <')
    expect(s.flush()).toBe('<')
  })

  it('flush 在正文态不产出（残包是答案文本）', () => {
    const s = createThinkTagStream()
    s.push('思考</think>')
    // 正文态的 push 一律不产出（那是答案，不是思考）
    expect(s.push('答案 <')).toBe('')
    expect(s.flush()).toBe('')
  })

  it('与 extractReasoning 组合：流式思考字段的标签剥离全链路', () => {
    // 模拟真实消费路径：每块 delta 取 reasoning_content → 过剥离流 → 拼思考
    const s = createThinkTagStream()
    const deltas = [
      { reasoning_content: '<thi' },
      { reasoning_content: 'nk>用户想算 17*3' },
      { reasoning_content: '，先算 51' },
      { reasoning_content: '</thi' },
      { reasoning_content: 'nk>' },
    ]
    let fullThinking = ''
    for (const d of deltas) fullThinking += s.push(extractReasoning(d))
    fullThinking += s.flush()
    expect(fullThinking).toBe('用户想算 17*3，先算 51')
  })
})

describe('hasReasoning', () => {
  it('有内容 → true', () => {
    expect(hasReasoning({ reasoning: 'x' })).toBe(true)
  })

  it('无内容 → false', () => {
    expect(hasReasoning({ content: 'x' })).toBe(false)
    expect(hasReasoning({})).toBe(false)
  })
})
