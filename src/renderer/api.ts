/**
 * 渲染层 API 层（v12.1）—— 所有后端调用的唯一入口。
 *
 * 之前全项目 174 处裸 fetch，各自处理超时与错误：有的完全没超时（请求挂死），
 * 有的把 500 当成功解析，有的把网络错误吞成"未知"。
 *
 * 这一层在 shared/apiClient 之上加三件事：
 *   1. 同源请求自动带 Origin 门卫需要的头（本应用服务端要求同源）
 *   2. 统一错误提示：失败时给出人话（errors.ts），并把错误对象原样抛给调用方
 *   3. 常用端点封装（settings/health/tools/sessions），避免各处手写 URL
 *
 * 刻意不做：不缓存、不做全局 loading 状态——这些属于调用方。
 */
import { apiFetch, apiJson, fetchCompat as rawFetchCompat, ApiError, type ApiRequestOptions } from '../shared/apiClient'
import { describeError } from '../shared/errors'

/** 统一请求头：同源门卫 + JSON */
function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) }
  // 服务端只接受同源/可信来源；Electron 内是同源，这里补上以防某些环境丢头
  if (typeof location !== 'undefined' && location.origin && !h['Origin']) {
    h['Origin'] = location.origin
  }
  return h
}

/** 发请求（自动带 Origin + 默认 30s 超时 + 幂等重试） */
export function request(path: string, opts: ApiRequestOptions = {}): Promise<Response> {
  return apiFetch(path, {
    ...opts,
    headers: baseHeaders(opts.headers),
  })
}

/** 请求并解析 JSON（失败抛 ApiError，不会返回 undefined） */
export function requestJson<T = unknown>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  return apiJson<T>(path, {
    ...opts,
    headers: baseHeaders(opts.headers),
  })
}

/** POST JSON 的简写 */
export function post<T = unknown>(path: string, body: unknown, opts: ApiRequestOptions = {}): Promise<T> {
  return requestJson<T>(path, { ...opts, method: 'POST', body })
}

/** PUT JSON */
export function put<T = unknown>(path: string, body: unknown, opts: ApiRequestOptions = {}): Promise<T> {
  return requestJson<T>(path, { ...opts, method: 'PUT', body })
}

/** DELETE */
export function del<T = unknown>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  return requestJson<T>(path, { ...opts, method: 'DELETE' })
}

/**
 * 安全调用：失败时不抛，返回 { ok, data, error, info }。
 * 适合"失败了也不该中断流程"的场景（如后台刷新、可选功能）。
 */
export async function tryRequest<T = unknown>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string; kind: string; retryable: boolean }> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    const info = describeError(e)
    return { ok: false, error: `${info.message}${info.hint ? ' — ' + info.hint : ''}`, kind: info.kind, retryable: info.retryable }
  }
}

/* ─── 常用端点 ─────────────────────────────────────────────
 * 只封装真正被多处调用的端点；一次性调用直接写 requestJson 更清楚。
 */

export interface HealthInfo {
  status: string
  agent?: string
  version?: string
  tools?: number
  platform?: string
  workDir?: string | null
}

export const api = {
  health: () => requestJson<HealthInfo>('/api/health', { timeoutMs: 5000 }),
  settings: () => requestJson<Record<string, unknown>>('/api/settings'),
  saveSettings: (s: Record<string, unknown>) => post<{ ok?: boolean }>('/api/settings', s),

  tools: () => requestJson<{ tools: { name: string }[] }>('/api/tools'),
  execTool: (name: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }) =>
    post<{ success: boolean; output?: string; error?: string }>('/api/tools/execute', { name, args }, opts),

  notices: () => requestJson<unknown[]>('/api/notices'),
  announcement: (fresh = false) => requestJson<{ ok: boolean; announcement: unknown | null }>(
    `/api/announcement${fresh ? '?fresh=1' : ''}`,
  ),

  sessions: () => requestJson<unknown[]>('/api/sessions'),
  messages: (sid: string) => requestJson<unknown[]>(`/api/sessions/${encodeURIComponent(sid)}/messages`),
}

export { ApiError }
export type { ApiRequestOptions }

/**
 * fetch 兼容层：返回 Response、不因状态码抛错，只补超时与同源 Origin 头。
 * 见 shared/apiClient 里 fetchCompat 的说明（为什么不是直接换 apiFetch）。
 */
export const fetchCompat = rawFetchCompat
