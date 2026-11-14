// 计划模式：只读探索 → 输出计划 → 用户批准后才允许执行。
// 与 shared/sensitiveOps 的代码层权限闸门并列：sensitiveOps 拦"不可逆操作"，
// 本模块拦"计划批准前的任何副作用工具"。两者判据独立、互不覆盖。

/** 只读安全：允许在计划模式（未批准）下自由调用的工具。 */
export const PLAN_MODE_READONLY_TOOLS: readonly string[] = [
  'read_file', 'list_dir', 'search_files', 'search_content', 'get_file_info',
  'code_analysis', 'system_info', 'process_list', 'port_check',
  'web_search', 'web_fetch', 'consult_guidance',
]

/** 计划模式不可逆工具：即时提权也绝不放行，计划模式是硬只读。 */
const NEVER_IN_PLAN_MODE: readonly string[] = [
  'delete_file', 'shell_kill', 'install_skill',
]

export interface PlanGateResult {
  allowed: boolean
  /** 拦截原因（allowed=false 时给出，供回填为工具结果）。 */
  reason?: string
  /** 可替代的只读工具提示。 */
  hint?: string
}

/**
 * 计划模式下对一次工具调用的裁决。
 * @param toolName  工具名（含 MCP 等额外工具；非只读工具一律视作有副作用）
 * @param approved  计划是否已被用户批准（批准后放行，交由 sensitiveOps 继续拦不可逆操作）
 */
export function gatePlanTool(toolName: string, approved: boolean): PlanGateResult {
  if (approved) return { allowed: true }
  if (NEVER_IN_PLAN_MODE.includes(toolName)) {
    return {
      allowed: false,
      reason: `计划模式为硬只读：${toolName} 属不可逆操作，无论是否提权都不能在此执行。`,
      hint: '先完成计划并获得用户批准，再执行破坏性操作。',
    }
  }
  if (PLAN_MODE_READONLY_TOOLS.includes(toolName)) return { allowed: true }
  return {
    allowed: false,
    reason: `计划模式尚未批准：${toolName} 会产生副作用，禁止执行。`,
    hint: '现在请只做只读探索并整理成计划，等用户批准后再执行。',
  }
}

/** 计划模式待批准时注入的提示词片段（约束模型行为）。 */
export const PLAN_MODE_PROMPT = [
  '【计划模式（只读）】当前处于计划模式，尚未获得执行批准。',
  '你可以自由使用只读工具探索代码库与系统现状。',
  '严禁执行任何有副作用的操作：不得写文件、改文件、删除、移动、运行命令或调用会改变状态的工具。',
  '探索完成后，用清晰的步骤列出你的计划（目标、涉及的文件、每一步做什么、如何验证），然后停下等待用户批准。',
  '用户批准后你会被通知，届时再执行。',
].join('\n')

/** 计划批准后注入的提示词片段（解除只读约束）。 */
export const PLAN_APPROVED_PROMPT = '【计划已批准】用户已批准上述计划，现在可以开始执行。执行中保持与计划一致，若需偏离先说明原因。'

/**
 * 计划模式的会话内状态机（纯函数，便于测）。
 *
 * 关键是「进入」必须回到未批准：上一轮批准过的会话如果直接再进计划模式，
 * 残留的 approved 会让新方案跳过审批直接写文件——那正是计划模式要防的事。
 */
export interface PlanModeState {
  active: boolean
  approved: boolean
  /** 待补发给模型的批准/反馈语，发送一次后清空 */
  resume: string | null
}

export const PLAN_MODE_INITIAL: PlanModeState = { active: false, approved: false, resume: null }

export type PlanModeAction =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'approve'; feedback?: string }
  | { type: 'consumeResume' }

export function planModeReducer(s: PlanModeState, a: PlanModeAction): PlanModeState {
  switch (a.type) {
    case 'enter':
      return { active: true, approved: false, resume: null }
    case 'exit':
      return { active: false, approved: false, resume: null }
    case 'approve':
      return {
        active: s.active,
        approved: true,
        resume: a.feedback?.trim()
          ? `【计划已批准，按以下意见执行】用户批准了计划，同时提出修改意见：\n${a.feedback.trim()}\n请据此执行。`
          : PLAN_APPROVED_PROMPT,
      }
    case 'consumeResume':
      return s.resume === null ? s : { ...s, resume: null }
    default:
      return s
  }
}
