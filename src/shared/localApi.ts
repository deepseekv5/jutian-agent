// 开放本地 API —— 把本机当成一个 OpenAI 兼容服务，供其它工具调用。
//
// 场景：用户已经有配好的模型与密钥，想让别的客户端（编辑器插件、脚本、
// 局域网里的另一台机器）也能用上，不必再配一遍密钥。
//
// 设计取向：**默认关闭**。开一个监听端口等于开一个入口，任何能访问该端口
// 的人都能消耗用户的模型额度。所以：
//  · 默认不启动，必须用户显式打开
//  · 默认只绑 127.0.0.1（本机），局域网要单独再开一层
//  · 需要一个 API Key（本机生成），没有 Key 的请求一律 401
//  · 局域网访问用独立 Key，与本地 Key 不通用——任一泄露只需轮换对应一侧

// 默认端口刻意避开常见占用：8326 被 DeepSeek Harness 等工具占用，
// 18899/18900 也常被本地工具占用。18080 冲突概率低得多。
export const LOCAL_API_DEFAULT_PORT = 18080

/** 端口被占用时依次尝试的备选（都失败才报错） */
export const LOCAL_API_PORT_FALLBACKS = [18080, 18081, 18082, 18083, 18084]

/** 监听范围：本机 / 局域网 */
export type LocalApiScope = 'local' | 'lan'

export interface LocalApiConfig {
  enabled: boolean
  port: number
  scope: LocalApiScope
  /** 本机访问 Key */
  key: string
  /** 局域网访问 Key（与 key 不同，任一泄露可单独轮换） */
  lanKey: string
}

/** 生成一个 API Key（32 位十六进制，带前缀便于识别） */
export function mintApiKey(randomHex: (n: number) => string): string {
  return 'ly-' + randomHex(32)
}

/**
 * 校验一个请求是否放行。
 * @param authHeader 请求的 Authorization 头（可能缺失）
 * @param fromLoopback 来源是否为回环地址
 */
export function authorizeLocalApi(
  authHeader: string | undefined,
  fromLoopback: boolean,
  cfg: LocalApiConfig,
): { ok: boolean; status?: number; error?: string } {
  if (!cfg.enabled) return { ok: false, status: 403, error: '本地 API 未开启' }

  // 从 `Bearer xxx` 里取 Key；也接受裸 Key（有些客户端不带头部格式）
  const raw = String(authHeader || '').trim()
  const token = /^Bearer\s+(.+)$/i.test(raw) ? raw.replace(/^Bearer\s+/i, '').trim() : raw
  if (!token) return { ok: false, status: 401, error: '缺少 API Key' }

  // 回环来源认本机 Key；非回环必须用局域网 Key（不能拿本机 Key 从外部用）
  const expected = fromLoopback ? cfg.key : cfg.lanKey
  if (!expected) return { ok: false, status: 401, error: '尚未生成 API Key' }
  if (token !== expected) return { ok: false, status: 401, error: 'API Key 无效' }

  // 局域网范围未开时，非回环一律拒绝
  if (!fromLoopback && cfg.scope !== 'lan') {
    return { ok: false, status: 403, error: '仅允许本机访问（如需局域网请在设置中开启）' }
  }

  return { ok: true }
}

/** 监听地址：本机范围只绑回环，局域网范围绑全部接口 */
export function bindAddress(scope: LocalApiScope): string {
  return scope === 'lan' ? '0.0.0.0' : '127.0.0.1'
}

/** 配置校验：端口范围与 Key 非空 */
export function validateConfig(cfg: Partial<LocalApiConfig>): { ok: boolean; error?: string } {
  if (cfg.port !== undefined) {
    const p = Number(cfg.port)
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      return { ok: false, error: '端口需在 1024-65535 之间（1024 以下需要管理员权限）' }
    }
  }
  if (cfg.enabled && cfg.scope === 'lan' && !cfg.lanKey) {
    return { ok: false, error: '开启局域网访问前需要先生成局域网 Key' }
  }
  return { ok: true }
}

/** 给界面展示的接入信息 */
export function endpointInfo(cfg: LocalApiConfig): { baseUrl: string; hint: string } {
  const host = cfg.scope === 'lan' ? '0.0.0.0' : '127.0.0.1'
  return {
    baseUrl: `http://${host}:${cfg.port}/v1`,
    hint: cfg.scope === 'lan'
      ? '局域网内其它设备用本机 IP 替换 0.0.0.0，并使用局域网 Key'
      : '仅本机可访问，使用本机 Key',
  }
}
