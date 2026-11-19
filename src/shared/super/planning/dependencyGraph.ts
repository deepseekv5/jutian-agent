/**
 * 依赖图实现（模块 B: planning / DependencyGraph）
 *
 * 职责：把一组 PlanStep 视作一张有向图，并提供规划阶段需要的三种核心算法：
 *   1. 分层拓扑排序（topologicalLevels）：给出每一轮可以并行执行的步骤 id；
 *   2. 加权关键路径（criticalPath）：按 estimatedDifficulty 找最长依赖链；
 *   3. 环检测（detectCycle）：三色 DFS 找环并还原环路径。
 *
 * 数据模型（三张表始终保持一致）：
 *   - nodes   : id -> PlanStep 元数据（含难度，供关键路径加权）
 *   - edges   : id -> 它直接依赖的 id 列表（出边指向"前置步骤"）
 *   - reverse : id -> 直接依赖它的 id 列表（反向边，供 Kahn 递减入度）
 *
 * 之所以同时维护 edges 与 reverse，是因为两个方向都被算法高频使用：
 *   - 拓扑排序需要"某个节点完成后，谁可以解锁" -> reverse；
 *   - 关键路径需要"某个节点开始前沿哪个前置状态" -> edges。
 * 任何对图的改动都必须走 addNode/removeNode/addEdge/removeEdge，
 * 这三个方法协同维护三张表，不允许外部直接改写 Map 内容。
 *
 * 关于"环"：规划器产出的计划原则上不应有环，但用户手写步骤、模板拼接、
 * 上游分析器给出矛盾依赖时都可能出现环。本实现不抛异常，而是：
 *   - detectCycle 显式报告环；
 *   - topologicalLevels 把无法解锁的节点统一放进最后一个"降级层"；
 *   - suggestCycleBreaks 给出可操作的打破建议。
 * 这样编排层（superCore）即使拿到脏图也能继续跑，而不是整体崩溃。
 */

import type { DependencyGraph, PlanStep } from '../types'

/* ─────────────────────────────────────────────────────────────
 * 对外辅助类型
 * ───────────────────────────────────────────────────────────── */

/**
 * 一条"打破环"的建议。
 * 语义：from 依赖 to，因此移除 from -> to 这条依赖即可断开对应的环。
 */
export interface CycleBreakSuggestion {
  /** 依赖方步骤 id（它 dependsOn to） */
  from: string
  /** 被依赖步骤 id */
  to: string
  /** 是否是本轮最推荐移除的那一条 */
  recommended: boolean
  /** 可解释理由 */
  reason: string
}

/** 单节点的图结构摘要，供诊断面板/日志使用 */
export interface GraphNodeInfo {
  id: string
  /** 直接前置 */
  dependencies: string[]
  /** 直接后继 */
  dependents: string[]
  /** 估计难度（已夹逼到 0-100） */
  difficulty: number
  /** 入度（依赖数量，自环计一次） */
  inDegree: number
  /** 出度（后继数量，自环计一次） */
  outDegree: number
}

/* ─────────────────────────────────────────────────────────────
 * 实现类
 * ───────────────────────────────────────────────────────────── */

export class DependencyGraphImpl implements DependencyGraph {
  /** id -> PlanStep。对外暴露（契约要求），但修改请走本类方法 */
  public nodes: Map<string, PlanStep>
  /** id -> 它依赖的 id 列表 */
  public edges: Map<string, string[]>
  /** id -> 依赖它的 id 列表 */
  public reverse: Map<string, string[]>

  /**
   * 节点插入顺序。算法输出按此顺序稳定排列，
   * 避免 Map 迭代顺序在不同构建路径下造成测试抖动。
   */
  private readonly order: string[] = []

  constructor(steps: PlanStep[] = []) {
    this.nodes = new Map<string, PlanStep>()
    this.edges = new Map<string, string[]>()
    this.reverse = new Map<string, string[]>()

    // 两遍构建：先落全部节点，再连边。
    // 这样即便 step A 依赖在其之后出现的 step B，连边时 B 也已存在。
    for (const step of steps) {
      if (step && typeof step.id === 'string') this.insertNode(step)
    }
    for (const step of steps) {
      if (!step || typeof step.id !== 'string') continue
      const deps: unknown = (step as PlanStep).dependsOn
      if (!Array.isArray(deps)) continue
      for (const dep of deps) {
        if (typeof dep === 'string') this.connect(step.id, dep)
      }
    }
  }

  /* ── 内部原语：三张表的一致性维护 ───────────────────────── */

  /** 插入节点（重复 id 保留首次出现的定义），同时初始化两个邻接表 */
  private insertNode(step: PlanStep): boolean {
    if (this.nodes.has(step.id)) return false
    this.nodes.set(step.id, step)
    this.edges.set(step.id, [])
    this.reverse.set(step.id, [])
    this.order.push(step.id)
    return true
  }

  /** 建立 id -> depId 依赖边；自动去重，并保证两端节点已存在 */
  private connect(id: string, depId: string): boolean {
    if (!this.nodes.has(id) || !this.nodes.has(depId)) return false
    const outgoing = this.edges.get(id) as string[]
    if (outgoing.includes(depId)) return false // 重复依赖直接忽略，避免入度被重复计算
    outgoing.push(depId)
    const incoming = this.reverse.get(depId) as string[]
    if (!incoming.includes(id)) incoming.push(id)
    return true
  }

  /** 移除一条依赖边，同步清理两个邻接表 */
  private disconnect(id: string, depId: string): boolean {
    const outgoing = this.edges.get(id)
    if (!outgoing) return false
    const oi = outgoing.indexOf(depId)
    if (oi < 0) return false
    outgoing.splice(oi, 1)
    const incoming = this.reverse.get(depId)
    if (incoming) {
      const ii = incoming.indexOf(id)
      if (ii >= 0) incoming.splice(ii, 1)
    }
    return true
  }

  /* ── 公开的结构维护方法 ─────────────────────────────────── */

  /** 新增/替换一个节点（含其依赖）。返回是否真的插入了新节点 */
  addNode(step: PlanStep): boolean {
    const inserted = this.insertNode(step)
    if (!inserted) return false
    for (const dep of step.dependsOn ?? []) this.connect(step.id, dep)
    return true
  }

  /** 删除节点，并把它从所有邻接表中摘除。返回是否删除成功 */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false

    // 1) 我依赖的：从这些前置的 reverse 中移除我
    for (const dep of this.edges.get(id) ?? []) {
      const incoming = this.reverse.get(dep)
      if (incoming) {
        const i = incoming.indexOf(id)
        if (i >= 0) incoming.splice(i, 1)
      }
    }
    // 2) 依赖我的：从这些后继的 edges 中移除我
    for (const dependent of this.reverse.get(id) ?? []) {
      const outgoing = this.edges.get(dependent)
      if (outgoing) {
        const i = outgoing.indexOf(id)
        if (i >= 0) outgoing.splice(i, 1)
      }
    }

    this.nodes.delete(id)
    this.edges.delete(id)
    this.reverse.delete(id)
    const oi = this.order.indexOf(id)
    if (oi >= 0) this.order.splice(oi, 1)
    return true
  }

  /** 新增一条依赖边。返回 false 表示重复、或引用了不存在的节点 */
  addEdge(id: string, depId: string): boolean {
    return this.connect(id, depId)
  }

  /** 删除一条依赖边。返回是否删除成功 */
  removeEdge(id: string, depId: string): boolean {
    return this.disconnect(id, depId)
  }

  /** 是否存在该节点 */
  hasNode(id: string): boolean {
    return this.nodes.has(id)
  }

  /** 节点数量 */
  get size(): number {
    return this.nodes.size
  }

  /** 按插入顺序返回全部 id（副本） */
  orderedIds(): string[] {
    return [...this.order]
  }

  /** 取某节点的图摘要 */
  getNodeInfo(id: string): GraphNodeInfo | null {
    const step = this.nodes.get(id)
    if (!step) return null
    const deps = this.edges.get(id) ?? []
    const dependents = this.reverse.get(id) ?? []
    return {
      id,
      dependencies: [...deps],
      dependents: [...dependents],
      difficulty: this.clampDifficulty(step.estimatedDifficulty),
      inDegree: deps.length,
      outDegree: dependents.length,
    }
  }

  /**
   * 自检三张表是否一致。返回问题描述数组，空数组表示健康。
   * 用途：单测断言、运行期诊断面板。
   */
  validate(): string[] {
    const problems: string[] = []

    if (this.nodes.size !== this.edges.size || this.nodes.size !== this.reverse.size) {
      problems.push(
        `三表大小不一致：nodes=${this.nodes.size} edges=${this.edges.size} reverse=${this.reverse.size}`,
      )
    }
    if (this.order.length !== this.nodes.size) {
      problems.push(`顺序表与节点表长度不一致：order=${this.order.length} nodes=${this.nodes.size}`)
    }

    for (const id of this.nodes.keys()) {
      if (!this.edges.has(id)) problems.push(`edges 缺少节点 ${id}`)
      if (!this.reverse.has(id)) problems.push(`reverse 缺少节点 ${id}`)
    }
    for (const id of this.order) {
      if (!this.nodes.has(id)) problems.push(`order 含未知节点 ${id}`)
    }

    // edges[id] 中每个 dep 都必须存在，且 reverse[dep] 必须回指 id
    for (const [id, deps] of this.edges) {
      const seen = new Set<string>()
      for (const dep of deps) {
        if (!this.nodes.has(dep)) {
          problems.push(`节点 ${id} 依赖了不存在的节点 ${dep}`)
          continue
        }
        if (seen.has(dep)) {
          problems.push(`节点 ${id} 对 ${dep} 存在重复依赖`)
        }
        seen.add(dep)
        const back = this.reverse.get(dep) ?? []
        if (!back.includes(id)) {
          problems.push(`reverse[${dep}] 未回指 ${id}`)
        }
      }
    }

    // reverse[id] 中每个 dependent 都必须存在，且 edges[dependent] 必须含 id
    for (const [id, dependents] of this.reverse) {
      for (const dependent of dependents) {
        if (!this.nodes.has(dependent)) {
          problems.push(`节点 ${id} 的反向边指向不存在的节点 ${dependent}`)
          continue
        }
        const out = this.edges.get(dependent) ?? []
        if (!out.includes(id)) {
          problems.push(`edges[${dependent}] 未包含 ${id}`)
        }
      }
    }

    return problems
  }

  /* ── 核心图算法 ─────────────────────────────────────────── */

  /**
   * 分层拓扑排序（Kahn 算法的分层变体）。
   *
   * 定义：第 0 层是所有入度为 0 的节点；移除第 k 层后入度降为 0 的节点
   * 构成第 k+1 层。因此同一层内的节点互不依赖，可以并行执行。
   *
   * 环降级：若存在环（或环的后继），这些节点永远不会解锁。
   * 为不丢步骤，算法结束后把所有未处理节点按插入顺序放进最后一个"降级层"。
   * 调用方可借 detectCycle() 判断降级层是否由环造成。
   *
   * @returns 每层一个 id 数组；空图返回 []
   */
  topologicalLevels(): string[][] {
    if (this.order.length === 0) return []

    // 入度 = 依赖数量。edges 已在 connect 阶段去重，无需再次去重。
    const inDegree = new Map<string, number>()
    for (const id of this.order) {
      inDegree.set(id, (this.edges.get(id) ?? []).length)
    }

    let current = this.order.filter((id) => (inDegree.get(id) ?? 0) === 0)
    const levels: string[][] = []
    const processed = new Set<string>()

    while (current.length > 0) {
      // 按插入顺序归一化，保证输出稳定
      current = current.sort((a, b) => this.order.indexOf(a) - this.order.indexOf(b))
      levels.push([...current])
      for (const id of current) processed.add(id)

      const next: string[] = []
      for (const id of current) {
        // id 完成 -> 所有依赖它的节点入度减一
        for (const dependent of this.reverse.get(id) ?? []) {
          if (processed.has(dependent)) continue
          const remaining = (inDegree.get(dependent) ?? 0) - 1
          inDegree.set(dependent, remaining)
          if (remaining === 0) next.push(dependent)
        }
      }
      current = next
    }

    // 降级：环内节点 + 被环阻塞的后继节点
    const stranded = this.order.filter((id) => !processed.has(id))
    if (stranded.length > 0) levels.push(stranded)

    return levels
  }

  /**
   * 加权关键路径：沿依赖链求 estimatedDifficulty 之和最大的路径。
   *
   * 递推：dist[id] = difficulty(id) + max{ dist[dep] | dep ∈ deps(id) }
   * 若没有前置，max 视为 0。用 topologicalLevels 的展平顺序作为计算序，
   * 保证处理 id 时其所有前置的 dist 已就绪（环内节点按降级顺序近似处理）。
   *
   * @returns 按依赖方向排列的 id 数组（起点 -> 终点）；空图返回 []
   */
  criticalPath(): string[] {
    if (this.order.length === 0) return []

    const flatOrder: string[] = []
    for (const level of this.topologicalLevels()) flatOrder.push(...level)

    const dist = new Map<string, number>()
    const prev = new Map<string, string | null>()

    for (const id of flatOrder) {
      let best = 0
      let bestDep: string | null = null
      for (const dep of this.edges.get(id) ?? []) {
        const dv = dist.get(dep)
        if (dv !== undefined && dv > best) {
          best = dv
          bestDep = dep
        }
      }
      const weight = this.clampDifficulty(this.nodes.get(id)?.estimatedDifficulty ?? 0)
      dist.set(id, best + weight)
      prev.set(id, bestDep)
    }

    // 找最大 dist 的终点；平局时取插入顺序更早者
    let endId = flatOrder[0]
    let bestDist = Number.NEGATIVE_INFINITY
    for (const id of flatOrder) {
      const d = dist.get(id) ?? 0
      if (d > bestDist) {
        bestDist = d
        endId = id
      }
    }

    // 沿 prev 回溯，再反转成正向路径
    const path: string[] = []
    let cursor: string | null = endId
    const guard = new Set<string>()
    while (cursor !== null && !guard.has(cursor)) {
      guard.add(cursor)
      path.push(cursor)
      cursor = prev.get(cursor) ?? null
    }
    path.reverse()
    return path
  }

  /**
   * 三色 DFS 环检测。
   *   白(0)：未访问；灰(1)：在当前递归栈中；黑(2)：已处理完毕。
   * 遇到指向灰色节点的边即为回边，说明存在环。
   *
   * @returns 环路径，首尾相同以闭合（如 [a, c, b, a]）；无环返回 null
   */
  detectCycle(): string[] | null {
    const color = new Map<string, 0 | 1 | 2>()
    for (const id of this.order) color.set(id, 0)
    const stack: string[] = []

    const visit = (id: string): string[] | null => {
      color.set(id, 1)
      stack.push(id)

      for (const dep of this.edges.get(id) ?? []) {
        const c = color.get(dep) ?? 0
        if (c === 1) {
          // 回边：从栈中 dep 的位置到栈顶即为环，再补回 dep 闭合
          const start = stack.indexOf(dep)
          const cycle = start >= 0 ? stack.slice(start) : [dep]
          return [...cycle, dep]
        }
        if (c === 0) {
          const found = visit(dep)
          if (found) return found
        }
      }

      stack.pop()
      color.set(id, 2)
      return null
    }

    for (const id of this.order) {
      if ((color.get(id) ?? 0) === 0) {
        const found = visit(id)
        if (found) return found
      }
    }
    return null
  }

  /** 是否无环 */
  isAcyclic(): boolean {
    return this.detectCycle() === null
  }

  /**
   * 环打破建议：枚举环上的每条依赖边，给出移除建议。
   * 推荐顺序按"被依赖步骤的难度"升序——移除低难度前置的代价更小。
   */
  suggestCycleBreaks(): CycleBreakSuggestion[] {
    const cycle = this.detectCycle()
    if (!cycle || cycle.length < 2) return []

    // cycle 形如 [a, c, b, a]，相邻两项构成一条依赖边 a 依赖 c 等
    const pairs: Array<{ from: string; to: string; difficulty: number }> = []
    for (let i = 0; i < cycle.length - 1; i += 1) {
      const from = cycle[i]
      const to = cycle[i + 1]
      const difficulty = this.clampDifficulty(this.nodes.get(to)?.estimatedDifficulty ?? 0)
      pairs.push({ from, to, difficulty })
    }

    pairs.sort((a, b) => a.difficulty - b.difficulty || this.order.indexOf(a.from) - this.order.indexOf(b.from))

    return pairs.map((pair, index) => {
      const fromTitle = this.nodes.get(pair.from)?.title || pair.from
      const toTitle = this.nodes.get(pair.to)?.title || pair.to
      const recommended = index === 0
      return {
        from: pair.from,
        to: pair.to,
        recommended,
        reason: `「${fromTitle}」依赖「${toTitle}」形成循环依赖；` +
          `被依赖步骤难度为 ${pair.difficulty}，${recommended ? '优先移除此依赖' : '可作为备选移除'}以打破环。`,
      }
    })
  }

  /**
   * 应用"推荐"的打破建议到当前图（就地修改），返回被移除的边数量。
   * 若没有环则不做任何改动。用于需要自动修复的降级路径。
   */
  applyRecommendedCycleBreak(): number {
    const suggestions = this.suggestCycleBreaks().filter((s) => s.recommended)
    let removed = 0
    for (const s of suggestions) {
      if (this.disconnect(s.from, s.to)) removed += 1
    }
    return removed
  }

  /* ── 工具方法 ───────────────────────────────────────────── */

  /** 难度夹逼到 0-100，NaN/负数/超大值都归位 */
  private clampDifficulty(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(100, Math.round(value)))
  }
}

/* ─────────────────────────────────────────────────────────────
 * 工厂函数
 * ───────────────────────────────────────────────────────────── */

/**
 * 由 PlanStep 列表构建依赖图。
 * 这是规划器与依赖图之间唯一的入口，便于后续替换实现而不动调用方。
 */
export function buildDependencyGraph(steps: PlanStep[]): DependencyGraph {
  return new DependencyGraphImpl(steps)
}

/** 便利别名：有些调用点希望拿到具体类以使用额外方法（如 validate） */
export function buildConcreteDependencyGraph(steps: PlanStep[]): DependencyGraphImpl {
  return new DependencyGraphImpl(steps)
}
