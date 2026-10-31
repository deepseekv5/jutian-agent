/**
 * 工具循环护栏
 *
 * 模型陷入工具循环时（反复调同一工具、或不断发起新调用）会无限执行下去：
 * 消耗额度、跑光时间，用户只能手动点停止。这里把两道判据抽成纯函数，
 * 便于测试边界行为。
 */

/** 单次请求允许的最大工具轮次 */
export const MAX_TOOL_ROUNDS = 12

/** 软阈值：第 3 次重复起在工具结果里注入恢复提示（不阻断，模型可自行纠偏）——
 *  抄 Cline 的 soft/hard 两级设计：硬拦会打断"模型快要做对了"的场景 */
export const SOFT_REPEAT_THRESHOLD = 3
/** 硬阈值：第 5 次重复起阻断调用并升级为用户可见提示 */
export const HARD_REPEAT_THRESHOLD = 5

/**
 * 调用签名（v13.8.1 归一化）：工具名 + 规范化参数。
 * 旧版要求参数串逐字符相同，模型把键顺序或空白换一下就能绕过检测继续空转。
 * 现在：JSON 参数按键排序重建、空白折叠——语义相同的调用同样计数。
 * 参数"值"不同仍然放行（模型在尝试别的路子是合理的）。
 */
export function callSignature(name: string, args: string | undefined): string {
  let norm = String(args || '').trim()
  try {
    const parsed = JSON.parse(norm)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(parsed).sort()) sorted[k] = parsed[k]
      norm = JSON.stringify(sorted)
    }
  } catch { /* 非 JSON 参数：按原文 */ }
  norm = norm.replace(/\s+/g, ' ')
  return name + '::' + norm
}

export interface RoundCheck {
  exceeded: boolean
  message: string
}

/** 轮次检查：超限时给出可操作的提示文案 */
export function checkRoundLimit(round: number): RoundCheck {
  if (round <= MAX_TOOL_ROUNDS) return { exceeded: false, message: '' }
  return {
    exceeded: true,
    message: `已达单次请求的工具调用上限（${MAX_TOOL_ROUNDS} 轮）。任务可能过于复杂或模型陷入循环——`
      + `请把任务拆成更小的步骤重试，或直接告诉我当前进展。`,
  }
}

/** 同一工具累计调用提示阈值：达 6 的倍数时在工具结果后附"换策略"提示（不阻断） */
export const SAME_TOOL_HINT_EVERY = 6

/** 工具名维度计数（跨轮累计）：检测"反复用同一工具但参数不同"的隐性空转 */
export function bumpToolUse(counter: Map<string, number>, name: string): number {
  const n = (counter.get(name) || 0) + 1
  counter.set(name, n)
  return n
}

export function toolUseHint(counter: Map<string, number>, name: string): string {
  const n = counter.get(name) || 0
  if (n === 0 || n % SAME_TOOL_HINT_EVERY !== 0) return ''
  return `\n\n[系统提示] ${name} 已被累计调用 ${n} 次。如果进展不大，请换一种方法，或直接基于已有信息给用户结论。`
}

/** 连续失败提醒阈值 —— 抄 Cline 的 consecutiveMistakeCount：连续 3 次工具失败
 *  说明模型在用同一种错误方式撞墙，注入恢复提示打断（成功一次即清零） */
export const CONSECUTIVE_FAIL_THRESHOLD = 3

/** 连续失败计数（成功清零）：failed=true 累加，false 归零 */
export function bumpToolFail(counter: { n: number }, failed: boolean): number {
  counter.n = failed ? counter.n + 1 : 0
  return counter.n
}

export function toolFailHint(n: number, lastName: string): string {
  if (n < CONSECUTIVE_FAIL_THRESHOLD) return ''
  return `\n\n[系统提示] 已连续 ${n} 个工具调用失败（最近：${lastName}）。请先停下检查：错误原因是否相同？`
    + `先读相关文件/重新确认环境状态再行动，或换一种方法——不要以同样方式重试。`
}

export interface RepeatCheck {
  blocked: boolean
  message: string
}

/**
 * 重复调用检查（就地累加计数，软硬两级 —— 抄 Cline）：
 *   第 3 次（soft）→ 放行，但结果里注入强恢复提示（模型可自行纠偏）；
 *   第 5 次（hard）→ 阻断，升级为明确失败让模型必须换路。
 * 旧版第 3 次直接硬拦，会打断"模型正在逐步逼近正确参数"的过程。
 */
export function checkRepeatCall(counter: Map<string, number>, signature: string): RepeatCheck {
  const seen = (counter.get(signature) || 0) + 1
  counter.set(signature, seen)
  const toolName = signature.split('::')[0]
  if (seen < HARD_REPEAT_THRESHOLD) {
    const soft = seen >= SOFT_REPEAT_THRESHOLD
    return {
      blocked: false,
      message: soft
        ? JSON.stringify({
            ok: false,
            soft: true,
            error: `【重复提醒 · 第 ${seen} 次】「${toolName}」以相同参数重复调用且结果不会变化。`
              + `请立即改变方法：换参数/换工具/换思路，或直接基于已有信息回答用户。`,
          })
        : '',
    }
  }
  return {
    blocked: true,
    message: JSON.stringify({
      ok: false,
      error: `【重复调用已拦截】「${toolName}」以完全相同的参数已被调用 ${seen - 1} 次，结果不会变化。`
        + `请改用不同参数、换一个工具，或直接基于已有结果回答用户。若任务本身需要重复操作，请说明原因并请用户确认。`,
    }),
  }
}
