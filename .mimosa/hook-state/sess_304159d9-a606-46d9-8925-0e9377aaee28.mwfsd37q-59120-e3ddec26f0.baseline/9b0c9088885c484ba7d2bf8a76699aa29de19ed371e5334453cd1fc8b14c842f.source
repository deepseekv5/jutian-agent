/**
 * 自定义员工（增强 Agent 集群）
 * - 内置一套团队：总管 + 开发/测试/产品/文案
 * - 用户可创建/编辑/删除自定义员工（统一存 localStorage，可导出）
 * - 任务中员工可通过 @员工名 把任务接力给同事，最后由总管汇总
 */

export interface Employee {
  id: string
  name: string
  role: string
  prompt: string
  model?: string
  skills?: string[]
  builtin?: boolean
  icon?: string
}

/**
 * 群组：多个员工在同一个标签页里群聊。
 * - 可指定老板（bossId）：用户没 @ 任何人时由老板先接话，老板可在回复里 @ 指派成员继续干
 * - 用户也可以随时 @ 任意成员直接点名
 */
export interface Group {
  id: string
  name: string
  desc?: string
  memberIds: string[]
  bossId: string | null
  createdAt?: number
}

/* 内置团队 */
const builtinTeam: Employee[] = [
  {
    id: 'emp_manager', name: '总管', role: '项目统筹', builtin: true,
    prompt: `你是「总管」，负责理解用户目标、拆解任务、把子任务 @ 给合适的员工，并在最后汇总所有人的产出为用户交付最终答案。\n规则：\n1. 开场给出 3-6 步的拆解计划。\n2. 每一步 @ 对应员工（@开发 @测试 @产品 @文案），说明清楚要做什么、验收标准。\n3. 收到员工的产出后验收，不达标就打回（@该员工 + 修改意见）。\n4. 全部完成后输出最终交付说明。`,
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    id: 'emp_dev', name: '开发', role: '工程实现', builtin: true,
    prompt: `你是「开发」，负责代码实现：读写文件、执行命令、跑构建/测试。必须真实调用工具完成工作，产出可运行的代码与文件路径清单。遇到问题 @测试 或 @总管。`,
    icon: 'M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z',
  },
  {
    id: 'emp_test', name: '测试', role: '质量验收', builtin: true,
    prompt: `你是「测试」，负责验收：运行产品或代码、检查边界条件、输出 PASS/FAIL 与问题清单（含复现步骤）。发现问题 @开发 打回，严重问题 @总管 升级。`,
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'emp_product', name: '产品', role: '需求设计', builtin: true,
    prompt: `你是「产品」，负责需求澄清与方案设计：用户故事、功能清单、验收标准。输出结构化文档，必要时写入文件。完成后 @开发 交付实现。`,
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    id: 'emp_writer', name: '文案', role: '内容创作', builtin: true,
    prompt: `你是「文案」，负责一切文字创作：标题、正文、脚本、润色。语言自然、无 AI 腔，完成后 @产品 或 @总管 验收。`,
    icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125',
  },
]

const KEY = 'jutian_employees'

export function loadEmployees(): Employee[] {
  try {
    const raw = localStorage.getItem(KEY)
    const custom: Employee[] = raw ? JSON.parse(raw) : []
    return [...builtinTeam, ...(Array.isArray(custom) ? custom.filter(e => e && e.id && !e.builtin) : [])]
  } catch {
    return [...builtinTeam]
  }
}

export function saveEmployees(list: Employee[]): void {
  try {
    const custom = list.filter(e => !e.builtin)
    localStorage.setItem(KEY, JSON.stringify(custom))
    window.dispatchEvent(new CustomEvent('employees-changed'))
  } catch { /* ignore */ }
}

export function exportEmployees(list: Employee[]): string {
  return JSON.stringify(list.filter(e => !e.builtin), null, 2)
}

export function importEmployees(list: Employee[], json: string): Employee[] {
  try {
    const incoming: Employee[] = JSON.parse(json)
    if (!Array.isArray(incoming)) return list
    const custom = list.filter(e => !e.builtin)
    return [...builtinTeam, ...custom.filter(c => !incoming.some(i => i.id === c.id)), ...incoming.map(i => ({ ...i, builtin: false }))]
  } catch { return list }
}

/* ═══════════════ 群组 ═══════════════ */

const GKEY = 'jutian_groups'

/** 默认群：内置 5 名员工成团，老板为总管 */
function defaultGroups(): Group[] {
  const ids = builtinTeam.map(e => e.id)
  const boss = builtinTeam.find(e => e.id === 'emp_manager')
  return [{
    id: 'grp_default', name: '默认团队', desc: '内置团队：总管带队，开发 / 测试 / 产品 / 文案',
    memberIds: ids, bossId: boss ? boss.id : ids[0] || null, createdAt: 0,
  }]
}

export function loadGroups(): Group[] {
  try {
    const raw = localStorage.getItem(GKEY)
    const custom: Group[] = raw ? JSON.parse(raw) : []
    const valid = Array.isArray(custom) ? custom.filter(g => g && g.id && g.name && Array.isArray(g.memberIds)) : []
    // 首次使用：写入默认群
    if (raw === null) {
      const d = defaultGroups()
      try { localStorage.setItem(GKEY, JSON.stringify(d)) } catch { /* ignore */ }
      return d
    }
    return valid
  } catch {
    return defaultGroups()
  }
}

export function saveGroups(list: Group[]): void {
  try {
    localStorage.setItem(GKEY, JSON.stringify(list))
    window.dispatchEvent(new CustomEvent('groups-changed'))
  } catch { /* ignore */ }
}

export function createGroup(name: string, memberIds: string[], bossId: string | null): Group {
  const members = memberIds.length ? memberIds : []
  const boss = bossId && members.includes(bossId) ? bossId : (members[0] ?? null)
  return { id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.trim() || '未命名群组', memberIds: members, bossId: boss, createdAt: Date.now() }
}

/** 群成员（按群内顺序解析，剔除已删除的员工） */
export function groupMembers(g: Group, employees: Employee[]): Employee[] {
  const map = new Map(employees.map(e => [e.id, e]))
  return g.memberIds.map(id => map.get(id)).filter((e): e is Employee => !!e)
}

export function groupBoss(g: Group, employees: Employee[]): Employee | null {
  if (!g.bossId) return null
  return employees.find(e => e.id === g.bossId) || null
}
