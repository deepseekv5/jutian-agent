/**
 * 待发队列存储（v12）
 *
 * 断网时应把消息排队而不是丢弃。存储用 safeStorage（真持久化失败降级内存）。
 */
import { readJson, writeJson } from '../utils/safeStorage'
import type { QueuedMessage } from '../../shared/sendQueue'

const KEY = 'send-queue'
export const QUEUE_EVENT = 'send-queue-updated'

export function loadQueue(): QueuedMessage[] {
  const list = readJson<QueuedMessage[]>(KEY, [], (v): v is QueuedMessage[] => Array.isArray(v))
  return Array.isArray(list) ? list.filter((q) => q && typeof q.id === 'string' && typeof q.content === 'string') : []
}

export function saveQueue(list: QueuedMessage[]): void {
  writeJson(KEY, list)
  try { window.dispatchEvent(new CustomEvent(QUEUE_EVENT)) } catch { /* ignore */ }
}
