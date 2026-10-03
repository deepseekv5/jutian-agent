/**
 * subagent.ts — 子代理运行器（v5.3）
 *
 * 主对话的 AI 通过 dispatch_subagents 工具派出子代理；
 * 每个子代理是独立的一次 LLM 会话（自带全部内置工具，能真实读写文件/执行命令），
 * 串行执行避免资源争抢；进度经 window 事件广播给侧栏小组件。
 *
 * 性能约束：进度事件 ≥400ms 节流、只携带增量摘要，侧栏渲染零阻塞。
 */
import { streamChat } from './stream'
import { pushNotice } from '../notify'
import type { Settings } from '../types'

export interface SubAgentSpec { name: string; task: string }
export interface SubAgentState {
  name: string
  task: string
  status: 'pending' | 'running' | 'done'
  phase: string
  outputTail: string
}

const EVT = 'subagent-progress'

function emit(batchId: string, agents: SubAgentState[], running: boolean) {
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { batchId, running, agents: agents.map(a => ({ ...a })) } }))
  } catch { /* ignore */ }
}

/** 运行一批子代理（串行），resolve 汇总报告（作为工具结果回传主模型） */
export async function runSubagents(opts: {
  agents: SubAgentSpec[]
  settings: Settings
  signal: AbortSignal
}): Promise<string> {
  const list = opts.agents.slice(0, 5).filter(a => a && a.name && a.task)
  if (!list.length) return JSON.stringify({ ok: false, error: '没有可执行的子代理' })

  const batchId = Date.now().toString(36)
  const states: SubAgentState[] = list.map(a => ({ name: a.name, task: a.task, status: 'pending', phase: '排队中', outputTail: '' }))
  emit(batchId, states, true)

  /* 并行池:并发 3(7.0),结果按原始顺序聚合 */
  const results: string[] = new Array(states.length).fill('')
  let cursor = 0

  async function runOne(st: SubAgentState, idx: number) {
    st.status = 'running'
    st.phase = '开始执行'
    emit(batchId, states, true)

    let out = ''
    let lastEmit = 0
    let toolName = ''
    await streamChat(
      opts.settings,
      [
        {
          role: 'system',
          content: `你是子代理「${st.name}」，独立完成下面这个任务。可以直接使用工具（读文件/写文件/执行命令/搜索）真实地做，最后输出一份简洁的结果报告：完成了什么、产出了哪些文件、关键结论。不要复述任务本身。`,
        },
        { role: 'user', content: st.task },
      ],
      {
        onChunk: (d: string) => {
          out += d
          const now = Date.now()
          if (now - lastEmit > 400) {
            lastEmit = now
            st.phase = toolName ? `工具 ${toolName} · 输出中` : '执行中…'
            st.outputTail = out.slice(-140)
            emit(batchId, states, true)
          }
        },
        onToolStart: (tc: any) => {
          toolName = tc?.name || 'tool'
          st.phase = '⚙ ' + toolName
          emit(batchId, states, true)
        },
        onToolEnd: (tc: any) => { toolName = '' },
        onDone: (full: string) => { if (full) out = full },
        onError: (e: string) => { st.phase = '出错: ' + String(e).slice(0, 60) },
      },
      opts.signal,
    ).catch(() => { st.phase = '中断' })

    st.status = 'done'
    st.phase = opts.signal.aborted ? '已取消' : '完成'
    st.outputTail = out.slice(-140)
    emit(batchId, states, true)
    results[idx] = `【${st.name}】${(out || '(无输出)').slice(0, 2000)}`
  }

  async function worker() {
    while (cursor < states.length) {
      if (opts.signal.aborted) { while (cursor < states.length) { const s = states[cursor++]; s.status = 'done'; s.phase = '已取消' } return }
      const idx = cursor++
      await runOne(states[idx], idx)
    }
  }
  await Promise.all([worker(), worker(), worker()])

  emit(batchId, states, false)
  pushNotice({ type: 'subagent', title: `子代理批次完成（${states.length} 个）`, body: states.map(a => a.name).join('、') })
  return JSON.stringify({ ok: true, note: '所有子代理已完成，以下是各自的结果报告，请汇总后回复用户', results })
}
