/**
 * 时间格式化 —— 全站唯一实现
 *
 * 此前 23 处各自调用 toLocaleDateString / toLocaleTimeString，
 * 同一语义在不同文件里写法还不一致（有的带 hour12:false 有的不带、
 * 有的 'zh-CN' 有的 'sv-SE'），要改格式得逐个找。
 *
 * 按语义归成五类：
 *  - hhmm        时分，用于消息气泡、更新时间等"今天几点"的场景
 *  - hhmmss      时分秒，用于截图/剪贴板文件名与消息流时间戳
 *  - ymd         本地日期 YYYY-MM-DD，用于按天分组（用量统计、日记）
 *  - dateCN      本地化日期（默认中文，可传 en-US），用于列表项
 *  - dateTimeCN  本地化日期+时间，用于导出文件头、任务开始时间
 *  - relativeShort  GitPanel 风格：今天给时分，更早给「月/日 时分」
 *
 * 注意：不要把这些用到**数字**上。`n.toLocaleString()` 的千分位是另一回事。
 */

const ZH = 'zh-CN'

/** 时分，如 09:05（24 小时制） */
export function hhmm(d: Date | string | number = new Date()): string {
  return toDate(d).toLocaleTimeString(ZH, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 时分秒，如 09:05:32（24 小时制）——截图文件名与消息流时间戳用 */
export function hhmmss(d: Date | string | number = new Date()): string {
  return toDate(d).toLocaleTimeString(ZH, { hour12: false })
}

/** 本地日期 YYYY-MM-DD（借 sv-SE 的 ISO 风格，避免手动补零） */
export function ymd(d: Date | string | number = new Date()): string {
  return toDate(d).toLocaleDateString('sv-SE')
}

/** 本地化日期，默认中文；en 传入 'en-US' 等 */
export function dateCN(d: Date | string | number = new Date(), locale: string = ZH): string {
  return toDate(d).toLocaleDateString(locale)
}

/** 本地化日期+时间，默认中文 */
export function dateTimeCN(d: Date | string | number = new Date(), locale: string = ZH): string {
  return toDate(d).toLocaleString(locale)
}

/**
 * 简短相对时间：今天只给「09:05」，更早给「8/14 09:05」。
 * 原实现内联在 GitPanel，供提交记录列表使用。
 */
export function relativeShort(d: Date | string | number = new Date()): string {
  const date = toDate(d)
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  if (sameDay) return hhmm(date)
  return `${date.getMonth() + 1}/${date.getDate()} ${hhmm(date)}`
}

/** 统一入口：容忍字符串/数字/Date，非法值回落到当前时间（调用方无需再判 NaN） */
function toDate(d: Date | string | number): Date {
  if (d instanceof Date) return isNaN(d.getTime()) ? new Date() : d
  const date = new Date(d)
  return isNaN(date.getTime()) ? new Date() : date
}

/** 判断一个时间值是否可解析（供需要区分"无时间"的场景，如消息气泡不显示无效时间） */
export function isValidTime(d: unknown): boolean {
  if (d === null || d === undefined || d === '') return false
  return !isNaN(new Date(d as string).getTime())
}
