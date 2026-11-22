/**
 * 内核级失败恢复（mistake recovery）
 *
 * 与 toolLoopGuard 的分工：
 *   - toolLoopGuard 只做"计数 + 提示"，靠 hint 劝模型改路；
 *   - 本模块把失败结构化：先判类型（kind），再给出**可执行的恢复动作**（action），
 *     必要时切换工具、先读后写、甚至收尾退出，而不是继续撞墙。
 *
 * 设计约束（与 toolLoopGuard 一致）：
 *   - 零依赖纯 TS，不 import 任何东西，可在浏览器 / Node / 服务端共享；
 *   - 所有判据都是同步纯计算，无 I/O、无计时器、无全局状态；
 *   - 类实例持有状态，主循环在工具调用成功后调 reset() 清零。
 *
 * 典型用法（主循环）：
 *   const recovery = new FailureRecovery()
 *   // 工具失败时：
 *   recovery.record(ev)
 *   const plan = recovery.plan(ev)
 *   inject(plan.instruction)             // 注入给模型的可执行指令
 *   if (plan.patches) mergeArgs(ev, plan.patches)
 *   if (recovery.shouldStop()) abortToolRound()
 *   // 工具成功时：
 *   recovery.reset()
 *
 * 约定：record() 先于 plan() 调用是常规路径；但 plan() 也支持"未记录"的裸事件，
 * 内部会把当前事件当作虚拟的最后一次失败来计算连续次数，不会二次计数。
 */

/** 失败类型：分类是恢复策略的前提，分类错了后面全错 */
export type FailureKind =
  | 'not_found'        // 文件/路径不存在
  | 'permission'       // 权限拒绝、只读目录
  | 'invalid_args'     // 参数校验失败、JSON 破损
  | 'tool_error'       // 工具自身报错（超时/上游错误）
  | 'context_overflow' // 上下文溢出
  | 'repeated'         // 重复调用空转
  | 'unknown'

/**
 * 恢复动作：
 *   retry_same     原样重试一次（临时性错误，重试确实可能成功）
 *   fix_args       修正参数后重试（输入问题，原样重试必然再失败）
 *   switch_tool    换工具/换路线（同一工具已证明走不通）
 *   read_first     先读后写（先核实环境再决定写，避免盲写）
 *   summarize_exit 收尾总结（问题无法在本轮解决，带结论退出）
 *   should_stop    停止空转（完全相同的调用重复出现，再试无意义）
 */
export type RecoveryAction =
  | 'retry_same'
  | 'fix_args'
  | 'switch_tool'
  | 'read_first'
  | 'summarize_exit'
  | 'should_stop'

/** 一次失败事件的完备描述（由主循环在 catch 到工具错误时构造） */
export interface FailureEvent {
  toolName: string
  args: Record<string, unknown>
  errorText: string
  round: number
  at: number
}

/** 给模型/主循环使用的恢复决策 */
export interface RecoveryPlan {
  kind: FailureKind
  action: RecoveryAction
  /** 注入给模型的中文可执行指令，明确"下一步做什么" */
  instruction: string
  /** 建议的参数修正；无法安全推断的值不会放进来，交给模型或用户决定 */
  patches?: Record<string, unknown>
  /** 0-1，越高表示分类越确定；低置信度分支应Allow模型自行复核 */
  confidence: number
  /** 判定依据，便于调试与向用户解释 */
  reason: string
}

/** 内部记录：在事件上附加分类与归一化签名 */
interface FailureRecord {
  ev: FailureEvent
  kind: FailureKind
  signature: string
}

/** 已下发过的恢复决策，用于 shouldStop() 判断"给过策略仍失败" */
interface PlanLog {
  key: string
  kind: FailureKind
  action: RecoveryAction
}

/** 参数校验错误的解析结果 */
export interface InvalidArgsInfo {
  /** 提取到的字段名（缺失或为空），按出现顺序去重 */
  fields: string[]
  /** 明确被指出"不能为空"的字段，是补丁的首选目标 */
  emptyFields: string[]
  /** JSON 语法破损（而非字段缺失） */
  jsonBroken: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 阈值：全部导出，便于测试边界与未来配置化
// ─────────────────────────────────────────────────────────────────────────────

/** 环形缓冲上限：只保留最近 100 次失败，老事件自然淘汰 */
export const RING_BUFFER_LIMIT = 100
/** shouldStop() 的观察窗口：最近 5 次失败 */
export const STOP_WINDOW = 5
/** shouldStop() 的同类型门槛：窗口内 ≥4 次同一 kind */
export const STOP_SAME_KIND = 4
/** shouldStop() 的"给过策略"门槛：≥2 次 fix_args/switch_tool 仍失败 */
export const STOP_ACTIONABLE = 2
/** 完全相同调用连续达到此次数视为空转 */
export const REPEAT_STOP_LIMIT = 3
/** 同类工具临时错误达到此次数后不再原样重试 */
export const TOOL_ERROR_SWITCH_LIMIT = 2
/** 未知错误达到此次数后收尾，不再盲试 */
export const UNKNOWN_SUMMARY_LIMIT = 3
/** 单工具连续失败达到此次数后强制换路线（与 toolLoopGuard 的硬阈值对齐） */
export const HARD_CONSECUTIVE_LIMIT = 5

// ─────────────────────────────────────────────────────────────────────────────
// 分类关键词：大小写不敏感，中英文并收；顺序即优先级
// ─────────────────────────────────────────────────────────────────────────────

/** 上下文溢出最优先：再调用只会把上下文推得更满 */
const CONTEXT_OVERFLOW_RE = /(context\s+length|context\s+window|上下文过长|上下文超限|超出上下文|上下文已满|maximum\s+context|token\s+limit|too\s+many\s+tokens|prompt\s+too\s+long|提示词过长|messages?\s+too\s+long)/i

/** 路径不存在 */
const NOT_FOUND_RE = /(不存在|找不到|未找到|路径不存在|文件不存在|not\s*found|ENOENT|no\s+such\s+(file|directory)|does\s+not\s+exist|cannot\s+find|missing\s+file)/i

/** 权限 / 只读 */
const PERMISSION_RE = /(permission|EACCES|EPERM|denied|forbidden|access\s+not\s+permitted|read[\s-]?only|只读|无权限|没有权限|无权|路径不允许|不允许访问|禁止访问|operation\s+not\s+permitted)/i

/** 参数问题：刻意写得窄，避免把"上游返回 invalid response"误判成参数错 */
const INVALID_ARGS_RE = /(参数|字段|校验|\bjson\b|required|missing\s+(?:required\s+)?(?:field|param(?:eter)?|argument|property)|invalid\s+(?:argument|param(?:eter)?|input|json|value)|invalid\s+json|json\s*(?:parse|格式|语法)|validation|格式错误|格式不对|unexpected\s+token|cannot\s+parse)/i

/** 工具自身/上游临时错误 */
const TOOL_ERROR_RE = /(timeout|timed?\s*out|超时|上游|upstream|gateway|HTTP\s*5\d\d|\b50[0-9]\b|bad\s+gateway|service\s+unavailable|ECONNRESET|ECONNREFUSED|ETIMEDOUT|网络错误|连接失败|服务不可用|请求失败)/i

/** 只读目录的强信号（决定 permission 分支走 summarize_exit 还是 switch_tool） */
const READ_ONLY_RE = /(read[\s-]?only|只读|immutable|protected\s+path|read-only\s+file\s+system|不可写)/i

/** 写类工具：命中后"只读目录"才升级为让用户改路径 */
const WRITE_TOOL_RE = /(write|edit|create|delete|remove|mkdir|rmdir|save|patch|touch|move|\bmv\b|copy|\bcp\b|shell|bash|exec|execute|apply|modify|update)/i

/**
 * 纯文本分类：只看 errorText，不涉及序列状态。
 * 序列型判定（repeated）由 FailureRecovery 在 record/plan 里叠加，不放在这里。
 *
 * 优先级：context_overflow > not_found > permission > invalid_args > tool_error > unknown。
 * 原因：越靠前的分支越"可操作"；例如"上游 500 且提示文件不存在"应先修路径，
 * 而不是盲目重试一个前提就错的工具。
 */
export function classifyFailureKind(errorText: string): FailureKind {
  const t = String(errorText || '')
  if (CONTEXT_OVERFLOW_RE.test(t)) return 'context_overflow'
  if (NOT_FOUND_RE.test(t)) return 'not_found'
  if (PERMISSION_RE.test(t)) return 'permission'
  if (INVALID_ARGS_RE.test(t)) return 'invalid_args'
  if (TOOL_ERROR_RE.test(t)) return 'tool_error'
  return 'unknown'
}

/**
 * 调用签名：工具名 + 归一化参数。
 * 与 toolLoopGuard.callSignature 同思路但本地实现，保证本模块零 import：
 * 对象键递归排序（键序是序列化细节，不是语义），数组保持原序（顺序是语义），
 * 空白折叠，避免模型换一下键顺序就绕过重复检测。
 */
export function argsSignature(name: string, args: Record<string, unknown> | undefined): string {
  const norm = sortKeysDeep(args && typeof args === 'object' ? args : {})
  let text: string
  try {
    text = JSON.stringify(norm)
  } catch {
    text = String(args || '')
  }
  return name + '::' + text.replace(/\s+/g, ' ')
}

/** 递归键排序：对象键序无语义，数组元素顺序有语义 */
function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep)
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k])
    return out
  }
  return v
}

/** 事件唯一键：用于把 planLog 与历史记录对应起来 */
function keyOf(ev: FailureEvent): string {
  return ev.toolName + '\u0000' + argsSignature(ev.toolName, ev.args) + '\u0000' + ev.round + '\u0000' + ev.at
}

/** 同一事件判定（tool / args / round / at 全等） */
function sameEvent(a: FailureEvent, b: FailureEvent): boolean {
  return keyOf(a) === keyOf(b)
}

/**
 * 取父目录：read_first 分支要告诉模型"先列哪个目录"。
 * 'a/b.txt' -> 'a'；'/a/b.txt' -> '/a'；'b.txt' -> '.'；反斜杠按分隔符处理。
 */
export function parentPath(pathValue: string): string {
  const s = String(pathValue || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return s.slice(0, i)
}

/** 从错误文案里提取"疑似正确路径"（如 Did you mean / 你是否想找），有则作为补丁建议 */
export function extractSuggestedPath(errorText: string): string {
  const m = /(?:did\s+you\s+mean|perhaps\s+you\s+meant|suggest(?:ed)?(?:\s+path)?|similar\s+(?:file|path)|你是否想(?:找|访问)|或许你想(?:找|访问)|最接近(?:的)?(?:文件|路径)?(?:是|为)|建议路径)[：:\s]*["'`]?([^\s"'`，。；;、]+)/i.exec(errorText)
  return m && m[1] ? m[1] : ''
}

/** 参数字段名提取：英文 required/missing 与中文"缺少参数/字段 xxx"都覆盖 */
const FIELD_PATTERNS: RegExp[] = [
  /missing\s+(?:required\s+)?(?:field|parameter|param|argument|property)\s*["'`]?([\w.-]+)["'`]?/gi,
  /(?:required|missing)\s+["'`]?([\w.-]+)["'`]?\s+(?:field|parameter|param|argument|property|is\s+required)/gi,
  /(?:field|parameter|param|argument|property)\s*["'`]?([\w.-]+)["'`]?\s+(?:is\s+)?(?:required|missing)/gi,
  /(?:缺少|缺失)(?:必填)?(?:参数|字段)?\s*["'`]?([\w.-]+)["'`]?/g,
  /(?:参数|字段)\s*["'`]?([\w.-]+)["'`]?\s*(?:不能为空|未提供|缺失|不存在|必填)/g,
  /["'`]([\w.-]+)["'`]\s+(?:is\s+)?required/gi,
]
/** "不能为空"字段的提取（补丁优先级最高） */
const EMPTY_FIELD_RE = /(?:参数|字段)\s*["'`]?([\w.-]+)["'`]?\s*(?:不能为空|为空|empty|must\s+not\s+be\s+empty)/gi

/**
 * 解析参数类错误：提取字段名、空值字段、是否 JSON 破损。
 * 返回结构给 fix_args 分支构造 instruction 与 patches。
 */
export function parseInvalidArgs(errorText: string): InvalidArgsInfo {
  const t = String(errorText || '')
  const fields: string[] = []
  for (const re of FIELD_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(t)) !== null) {
      if (m[1] && !fields.includes(m[1])) fields.push(m[1])
      if (m[0].length === 0) re.lastIndex++ // 防御零宽匹配导致死循环
    }
  }
  const emptyFields: string[] = []
  EMPTY_FIELD_RE.lastIndex = 0
  let em: RegExpExecArray | null
  while ((em = EMPTY_FIELD_RE.exec(t)) !== null) {
    if (em[1] && !emptyFields.includes(em[1])) emptyFields.push(em[1])
  }
  const jsonBroken = /(json|unexpected\s+token|cannot\s+parse|parse\s+error|语法错误|格式错误|破损)/i.test(t)
  return { fields, emptyFields, jsonBroken }
}

/**
 * 字段默认值：只补"补了也绝对安全"的值。
 * 路径类字段绝不猜——猜错会让模型把内容写到错误位置，比不补更糟。
 * 返回 undefined 表示无法安全推断，patch 里不会出现该键。
 */
export function defaultForField(field: string, args: Record<string, unknown>): unknown {
  const cur = args[field]
  if (cur !== undefined && cur !== null && cur !== '') return undefined
  const f = field.toLowerCase()
  if (/(path|dir|folder|file|filename|uri|url|target|dest|destination|source)/.test(f)) return undefined
  if (/(content|text|body|message|desc|description|note|query|prompt|value|name|title)/.test(f)) return ''
  if (/(items|list|array|files|paths|commands|lines|tags|entries)/.test(f)) return []
  if (/(options|config|meta|metadata|params|headers|extra|settings)/.test(f)) return {}
  if (/(flag|enabled|force|recursive|dryrun|dry_run|verbose|overwrite)/.test(f)) return false
  return undefined
}

/** 是否写类工具：决定 permission + readonly 是"建议用户改路径"还是"换工具" */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_RE.test(toolName)
}

/** 换工具的具体建议：给模型一个明确替代路线，而不是"你换一下吧" */
export function switchToolAdvice(toolName: string): string {
  const n = toolName.toLowerCase()
  if (/(shell|bash|exec|execute|terminal|cmd)/.test(n)) {
    return '改用专门的文件工具（read_file / list_dir / write_file），不要用 shell 处理路径与权限'
  }
  if (/(write|edit|create|save|patch|modify|update)/.test(n)) {
    return '先用 list_dir 核实目录是否可写，再换一个可写路径写入；或改用带权限检查的专用写入工具'
  }
  if (/(read|cat|open|view|get_file)/.test(n)) {
    return '改用 list_dir 确认目标是否存在，或改用 search_content 在已知目录内定位文件'
  }
  if (/(search|find|grep|glob)/.test(n)) {
    return '先用 list_dir 缩小到具体目录，再在该目录内检索，避免全盘扫描'
  }
  return '换一个功能等价但实现不同的工具，先用最小输入验证前提是否成立'
}

/** 类型中文名：summary() 用，保证输出可读 */
const KIND_LABEL: Record<FailureKind, string> = {
  not_found: '路径不存在',
  permission: '权限拒绝',
  invalid_args: '参数错误',
  tool_error: '工具错误',
  context_overflow: '上下文过长',
  repeated: '重复空转',
  unknown: '未知错误',
}

/** 动作中文名：summary() 用，描述"已经走过的路线"，避免模型重复 */
function routeLabel(kind: FailureKind, action: RecoveryAction | undefined): string {
  if (!action) return '尚未给出恢复策略'
  switch (action) {
    case 'retry_same': return '已原样重试'
    case 'fix_args': return '已建议修正参数'
    case 'switch_tool': return kind === 'permission' ? '已建议换路径' : '已建议换工具'
    case 'read_first': return '已试 list_dir 核对路径'
    case 'summarize_exit': return '已建议收尾总结'
    case 'should_stop': return '已建议停止空转'
  }
}

/** 计数型分类的名字表，stats() 返回时深拷贝，避免外部改到内部状态 */
const ALL_KINDS: FailureKind[] = [
  'not_found', 'permission', 'invalid_args', 'tool_error',
  'context_overflow', 'repeated', 'unknown',
]

/**
 * 失败恢复状态机。
 *
 * 状态：
 *   - 环形缓冲（上限 100）：只保留最近失败，老事件自动淘汰；
 *   - 分工具连续计数：记录每个工具自上次成功以来的失败次数，reset() 全清；
 *   - 恢复决策日志：记录已下发过哪些 fix_args/switch_tool，供 shouldStop 判断"给了策略仍失败"。
 *
 * 线程安全：单线程顺序调用即可，不做并发保护（与主循环同线程）。
 */
export class FailureRecovery {
  /** 固定长度环形数组，head 指向下一次写入位置 */
  private readonly buf: FailureRecord[] = new Array<FailureRecord>(RING_BUFFER_LIMIT)
  private head = 0
  private size = 0

  /** 分工具连续失败槽：键为 toolName，值自上次 reset() 以来的失败次数 */
  private readonly consecutive = new Map<string, number>()

  /** 已下发的恢复决策（上限 100，与缓冲同量级） */
  private planLog: PlanLog[] = []

  /** 累计统计（reset 不清，便于跨请求观测） */
  private totalFailures = 0
  private byKindCount: Record<string, number> = {}
  private recoveryCount = 0

  constructor() {
    for (const k of ALL_KINDS) this.byKindCount[k] = 0
  }

  /**
   * 记录一次失败。同一事件重复 record 会各记一次（重复调用本身就是信号），
   * 不会去重；去重由 plan() 在"虚拟视图"里处理。
   */
  record(ev: FailureEvent): void {
    const kind = this.classifyWithRepeats(ev)
    const rec: FailureRecord = {
      ev,
      kind,
      signature: argsSignature(ev.toolName, ev.args),
    }
    this.buf[this.head] = rec
    this.head = (this.head + 1) % RING_BUFFER_LIMIT
    if (this.size < RING_BUFFER_LIMIT) this.size++
    this.consecutive.set(ev.toolName, (this.consecutive.get(ev.toolName) || 0) + 1)
    this.totalFailures++
    this.byKindCount[kind] = (this.byKindCount[kind] || 0) + 1
  }

  /**
   * 给出恢复策略。纯计算：不写环形缓冲、不清零计数；只追加一条 planLog
   * 用于 shouldStop()/summary()。因此同一事件多次调用 plan() 决策稳定。
   */
  plan(ev: FailureEvent): RecoveryPlan {
    const entries = this.entries()
    // 已记录过的事件（哪怕不是最后一条）不再补计一次，避免连续次数翻倍
    const recorded = entries.some(e => sameEvent(e.ev, ev))
    const view: FailureRecord[] = recorded
      ? entries
      : [...entries, { ev, kind: classifyFailureKind(ev.errorText), signature: argsSignature(ev.toolName, ev.args) }]

    const kind = this.classifyWithRepeatsIn(view, ev, recorded)
    const n = (this.consecutive.get(ev.toolName) || 0) + (recorded ? 0 : 1)
    const plan = this.decide(ev, kind, n, view, recorded)
    const isNew = this.logPlan(ev, kind, plan.action)
    if (isNew && plan.action !== 'should_stop' && plan.action !== 'summarize_exit') this.recoveryCount++
    return plan
  }

  /**
   * 是否应停止当前工具轮次。
   * 条件（同时满足）：最近 5 次失败里 ≥4 次同一 kind，且其中至少 2 次
   * 已经给过 fix_args / switch_tool 策略仍然失败——说明"给策略"这条路也走不通。
   */
  shouldStop(): boolean {
    const win = this.entries().slice(-STOP_WINDOW)
    if (win.length < STOP_SAME_KIND) return false

    // 找窗口内出现次数最多的 kind
    const counts: Record<string, number> = {}
    for (const r of win) counts[r.kind] = (counts[r.kind] || 0) + 1
    let dominant: FailureKind | '' = ''
    let max = 0
    for (const k of ALL_KINDS) {
      if ((counts[k] || 0) > max) { max = counts[k] || 0; dominant = k }
    }
    if (!dominant || max < STOP_SAME_KIND) return false

    const winKeys = new Set(win.map(r => keyOf(r.ev)))
    let actionable = 0
    for (const p of this.planLog) {
      if (!winKeys.has(p.key) || p.kind !== dominant) continue
      if (p.action === 'fix_args' || p.action === 'switch_tool') actionable++
    }
    return actionable >= STOP_ACTIONABLE
  }

  /**
   * 给模型的失败摘要：列出最近 3 次失败的类型与已尝试路线，末尾要求"勿重复"。
   * 路线取自 planLog，因此只有真正下发过策略的失败才会标注路线。
   */
  summary(): string {
    const win = this.entries().slice(-3)
    if (win.length === 0) return '暂无失败记录。'
    const parts: string[] = []
    for (const r of win) {
      const action = this.lastActionFor(keyOf(r.ev))
      parts.push(r.ev.toolName + '(' + KIND_LABEL[r.kind] + ')→' + routeLabel(r.kind, action))
    }
    return '最近 ' + win.length + ' 次失败：' + parts.join('；') + '。请勿重复这些路线。'
  }

  /** 工具成功后调用：清空失败历史、连续计数与决策日志；累计统计保留 */
  reset(): void {
    // 不用 fill：槽位会在后续 record 里覆盖，size=0 时 entries() 不读旧槽
    this.head = 0
    this.size = 0
    this.consecutive.clear()
    this.planLog = []
  }

  /** 累计统计的快照（深拷贝 byKind） */
  stats(): { total: number; byKind: Record<string, number>; recoveries: number } {
    return {
      total: this.totalFailures,
      byKind: { ...this.byKindCount },
      recoveries: this.recoveryCount,
    }
  }

  /** 只读历史快照，便于调用方/测试检查环形缓冲状态 */
  get history(): readonly FailureEvent[] {
    return this.entries().map(r => r.ev)
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────────

  /** 按写入顺序展开环形缓冲（旧 -> 新） */
  private entries(): FailureRecord[] {
    const out: FailureRecord[] = []
    const start = (this.head - this.size + RING_BUFFER_LIMIT) % RING_BUFFER_LIMIT
    for (let i = 0; i < this.size; i++) out.push(this.buf[(start + i) % RING_BUFFER_LIMIT])
    return out
  }

  /** record 时的分类：叠加"连续重复"判定 */
  private classifyWithRepeats(ev: FailureEvent): FailureKind {
    const base = classifyFailureKind(ev.errorText)
    const sig = argsSignature(ev.toolName, ev.args)
    let repeats = 0
    for (let i = this.size - 1; i >= 0; i--) {
      const r = this.buf[(this.head - 1 - i + RING_BUFFER_LIMIT) % RING_BUFFER_LIMIT]
      if (r && r.signature === sig) repeats++
      else break
    }
    return repeats + 1 >= REPEAT_STOP_LIMIT ? 'repeated' : base
  }

  /** plan 时的分类：使用虚拟视图（含尚未记录的事件） */
  private classifyWithRepeatsIn(view: FailureRecord[], ev: FailureEvent, recorded: boolean): FailureKind {
    const base = classifyFailureKind(ev.errorText)
    const sig = argsSignature(ev.toolName, ev.args)
    let repeats = 0
    for (let i = view.length - 1; i >= 0; i--) {
      if (view[i].signature === sig) repeats++
      else break
    }
    if (!recorded) repeats++ // 当前事件尚未进历史，虚拟追加
    return repeats >= REPEAT_STOP_LIMIT ? 'repeated' : base
  }

  /** 具体决策：每个分支都给出明确指令、理由与置信度 */
  private decide(
    ev: FailureEvent,
    kind: FailureKind,
    n: number,
    view: FailureRecord[],
    recorded: boolean,
  ): RecoveryPlan {
    const tool = ev.toolName
    switch (kind) {
      case 'context_overflow':
        return {
          kind,
          action: 'summarize_exit',
          instruction: `上下文已接近上限，停止继续调用工具。请基于已有结果收尾总结，明确说明未完成部分与阻塞原因，不要再发起新的工具调用。`,
          confidence: 0.96,
          reason: '错误文案命中上下文长度/token 限制，继续调用只会让溢出加重',
        }

      case 'repeated': {
        const repeats = this.countRepeats(view, ev, recorded)
        return {
          kind,
          action: 'should_stop',
          instruction: `「${tool}」以完全相同的参数已连续失败 ${repeats} 次，属于空转。立即停止重复调用：换参数、换工具，或直接基于已有结果给出结论。`,
          confidence: 0.97,
          reason: `相同调用签名连续出现 ${repeats} 次（阈值 ${REPEAT_STOP_LIMIT}），重复执行不会改变结果`,
        }
      }

      case 'not_found': {
        const pathValue = this.firstPathArg(ev.args)
        const suggested = extractSuggestedPath(ev.errorText)
        if (!pathValue) {
          return {
            kind,
            action: 'read_first',
            instruction: `找不到目标且参数里没有明确的 path。请先用 list_dir 查看工作目录，确认真实路径后再调用 ${tool}；不要凭猜测重试。`,
            confidence: 0.8,
            reason: '错误命中路径不存在，但没有 path 参数可据此定位父目录',
          }
        }
        const parent = parentPath(pathValue)
        let instruction = `路径「${pathValue}」不存在。请先用 list_dir 查看父目录「${parent}」，确认真实路径后再重试 ${tool}；不要把不存在的路径原样再传一次。`
        if (suggested) instruction += ` 错误里疑似正确路径为「${suggested}」，可先核对再改用该路径。`
        const patches: Record<string, unknown> = {}
        if (suggested) patches.path = suggested
        return {
          kind,
          action: 'read_first',
          instruction,
          ...(suggested ? { patches } : {}),
          confidence: suggested ? 0.94 : 0.92,
          reason: '错误命中 ENOENT/not found，先读父目录确认真实路径，避免盲写或盲读',
        }
      }

      case 'permission': {
        const advice = switchToolAdvice(tool)
        if (READ_ONLY_RE.test(ev.errorText) && isWriteTool(tool)) {
          return {
            kind,
            action: 'summarize_exit',
            instruction: `目标目录只读或当前账号无写权限，${tool} 的写入不会成功。请换一个可写路径（如工作区内的临时目录），或请用户调整权限后再写；不要重复同一写入。若无法改写，请基于已有结果收尾说明阻塞原因。`,
            confidence: 0.9,
            reason: '写操作命中只读/权限拒绝，是本轮无法自愈的环境问题，继续试无收益',
          }
        }
        return {
          kind,
          action: 'switch_tool',
          instruction: `权限被拒绝，${tool} 在当前环境下不可用。${advice}。先确认访问权限再继续，不要原样重试。`,
          confidence: 0.88,
          reason: '错误命中 permission/denied/EACCES，换用实现不同的工具通常能绕过单一工具的权限限制',
        }
      }

      case 'invalid_args': {
        const info = parseInvalidArgs(ev.errorText)
        const patches: Record<string, unknown> = {}
        for (const f of info.fields) {
          const d = defaultForField(f, ev.args)
          if (d !== undefined) patches[f] = d
        }
        const patchKeys = Object.keys(patches)
        const parts = [`参数校验失败`]
        if (info.fields.length) parts.push(`涉及字段：${info.fields.join('、')}`)
        if (info.emptyFields.length) parts.push(`不能为空：${info.emptyFields.join('、')}`)
        if (info.jsonBroken) parts.push('参数是破损的 JSON，请重新生成合法 JSON 对象后再调用')
        if (patchKeys.length) {
          parts.push(`可安全补的默认值：${patchKeys.map(k => k + '=' + JSON.stringify(patches[k])).join('，')}`)
        }
        parts.push(`请先修正参数再重新调用 ${tool}，不要原样重试。`)
        const hasPatch = patchKeys.length > 0
        return {
          kind,
          action: 'fix_args',
          instruction: parts.join('。'),
          ...(hasPatch ? { patches } : {}),
          confidence: info.jsonBroken ? 0.78 : (info.fields.length ? 0.88 : 0.72),
          reason: '错误命中参数/校验/JSON 关键词，属于输入问题：修正后重试即可恢复',
        }
      }

      case 'tool_error': {
        if (n < TOOL_ERROR_SWITCH_LIMIT) {
          return {
            kind,
            action: 'retry_same',
            instruction: `${tool} 出现临时错误（超时/上游故障），可原样重试一次；若仍失败请换工具，不要无限重试。`,
            confidence: 0.86,
            reason: `该工具连续失败 ${n} 次（<${TOOL_ERROR_SWITCH_LIMIT}），临时性错误原样重试有恢复概率`,
          }
        }
        const advice = switchToolAdvice(tool)
        return {
          kind,
          action: 'switch_tool',
          instruction: `${tool} 已连续 ${n} 次临时错误，原样重试无意义。${advice}。若换工具仍失败，请收尾说明上游状态。`,
          confidence: 0.82,
          reason: `同一工具连续失败 ${n} 次（≥${TOOL_ERROR_SWITCH_LIMIT}），判定为持续性上游故障，需换路线`,
        }
      }

      case 'unknown':
      default:
        if (n < UNKNOWN_SUMMARY_LIMIT) {
          return {
            kind: 'unknown',
            action: 'retry_same',
            instruction: `工具 ${tool} 返回了无法归类的错误，可原样重试一次；重试前留意错误文案里是否含路径、权限或参数信息，若有请按对应方式处理。`,
            confidence: 0.4,
            reason: `未知错误仅 ${n} 次（<${UNKNOWN_SUMMARY_LIMIT}），先低成本重试收集信息`,
          }
        }
        return {
          kind: 'unknown',
          action: 'summarize_exit',
          instruction: `${tool} 已连续 ${n} 次未知错误，继续盲试没有收益。请收尾总结已完成的步骤和阻塞原因，等待用户指示。`,
          confidence: 0.6,
          reason: `未知错误累计 ${n} 次（≥${UNKNOWN_SUMMARY_LIMIT}），分类信号不足，停止试错交由用户决策`,
        }
    }
  }

  /** 取第一个可用的路径类参数：path 优先，其次常见别名 */
  private firstPathArg(args: Record<string, unknown>): string {
    for (const k of ['path', 'filePath', 'file_path', 'file', 'dir', 'directory']) {
      const v = args[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return ''
  }

  /** 统计当前调用签名在虚拟视图尾部的连续重复次数 */
  private countRepeats(view: FailureRecord[], ev: FailureEvent, recorded: boolean): number {
    const sig = argsSignature(ev.toolName, ev.args)
    let repeats = 0
    for (let i = view.length - 1; i >= 0; i--) {
      if (view[i].signature === sig) repeats++
      else break
    }
    return recorded ? repeats : repeats + 1
  }

  /**
   * 记录决策；同一事件同一动作只记一次，避免 plan() 幂等调用被当成多次策略。
   * 返回是否为新策略，供 recoveries 计数使用。
   */
  private logPlan(ev: FailureEvent, kind: FailureKind, action: RecoveryAction): boolean {
    const key = keyOf(ev)
    if (this.planLog.some(p => p.key === key && p.action === action)) return false
    this.planLog.push({ key, kind, action })
    if (this.planLog.length > RING_BUFFER_LIMIT) this.planLog.splice(0, this.planLog.length - RING_BUFFER_LIMIT)
    return true
  }

  /** 取某事件最近一次下发过的动作 */
  private lastActionFor(key: string): RecoveryAction | undefined {
    for (let i = this.planLog.length - 1; i >= 0; i--) {
      if (this.planLog[i].key === key) return this.planLog[i].action
    }
    return undefined
  }
}
