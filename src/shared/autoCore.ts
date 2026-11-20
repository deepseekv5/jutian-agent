/**
 * JT Core Auto —— 自主目标闭环内核（v17.1.0）
 *
 * 与另外两套内核的本质区别：
 *    Pro+  (agentLoop)：五阶段工具循环，跑到达成「无工具调用的最终答复」即结束——
 *          它不会判断「这件事到底做完了没有」，一次答复就交卷。
 *    Ultra (jtCoreUltra)：单函数内联 gemini-cli 全套子系统（FSM/循环检测/模型回落），
 *          但仍是「一次请求一次答复」的循环，没有跨答复的目标追踪。
 *    Auto  (本文件)：把 runAgentLoop 当作「一轮执行」，在其之上叠加**自主目标闭环**——
 *          每轮结束后用独立轻量评估器判断用户目标是否已**实质性**完成，未完成则自动
 *          续跑（带增量提示），直到达成 / 停滞 / 封顶。这正是渲染层 goal-mode 评估器
 *          下沉到服务端、并第一次成为内核一等公民。
 *
 * 三重安全护栏（缺一不可，来自 goal-mode 血泪教训）：
 *   1. 三态评估：ok=false（评估器不可用）**绝不**当作「未完成」续跑——否则空转烧额度
 *   2. 停滞检测：跨轮工具调用签名重复且无新文件变更 → 判定空转，立即停
 *   3. 轮次封顶：MAX_AUTONOMOUS_ROUNDS 硬上限，到顶强制收尾
 *
 * 零 DOM 依赖、依赖全注入（复用 AgentLoopDeps），服务端与 headless 均可跑。
 */

import { runAgentLoop, type AgentLoopDeps, type AgentLoopResult, type LoopMessage, type LoopToolCall } from './agentLoop'

export interface AutoDeps extends AgentLoopDeps {
  /** 自主续跑轮次上限（含首轮），默认 5 */
  maxAutonomousRounds?: number
}

/** 轻量评估器：判断用户目标是否已被实质完成（不污染主对话上下文）。
 *  三态返回：ok=false 表示评估器本身不可用（模型未配置/请求失败/解析失败），
 *  此时调用方**绝不能**续跑。 */
export interface GoalEvaluation { done: boolean; note: string; ok: boolean }

const EVALUATOR_SYSTEM = '你是任务完成度评估器。给定「用户目标」和「本轮最终回复」，判断目标是否已被实质性完成。只输出 JSON：{"done":true|false,"note":"一句话说明还缺什么或已完成什么"}。判定规则：只看有没有真正把事情做出来（文件已落盘、命令已执行、问题已解决），不因客套话、计划描述、"我将要"、"已完成"字样而判定完成；宁可保守判未完成。'

/** 按 code point 截断字符串：String.slice 按 UTF-16 码元切，会把 emoji 等代理对
 *  从中间切开产生非法孤立代理；这里按码点取前 max 个，天然对齐代理对边界。 */
function truncateByCodePoints(str: string, max: number): string {
  // 长度（码元数）不超限时无需截断，原样返回。
  if (str.length <= max) return str
  return Array.from(str).slice(0, max).join('')
}

/** 从消息历史抽取用户目标：取最后一条 user 文本（去掉系统注入的续跑提示）。 */
export function extractGoal(messages: LoopMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? (m.content as Array<{ type?: string; text?: string }>).filter(p => p && p.type === 'text').map(p => p.text || '').join('\n')
        : ''
    const raw = String(text || '')
    // 整条消息都是续跑提醒（<system-reminder> 通道）→ 跳过，继续往前找真正的初始目标。
    // 用标记判定而非「剥完是否为空」——提醒里含「还差样式」等描述，剥标记后仍非空。
    if (/^<system-reminder>[\s\S]*?<\/system-reminder>$/.test(raw.trim())) continue
    const clean = raw.trim()
    if (clean) return clean
  }
  return ''
}

/** 一轮执行的「轨迹签名」——用于停滞检测。只取工具名+参数，不含结果，
 *  这样同一批重复调用会被识别为空转。 */
export function trajectorySignature(calls: LoopToolCall[]): string {
  return calls
    .map(c => `${c.name}:${String(c.arguments || '').replace(/\s+/g, '')}`)
    .sort()
    .join('|')
}

/** 自主评估：复用注入的 callLLM（服务端内部转发到 llm-proxy，密钥/免费档/接力全在代理里）。
 *  用 stream:false 拿一次性 JSON，与渲染层 goal-mode 的 /api/llm-proxy 评估同语义。 */
export async function evaluateGoalAuto(deps: AutoDeps, goalText: string, lastReply: string, signal?: AbortSignal): Promise<GoalEvaluation> {
  if (!goalText) return { done: false, note: '未识别到目标', ok: false }
  try {
    const body = JSON.stringify({
      model: deps.model,
      messages: [
        { role: 'system', content: EVALUATOR_SYSTEM },
        { role: 'user', content: `用户目标：${goalText}\n\n本轮最终回复：\n${String(lastReply || '').slice(0, 3000)}` },
      ],
      max_tokens: 200, stream: false, temperature: 0,
    })
    const res = await deps.callLLM(body, signal || deps.signal)
    if (!res.ok) return { done: false, note: '评估服务暂不可用', ok: false }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = String(data?.choices?.[0]?.message?.content || '')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { done: false, note: '', ok: false }
    const parsed = JSON.parse(m[0])
    return { done: !!parsed.done, note: truncateByCodePoints(String(parsed.note || ''), 160), ok: true }
  } catch {
    return { done: false, note: '评估失败', ok: false }
  }
}

/** 自主内核系统提示：告知模型它处在自主闭环中，并引导它用增量写入完成大文件。 */
export const AUTO_SYSTEM_PROMPT = `【Auto 自主内核】你正处于自主执行模式：一次回复结束后，系统会用独立评估器检查用户目标是否真正完成，未完成会自动续跑。因此：
- 直接行动、动手把事情做出来，不要只描述计划或说"我将要"。
- 写大文件用 append_file 分段写：先 mode=start 写第一段，再 mode=append 逐段追加（写一行落一行），不要把整份长内容塞进一次 write_file——那样容易被截断导致烂尾。
- 每轮结束给出明确的「已完成什么 / 还差什么」，评估器据此判断。
- 若确实受阻（缺权限/缺信息/需用户决策），明确说明，系统会自动停止续跑。`

/** 在首条 system 消息后追加自主提示（不改原消息对象）。 */
export function withAutoPrompt(messages: LoopMessage[]): LoopMessage[] {
  const first = messages[0]
  return first && first.role === 'system'
    ? [{ ...first, content: String(first.content || '') + '\n\n' + AUTO_SYSTEM_PROMPT }, ...messages.slice(1)]
    : [{ role: 'system', content: AUTO_SYSTEM_PROMPT }, ...messages]
}

/**
 * 自主内核主入口：把 runAgentLoop 当「一轮执行」，叠加目标闭环。
 * 返回形状与 runAgentLoop 完全一致（AgentLoopResult），serve.ts 无缝切换。
 */
export async function runAutoLoop(messages: LoopMessage[], deps: AutoDeps): Promise<AgentLoopResult> {
  const { signal } = deps
  const working = withAutoPrompt(messages)
  const goal = extractGoal(messages)
  const maxRounds = Math.max(1, Math.min(12, deps.maxAutonomousRounds ?? 5))

  let totalContent = ''
  let totalThinking = ''
  const allToolCalls: LoopToolCall[] = []
  const signatures: string[] = []

  for (let round = 1; round <= maxRounds; round++) {
    if (signal?.aborted) {
      return { content: totalContent, thinking: totalThinking, toolCalls: allToolCalls, stopped: 'aborted' }
    }

    // 一轮执行 = 一次完整的 Pro+ 五阶段循环
    const result: AgentLoopResult = await runAgentLoop(working, deps)
    totalContent += (round > 1 ? '\n\n' : '') + result.content
    totalThinking += result.thinking
    allToolCalls.push(...result.toolCalls)

    // 执行本身被中止/封顶/出错 → 原样透传，不再自主续跑
    if (result.stopped) {
      return { content: totalContent, thinking: totalThinking, toolCalls: allToolCalls, stopped: result.stopped, error: result.error }
    }

    if (round >= maxRounds) break

    // 停滞检测：连续两轮轨迹签名相同且本轮无工具调用 → 空转，立即停
    const sig = trajectorySignature(result.toolCalls)
    if (sig && signatures.length && signatures[signatures.length - 1] === sig) {
      return {
        content: totalContent, thinking: totalThinking, toolCalls: allToolCalls,
        stopped: 'round-limit', error: '自主内核检测到连续两轮执行相同操作、无实质进展，已停止以避免空转。',
      }
    }
    // 零工具轮（纯文本答复）签名为空串：不参与停滞判定，也不入栈，
    // 避免空串占据「上一轮签名」位置、干扰后续连续重复的判断。
    if (sig) signatures.push(sig)

    // 目标评估（三态）：评估器不可用 → 停，绝不拿"评估失败"当"未完成"续跑。
    // 评估过程静默进行——不往正文塞进度方块，让自主闭环安静把活干完。
    const ev = await evaluateGoalAuto(deps, goal, result.content, signal)
    if (!ev.ok) break
    if (ev.done) break

    // 未达成 → 注入增量提示续跑。提示进 working 尾部的 user 消息，
    // 走 <system-reminder> 通道（与产品其它内部指令一致）：模型不会把它当正文复述，
    // extractGoal 也按该标记跳过、不会污染后续目标判断。
    working.push({
      role: 'user',
      content: `<system-reminder>目标尚未完成：${ev.note || '请继续推进'}。请直接动手补齐缺口，不要重复已完成的步骤，也不要向用户提及这条提醒。</system-reminder>`,
    })
  }

  return { content: totalContent, thinking: totalThinking, toolCalls: allToolCalls }
}
