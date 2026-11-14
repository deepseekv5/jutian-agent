/**
 * 权限审批闸门（v14.4）
 *
 * useChat 的 beforeTool 是纯回调，弹窗必须由 React 树里的组件渲染。
 * 这里做一个极小的「请求 → Promise」桥：组件挂载时注册 handler，
 * 工具循环 await 用户决定。没有 UI 时一律按拒绝处理（fail-closed）。
 */
import type { PermissionRequest } from '../../shared/permission'

export type PermissionDecision = 'allow' | 'allow-session' | 'deny'

type Handler = (req: PermissionRequest) => Promise<PermissionDecision>

let handler: Handler | null = null

/** 本会话已放行的操作（scopeKey）。放在闸门里，两个内核共用同一份。 */
const approved = new Set<string>()
export function isSessionApproved(key: string): boolean { return approved.has(key) }
export function approveForSession(key: string): void { approved.add(key) }
export function clearSessionApprovals(): void { approved.clear() }

export function setPermissionHandler(h: Handler | null) {
  handler = h
}

export async function askPermission(req: PermissionRequest): Promise<PermissionDecision> {
  if (!handler) return 'deny'
  try {
    return await handler(req)
  } catch {
    return 'deny'
  }
}
