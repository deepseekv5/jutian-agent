/**
 * 标准 5 段 cron 解析（v14）
 *
 * 背景：定时任务的 UI 让用户填 cron 表达式，但服务端此前根本不解析——
 * `nextRun` 从未被计算，任务创建后永远不会触发（只有手改 JSON 的能跑）。
 * 这里实现标准 5 段（分 时 日 月 周），够覆盖日常自动化：
 *
 *   * * * * *        每分钟
 *   0 9 * * 1-5      工作日 9:00
 *   0 9,18 * * *     每天 9:00 与 18:00
 *   0/15 * * * *     每 15 分钟（也接受 0-59/15）
 *   30 8 1 * *       每月 1 号 8:30
 *   0 0 * * 0        每周日 0:00
 *
 * 语义遵循 Vixie cron：日与周同时受限时取「或」（任一匹配即触发）。
 * 纯函数、无依赖，便于测试。
 */

export interface CronFields {
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** 日与周是否都被限制（决定用「或」还是「与」） */
  domRestricted: boolean
  dowRestricted: boolean
}

const RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7],  // day of week (0/7 = Sunday，解析后统一成 0)
]

/** 解析单个字段为取值集合；非法返回 null */
export function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  const f = String(field || '').trim()
  if (!f) return null
  for (const part of f.split(',')) {
    const seg = part.trim()
    if (!seg) return null
    let step = 1
    let base = seg
    const slash = seg.indexOf('/')
    if (slash >= 0) {
      base = seg.slice(0, slash)
      step = Number(seg.slice(slash + 1))
      if (!Number.isInteger(step) || step <= 0) return null
    }
    let lo: number
    let hi: number
    if (base === '*' || base === '') {
      lo = min; hi = max
    } else if (base.includes('-')) {
      const [a, b] = base.split('-')
      lo = Number(a); hi = Number(b)
    } else {
      lo = Number(base)
      // 单值 + 步长（`5/10`）按 Vixie 语义表示「从 5 开始每隔 10」
      hi = slash >= 0 ? max : lo
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size ? out : null
}

/** 解析整条表达式；非法返回 null（调用方给用户明确报错） */
export function parseCron(expr: string): CronFields | null {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets: Set<number>[] = []
  for (let i = 0; i < 5; i++) {
    const s = parseCronField(parts[i], RANGES[i][0], RANGES[i][1])
    if (!s) return null
    sets.push(s)
  }
  // 周日既可写 0 也可写 7：统一成 0
  if (sets[4].has(7)) { sets[4].delete(7); sets[4].add(0) }
  return {
    minutes: sets[0], hours: sets[1], days: sets[2], months: sets[3], weekdays: sets[4],
    domRestricted: parts[2].trim() !== '*',
    dowRestricted: parts[4].trim() !== '*',
  }
}

/**
 * 从 from 之后（不含 from 所在分钟）找下一个匹配时刻。
 * 最多向前找 366 天，找不到返回 null（如 2 月 30 日这类永不成立的条件）。
 */
export function nextCronTime(expr: string, from: Date = new Date()): Date | null {
  const f = parseCron(expr)
  if (!f) return null
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = 366 * 24 * 60
  for (let i = 0; i < limit; i++) {
    if (!f.months.has(d.getMonth() + 1)) {
      // 整月跳过：直接跳到下月 1 日 0:00
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    const domOk = f.days.has(d.getDate())
    const dowOk = f.weekdays.has(d.getDay())
    // Vixie 语义：两者都受限时任一匹配即可；只受限其一时按那个判断
    const dayOk = f.domRestricted && f.dowRestricted ? (domOk || dowOk) : (f.domRestricted ? domOk : f.dowRestricted ? dowOk : true)
    if (!dayOk) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!f.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!f.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d
  }
  return null
}

/** 校验表达式并给出可操作的中文错误 */
export function validateCron(expr: string): string | null {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length !== 5) return 'cron 需要 5 段：分 时 日 月 周（例：0 9 * * 1-5）'
  const f = parseCron(expr)
  if (!f) return 'cron 表达式无法解析，请检查数字范围与符号（支持 * , - /）'
  if (!nextCronTime(expr, new Date())) return '该表达式永远不会触发（例如 2 月 30 日）'
  return null
}
