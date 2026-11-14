/**
 * 计划模式（只读）门禁测试
 *
 * 核心保证：计划未批准时，任何有副作用的工具都被代码层拦下，
 * 不依赖模型遵守提示词；批准后放行，交由 sensitiveOps 继续拦不可逆操作。
 */
import { describe, it, expect } from 'vitest'
import { gatePlanTool, PLAN_MODE_READONLY_TOOLS, PLAN_MODE_INITIAL, planModeReducer } from '../src/shared/planMode'

describe('gatePlanTool — 未批准(计划模式)', () => {
  it('只读工具放行', () => {
    for (const t of PLAN_MODE_READONLY_TOOLS) {
      expect(gatePlanTool(t, false).allowed).toBe(true)
    }
  })

  it('写/改/删/命令等副作用工具一律拦截', () => {
    for (const t of ['write_file', 'edit_file', 'delete_file', 'move_file',
      'shell', 'npm_run', 'install_skill', 'create_skill', 'remember', 'unknown_mcp_tool']) {
      const r = gatePlanTool(t, false)
      expect(r.allowed, t).toBe(false)
      expect(r.reason).toBeTruthy()
    }
  })

  it('不可逆工具即使在其他地方也绝不放行', () => {
    expect(gatePlanTool('delete_file', false).allowed).toBe(false)
    expect(gatePlanTool('shell_kill', false).allowed).toBe(false)
  })

  it('MCP 等未知工具按有副作用拦截(白名单制)', () => {
    expect(gatePlanTool('mcp__foo__bar', false).allowed).toBe(false)
  })
})

describe('gatePlanTool — 已批准', () => {
  it('全部放行(由 sensitiveOps 继续拦不可逆操作)', () => {
    for (const t of ['write_file', 'shell', 'delete_file', 'install_skill', 'mcp__x']) {
      expect(gatePlanTool(t, true).allowed).toBe(true)
    }
  })
})

describe('planModeReducer — 状态机', () => {
  it('初始未激活未批准', () => {
    expect(PLAN_MODE_INITIAL).toEqual({ active: false, approved: false, resume: null })
  })

  it('进入 → 未批准', () => {
    const s = planModeReducer(PLAN_MODE_INITIAL, { type: 'enter' })
    expect(s).toEqual({ active: true, approved: false, resume: null })
  })

  it('批准 → 置 approved 并生成续跑语', () => {
    let s = planModeReducer(PLAN_MODE_INITIAL, { type: 'enter' })
    s = planModeReducer(s, { type: 'approve' })
    expect(s.approved).toBe(true)
    expect(s.resume).toBeTruthy()
    expect(gatePlanTool('write_file', s.approved).allowed).toBe(true)
  })

  it('带反馈批准 → 续跑语含反馈原文', () => {
    let s = planModeReducer(PLAN_MODE_INITIAL, { type: 'enter' })
    s = planModeReducer(s, { type: 'approve', feedback: '  第二步换成不重启的方式  ' })
    expect(s.resume).toContain('第二步换成不重启的方式')
  })

  it('消费续跑语后清空，只消费一次', () => {
    let s = planModeReducer(PLAN_MODE_INITIAL, { type: 'enter' })
    s = planModeReducer(s, { type: 'approve' })
    s = planModeReducer(s, { type: 'consumeResume' })
    expect(s.resume).toBeNull()
    // 幂等：重复消费不再触发多余发送
    expect(planModeReducer(s, { type: 'consumeResume' })).toBe(s)
  })

  // 回归：上一轮批准过之后，直接再进计划模式若残留 approved，
  // 新方案会跳过审批直接写文件——计划模式就白设了
  it('回归:批准后再进入计划模式必须回到未批准', () => {
    let s = planModeReducer(PLAN_MODE_INITIAL, { type: 'enter' })
    s = planModeReducer(s, { type: 'approve' })
    s = planModeReducer(s, { type: 'enter' })
    expect(s.approved).toBe(false)
    expect(s.resume).toBeNull()
    expect(gatePlanTool('write_file', s.approved).allowed).toBe(false)
  })

  it('退出后残留状态被清空', () => {
    let s = planModeReducer(PLAN_MODE_INITIAL, { type: 'enter' })
    s = planModeReducer(s, { type: 'approve', feedback: 'x' })
    s = planModeReducer(s, { type: 'exit' })
    expect(s).toEqual({ active: false, approved: false, resume: null })
  })
})

