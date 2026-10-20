/**
 * 待发队列自动重试（v12）
 *
 * 职责：网络恢复后把排队的消息逐条重发。
 * 触发条件：浏览器 online 事件、窗口重新获得焦点、定时兜底（30s）。
 *
 * 关键约束：
 *   - 一次只发一条，保证对话顺序（并发发会让回答错位）
 *   - 连续失败到阈值就暂停，避免离线状态下反复打日志
 *   - 重发走调用方注入的 send 函数，保持与正常发送完全同一条链路
 */
import { useEffect, useRef } from 'react'
import { backoffItem, dequeue, pruneQueue, readyItems, shouldPauseRetry, type QueuedMessage } from '../../shared/sendQueue'
import { loadQueue, saveQueue } from '../store/sendQueue'

export type QueueSender = (item: QueuedMessage) => Promise<void>

const TICK_MS = 30_000

export function useSendQueue(onSendQueued: QueueSender) {
  // 用 ref 持有最新回调，避免因依赖变化反复重装定时器
  const senderRef = useRef(onSendQueued)
  senderRef.current = onSendQueued
  const busyRef = useRef(false)

  useEffect(() => {
    let dead = false

    const drain = async () => {
      if (busyRef.current || dead) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      busyRef.current = true
      try {
        let queue = pruneQueue(loadQueue())
        if (!queue.length) return
        if (shouldPauseRetry(queue)) return  // 连败太多：等用户手动重试或网络真正恢复
        const ready = readyItems(queue, Date.now())
        for (const item of ready) {
          if (dead) break
          try {
            await senderRef.current(item)
            queue = dequeue(loadQueue(), item.id)
            saveQueue(queue)
          } catch (e) {
            // 失败：退避，然后停止本轮（后面的消息依赖前一条的上下文）
            const cur = loadQueue()
            const next = cur.map((q) => (q.id === item.id ? backoffItem(q, String(e), Date.now()) : q))
            saveQueue(next)
            break
          }
        }
      } finally {
        busyRef.current = false
      }
    }

    const onOnline = () => { drain() }
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onOnline)
    const iv = setInterval(drain, TICK_MS)
    // 启动时先跑一次（可能上次退出前就有残留）
    const t = setTimeout(drain, 3000)

    return () => {
      dead = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onOnline)
      clearInterval(iv)
      clearTimeout(t)
    }
  }, [])
}
