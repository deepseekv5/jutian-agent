/**
 * 统一 HTTP 客户端（v12 底层重构）
 *
 * 为什么要有这一层：全项目 170 处直接 fetch，每处各自处理超时、
 * 错误文案、重试——结果三种情况都有：有的完全没超时（请求挂死）、
 * 有的把 500 当成成功解析、有的把网络错误吞成"未知错误"。
 *
 * 这一层只做四件事，不引入任何依赖：
 *   1. 超时（默认 30s，AbortSignal 组合调用方自己的 signal）
 *   2. 错误归一（网络/超时/HTTP 状态/JSON 解析失败 → ApiError）
 *   3. 幂等请求的自动重试（仅 GET/HEAD 与显式声明幂等的调用，指数退避）
 *   4. 可选 JSON 解析（非 2xx 不解析成"成功"）
 *
 * 刻意不做：不封装业务端点、不缓存、不注入鉴权——这些属于调用方。
 */

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'parse' | 'abort'

export class ApiError extends Error {
  kind: ApiErrorKind
  status?: number
  /** 服务端返回的原始错误文本（截断），便于排查 */
  detail?: string
  /** 是否值得重试（网络抖动类为 true，4xx 为 false） */
  retryable: boolean

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; detail?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = opts.status
    this.detail = opts.detail
    this.retryable = opts.retryable ?? (kind === 'network' || kind === 'timeout' || (opts.status ?? 0) >= 500)
  }
}

export interface ApiRequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  /** 毫秒；<=0 表示不超时（慎用） */
  timeoutMs?: number
  signal?: AbortSignal
  /** 覆盖默认重试次数（0 关闭）；GET/HEAD 默认 2，其他默认 0 */
  retries?: number
  /** 非 2xx 时的兜底错误文案前缀 */
  label?: string
}

const DEFAULT_TIMEOUT = 30_000

/** 指数退避 + 抖动：避免重试风暴同时打在同一个上游 */
export function backoffDelay(attempt: number, baseMs = 400, maxMs = 8000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)))
  // 抖动 50%~100%：既能错开，又不会无限逼近 0 导致秒重试
  return Math.round(exp * (0.5 + Math.random() * 0.5))
}

export function isIdempotentMethod(method: string): boolean {
  const m = method.toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError('abort', '请求已取消'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => { clearTimeout(t); reject(new ApiError('abort', '请求已取消')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 把 fetch 的各类失败翻译成可诊断的 kind */
function classifyThrow(e: unknown, timedOut: boolean, callerSignal?: AbortSignal): ApiError {
  if (e instanceof ApiError) return e
  const name = (e as { name?: string })?.name || ''
  if (callerSignal?.aborted) return new ApiError('abort', '请求已取消')
  if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
    return new ApiError('timeout', '请求超时（服务端无响应）')
  }
  const msg = String((e as { message?: string })?.message || e || '')
  if (/Failed to fetch|NetworkError|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)) {
    return new ApiError('network', '网络不可达（请检查网络或代理设置）', { detail: msg })
  }
  return new ApiError('network', msg || '网络请求失败', { detail: msg })
}

/** 读一小段响应体用于报错，避免把整页 HTML 塞进错误信息 */
async function readErrorDetail(r: Response): Promise<string> {
  try {
    const t = await r.text()
    return t.slice(0, 500)
  } catch {
    return ''
  }
}

/**
 * 发一次请求（不含重试）。返回 Response，调用方决定怎么读。
 * 非 2xx 一律抛 ApiError，不会静默返回"看起来成功"的响应。
 */
export async function fetchOnce(url: string, opts: ApiRequestOptions = {}): Promise<Response> {
  const method = (opts.method || 'GET').toUpperCase()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT

  // 组合调用方 signal 与超时 signal：
  // AbortSignal.any 在部分 Electron 版本没有，手写一次
  const ctl = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeoutMs)
  }
  const onCallerAbort = () => ctl.abort()
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true })

  const headers: Record<string, string> = { ...(opts.headers || {}) }
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string' || opts.body instanceof FormData || opts.body instanceof Blob) {
      body = opts.body as BodyInit
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
      body = JSON.stringify(opts.body)
    }
  }

  try {
    const r = await fetch(url, { method, headers, body, signal: ctl.signal })
    if (!r.ok) {
      const detail = await readErrorDetail(r)
      throw new ApiError('http', `${opts.label ? opts.label + '：' : ''}HTTP ${r.status}${detail ? '：' + detail.slice(0, 160) : ''}`, {
        status: r.status,
        detail,
      })
    }
    return r
  } catch (e) {
    throw classifyThrow(e, timedOut, opts.signal)
  } finally {
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/** 带重试的请求：只对幂等方法或 retries 显式 >0 的调用重试 */
export async function apiFetch(url: string, opts: ApiRequestOptions = {}): Promise<Response> {
  const method = (opts.method || 'GET').toUpperCase()
  const maxRetries = opts.retries ?? (isIdempotentMethod(method) ? 2 : 0)
  let last: ApiError | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchOnce(url, opts)
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('network', String(e))
      last = err
      if (err.kind === 'abort') throw err
      if (!err.retryable || attempt === maxRetries) throw err
      await sleep(backoffDelay(attempt), opts.signal)
    }
  }
  throw last || new ApiError('network', '请求失败')
}

/** 请求并解析 JSON；解析失败抛 parse 而不是返回 undefined */
export async function apiJson<T = unknown>(url: string, opts: ApiRequestOptions = {}): Promise<T> {
  const r = await apiFetch(url, opts)
  try {
    return (await r.json()) as T
  } catch (e) {
    throw new ApiError('parse', '响应不是合法 JSON（服务可能返回了错误页）', { detail: String((e as Error)?.message || e) })
  }
}

/**
 * 与 fetch 签名兼容的版本（v12.1）。
 *
 * 存在的理由：现有 170+ 处调用点里有 59 处自己判断 `res.ok`、43 处链式
 * `.then(r => r.json())`——直接换成"非 2xx 就抛错"的 apiFetch 会静默改变
 * 这些控制流（原本走 else 分支的现在直接抛异常，页面可能空白）。
 *
 * 所以这个版本保持"返回 Response、不因状态码抛错"的语义，只补两件事：
 *   1. 默认超时（原来的裸 fetch 完全没有超时，服务端不响应就永久挂起）
 *   2. 同源 Origin 头（服务端门卫要求）
 * 网络层错误（断网/超时）仍然抛 ApiError——这类原本也会抛 TypeError，
 * 换成带分类的错误只会让上层提示更准确。
 */
export async function fetchCompat(input: string, init: RequestInit = {}, opts: { timeoutMs?: number } = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  // RequestInit.headers 可能是 Headers 实例、数组或对象，统一摊平成对象
  const h = init.headers
  if (h) {
    if (typeof (h as Headers).forEach === 'function' && !Array.isArray(h)) {
      ;(h as Headers).forEach((v, k) => { headers[k] = v })
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) headers[k] = v
    } else {
      Object.assign(headers, h as Record<string, string>)
    }
  }
  if (typeof location !== 'undefined' && location.origin && !headers['Origin'] && !headers['origin']) {
    headers['Origin'] = location.origin
  }
  return fetchOnce(input, {
    method: init.method,
    body: init.body as BodyInit | undefined,
    headers,
    signal: init.signal || undefined,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    retries: 0,  // 与原生 fetch 一致：不自动重试（重试由调用方决定）
  })
}
