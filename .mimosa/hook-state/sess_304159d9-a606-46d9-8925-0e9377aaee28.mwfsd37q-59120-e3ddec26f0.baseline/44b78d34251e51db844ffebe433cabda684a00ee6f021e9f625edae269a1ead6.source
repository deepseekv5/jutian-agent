/**
 * 任务清单（update_plan）—— 主对话与 Code 面板共用的单一实现
 *
 * 对标 Claude Code 的 TodoWrite：多步任务先列步骤清单，每完成一步更新状态，
 * 用户随时能看到"进行到哪了"。此前只有 Code 面板有一份私有实现，
 * 主对话（最常用的入口）没有 —— 复杂任务只能看一长串工具调用猜进度。
 *
 * 这里收敛三件事：参数解析与校验、按 key 持久化、状态形状。
 * 渲染仍由各处按自己的视觉语言做（Code 面板是等宽终端风，主对话是卡片风）。
 */

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanStep {
  title: string
  status: PlanStatus
}

export interface Plan {
  explanation?: string
  steps: PlanStep[]
}

const VALID: PlanStatus[] = ['pending', 'in_progress', 'completed']

/** 解析模型给的参数；返回 { plan } 或 { error }。绝不抛错——参数来自模型 */
export function parsePlanArgs(argsJson: string): { plan?: Plan; error?: string } {
  let a: unknown
  try { a = JSON.parse(argsJson || '{}') } catch { return { error: '参数解析失败' } }
  if (!a || typeof a !== 'object') return { error: '参数格式不正确' }
  const raw = (a as { steps?: unknown }).steps
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'steps 为空' }
  const steps: PlanStep[] = raw.map((s) => {
    const o = (s || {}) as { title?: unknown; status?: unknown }
    const status = VALID.includes(o.status as PlanStatus) ? (o.status as PlanStatus) : 'pending'
    // 标题先 trim：模型偶尔会传全空格，留着会渲染出一行看不见的空条目
    return { title: String(o.title ?? '').trim().slice(0, 200), status }
  }).filter(s => s.title)
  if (!steps.length) return { error: 'steps 无有效条目' }
  const expl = (a as { explanation?: unknown }).explanation
  return { plan: { explanation: expl ? String(expl).slice(0, 300) : undefined, steps } }
}

/** 作为 tool result 回传给模型的应答 */
export function planAck(plan: Plan): string {
  const done = plan.steps.filter(s => s.status === 'completed').length
  return JSON.stringify({ ok: true, progress: `${done}/${plan.steps.length}` })
}

export function planReject(error: string): string {
  return JSON.stringify({ ok: false, error })
}

/** 持久化：按 key 存 localStorage。读写都容错（隐私模式/配额不足） */
export function loadPlan(key: string): Plan | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && Array.isArray(p.steps) && p.steps.length ? p as Plan : null
  } catch { return null }
}

export function savePlan(key: string, plan: Plan): void {
  try { localStorage.setItem(key, JSON.stringify(plan)) } catch { /* 配额或隐私模式，忽略 */ }
}

export function clearPlan(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

/** 完成度摘要，供标题栏与提示语复用 */
export function planProgress(plan: Plan): { done: number; total: number; label: string } {
  const done = plan.steps.filter(s => s.status === 'completed').length
  const total = plan.steps.length
  return { done, total, label: `${done}/${total}` }
}

/** 是否全部完成（用于自动收起清单） */
export function planAllDone(plan: Plan | null): boolean {
  return !!plan && plan.steps.length > 0 && plan.steps.every(s => s.status === 'completed')
}

/** 暴露给模型的工具定义（主对话与 Code 面板共用同一份描述） */
export const PLAN_TOOL_SCHEMA = {
  name: 'update_plan',
  description: '维护当前任务的步骤清单。多步任务（≥3 步）必须先调用本工具列出步骤，之后每完成一步就再次调用更新状态——用户靠它了解进展。status 取值：pending / in_progress / completed。',
  parameters: {
    type: 'object',
    properties: {
      explanation: { type: 'string', description: '一句话说明当前进展（可选）' },
      steps: {
        type: 'array',
        description: '完整步骤列表（每次都要传全量，不是增量）',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '步骤描述，简短' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['steps'],
  },
} as const
