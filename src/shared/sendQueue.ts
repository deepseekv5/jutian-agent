/**
 * 任务队列（v12 新功能）：断网/限流时把消息排队，恢复后自动重发。
 *
 * 场景：用户在高铁上打了一段话点发送，网络断了。现在的行为是
 * 报错 + 消息丢失。改成：入队 → 顶部显示"待发 1 条" → 网络恢复自动发出。
 */

export interface QueuedMessage {
  id: string
  sessionId: string
  content: string
  /** 原始发送参数（模型、模式、附件等）尽量原样保留 */
  opts?: Record<string, unknown>
  createdAt: number
  /** 已尝试次数 */
  attempts: number
  lastError?: string
  /** 下次可尝试时间（指数退避） */
  nextAt: number
}

export const QUEUE_MAX = 50
export const QUEUE_MAX_AGE_MS = 24 * 3600 * 1000

export function enqueue(queue: QueuedMessage[], item: Omit<QueuedMessage, 'attempts' | 'nextAt'>): QueuedMessage[] {
  const next = [...queue, { ...item, attempts: 0, nextAt: 0 }]
  // 超限时丢最旧的，但保留最近 1 条（用户刚打的）
  return next.length > QUEUE_MAX ? next.slice(next.length - QUEUE_MAX) : next
}

export function dequeue(queue: QueuedMessage[], id: string): QueuedMessage[] {
  return queue.filter((q) => q.id !== id)
}

/** 取出当前可以尝试的项（按创建顺序，FIFO 保证对话顺序） */
export function readyItems(queue: QueuedMessage[], now = Date.now()): QueuedMessage[] {
  return queue.filter((q) => q.nextAt <= now).sort((a, b) => a.createdAt - b.createdAt)
}

/** 失败后重排：指数退避，超过上限则标记为"需要手动重试"（nextAt = Infinity） */
export function backoffItem(item: QueuedMessage, error: string, now = Date.now()): QueuedMessage {
  const attempts = item.attempts + 1
  const delay = Math.min(60_000, 2000 * Math.pow(2, Math.min(attempts - 1, 5)))
  return {
    ...item,
    attempts,
    lastError: String(error || '').slice(0, 200),
    nextAt: attempts >= 5 ? Number.MAX_SAFE_INTEGER : now + delay,
  }
}

/** 清理：过期项与已被手动放弃的项 */
export function pruneQueue(queue: QueuedMessage[], now = Date.now()): QueuedMessage[] {
  return queue.filter((q) => now - q.createdAt < QUEUE_MAX_AGE_MS)
}

export function queueSummary(queue: QueuedMessage[]): { pending: number; retrying: number; stuck: number } {
  let pending = 0, retrying = 0, stuck = 0
  for (const q of queue) {
    if (q.attempts === 0) pending++
    else if (q.nextAt === Number.MAX_SAFE_INTEGER) stuck++
    else retrying++
  }
  return { pending, retrying, stuck }
}

/**
 * 是否应该暂停自动重发：连续多条都失败时说明网络确实不通，
 * 继续重试只会刷日志与打上游。返回 true 表示暂停。
 */
export function shouldPauseRetry(queue: QueuedMessage[]): boolean {
  const recent = queue.filter((q) => q.attempts > 0)
  if (recent.length < 3) return false
  return recent.every((q) => q.attempts >= 3)
}
