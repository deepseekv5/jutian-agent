/**
 * notify.ts — 通知中心存储（v5.6）
 * 聚合：集群任务完成 / 子代理批次完成 / Computer Use 结束 / 定时任务。
 * localStorage 持久化（上限 50 条）+ window 'app-notice' 事件驱动徽标。
 * 系统通知：文档隐藏且已授权时弹出（复用 notifyDone 的权限）。
 */
import { useEffect, useState } from 'react'

export interface AppNotice {
  id: string
  type: 'swarm' | 'subagent' | 'system'
  title: string
  body?: string
  ts: number
  read?: boolean
}

const KEY = 'jutian-notices'
const EVT = 'app-notice'

function load(): AppNotice[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, 50) : []
  } catch { return [] }
}

function save(list: AppNotice[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))) } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch { /* ignore */ }
}

function maybeSystemNotice(n: AppNotice) {
  try {
    if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(n.title, { body: n.body || '', silent: false })
  } catch { /* ignore */ }
}

let seq = 0
export function pushNotice(n: { type: AppNotice['type']; title: string; body?: string }): void {
  const list = load()
  list.unshift({ ...n, id: Date.now().toString(36) + (seq++), ts: Date.now(), read: false })
  save(list)
  const first = list[0]
  maybeSystemNotice(first)
}

export function getNotices(): AppNotice[] { return load() }
export function markAllRead(): void { save(load().map(n => ({ ...n, read: true }))) }
export function clearNotices(): void { save([]) }
export function unreadCount(): number { return load().filter(n => !n.read).length }

/** 服务端通知桥（v7.0）：拉取定时任务/远程接入等 server 通知并合并进本地 */
export async function mergeServerNotices(): Promise<void> {
  try {
    const r = await fetch('/api/notices')
    if (!r.ok) return
    const server: AppNotice[] = await r.json()
    if (!Array.isArray(server) || !server.length) return
    const local = load()
    const ids = new Set(local.map(n => n.id))
    const fresh = server.filter(n => n && n.id && !ids.has(n.id))
    if (!fresh.length) return
    save([...fresh, ...local].slice(0, 50))
  } catch { /* 离线时忽略 */ }
}

/** 铃铛徽标订阅（只重渲染订阅者）；轮询合并服务端通知（定时任务/手机接入） */
export function useNoticeBadge(): number {
  const [n, setN] = useState(unreadCount())
  useEffect(() => {
    const h = () => setN(unreadCount())
    window.addEventListener(EVT, h)
    window.addEventListener('storage', h)
    const iv = setInterval(() => { mergeServerNotices().then(() => setN(unreadCount())) }, 60000)
    return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h); clearInterval(iv) }
  }, [])
  return n
}
