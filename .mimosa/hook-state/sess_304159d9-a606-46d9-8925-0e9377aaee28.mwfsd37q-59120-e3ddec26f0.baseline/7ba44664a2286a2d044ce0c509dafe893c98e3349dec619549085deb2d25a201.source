/**
 * Agent 性能打点（v13.10.1）
 *
 * 背景：「干个活都要很久」一直只有体感没有数据——每轮 LLM 首字要多久、
 * 工具执行占多少、总共几轮，全靠猜。这里把 agent 循环的耗时结构采集成
 * 一份报告，随会话完成上报到服务端（/api/perf-log），设置·性能诊断可查。
 * 之后每项执行策略优化都能用同一把尺子验证有没有效。
 *
 * 纯收集器，零副作用：采集失败不影响对话。
 */

export interface PerfToolEntry {
  name: string
  ms: number
  ok: boolean
}

export interface PerfRound {
  round: number
  /** 本轮 LLM 请求到首个内容分片的耗时（首字延迟，含网络+上游排队） */
  firstTokenMs?: number
  /** 本轮 LLM 请求总耗时（首字到流结束） */
  llmMs?: number
  tools: PerfToolEntry[]
  /** 本轮工具执行总耗时（并行工具按最长一条计） */
  toolMs: number
}

export interface PerfReport {
  /** 总轮次（一次 agent 请求内的 LLM 往返数） */
  rounds: number
  /** 从请求开始到最终回答完成 */
  totalMs: number
  /** LLM 阶段累计耗时（各轮之和，不含工具） */
  llmMs: number
  /** 工具阶段累计耗时（各轮之和） */
  toolMs: number
  /** 首轮首字延迟（用户感知的"等多久开始动"） */
  firstTokenMs?: number
  toolCalls: number
  toolErrors: number
  model?: string
  ts: number
  roundsDetail: PerfRound[]
}

export interface AgentPerfCollector {
  roundStart(round: number): void
  llmRequestStart(): void
  firstToken(): void
  llmStreamEnd(): void
  addTool(round: number, name: string, ms: number, ok: boolean): void
  setModel(model: string): void
  finish(): PerfReport
}

export function createAgentPerf(): AgentPerfCollector {
  const t0 = Date.now()
  const rounds: PerfRound[] = []
  let cur: PerfRound | null = null
  let llmT = 0
  let firstTokenAt = 0
  let model: string | undefined

  const ensure = (round: number): PerfRound => {
    if (!cur || cur.round !== round) {
      cur = rounds.find(r => r.round === round) ?? { round, tools: [], toolMs: 0 }
      if (!rounds.includes(cur)) rounds.push(cur)
    }
    return cur
  }

  return {
    roundStart(round) { ensure(round) },
    llmRequestStart() { llmT = Date.now(); firstTokenAt = 0 },
    firstToken() {
      if (!firstTokenAt) firstTokenAt = Date.now()
      if (cur) cur.firstTokenMs = firstTokenAt - llmT
    },
    llmStreamEnd() {
      if (cur && llmT) cur.llmMs = Date.now() - llmT
    },
    addTool(round, name, ms, ok) {
      const r = ensure(round)
      r.tools.push({ name, ms, ok })
      // 并行批次：取最长一条作为该轮工具墙钟时间
      r.toolMs = Math.max(r.toolMs, ms)
    },
    setModel(m) { model = m },
    finish(): PerfReport {
      const llmMs = rounds.reduce((a, r) => a + (r.llmMs || 0), 0)
      const toolMs = rounds.reduce((a, r) => a + r.toolMs, 0)
      const toolEntries = rounds.flatMap(r => r.tools)
      return {
        rounds: rounds.length,
        totalMs: Date.now() - t0,
        llmMs,
        toolMs,
        firstTokenMs: rounds[0]?.firstTokenMs,
        toolCalls: toolEntries.length,
        toolErrors: toolEntries.filter(t => !t.ok).length,
        model,
        ts: Date.now(),
        roundsDetail: rounds,
      }
    },
  }
}

/** 报告 → 人读摘要（诊断视图与日志共用，避免两处格式不一致） */
export function perfSummary(r: PerfReport): string {
  const pct = (a: number) => (r.totalMs ? Math.round((a / r.totalMs) * 100) : 0)
  return `${(r.totalMs / 1000).toFixed(1)}s · ${r.rounds} 轮 · LLM ${(r.llmMs / 1000).toFixed(1)}s(${pct(r.llmMs)}%) · 工具 ${(r.toolMs / 1000).toFixed(1)}s(${pct(r.toolMs)}%, ${r.toolCalls} 次${r.toolErrors ? `/错 ${r.toolErrors}` : ''})`
}
