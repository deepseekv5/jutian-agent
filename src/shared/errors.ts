/**
 * 统一错误归类（v12）——把底层错误翻译成"用户能看懂且能行动"的一句话。
 *
 * 现状问题：185 处空 catch，错误要么消失、要么原文抛给用户
 * （"TypeError: Failed to fetch" / "HTTP 401"）。用户不知道下一步做什么。
 *
 * 这里把错误分成 8 类，每类给：一句人话 + 一个可执行建议 + 是否值得重试。
 * 纯函数，无依赖，可测试。
 */

export type ErrorKind =
  | 'network'      // 断网 / DNS / 代理
  | 'timeout'      // 超时
  | 'auth'         // 401/403 密钥问题
  | 'rate_limit'   // 429
  | 'quota'        // 余额/配额不足
  | 'context'      // 上下文过长
  | 'content'      // 内容审核拦截
  | 'not_found'    // 404 模型/端点不存在
  | 'server'       // 5xx
  | 'cancelled'    // 用户取消
  | 'unknown'

export interface ErrorInfo {
  kind: ErrorKind
  /** 一句话人话 */
  message: string
  /** 下一步建议（可为空） */
  hint: string
  retryable: boolean
}

const INFO: Record<ErrorKind, Omit<ErrorInfo, 'kind'>> = {
  network: { message: '网络连接失败', hint: '检查网络或代理设置；离线时消息会进入待发队列', retryable: true },
  timeout: { message: '请求超时', hint: '服务端响应过慢，可重试或换更快的模型', retryable: true },
  auth: { message: 'API 密钥无效或无权限', hint: '到设置检查密钥是否正确、是否已过期', retryable: false },
  rate_limit: { message: '请求过于频繁，被上游限流', hint: '稍后重试，或切换到其他模型/供应商', retryable: true },
  quota: { message: '额度不足', hint: '该供应商余额或配额已用尽，换供应商或充值', retryable: false },
  context: { message: '对话上下文超出模型上限', hint: '开启上下文压缩，或新建对话继续', retryable: false },
  content: { message: '内容被上游安全策略拦截', hint: '调整表述后重试', retryable: false },
  not_found: { message: '模型或接口不存在', hint: '到设置重新拉取模型列表', retryable: false },
  server: { message: '上游服务异常', hint: '这是服务方问题，稍后重试或切换模型', retryable: true },
  cancelled: { message: '已取消', hint: '', retryable: false },
  unknown: { message: '发生未知错误', hint: '可到设置 → 诊断查看详情', retryable: false },
}

/** 从任意错误对象/文本判定类别。顺序敏感：先判最具体的。 */
export function classifyError(input: unknown): ErrorKind {
  const text = extractText(input).toLowerCase()
  const status = extractStatus(input)

  if (status === 401 || status === 403 || /invalid.*(api.?key|token)|unauthorized|forbidden|密钥无效|鉴权失败/.test(text)) return 'auth'
  if (status === 429 || /rate.?limit|too many requests|限流|请求过于频繁/.test(text)) return 'rate_limit'
  if (status === 404 || /model.*not.*found|no such model|模型不存在|接口不存在/.test(text)) return 'not_found'
  if (/insufficient.*(quota|balance|credit)|exceeded.*quota|余额不足|额度不足|quota/.test(text)) return 'quota'
  if (/context.*(length|window|limit)|maximum context|too many tokens|上下文.{0,6}(超|上限)|token.{0,6}超/.test(text)) return 'context'
  if (/content.?filter|content.?policy|safety|审核|违规|blocked/.test(text)) return 'content'
  if (status !== undefined && status >= 500) return 'server'
  if (/timeout|timed out|超时|etimedout/.test(text)) return 'timeout'
  if (/abort|cancel|取消|已中止/.test(text)) return 'cancelled'
  if (/failed to fetch|networkerror|econnrefused|enotfound|eai_again|fetch failed|网络|离线/.test(text)) return 'network'
  return 'unknown'
}

function extractStatus(input: unknown): number | undefined {
  const o = input as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  const candidates = [o?.status, o?.statusCode, o?.response?.status]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n >= 100 && n < 600) return n
  }
  const m = extractText(input).match(/\b(4\d\d|5\d\d)\b/)
  if (m) return Number(m[1])
  return undefined
}

function extractText(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  const o = input as { message?: unknown; error?: unknown; detail?: unknown; body?: unknown }
  const parts = [o?.message, o?.error, o?.detail, o?.body]
  return parts.filter((p) => typeof p === 'string').join(' ') || String(input)
}

/** 归类 + 附上原始细节（截断），用于提示与诊断 */
export function describeError(input: unknown, opts: { keepDetail?: boolean } = {}): ErrorInfo {
  const kind = classifyError(input)
  const base = INFO[kind]
  if (!opts.keepDetail) return { kind, ...base }
  const raw = extractText(input).slice(0, 300)
  return { kind, ...base, hint: raw ? `${base.hint}${base.hint ? '｜' : ''}详情：${raw}` : base.hint }
}

/** 单行展示：用于 toast / 行内错误条 */
export function errorLine(input: unknown): string {
  const d = describeError(input)
  return d.hint ? `${d.message} — ${d.hint}` : d.message
}

/** 是否适合自动重试（配合 shared/apiClient 的 backoff） */
export function shouldRetry(input: unknown): boolean {
  return describeError(input).retryable
}
