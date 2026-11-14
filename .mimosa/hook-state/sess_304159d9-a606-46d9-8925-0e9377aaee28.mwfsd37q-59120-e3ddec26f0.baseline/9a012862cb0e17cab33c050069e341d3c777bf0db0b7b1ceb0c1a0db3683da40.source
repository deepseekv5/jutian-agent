/**
 * 本地 API 实时活动（v14.11.2）——「谁在用、正在回复什么」
 *
 * 本地 OpenAI 兼容端点（/v1/chat/completions）收到外部请求时，
 * 服务端把一条活动记录广播给渲染层：谁调用（User-Agent 归一化 +
 * 本机/局域网区分）、用了哪个模型、用户问了什么（前 80 字预览）、
 * 首字延迟与总耗时——用户在设置页能实时看到，正在回复时还带动画。
 *
 * 持久化：写 ~/.lyclaw/data/local-api-activity.json（最近 30 条），
 * 设置页轮询读取。渲染层不维护状态，服务端是唯一数据源。
 */

export interface LocalApiActivity {
  id: string
  ts: number
  /** 调用方名称：User-Agent 归一化后的干净名字 + 来源标记 */
  source: string
  /** 来源 IP（回环则记 local） */
  origin: string
  method: string
  path: string
  model: string
  /** 本次请求的用户文本预览（前 80 字，不存全文） */
  preview: string
  /** 活动状态：started=正在推理；done=完成；error=失败 */
  status: 'started' | 'done' | 'error'
  ttft?: number
  totalMs?: number
  error?: string
}

export const LA_MAX = 30
export const LA_FILE = 'local-api-activity.json'

function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

/** User-Agent 归一化：SDK / Python / curl / 编辑器插件的 UA 各不相同 */
export function normalizeSource(ua: unknown, fromLoopback: boolean): string {
  const raw = String(ua || '').trim()
  const origin = fromLoopback ? '本机' : '局域网设备'
  if (!raw) return origin
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9 _.-]+)/)
  const name = (m ? m[1] : raw.replace(/\s+/g, ' ')).slice(0, 40)
  return `${origin} · ${name}`
}

/** 前 80 字摘要（压空白） */
export function previewOf(text: unknown): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** 新活动（status=started 时）插入到最前；状态更新（done/error）按 id 合并 */
export function appendActivity(list: LocalApiActivity[] | null | undefined, entry: Partial<LocalApiActivity>): LocalApiActivity[] {
  const arr = Array.isArray(list) ? list.slice() : []
  const id = String(entry.id || '')
  if (id) {
    const idx = arr.findIndex(x => x.id === id)
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...entry, id }
      return arr.slice(0, LA_MAX)
    }
  }
  arr.unshift({
    id: id || uid(),
    ts: entry.ts || Date.now(),
    source: entry.source || '本机',
    origin: entry.origin || 'local',
    method: entry.method || 'POST',
    path: entry.path || '/v1/chat/completions',
    model: entry.model || '',
    preview: entry.preview || '',
    status: entry.status || 'started',
    ttft: entry.ttft,
    totalMs: entry.totalMs,
    error: entry.error,
  })
  return arr.slice(0, LA_MAX)
}

/** 容错清洗（文件损坏/旧版本时当空）——永不抛 */
export function sanitizeActivity(raw: unknown): LocalApiActivity[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(x => x && typeof x === 'object' && typeof (x as { ts?: unknown }).ts === 'number')
    .map(x => {
      const r = x as Record<string, unknown>
      const status = ['started', 'done', 'error'].includes(String(r.status))
        ? (String(r.status) as LocalApiActivity['status']) : 'done'
      return {
        id: String(r.id || ''),
        ts: Number(r.ts),
        source: String(r.source || '本机'),
        origin: String(r.origin || 'local'),
        method: String(r.method || 'POST'),
        path: String(r.path || ''),
        model: String(r.model || ''),
        preview: String(r.preview || ''),
        status,
        ttft: typeof r.ttft === 'number' ? r.ttft : undefined,
        totalMs: typeof r.totalMs === 'number' ? r.totalMs : undefined,
        error: String(r.error || ''),
      } as LocalApiActivity
    })
    .slice(0, LA_MAX)
}

/** 相对时间 */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 5) return '刚刚'
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}
