import { describe, it, expect } from 'vitest'
import { createAgentPerf, perfSummary } from '../src/renderer/engine/agentPerf'

// Agent 性能打点（v13.10.1）：把「干活慢」从体感变成数据。
// 采集失败/乱序绝不影响对话——这里验证核心计时语义。

describe('agentPerf 收集器', () => {
  it('单轮：首字延迟、流时长、工具耗时归集', async () => {
    const p = createAgentPerf()
    p.setModel('test-model')
    p.roundStart(1)
    p.llmRequestStart()
    await new Promise(r => setTimeout(r, 15))
    p.firstToken()
    await new Promise(r => setTimeout(r, 10))
    p.llmStreamEnd()
    p.addTool(1, 'read_file', 120, true)
    p.addTool(1, 'search_content', 300, false)
    const r = p.finish()
    expect(r.model).toBe('test-model')
    expect(r.rounds).toBe(1)
    expect(r.firstTokenMs).toBeGreaterThanOrEqual(14)
    expect(r.llmMs).toBeGreaterThanOrEqual(24)
    expect(r.toolCalls).toBe(2)
    expect(r.toolErrors).toBe(1)
    // 并行批次取最长一条作为该轮工具墙钟
    expect(r.toolMs).toBe(300)
    expect(r.roundsDetail[0].tools.map(t => t.name)).toEqual(['read_file', 'search_content'])
  })

  it('多轮：LLM 与工具耗时分开累计、乱序 roundStart 不串轮', () => {
    const p = createAgentPerf()
    p.roundStart(1); p.llmRequestStart(); p.firstToken(); p.llmStreamEnd()
    p.addTool(1, 'shell', 500, true)
    p.roundStart(2); p.llmRequestStart(); p.firstToken(); p.llmStreamEnd()
    p.addTool(2, 'edit_file', 50, true)
    // 乱序补记第 1 轮的另一个工具（并行 Promise.all 完成顺序不保证）
    p.addTool(1, 'list_dir', 80, true)
    const r = p.finish()
    expect(r.rounds).toBe(2)
    expect(r.toolCalls).toBe(3)
    expect(r.toolMs).toBe(500 + 50)
    expect(r.roundsDetail[0].tools).toHaveLength(2)
    expect(r.roundsDetail[1].tools).toHaveLength(1)
  })

  it('finish 可重复调用且结果稳定（乱序上报不炸）', () => {
    const p = createAgentPerf()
    p.roundStart(1); p.addTool(1, 'a', 1, true)
    const a = p.finish()
    const b = p.finish()
    expect(b.rounds).toBe(a.rounds)
    expect(b.toolCalls).toBe(a.toolCalls)
  })

  it('perfSummary 输出占比与错误数', () => {
    const r = perfSummary({
      rounds: 2, totalMs: 10_000, llmMs: 8_000, toolMs: 2_000,
      firstTokenMs: 900, toolCalls: 4, toolErrors: 1, ts: 0, roundsDetail: [],
    })
    expect(r).toContain('10.0s')
    expect(r).toContain('2 轮')
    expect(r).toContain('80%')
    expect(r).toContain('20%')
    expect(r).toContain('错 1')
  })
})
