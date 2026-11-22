import { describe, it, expect } from 'vitest'
import {
  FailureRecovery,
  classifyFailureKind,
  argsSignature,
  parentPath,
  extractSuggestedPath,
  parseInvalidArgs,
  defaultForField,
  isWriteTool,
  switchToolAdvice,
  RING_BUFFER_LIMIT,
  REPEAT_STOP_LIMIT,
  TOOL_ERROR_SWITCH_LIMIT,
  UNKNOWN_SUMMARY_LIMIT,
  STOP_WINDOW,
  STOP_SAME_KIND,
  STOP_ACTIONABLE,
  type FailureEvent,
} from '../src/shared/failureRecovery'

// 内核级失败恢复：分类 -> 决策 -> 状态机，判据必须钉死边界。
// 事件工厂用自增 clock 保证 round/at 唯一，避免测试之间串味。

let clock = 0
function mk(over: Partial<FailureEvent> = {}): FailureEvent {
  clock += 1
  return {
    toolName: 'read_file',
    args: {},
    errorText: '',
    round: clock,
    at: clock * 100,
    ...over,
  }
}

function planAll(rec: FailureRecovery, events: FailureEvent[]): void {
  for (const e of events) {
    rec.record(e)
    rec.plan(e)
  }
}

describe('classifyFailureKind 文本分类', () => {
  it('not_found：中英文与 errno 各种写法', () => {
    for (const text of [
      '文件不存在', '路径不存在', 'File not found',
      'ENOENT: no such file or directory', 'No such file or directory', '找不到目标',
    ]) {
      expect(classifyFailureKind(text), text).toBe('not_found')
    }
  })

  it('permission：权限拒绝、只读、EACCES', () => {
    for (const text of [
      'permission denied', 'EACCES: permission denied', 'Access denied',
      '只读文件系统', '路径不允许', 'operation not permitted', '没有权限',
    ]) {
      expect(classifyFailureKind(text), text).toBe('permission')
    }
  })

  it('invalid_args：参数缺失、校验、JSON 破损', () => {
    for (const text of [
      '缺少参数 path', 'required field "content" is missing',
      'invalid arguments', 'JSON 破损', '参数校验失败', 'unexpected token in JSON',
    ]) {
      expect(classifyFailureKind(text), text).toBe('invalid_args')
    }
  })

  it('tool_error：超时、HTTP 5xx、上游故障', () => {
    for (const text of [
      'Request timeout after 30s', '请求超时', 'HTTP 503 Service Unavailable',
      '上游服务异常', 'ETIMEDOUT', 'bad gateway', '服务不可用',
    ]) {
      expect(classifyFailureKind(text), text).toBe('tool_error')
    }
  })

  it('context_overflow：上下文长度与 token 限制', () => {
    for (const text of [
      'context length exceeded', 'maximum context length',
      '上下文过长', '上下文超限', 'too many tokens', 'token limit exceeded',
    ]) {
      expect(classifyFailureKind(text), text).toBe('context_overflow')
    }
  })

  it('unknown：无关键词时兜底', () => {
    expect(classifyFailureKind('奇怪的错误码 XYZ')).toBe('unknown')
    expect(classifyFailureKind('')).toBe('unknown')
  })

  it('优先级：上下文溢出 > 路径 > 权限 > 参数 > 工具错误', () => {
    expect(classifyFailureKind('context length exceeded, file not found')).toBe('context_overflow')
    expect(classifyFailureKind('ENOENT and permission denied')).toBe('not_found')
    expect(classifyFailureKind('permission denied, 参数错误')).toBe('permission')
    expect(classifyFailureKind('参数错误，timeout')).toBe('invalid_args')
  })

  it('英文大小写不敏感', () => {
    expect(classifyFailureKind('NOT FOUND')).toBe('not_found')
    expect(classifyFailureKind('PERMISSION DENIED')).toBe('permission')
    expect(classifyFailureKind('TIMEOUT')).toBe('tool_error')
  })
})

describe('辅助判据', () => {
  it('argsSignature：对象键序无关，数组顺序有关', () => {
    expect(argsSignature('t', { b: 2, a: 1 })).toBe(argsSignature('t', { a: 1, b: 2 }))
    expect(argsSignature('t', { n: { y: 2, x: 1 } })).toBe(argsSignature('t', { n: { x: 1, y: 2 } }))
    expect(argsSignature('t', { x: [1, 2] })).not.toBe(argsSignature('t', { x: [2, 1] }))
    expect(argsSignature('t', {})).toBe(argsSignature('t', undefined))
  })

  it('parentPath：相对/绝对/无分隔符路径', () => {
    expect(parentPath('src/a/b.txt')).toBe('src/a')
    expect(parentPath('/a/b.txt')).toBe('/a')
    expect(parentPath('b.txt')).toBe('.')
    // 反斜杠统一按分隔符处理，输出用正斜杠，保证跨平台一致
    expect(parentPath('a\\b\\c.txt')).toBe('a/b')
  })

  it('extractSuggestedPath：从 did you mean 提取疑似正确路径', () => {
    expect(extractSuggestedPath('ENOENT. Did you mean "src/real.txt"?')).toBe('src/real.txt')
    expect(extractSuggestedPath('你是否想找 src/real.txt')).toBe('src/real.txt')
    expect(extractSuggestedPath('no such file')).toBe('')
  })

  it('parseInvalidArgs：提取缺失字段、空字段、JSON 破损标记', () => {
    const info = parseInvalidArgs('missing required field "content"; 参数 path 不能为空; JSON 破损')
    expect(info.fields).toContain('content')
    expect(info.fields).toContain('path')
    expect(info.emptyFields).toContain('path')
    expect(info.jsonBroken).toBe(true)
    expect(parseInvalidArgs('一切正常').fields).toEqual([])
  })

  it('defaultForField：只补安全默认值，路径与已有值不猜', () => {
    expect(defaultForField('content', {})).toBe('')
    expect(defaultForField('items', { content: 'x' })).toEqual([])
    expect(defaultForField('options', {})).toEqual({})
    expect(defaultForField('force', {})).toBe(false)
    expect(defaultForField('path', {})).toBeUndefined()
    expect(defaultForField('content', { content: '已有内容' })).toBeUndefined()
  })

  it('isWriteTool / switchToolAdvice：写类工具与替代路线', () => {
    expect(isWriteTool('write_file')).toBe(true)
    expect(isWriteTool('list_dir')).toBe(false)
    expect(switchToolAdvice('shell')).toContain('read_file')
    expect(switchToolAdvice('write_file')).toContain('list_dir')
    expect(switchToolAdvice('unknown_tool')).toContain('换一个')
  })
})

describe('plan 分类与恢复动作', () => {
  it('not_found + path：read_first，指令含 list_dir 与父目录', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'write_file', args: { path: 'src/a.txt' }, errorText: 'ENOENT: no such file' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('not_found')
    expect(p.action).toBe('read_first')
    expect(p.instruction).toContain('list_dir')
    expect(p.instruction).toContain('src')
    expect(p.patches).toBeUndefined()
    expect(p.confidence).toBeGreaterThan(0.9)
  })

  it('not_found + 疑似路径：patches.path 给出可核对的建议', () => {
    const rec = new FailureRecovery()
    const e = mk({
      toolName: 'read_file',
      args: { path: 'wrong.txt' },
      errorText: 'ENOENT. Did you mean "real.txt"?',
    })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.action).toBe('read_first')
    expect(p.patches?.path).toBe('real.txt')
    expect(p.instruction).toContain('real.txt')
  })

  it('not_found 无 path：仍先列目录，不猜路径', () => {
    const rec = new FailureRecovery()
    const e = mk({ args: {}, errorText: 'file not found' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('not_found')
    expect(p.action).toBe('read_first')
    expect(p.instruction).toContain('list_dir')
    expect(p.patches).toBeUndefined()
  })

  it('permission 写操作 + 只读：summarize_exit，建议换可写路径', () => {
    const rec = new FailureRecovery()
    const e = mk({
      toolName: 'write_file',
      args: { path: '/sys/a.txt' },
      errorText: 'EACCES: read-only file system, permission denied',
    })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('permission')
    expect(p.action).toBe('summarize_exit')
    expect(p.instruction).toContain('可写路径')
  })

  it('permission 非只读：switch_tool，给出具体替代工具', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'shell', args: { command: 'ls' }, errorText: 'permission denied' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('permission')
    expect(p.action).toBe('switch_tool')
    expect(p.instruction).toContain('read_file')
    expect(p.reason).toContain('permission')
  })

  it('invalid_args：fix_args，提取字段并补空 content', () => {
    const rec = new FailureRecovery()
    const e = mk({
      toolName: 'write_file',
      args: { path: 'a.txt', content: '' },
      errorText: '参数 content 不能为空',
    })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('invalid_args')
    expect(p.action).toBe('fix_args')
    expect(p.patches?.content).toBe('')
    expect(p.instruction).toContain('content')
    expect(p.instruction).toContain('不要原样重试')
  })

  it('invalid_args required field：补 query 默认值', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'search', args: {}, errorText: 'missing required field "query"' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.action).toBe('fix_args')
    expect(p.patches?.query).toBe('')
    expect(p.instruction).toContain('query')
  })

  it('invalid_args 路径字段不猜，patches 为空', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'read_file', args: {}, errorText: '缺少参数 path' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.action).toBe('fix_args')
    expect(p.patches).toBeUndefined()
    expect(p.confidence).toBeLessThan(0.9)
  })

  it('invalid_args JSON 破损：提示重生成合法 JSON，不给假补丁', () => {
    const rec = new FailureRecovery()
    const e = mk({
      toolName: 'apply',
      args: { payload: '{bad json' },
      errorText: 'JSON parse error: unexpected token',
    })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('invalid_args')
    expect(p.action).toBe('fix_args')
    expect(p.instruction).toContain('JSON')
    expect(p.patches).toBeUndefined()
  })

  it('tool_error 第 1 次：retry_same，低风险临时错误', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'fetch_data', errorText: 'Request timeout' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('tool_error')
    expect(p.action).toBe('retry_same')
    expect(p.instruction).toContain('原样重试一次')
    expect(TOOL_ERROR_SWITCH_LIMIT).toBe(2)
  })

  it('tool_error 第 2 次：switch_tool，不再原样重试', () => {
    const rec = new FailureRecovery()
    const e1 = mk({ toolName: 'fetch_data', errorText: 'timeout' })
    const e2 = mk({ toolName: 'fetch_data', errorText: 'HTTP 502 bad gateway' })
    rec.record(e1)
    rec.record(e2)
    const p = rec.plan(e2)
    expect(p.kind).toBe('tool_error')
    expect(p.action).toBe('switch_tool')
    expect(p.instruction).toContain('已连续 2 次')
  })

  it('分工具计数：A/B 各失败 1 次互不影响', () => {
    const rec = new FailureRecovery()
    const a = mk({ toolName: 'A', errorText: 'timeout' })
    const b = mk({ toolName: 'B', errorText: 'timeout' })
    rec.record(a)
    rec.record(b)
    expect(rec.plan(b).action).toBe('retry_same')
    expect(rec.plan(a).action).toBe('retry_same')
  })

  it('context_overflow：summarize_exit 收尾', () => {
    const rec = new FailureRecovery()
    const e = mk({ errorText: 'context length exceeded, please summarize' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('context_overflow')
    expect(p.action).toBe('summarize_exit')
    expect(p.instruction).toContain('收尾总结')
    expect(p.confidence).toBeGreaterThan(0.9)
  })

  it(`repeated：相同签名连续 ${REPEAT_STOP_LIMIT} 次 -> should_stop（压过文本分类）`, () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'search', args: { q: 'x' }, errorText: 'not found' })
    rec.record(e)
    rec.record(e)
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('repeated')
    expect(p.action).toBe('should_stop')
    expect(p.instruction).toContain('空转')
    expect(rec.stats().byKind.repeated).toBe(1)
  })

  it('repeated 边界：连续 2 次不算空转', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'search', args: { q: 'x' }, errorText: 'not found' })
    rec.record(e)
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('not_found')
    expect(p.action).not.toBe('should_stop')
  })

  it('unknown 第 1 次：retry_same 收集信息', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'mystery', args: { i: 0 }, errorText: 'weird error XYZ' })
    rec.record(e)
    const p = rec.plan(e)
    expect(p.kind).toBe('unknown')
    expect(p.action).toBe('retry_same')
    expect(p.confidence).toBeLessThan(0.5)
    expect(UNKNOWN_SUMMARY_LIMIT).toBe(3)
  })

  it(`unknown 第 ${UNKNOWN_SUMMARY_LIMIT} 次：summarize_exit 停止盲试`, () => {
    const rec = new FailureRecovery()
    const events = [0, 1, 2].map(i => mk({ toolName: 'mystery', args: { i }, errorText: 'weird error XYZ' }))
    planAll(rec, events)
    const p = rec.plan(events[2])
    expect(p.kind).toBe('unknown')
    expect(p.action).toBe('summarize_exit')
    expect(p.instruction).toContain('收尾总结')
  })

  it('所有分支 confidence 都在 0-1 之间且 reason 非空', () => {
    const rec = new FailureRecovery()
    const texts = [
      'ENOENT no such file', 'permission denied', '参数错误', 'timeout',
      'context length exceeded', 'weird XYZ',
    ]
    for (const text of texts) {
      const e = mk({ args: { t: text }, errorText: text })
      rec.record(e)
      const p = rec.plan(e)
      expect(p.confidence, text).toBeGreaterThanOrEqual(0)
      expect(p.confidence, text).toBeLessThanOrEqual(1)
      expect(p.reason.length, text).toBeGreaterThan(0)
      expect(p.instruction.length, text).toBeGreaterThan(0)
    }
  })
})

describe('plan 与状态机的交互', () => {
  it('plan 是纯决策：重复调用不增加 total，也不二次计入 recoveries', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'A', errorText: 'timeout' })
    rec.record(e)
    const before = rec.stats()
    const p1 = rec.plan(e)
    const p2 = rec.plan(e)
    expect(p1.action).toBe(p2.action)
    const after = rec.stats()
    expect(after.total).toBe(before.total)
    expect(after.recoveries).toBe(before.recoveries + 1)
    expect(rec.history).toHaveLength(1)
  })

  it('plan 支持未 record 的裸事件，不污染历史', () => {
    const rec = new FailureRecovery()
    const e = mk({ toolName: 'A', errorText: 'timeout' })
    expect(rec.plan(e).action).toBe('retry_same')
    expect(rec.history).toHaveLength(0)
    expect(rec.stats().total).toBe(0)
  })

  it('plan 未 record 时也能识别重复空转', () => {
    const rec = new FailureRecovery()
    const e1 = mk({ toolName: 'B', args: { q: 1 }, errorText: 'not found' })
    rec.record(e1)
    rec.record(e1)
    const e3 = mk({ toolName: 'B', args: { q: 1 }, errorText: 'not found' })
    expect(rec.plan(e3).action).toBe('should_stop')
    expect(rec.history).toHaveLength(2)
  })

  it('shouldStop 初始为 false', () => {
    expect(new FailureRecovery().shouldStop()).toBe(false)
  })

  it(`shouldStop：最近 ${STOP_WINDOW} 次里 ${STOP_SAME_KIND} 次同类且给过 ${STOP_ACTIONABLE} 次策略 -> true`, () => {
    const rec = new FailureRecovery()
    for (let i = 0; i < STOP_WINDOW; i++) {
      const e = mk({ toolName: 'write_file', args: { i }, errorText: '参数 content 不能为空' })
      rec.record(e)
      rec.plan(e)
    }
    expect(rec.shouldStop()).toBe(true)
  })

  it('shouldStop：同类够数但只给过 1 次策略 -> false', () => {
    const rec = new FailureRecovery()
    for (let i = 0; i < STOP_WINDOW; i++) {
      const e = mk({ toolName: 'write_file', args: { i }, errorText: '参数 content 不能为空' })
      rec.record(e)
      if (i === 0) rec.plan(e)
    }
    expect(rec.shouldStop()).toBe(false)
  })

  it('shouldStop：类型混杂 -> false', () => {
    const rec = new FailureRecovery()
    const texts = [
      'ENOENT no such file', 'permission denied', '参数错误',
      'timeout', 'context length exceeded',
    ]
    for (const text of texts) {
      const e = mk({ toolName: 't', args: { t: text }, errorText: text })
      rec.record(e)
      rec.plan(e)
    }
    expect(rec.shouldStop()).toBe(false)
  })

  it('shouldStop：给的是 summarize_exit 不算可恢复策略 -> false', () => {
    const rec = new FailureRecovery()
    for (let i = 0; i < STOP_WINDOW; i++) {
      const e = mk({ toolName: 't', args: { i }, errorText: 'context length exceeded' })
      rec.record(e)
      rec.plan(e)
    }
    expect(rec.shouldStop()).toBe(false)
  })

  it('reset 清空历史/连续计数/决策日志，shouldStop 归 false', () => {
    const rec = new FailureRecovery()
    for (let i = 0; i < STOP_WINDOW; i++) {
      const e = mk({ toolName: 'write_file', args: { i }, errorText: '参数 content 不能为空' })
      rec.record(e)
      rec.plan(e)
    }
    expect(rec.shouldStop()).toBe(true)
    const totalBefore = rec.stats().total
    rec.reset()
    expect(rec.shouldStop()).toBe(false)
    expect(rec.history).toHaveLength(0)
    expect(rec.summary()).toBe('暂无失败记录。')
    expect(rec.stats().total).toBe(totalBefore)
    const after = mk({ toolName: 'write_file', args: { k: 9 }, errorText: 'timeout' })
    rec.record(after)
    expect(rec.plan(after).action).toBe('retry_same')
  })
})

describe('summary 失败摘要', () => {
  it('无失败时给出空摘要', () => {
    expect(new FailureRecovery().summary()).toBe('暂无失败记录。')
  })

  it('包含工具名、类型、已试路线，并要求勿重复', () => {
    const rec = new FailureRecovery()
    const e1 = mk({ toolName: 'write_file', args: { path: 'a' }, errorText: 'ENOENT no such file' })
    rec.record(e1)
    rec.plan(e1)
    const e2 = mk({ toolName: 'shell', args: { cmd: 'ls' }, errorText: 'permission denied' })
    rec.record(e2)
    rec.plan(e2)
    const s = rec.summary()
    expect(s).toContain('最近 2 次失败')
    expect(s).toContain('write_file(路径不存在)')
    expect(s).toContain('已试 list_dir 核对路径')
    expect(s).toContain('shell(权限拒绝)')
    expect(s).toContain('已建议换路径')
    expect(s).toContain('请勿重复这些路线')
  })

  it('只看最近 3 次失败', () => {
    const rec = new FailureRecovery()
    for (let i = 0; i < 5; i++) {
      const e = mk({ toolName: 'tool' + i, args: { i }, errorText: 'ENOENT no such file' })
      rec.record(e)
      rec.plan(e)
    }
    const s = rec.summary()
    expect(s).toContain('最近 3 次失败')
    expect(s).toContain('tool4')
    expect(s).not.toContain('tool0')
    expect(s).not.toContain('tool1')
  })

  it('未下发过策略的失败标注"尚未给出恢复策略"', () => {
    const rec = new FailureRecovery()
    const e = mk({ errorText: 'ENOENT no such file' })
    rec.record(e)
    expect(rec.summary()).toContain('尚未给出恢复策略')
  })
})

describe('stats 与环形缓冲', () => {
  it('stats 统计累计总数、分类分布与恢复次数', () => {
    const rec = new FailureRecovery()
    // 用不同 args 避免被"相同签名连续 3 次"的重复检测覆盖
    const e1 = mk({ args: { i: 1 }, errorText: 'ENOENT no such file' })
    const e2 = mk({ args: { i: 2 }, errorText: 'permission denied' })
    const e3 = mk({ args: { i: 3 }, errorText: 'ENOENT no such file' })
    rec.record(e1)
    rec.record(e2)
    rec.record(e3)
    const s = rec.stats()
    expect(s.total).toBe(3)
    expect(s.byKind.not_found).toBe(2)
    expect(s.byKind.permission).toBe(1)
    expect(s.recoveries).toBe(0)
    rec.plan(e3)
    expect(rec.stats().recoveries).toBe(1)
    expect(rec.stats().byKind).not.toBe(s.byKind)
  })

  it(`环形缓冲上限 ${RING_BUFFER_LIMIT}：超出后只保留最近 ${RING_BUFFER_LIMIT} 条`, () => {
    const rec = new FailureRecovery()
    const overflow = RING_BUFFER_LIMIT + 5
    for (let i = 0; i < overflow; i++) {
      rec.record(mk({ toolName: 't', args: { i }, errorText: 'unexpected situation ' + i }))
    }
    expect(rec.history).toHaveLength(RING_BUFFER_LIMIT)
    expect((rec.history[0].args as { i: number }).i).toBe(5)
    expect((rec.history[RING_BUFFER_LIMIT - 1].args as { i: number }).i).toBe(overflow - 1)
    expect(rec.stats().total).toBe(overflow)
    expect(rec.summary()).toContain('最近 3 次失败')
  })

  it('环形缓冲淘汰老事件后，shouldStop 只看窗口内的新事件', () => {
    const rec = new FailureRecovery()
    // 先灌满 100 条工具错误，再灌 100 条路径错误：窗口内应只剩后者
    for (let i = 0; i < RING_BUFFER_LIMIT; i++) {
      rec.record(mk({ toolName: 't', args: { phase: 'old', i }, errorText: 'timeout' }))
    }
    for (let i = 0; i < RING_BUFFER_LIMIT; i++) {
      rec.record(mk({ toolName: 't', args: { phase: 'new', i }, errorText: 'ENOENT no such file' }))
    }
    expect(rec.history).toHaveLength(RING_BUFFER_LIMIT)
    expect(rec.history.every(e => classifyFailureKind(e.errorText) === 'not_found')).toBe(true)
    expect(rec.summary()).not.toContain('工具错误')
  })
})
