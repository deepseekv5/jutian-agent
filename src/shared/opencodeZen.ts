// OpenCode Zen 免费车道。
//
// 这是唯一一条"看得见但不改姿势就用不了"的免 key 车道，踩坑记录：
//
//  1) 它用 `Authorization: Bearer public`，但**密钥不是关键**——`public`
//     人人可用。真正的门槛是客户端指纹：必须带 x-opencode-client /
//     x-opencode-session / x-opencode-request / x-opencode-project，
//     且 session/request id 必须是 OpenCode 那种特定形状（12 位 hex 时间戳
//     前缀 + 14 位 base62 尾巴）。形状不对直接 403 FreeTierError。
//
//  2) **必须 stream: true。** 这是最坑的一条：同一个模型、同样的头，
//     只要 stream:false 就 403 FreeTierError，报的却是"只能在 OpenCode 里用"，
//     极易误判成地区封锁或凭据问题（实测对着它排查了很久）。
//
//  3) 部分模型走 /responses（muse-spark 系列）而非 /chat/completions。
//
//  4) 有些 id 在 /models 清单里标着 -free，但实际不路由：
//     cat-jam-free 返回 "Endpoint is unavailable"；muse-spark 系列在
//     中国大陆出口返回 RegionError。这类要在界面上标出来，不能假装可用。
//
// 实测可用（2026-10，中国大陆出口，无需代理）：big-pickle、
// mimo-v2.6-flash-free、nemotron-3.5-lightning-free、step-5-preview-free、
// longcat-2.5-preview-free、space-bunny-free。

import { randomBytes } from 'node:crypto'

export const ZEN_BASE = 'https://opencode.ai/zen/v1'
export const ZEN_KEY = 'public'

/** 实测可用的免费模型（离线兜底；在线时以实时拉取为准） */
export const ZEN_FREE_MODELS: { id: string; name: string; context: number; note?: string }[] = [
  { id: 'big-pickle', name: 'Big Pickle', context: 200000, note: '综合能力最强的一档' },
  { id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash', context: 262144 },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning', context: 131072 },
  { id: 'step-5-preview-free', name: 'Step 5 Preview', context: 131072 },
  { id: 'longcat-2.5-preview-free', name: 'LongCat 2.5 Preview', context: 131072 },
  { id: 'space-bunny-free', name: 'Space Bunny', context: 131072 },
]

/** 已知不路由的 id → 原因（用于给实时清单打状态标记） */
export const ZEN_KNOWN_DEAD: Record<string, string> = {
  'cat-jam-free': '上游暂不路由该模型',
  'muse-spark-1.2-contributor-free': '中国大陆出口被地区限制',
  'muse-spark-1.3-contributor-free': '中国大陆出口被地区限制',
  'jev-1.13-free': '实测未通过（上游拒绝）',
}

/**
 * 从上游 /models 拉取清单。
 *
 * 面板要"显示所有模型"，所以这里返回**全部** -free 条目（含已知不可用的），
 * 由上层标注状态，而不是替用户过滤掉——用户有权看到上游声明了什么、
 * 哪些在这个网络下用不了。付费档不列（本车道只免费用）。
 */
export async function fetchZenModels(timeoutMs = 15000): Promise<{
  ok: boolean
  models: { id: string; name: string; free: boolean; dead?: string }[]
  error?: string
}> {
  try {
    const r = await fetch(`${ZEN_BASE}/models`, {
      headers: zenHeaders(mintSessionId(), mintRequestId(), false),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return { ok: false, models: [], error: `上游返回 ${r.status}` }
    const j = await r.json() as { data?: { id?: string }[] }
    const ids = (j.data || []).map(m => String(m.id || '')).filter(Boolean)
    const models = ids
      .filter(id => /-free$/.test(id) || id === 'big-pickle')
      .map(id => ({
        id,
        name: id.replace(/-free$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        free: true,
        dead: ZEN_KNOWN_DEAD[id],
      }))
    return { ok: true, models }
  } catch (e) {
    return { ok: false, models: [], error: String((e as Error)?.message || e) }
  }
}

/** 走 /responses 而非 /chat/completions 的模型 */
const RESPONSES_MODELS = /^muse-spark/

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

let lastStamp = 0
let seq = 0

function base62(n: number): string {
  const b = randomBytes(n)
  let out = ''
  for (const x of b) out += B62[x % 62]
  return out
}

/**
 * 生成 OpenCode 形状的 session id。
 * 12 位 hex 是「毫秒时间戳 << 12 + 自增序号」取反后的低 48 位——
 * 上游会校验这个形状（低 12 位计数器要小），随便造的哈希会被拒。
 */
export function mintSessionId(ts = Date.now()): string {
  if (ts !== lastStamp) { lastStamp = ts; seq = 0 }
  seq += 1
  const v = ~(BigInt(ts) * 0x1000n + BigInt(seq)) & 0xffffffffffffn
  return `ses_${v.toString(16).padStart(12, '0')}${base62(14)}`
}

/** 同形状的 request id */
export function mintRequestId(ts = Date.now()): string {
  const v = (BigInt(ts) * 0x1000n) & 0xffffffffffffn
  return `msg_${v.toString(16).padStart(12, '0')}${base62(14)}`
}

export const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
export const REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/

/** 是否本车道（按 base url 判定，供 llm-proxy 分流） */
export function isZenBase(base: string): boolean {
  return /^https?:\/\/opencode\.ai\/zen\/v1\/?$/.test(String(base || '').trim())
}

/** 该模型该走哪个端点 */
export function zenEndpoint(model: string): string {
  return RESPONSES_MODELS.test(String(model || '')) ? '/responses' : '/chat/completions'
}

/**
 * 构造上游请求头。注意 x-opencode-client 用 'cli'：
 * 两个参考实现分别用 'cli'（magpie 插件）和 'desktop'（dsh-fm），
 * 实测两者都能过指纹，这里取 magpie 的写法（与官方 CLI 一致）。
 */
export function zenHeaders(session: string, requestId: string, stream: boolean): Record<string, string> {
  return {
    'content-type': 'application/json',
    'authorization': `Bearer ${ZEN_KEY}`,
    'user-agent': 'opencode/1.19.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14',
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-request': requestId,
    'x-opencode-session-id': session,
    'x-opencode-project': 'global',
    'accept': stream ? 'text/event-stream' : '*/*',
  }
}

/** 免费车道要求声明的四个小写工具；缺了会被指纹门拒 */
export const FINGERPRINT_TOOLS = ['bash', 'glob', 'grep', 'read']

/**
 * 补全指纹工具：上游要求这四个名字**以小写**声明。
 * 调用方已有的同名工具保留原样（真实能力优先），缺的槽位补一个
 * "永不可调用"的占位，不虚构能力。
 */
export function withFingerprintTools<T extends { type?: string; function?: { name?: string } }>(
  tools: T[],
  makePlaceholder: (name: string) => T,
): T[] {
  const present = new Set(
    tools.map(t => String(t?.function?.name || '').trim().toLowerCase()).filter(Boolean),
  )
  const out = [...tools]
  for (const name of FINGERPRINT_TOOLS) {
    if (!present.has(name)) out.push(makePlaceholder(name))
  }
  return out
}

/**
 * 把请求体改造成本车道能接受的样子。
 * 关键：**强制 stream**。非流式一律 403，且报错文案是误导性的
 * FreeTierError（看起来像凭据/地区问题，其实是姿势问题）。
 */
export function zenBody(model: string, body: Record<string, unknown>): Record<string, unknown> {
  const isResp = RESPONSES_MODELS.test(String(model || ''))
  const out: Record<string, unknown> = { ...body, model, stream: true }
  if (!isResp) out.stream_options = { ...(body.stream_options as object || {}), include_usage: true }
  return out
}

/** 错误分类：把上游的两种 403 分开，便于界面给准确提示 */
export function classifyZenError(status: number, text: string): { kind: 'region' | 'unavailable' | 'auth' | 'other'; message: string } {
  const t = String(text || '')
  if (/RegionError|not available in your country/i.test(t)) {
    return { kind: 'region', message: '该模型在当前网络出口被地区限制' }
  }
  if (/Endpoint is unavailable/i.test(t)) {
    return { kind: 'unavailable', message: '该模型上游暂不路由' }
  }
  if (/FreeTierError|FreeUsageLimitError/i.test(t)) {
    return { kind: 'auth', message: '免费额度校验未通过（可能已超量或请求姿势不符）' }
  }
  return { kind: 'other', message: `上游返回 ${status}` }
}
