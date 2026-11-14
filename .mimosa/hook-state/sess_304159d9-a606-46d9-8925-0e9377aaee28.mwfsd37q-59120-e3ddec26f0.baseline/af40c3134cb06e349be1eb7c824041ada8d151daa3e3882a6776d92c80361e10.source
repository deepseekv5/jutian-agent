/**
 * 用户扩展层（UXL）渲染层注册表 —— v14.11
 *
 * 启动时拉 /api/extensions/active，把「已批准 + 启用」的扩展注册成动态页面。
 * 与官方不冲突：扩展文件在 ~/.lyclaw/extensions/，asar 更新不动它；
 * manifest 的 apiVersion 与宿主不符时服务端已自动排除，绝不白屏。
 */

import type { ExtManifest } from '../../shared/extensions'

export interface RegisteredExt {
  id: string
  name: string
  icon: string
  description?: string
  entry: string
  capabilities: string[]
  slot: string
}

/** 动态页面 type 统一前缀，App.renderTabBody 据此分发到 ExtPanel */
export const EXT_TYPE_PREFIX = 'ext:'
export const extType = (id: string) => EXT_TYPE_PREFIX + id
export const extIdFromType = (type: string) => (type.startsWith(EXT_TYPE_PREFIX) ? type.slice(EXT_TYPE_PREFIX.length) : '')

let registry: RegisteredExt[] = []
const listeners = new Set<() => void>()
/** 同步缓存副本：buildChatSystemPrompt 是同步纯函数，从这里读已注册扩展清单 */
let syncCache: RegisteredExt[] = []

export function getRegisteredExts(): RegisteredExt[] {
  return registry.slice()
}

/** 给系统提示词用的同步快照（不触发网络） */
export function getExtPromptSnapshot(): RegisteredExt[] {
  return syncCache.slice()
}

export function getRegisteredExt(id: string): RegisteredExt | undefined {
  return registry.find(x => x.id === id)
}

function emit() { listeners.forEach(l => l()) }
export function subscribeExts(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 拉取并替换注册表；失败时保留旧注册表（离线不白屏） */
export async function refreshExts(): Promise<RegisteredExt[]> {
  try {
    const r = await fetch('/api/extensions/active', { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return registry
    const d = await r.json()
    const items = Array.isArray(d?.items) ? d.items : []
    const next = items.map((x: any) => ({
      id: String(x.id), name: String(x.name || x.id), icon: String(x.icon || '🧩'),
      description: String(x.description || ''), entry: String(x.entry || 'panel.html'),
      capabilities: Array.isArray(x.capabilities) ? x.capabilities.map(String) : [],
      slot: String(x.slot || 'tab'),
    }))
    registry = next
    // 无变化不 emit（v14.13.1 CPU 修复）：sync 自身订阅了本事件源，
    // 成功即 emit 会形成 sync→fetch→emit→sync 的 550 req/s 自激循环（主进程 130% CPU 的元凶）。
    // 只有注册表真正变化时才广播。
    const changed = JSON.stringify(syncCache) !== JSON.stringify(registry)
    syncCache = registry.slice()
    if (changed) emit()
  } catch { /* 离线/服务未就绪：保留旧注册表 */ }
  return registry
}

/** 管理动作：返回是否成功；成功后自动刷新注册表 */
export async function manageExt(id: string, action: 'approve' | 'enable' | 'disable' | 'delete'): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/api/extensions/manage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }), signal: AbortSignal.timeout(8000),
    })
    const d = await r.json().catch(() => ({} as any))
    if (!r.ok || d?.ok === false) return { ok: false, error: String(d?.error || 'HTTP ' + r.status) }
    await refreshExts()
    return { ok: true }
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) } }
}

/** 扩展面板内可调用的只读能力（宿主侧白名单映射） */
export const EXT_CAPABILITY_ENDPOINTS: Record<string, string> = {
  settings: '/api/settings',
  sessions: '/api/sessions',
  notices: '/api/notices',
  workspace: '/api/workspace',
}

export type { ExtManifest }
