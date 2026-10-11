/**
 * 上游 HTTP 错误的用户可读映射
 *
 * 抽成纯函数以便测试与复用。原则：不只报数字，要给出「接下来该做什么」——
 * 用户看到 "请求失败 (402)" 不知道是自己欠费还是模型写错了。
 */

/** 状态码 → 中文提示；未知状态码返回空串，由调用方回落到通用文案 */
export function friendlyHttpError(status: number): string {
  if (status === 429) return '⚠️ 请求过于频繁或额度/限流，稍后重试或换一个模型'
  if (status === 402) return '💳 余额或配额不足，请在服务商处充值或改用免费模型'
  if (status === 401) return '🔑 API 密钥无效或已过期，请到设置中检查'
  if (status === 403) return '🚫 无权访问该模型（可能未开通或地区受限）'
  if (status === 404) return '🔍 模型或地址不存在，请核对设置里的模型名与接口地址'
  if (status === 400) return '请求格式错误'
  if (status === 413) return '📦 请求体过大，请减少附件或缩短上下文'
  if (status >= 500) return '🛠 上游服务暂时故障，请稍后重试或换一个模型'
  return ''
}

/**
 * 从上游错误响应体里提取可读细节。
 * 兼容 {error}/{hint}/{detail} 三种字段名，非 JSON 时截断原文。
 */
export function extractErrorDetail(errText: string): string {
  if (!errText) return ''
  try {
    const j = JSON.parse(errText)
    // JSON.parse('null'/'[]'/数字) 都是合法 JSON 但不是对象，取字段会抛错
    if (!j || typeof j !== 'object') return ''
    const rec = j as Record<string, unknown>
    const v = rec.error ?? rec.hint ?? rec.detail ?? ''
    if (typeof v === 'string') return v
    // 有些上游把 error 写成对象
    if (v && typeof v === 'object' && typeof (v as { message?: unknown }).message === 'string') {
      return (v as { message: string }).message
    }
    return ''
  } catch {
    return errText.slice(0, 200)
  }
}

/** 组装最终展示给用户的错误文案 */
export function buildHttpErrorMessage(status: number, errText: string): string {
  const head = friendlyHttpError(status) || `请求失败 (${status})`
  const detail = extractErrorDetail(errText)
  return detail ? `${head}：${detail}` : head
}
