/**
 * 长任务跨会话编排模块（mission tracker）
 *
 * 解决的核心问题：一次用户目标不应被"一次会话 / 一轮答复"框住。真实的长任务
 * （调研、大型重构、批量生成）往往需要跨多轮、多会话、甚至多天持续推进。本模块
 * 把"目标"升格为一等公民：它有自己的生命周期、里程碑、累计轮次和历史记录，
 * 会话只是推进它的载体（sessionIds 记录哪些会话碰过某个里程碑）。
 *
 * 设计约束：
 *   - 零外部依赖纯 TS，可在浏览器 / Node / 服务端共享；不 import 任何东西。
 *   - 持久化通过可注入的 MissionStore 完成：不传则使用内置内存存储（测试友好）。
 *   - 内存状态是唯一真相源；store.save 失败（含 JSON 序列化失败）只记录失败标志，
 *     不回滚、不抛出，绝不因磁盘问题打断正在推进的任务。
 *   - 所有 id 优先用 globalThis.crypto.randomUUID，缺失时退化为时间戳 + 随机数。
 *   - 历史记录是环形缓冲，每个任务最多 MAX_HISTORY 条，防止长任务无限膨胀。
 *   - 未知 id 一律 undefined / 静默返回，不抛异常。
 *
 * 与渲染层 useChat.ts 的关系：那边 MAX_GOAL_ROUNDS=3 只管单次会话内的目标闭环；
 * 本模块的 maxRounds（默认 20）管的是**跨会话的整条任务寿命**，两者是上下游关系。
 * 主循环每轮结束后把评估器结果喂给 advance()，由本模块决定"继续 / 暂停 / 完成 / 失败"。
 *
 * 接线方式（由 serve.ts 完成，不在本模块内）：
 *   const tracker = new MissionTracker(new FileMissionStore())
 *   const mission = tracker.create(goal, { project, maxRounds: 20 })
 *   tracker.linkSession(mission.id, sessionId)
 *   const plan = tracker.advance(mission.id, sessionId, evaluation)
 *   if (plan.shouldContinue) inject(plan.nextDirective)   // <system-reminder> 通道
 */

// ─────────────────────────────────────────────────────────────
// 公开类型
// ─────────────────────────────────────────────────────────────

/** 任务生命周期状态 */
export type MissionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'

/** 里程碑状态：blocked 用于标记受阻但尚未放弃的步骤 */
export type MilestoneStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

export interface Milestone {
  id: string
  title: string
  status: MilestoneStatus
  /** 哪些会话推进过这个里程碑（去重，按首次关联顺序） */
  sessionIds: string[]
  /** 推进记录 / 已尝试路线，供续跑指令引用，避免模型重复撞墙 */
  notes: string[]
  createdAt: number
  updatedAt: number
}

/** 任务历史条目；kind 决定这条记录属于哪类状态变更 */
export type MissionHistoryKind =
  | 'progress'
  | 'evaluate'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'fail'

export interface MissionHistoryEntry {
  at: number
  sessionId: string
  kind: MissionHistoryKind
  detail: string
}

export interface Mission {
  id: string
  goal: string
  status: MissionStatus
  /** 关联项目（与 sessions.project 对齐） */
  project: string
  milestones: Milestone[]
  /** 当前正在推进的里程碑；null 表示尚未设置或全部完成 */
  currentMilestoneId: string | null
  /** 累计推进轮次（跨会话） */
  rounds: number
  /** 默认 20，封顶防失控 */
  maxRounds: number
  /** 最新评估 note（即使评估器不可用也会记录其说明） */
  lastNote: string
  history: MissionHistoryEntry[]
  createdAt: number
  updatedAt: number
}

/** 持久化接口：服务端可用 JSON 文件 / SQLite 实现，测试可用内存实现 */
export interface MissionStore {
  load(): Mission[]
  save(missions: Mission[]): void
}

/** 评估器结果，与 autoCore.ts 的 evaluateGoalAuto 返回形状对齐 */
export interface MissionEvaluation {
  done: boolean
  note: string
  /** false 表示评估器本身不可用（网络错误 / 解析失败），此时不应盲目续跑 */
  ok: boolean
}

/** advance 的决策结果，直接供主循环使用 */
export interface AdvancePlan {
  /** 是否应在新会话里继续推进 */
  shouldContinue: boolean
  /** 注入给模型的续跑指令；shouldContinue=false 时通常为空串 */
  nextDirective: string
  /** 人类可读的决策理由（也写进历史） */
  reason: string
}

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 单任务默认轮次上限：跨会话累计，防止目标闭环失控 */
export const DEFAULT_MAX_ROUNDS = 20
/** 未指定项目时的占位值，故意用空串以便与 sessions.project 的默认口径对齐 */
export const DEFAULT_PROJECT = ''
/** 历史环形缓冲上限 */
export const MAX_HISTORY = 200
/** 续跑指令中最多引用几条已尝试路线，避免指令本身过长 */
export const MAX_TRIED_NOTES = 8
/** 里程碑 notes 上限，防止单个里程碑无限膨胀 */
export const MAX_MILESTONE_NOTES = 60

// ─────────────────────────────────────────────────────────────
// 通用小工具（均为纯函数，便于单测直接验证）
// ─────────────────────────────────────────────────────────────

/**
 * 生成 id：优先用 Web Crypto 的 randomUUID；某些 Node 18 构建或受限运行环境
 * 未暴露 globalThis.crypto 时，退化为时间戳 + 随机数（碰撞概率可忽略）。
 */
export function makeId(prefix = ''): string {
  let uuid = ''
  try {
    const c = globalThis.crypto
    if (c && typeof c.randomUUID === 'function') uuid = c.randomUUID()
  } catch {
    // 某些沙箱访问 crypto 会抛，忽略后走退化路径
    uuid = ''
  }
  const suffix = uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}_${suffix}` : suffix
}

/** 把任意值收敛为字符串；空值一律变成空串 */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 把任意值收敛为有限数字；非法值返回 fallback */
function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 把任意值收敛为字符串数组，并去掉空项 */
function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item === 'string' && item.length > 0) out.push(item)
  }
  return out
}

/** 把任意值收敛为状态枚举，非法值返回 fallback */
function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : fallback
}

const MISSION_STATUSES: readonly MissionStatus[] = ['active', 'paused', 'completed', 'failed', 'cancelled']
const MILESTONE_STATUSES: readonly MilestoneStatus[] = ['pending', 'in_progress', 'done', 'blocked']
const HISTORY_KINDS: readonly MissionHistoryKind[] = ['progress', 'evaluate', 'pause', 'resume', 'complete', 'fail']

/** 深拷贝：用 JSON 往返，保证传给 store 的快照与内存状态彻底隔离 */
function cloneMissions(missions: Mission[]): Mission[] {
  return JSON.parse(JSON.stringify(missions)) as Mission[]
}

/** 去重追加：相同文本不重复记录（避免同一个 note 在续跑指令里刷屏） */
function appendNote(target: Milestone, note: string, now: number): void {
  const text = note.trim()
  if (!text || target.notes.includes(text)) return
  target.notes.push(text)
  if (target.notes.length > MAX_MILESTONE_NOTES) {
    target.notes.splice(0, target.notes.length - MAX_MILESTONE_NOTES)
  }
  target.updatedAt = now
}

/** 去重追加会话 id */
function appendSession(target: Milestone, sessionId: string, now: number): boolean {
  const id = sessionId.trim()
  if (!id || target.sessionIds.includes(id)) return false
  target.sessionIds.push(id)
  target.updatedAt = now
  return true
}

/**
 * 把外部 load() 返回的脏数据规整成合法 Mission；完全不可救的记录返回 null。
 * 这一步是防止"持久化文件被手写坏 / 旧版本字段缺失"直接击穿整个模块。
 */
function normalizeMission(raw: unknown): Mission | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = asString(r.id)
  const goal = asString(r.goal)
  if (!id || !goal) return null

  const now = Date.now()
  const rawMilestones = Array.isArray(r.milestones) ? r.milestones : []
  const milestones: Milestone[] = []
  for (let i = 0; i < rawMilestones.length; i++) {
    const rm = rawMilestones[i]
    if (!rm || typeof rm !== 'object' || Array.isArray(rm)) continue
    const m = rm as Record<string, unknown>
    const mid = asString(m.id)
    const title = asString(m.title)
    if (!mid || !title) continue
    milestones.push({
      id: mid,
      title,
      status: asEnum<MilestoneStatus>(m.status, MILESTONE_STATUSES, 'pending'),
      sessionIds: asStringArray(m.sessionIds),
      notes: asStringArray(m.notes),
      createdAt: asNumber(m.createdAt, now),
      updatedAt: asNumber(m.updatedAt, now),
    })
  }

  const rawHistory = Array.isArray(r.history) ? r.history : []
  const history: MissionHistoryEntry[] = []
  for (const rh of rawHistory) {
    if (!rh || typeof rh !== 'object' || Array.isArray(rh)) continue
    const h = rh as Record<string, unknown>
    history.push({
      at: asNumber(h.at, now),
      sessionId: asString(h.sessionId),
      kind: asEnum<MissionHistoryKind>(h.kind, HISTORY_KINDS, 'progress'),
      detail: asString(h.detail),
    })
  }
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)

  const currentMilestoneId = asString(r.currentMilestoneId)
  // 归档数据里的 0 / 负数视为字段缺失，回落到默认值；有效值才取整
  const rawMaxRounds = asNumber(r.maxRounds, DEFAULT_MAX_ROUNDS)
  const maxRounds = rawMaxRounds > 0
    ? Math.max(1, Math.floor(rawMaxRounds))
    : DEFAULT_MAX_ROUNDS

  return {
    id,
    goal,
    status: asEnum<MissionStatus>(r.status, MISSION_STATUSES, 'active'),
    project: asString(r.project) || DEFAULT_PROJECT,
    milestones,
    currentMilestoneId: currentMilestoneId && milestones.some((m) => m.id === currentMilestoneId)
      ? currentMilestoneId
      : null,
    rounds: Math.max(0, Math.floor(asNumber(r.rounds, 0))),
    maxRounds,
    lastNote: asString(r.lastNote),
    history,
    createdAt: asNumber(r.createdAt, now),
    updatedAt: asNumber(r.updatedAt, now),
  }
}

/** 内置内存存储：按引用持有快照，仅用于未注入 store 的场景 */
class MemoryMissionStore implements MissionStore {
  private data: Mission[] = []
  load(): Mission[] {
    return cloneMissions(this.data)
  }
  save(missions: Mission[]): void {
    this.data = cloneMissions(missions)
  }
}

/** 供外部显式构造内存 store（服务端未接文件存储时可临时使用） */
export function createMemoryStore(): MissionStore {
  return new MemoryMissionStore()
}

// ─────────────────────────────────────────────────────────────
// 主类
// ─────────────────────────────────────────────────────────────

export class MissionTracker {
  /** 内存中的唯一真相源 */
  private missions: Mission[] = []
  /** 实际使用的持久化后端 */
  private readonly store: MissionStore
  /** 最近一次 save 是否失败：暴露给运维排查，不抛异常 */
  private lastPersistError: unknown = null

  constructor(store?: MissionStore) {
    this.store = store || new MemoryMissionStore()
    try {
      const loaded = this.store.load()
      if (Array.isArray(loaded)) {
        const seen = new Set<string>()
        this.missions = []
        for (let i = 0; i < loaded.length; i++) {
          const mission = normalizeMission(loaded[i])
          if (!mission || seen.has(mission.id)) continue
          seen.add(mission.id)
          this.missions.push(mission)
        }
      }
    } catch {
      // load 失败就当空库启动，绝不阻塞构造
      this.missions = []
    }
  }

  // ── 查询 ──────────────────────────────────────────────────

  /** 最近一次持久化失败的原因；从未失败则为 null */
  get persistError(): unknown {
    return this.lastPersistError
  }

  /** 按 id 取任务；未知 id 返回 undefined */
  get(id: string): Mission | undefined {
    return this.find(id)
  }

  /** 列出任务；传 status 则只返回该状态。返回的是内部引用，调用方不应直接改写 */
  list(status?: MissionStatus): Mission[] {
    if (status === undefined) return this.missions.slice()
    return this.missions.filter((m) => m.status === status)
  }

  /** 统计概览：byStatus 固定包含 5 个键（即使计数为 0），便于 UI 直接渲染 */
  stats(): { total: number; byStatus: Record<string, number>; totalRounds: number } {
    const byStatus: Record<string, number> = {}
    for (const s of MISSION_STATUSES) byStatus[s] = 0
    let totalRounds = 0
    for (const m of this.missions) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1
      totalRounds += m.rounds
    }
    return { total: this.missions.length, byStatus, totalRounds }
  }

  // ── 创建与里程碑 ──────────────────────────────────────────

  /** 创建任务；goal 为空仍允许创建（后续由接线层填指令），但会规整为字符串 */
  create(goal: string, opts?: { project?: string; maxRounds?: number }): Mission {
    const now = Date.now()
    const rawMax = opts?.maxRounds
    const maxRounds = rawMax === undefined
      ? DEFAULT_MAX_ROUNDS
      : Math.max(1, Math.floor(Number.isFinite(rawMax) ? rawMax : DEFAULT_MAX_ROUNDS))
    const mission: Mission = {
      id: makeId('mission'),
      goal: asString(goal),
      status: 'active',
      project: asString(opts?.project) || DEFAULT_PROJECT,
      milestones: [],
      currentMilestoneId: null,
      rounds: 0,
      maxRounds,
      lastNote: '',
      history: [{
        at: now,
        sessionId: '',
        kind: 'progress',
        detail: `任务创建：${asString(goal).slice(0, 120) || '（未填写目标）'}`,
      }],
      createdAt: now,
      updatedAt: now,
    }
    this.missions.push(mission)
    this.persist()
    return mission
  }

  /** 新增里程碑，返回其 id；未知任务返回空串。第一个里程碑自动成为当前里程碑 */
  addMilestone(missionId: string, title: string): string {
    const m = this.find(missionId)
    if (!m) return ''
    const now = Date.now()
    const cleanTitle = asString(title).trim()
    if (!cleanTitle) return ''
    const milestone: Milestone = {
      id: makeId('ms'),
      title: cleanTitle,
      status: 'pending',
      sessionIds: [],
      notes: [],
      createdAt: now,
      updatedAt: now,
    }
    m.milestones.push(milestone)
    if (!m.currentMilestoneId) {
      m.currentMilestoneId = milestone.id
      milestone.status = 'in_progress'
    }
    m.updatedAt = now
    this.persist()
    return milestone.id
  }

  /** 修改里程碑状态并记录可选 note；未知任务 / 里程碑静默返回 */
  markMilestone(missionId: string, milestoneId: string, status: MilestoneStatus, note?: string): void {
    const m = this.find(missionId)
    if (!m) return
    const ms = m.milestones.find((x) => x.id === milestoneId)
    if (!ms) return
    const now = Date.now()
    ms.status = asEnum<MilestoneStatus>(status, MILESTONE_STATUSES, 'pending')
    if (note !== undefined) appendNote(ms, note, now)
    ms.updatedAt = now
    m.updatedAt = now
    this.persist()
  }

  /**
   * 关联会话到当前里程碑：去重；首次关联时补一条 progress 历史。
   * 没有当前里程碑时静默返回（任务还没拆步骤）。
   */
  linkSession(missionId: string, sessionId: string): void {
    const m = this.find(missionId)
    if (!m) return
    const cur = this.currentMilestone(m)
    if (!cur) return
    const now = Date.now()
    if (!appendSession(cur, sessionId, now)) return
    this.record(m, now, sessionId, 'progress', `会话 ${sessionId} 开始推进里程碑「${cur.title}」`)
    m.updatedAt = now
    this.persist()
  }

  // ── 核心状态机 ────────────────────────────────────────────

  /**
   * 推进一轮：吃进评估器结果，产出"继续 / 暂停 / 完成 / 失败"的决策。
   *
   * 状态转移：
   *   ok=false                       -> paused（评估器不可用，不盲目续跑）
   *   done=true 且无剩余里程碑        -> completed
   *   done=true 且有剩余里程碑        -> 切到下一个里程碑，继续
   *   done=false 且 rounds<maxRounds  -> 继续，附续跑指令（含已尝试路线）
   *   rounds>=maxRounds              -> failed（封顶）
   *
   * 注意：done=true 的那一轮也会计入 rounds；若刚好触顶且还有后续里程碑，
   * 任务仍判 failed，但已完成的里程碑与当前指针会保留，便于人工接手。
   */
  advance(
    missionId: string,
    sessionId: string,
    evaluation: MissionEvaluation,
  ): AdvancePlan {
    const m = this.find(missionId)
    if (!m) return this.noPlan('任务不存在或已被移除')

    if (m.status !== 'active') {
      return this.noPlan(`任务当前状态为 ${m.status}，无法推进`)
    }

    const now = Date.now()
    const ev = evaluation || { done: false, note: '', ok: false }
    const note = asString(ev.note).trim()
    const ok = !!ev.ok
    const done = ok && !!ev.done

    // 无论评估成功与否，轮次和 lastNote 都要如实记录
    m.rounds += 1
    m.updatedAt = now
    m.lastNote = note

    const cur = this.currentMilestone(m)
    if (cur) appendSession(cur, sessionId, now)

    const label = !ok ? '评估不可用' : done ? '完成' : '未完成'
    this.record(
      m, now, sessionId, 'evaluate',
      `第 ${m.rounds} 轮评估（${label}）${note ? `：${note}` : ''}`,
    )

    // 分支一：评估器不可用。谨慎起见暂停，等外部修复后显式 resume
    if (!ok) {
      this.setStatus(m, 'paused', now, sessionId, `评估器不可用，任务已暂停${note ? `：${note}` : ''}`)
      return {
        shouldContinue: false,
        nextDirective: '',
        reason: '评估器不可用，任务已暂停，需修复后手动恢复',
      }
    }

    // 分支二：本轮达成目标
    if (done) {
      if (cur) {
        cur.status = 'done'
        if (note) appendNote(cur, `已完成：${note}`, now)
        cur.updatedAt = now
      }
      // 按数组顺序寻找下一个尚未完成的里程碑；blocked 同样是"未完成"，
      // 不能被悄悄跳过，否则任务会在仍有受阻步骤时误判为完成。
      const next = m.milestones.find(
        (x) => x.id !== cur?.id && x.status !== 'done',
      )
      if (!next) {
        this.setStatus(
          m, 'completed', now, sessionId,
          note ? `目标达成：${note}` : '全部里程碑已完成',
        )
        return {
          shouldContinue: false,
          nextDirective: '',
          reason: '目标已完成，全部里程碑达成',
        }
      }
      m.currentMilestoneId = next.id
      // 受阻里程碑保留 blocked 标记（它需要在续跑中被显式解决），不改写成 in_progress
      if (next.status !== 'blocked') next.status = 'in_progress'
      next.updatedAt = now

      if (m.rounds >= m.maxRounds) {
        this.setStatus(
          m, 'failed', now, sessionId,
          `已推进 ${m.rounds} 轮，达到上限 ${m.maxRounds} 轮`,
        )
        return {
          shouldContinue: false,
          nextDirective: '',
          reason: '达到最大轮次上限，任务已失败（里程碑进度已保留）',
        }
      }
      // 续跑路径不经过 setStatus，需在这里单独落盘（轮次 / 里程碑已变化）
      this.persist()
      return {
        shouldContinue: true,
        nextDirective: this.buildDirective(m),
        reason: '当前里程碑完成，已进入下一里程碑',
      }
    }

    // 分支三：未完成。把 note 记进当前里程碑，作为"已尝试路线"供下一轮避坑
    if (cur && note) appendNote(cur, note, now)

    if (m.rounds >= m.maxRounds) {
      this.setStatus(
        m, 'failed', now, sessionId,
        `已推进 ${m.rounds} 轮，达到上限 ${m.maxRounds} 轮`,
      )
      return {
        shouldContinue: false,
        nextDirective: '',
        reason: '达到最大轮次上限，任务已失败',
      }
    }

    // 续跑路径不经过 setStatus，需在这里单独落盘（轮次 / note / 历史已变化）
    this.persist()
    return {
      shouldContinue: true,
      nextDirective: this.buildDirective(m),
      reason: '目标尚未完成，需继续推进',
    }
  }

  // ── 显式状态操作 ──────────────────────────────────────────

  /** 暂停：仅 active 可暂停。原因会写进历史 */
  pause(missionId: string, reason?: string): void {
    this.transition(missionId, 'paused', reason || '任务已暂停', ['active'])
  }

  /**
   * 恢复：paused / failed 可恢复为 active。
   * paused -> active 保留累计轮次；failed -> active 视为人工续命，重置 rounds=0 给新预算，
   * 否则一个已经触顶的任务恢复后下一轮又会立刻失败，恢复动作将毫无意义。
   */
  resume(missionId: string, reason?: string): void {
    const m = this.find(missionId)
    if (!m) return
    if (m.status !== 'paused' && m.status !== 'failed') return
    const now = Date.now()
    const fromFailed = m.status === 'failed'
    if (fromFailed) m.rounds = 0
    this.setStatus(
      m, 'active', now, '',
      reason || (fromFailed ? '任务从失败态恢复，轮次预算已重置' : '任务已恢复'),
    )
  }

  /** 完成：仅 active / paused 可标记完成 */
  complete(missionId: string, reason?: string): void {
    this.transition(missionId, 'completed', reason || '任务已手动完成', ['active', 'paused'])
  }

  /** 取消：仅未终结的任务可取消（completed / cancelled 是终态） */
  cancel(missionId: string, reason?: string): void {
    this.transition(missionId, 'cancelled', reason || '任务已取消', ['active', 'paused', 'failed'])
  }

  // ── 展示 ──────────────────────────────────────────────────

  /** 生成给模型 / UI 的文本摘要：目标、状态、里程碑、轮次、最近 note 一目了然 */
  summary(missionId: string): string {
    const m = this.find(missionId)
    if (!m) return ''
    const lines: string[] = []
    lines.push(`【任务进度】${m.id}`)
    lines.push(`目标：${m.goal || '（未填写）'}`)
    lines.push(`状态：${m.status}${m.project ? ` | 项目：${m.project}` : ''}`)
    lines.push(`轮次：${m.rounds}/${m.maxRounds}`)
    lines.push(`里程碑（${m.milestones.length}）：`)
    if (m.milestones.length === 0) {
      lines.push('  （尚未拆分里程碑）')
    } else {
      m.milestones.forEach((ms, i) => {
        const sessions = ms.sessionIds.length ? ` | 会话：${ms.sessionIds.join(', ')}` : ''
        const current = ms.id === m.currentMilestoneId ? ' <- 当前' : ''
        lines.push(`  ${i + 1}. [${ms.status}] ${ms.title}${sessions}${current}`)
      })
    }
    lines.push(`最近评估：${m.lastNote || '（暂无）'}`)
    lines.push(`历史条目：${m.history.length}`)
    return lines.join('\n')
  }

  // ── 内部实现 ──────────────────────────────────────────────

  private find(id: string): Mission | undefined {
    if (!id) return undefined
    return this.missions.find((m) => m.id === id)
  }

  private currentMilestone(m: Mission): Milestone | undefined {
    if (!m.currentMilestoneId) return undefined
    return m.milestones.find((x) => x.id === m.currentMilestoneId)
  }

  /** 统一的"无操作"返回值，保证 advance 的形状固定 */
  private noPlan(reason: string): AdvancePlan {
    return { shouldContinue: false, nextDirective: '', reason }
  }

  /** 环形缓冲写历史；超过上限时丢弃最旧的条目 */
  private record(
    m: Mission,
    at: number,
    sessionId: string,
    kind: MissionHistoryKind,
    detail: string,
  ): void {
    m.history.push({ at, sessionId, kind, detail })
    if (m.history.length > MAX_HISTORY) {
      m.history.splice(0, m.history.length - MAX_HISTORY)
    }
  }

  /**
   * 状态切换 + 历史记录 + 持久化。
   * kind 从目标状态推导：active 记为 resume，其余状态同名映射；
   * cancelled 没有专属 kind，归入 progress（历史类型清单里没有 cancel）。
   */
  private setStatus(
    m: Mission,
    status: MissionStatus,
    at: number,
    sessionId: string,
    detail: string,
  ): void {
    m.status = status
    m.updatedAt = at
    const kind: MissionHistoryKind =
      status === 'active' ? 'resume'
        : status === 'paused' ? 'pause'
          : status === 'completed' ? 'complete'
            : status === 'failed' ? 'fail'
              : 'progress'
    this.record(m, at, sessionId, kind, detail)
    this.persist()
  }

  /** 带前置状态校验的通用转移（pause / complete / cancel 共用） */
  private transition(
    missionId: string,
    target: MissionStatus,
    detail: string,
    allowedFrom: readonly MissionStatus[],
  ): void {
    const m = this.find(missionId)
    if (!m) return
    if (!allowedFrom.includes(m.status)) return
    this.setStatus(m, target, Date.now(), '', detail)
  }

  /**
   * 构造续跑指令：明确带上目标、当前里程碑、评估反馈以及"已尝试路线"，
   * 让新会话里的模型不会重复上一轮已经证明走不通的做法。
   */
  private buildDirective(m: Mission): string {
    const cur = this.currentMilestone(m)
    const title = cur ? cur.title : '（尚未设置里程碑）'
    const tried = cur ? cur.notes.slice(-MAX_TRIED_NOTES) : []
    const lines: string[] = []
    lines.push(`【长任务续跑指令】目标：${m.goal || '（未填写）'}`)
    lines.push(`当前里程碑：${title}`)
    lines.push(`评估反馈：${m.lastNote || '（评估器未给出说明）'}`)
    if (tried.length === 0) {
      lines.push('已尝试路线：暂无记录')
    } else {
      lines.push('已尝试路线（请勿重复）：')
      tried.forEach((note, i) => lines.push(`  ${i + 1}. ${note}`))
    }
    lines.push(
      `轮次进度：${m.rounds}/${m.maxRounds}。请换用新路线推进「${title}」，本轮须给出可验证的实际产出。`,
    )
    return lines.join('\n')
  }

  /**
   * 持久化：先做 JSON 往返快照再交给 store，避免外部 store 持有同一份引用后
   * 被后续内存修改意外污染。任何失败都吞掉并记录到 lastPersistError。
   */
  private persist(): void {
    try {
      this.store.save(cloneMissions(this.missions))
      this.lastPersistError = null
    } catch (err) {
      this.lastPersistError = err
    }
  }
}
