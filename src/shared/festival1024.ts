/**
 * 1024 程序员节彩蛋（v12.3）
 *
 * 设计原则：
 *   1. 不打扰：只在 10-24 当天、且用户主动触发时出现，不弹窗不挡操作
 *   2. 有真东西：不是纯装饰——彩蛋里给一份"程序员日报"（真实统计数据）
 *   3. 可测：判定逻辑是纯函数，节日边界用假时间测
 *
 * 触发方式（三个入口，都不显眼）：
 *   · 主页顶部徽章点 3 次
 *   · 命令面板输入 1024
 *   · 输入框发送 /1024
 */

/** 节日窗口：10-24 当天（本地时区）。宽限到 10-25 凌晨 2 点，
 *  因为程序员过节通常在深夜——0 点一过就消失会让熬夜的人错过。 */
export const FESTIVAL_MONTH = 10
export const FESTIVAL_DAY = 24
const GRACE_HOURS = 2

/** 是否处于 1024 节日窗口 */
export function isFestival(now = new Date()): boolean {
  // 预览开关：?f1024=1 或 localStorage.jt_f1024_preview=1
  // 只给开发/验收用——让非节日期间也能看节日主页效果，
  // 不影响真实判定（默认关闭，用户不会误触）。
  try {
    if (typeof location !== 'undefined' && /[?&]f1024=1\b/.test(location.search)) return true
    if (typeof localStorage !== 'undefined' && localStorage.getItem('jt_f1024_preview') === '1') return true
  } catch { /* ignore */ }
  const m = now.getMonth() + 1
  const d = now.getDate()
  if (m === FESTIVAL_MONTH && d === FESTIVAL_DAY) return true
  // 10-25 的 0:00~2:00 算宽限
  if (m === FESTIVAL_MONTH && d === FESTIVAL_DAY + 1 && now.getHours() < GRACE_HOURS) return true
  return false
}

/** 距离下一个 1024 还有多少天（用于主页倒计时；当天返回 0） */
export function daysUntilFestival(now = new Date()): number {
  if (isFestival(now)) return 0
  const y = now.getMonth() + 1 > FESTIVAL_MONTH
    || (now.getMonth() + 1 === FESTIVAL_MONTH && now.getDate() > FESTIVAL_DAY)
    ? now.getFullYear() + 1 : now.getFullYear()
  const target = new Date(y, FESTIVAL_MONTH - 1, FESTIVAL_DAY)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - start.getTime()) / 86400000)
}

export interface EggCard {
  id: string
  /** 主标题 */
  title: string
  /** 正文 */
  body: string
  /** 可选的等宽小字（代码/数字） */
  mono?: string
}

/**
 * 彩蛋内容：程序员日报的"固定部分"。
 * 动态统计（工具数、会话数等）由调用方注入，这里只写不变量。
 */
export function eggCards(stats: { toolCount: number; sessionCount: number; daysUsed: number }): EggCard[] {
  const cards: EggCard[] = [
    {
      id: 'greet',
      title: '1024 · 程序员节快乐',
      body: `你正在使用的这个应用有 ${stats.toolCount} 个工具，全部跑在你自己机器上。没有账号、没有云端、数据不出本机——这是它存在的意义。`,
      mono: '01001000 01100101 01101100 01101100 01101111',
    },
    {
      id: 'stats',
      title: '你的 1024 小结',
      body: stats.sessionCount > 0
        ? `你已经和它聊过 ${stats.sessionCount} 个会话，用了 ${stats.daysUsed} 天。这些记录都在本地数据库里，随时可以导出或备份。`
        : '你还没开始对话——今天很适合试一次：让它帮你干完一件真实的事，而不是只回答一个问题。',
    },
    {
      id: 'truth',
      title: '一句实话',
      body: 'AI 会犯错。它写的代码要跑一遍，它说的数字要核一次。工具再强也替代不了你的判断——这就是为什么这个应用把「改前必读、改后必验」写进了工作铁律。',
    },
    {
      id: 'wish',
      title: '今天许个愿',
      body: '愿你的构建都通过，愿你的告警都不响，愿你在 23:59 提交的那一行代码没有 typo。',
      mono: 'exit 0',
    },
  ]
  return cards
}

/**
 * 主页节日横幅的文案（按是否当天区分）。
 * 当天：祝福 + 彩蛋入口提示；平时：倒计时，不打扰。
 */
export function festivalBanner(now = new Date()): { active: boolean; title: string; subtitle: string } | null {
  const d = daysUntilFestival(now)
  if (isFestival(now)) {
    return {
      active: true,
      title: '1024 · 程序员节快乐',
      subtitle: '点这里三次，有东西给你',
    }
  }
  // 只在临近 7 天显示倒计时，平时完全不出现（避免常驻广告感）
  if (d > 0 && d <= 7) {
    return {
      active: false,
      title: `还有 ${d} 天到 1024`,
      subtitle: '程序员节 · 点开预览彩蛋',
    }
  }
  return null
}

/** 连点计数：3 次触发，间隔超过 1.2 秒重新计数 */
export const TAP_TARGET = 3
export const TAP_WINDOW_MS = 1200

export function nextTapCount(prev: { count: number; lastAt: number }, now = Date.now()): { count: number; lastAt: number; fired: boolean } {
  const within = now - prev.lastAt <= TAP_WINDOW_MS
  const count = within ? prev.count + 1 : 1
  return { count, lastAt: now, fired: count >= TAP_TARGET }
}
