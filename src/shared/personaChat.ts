/**
 * AI 角色聊天 —— 聊天服务层
 *
 * 职责：
 * - 组装系统提示（人设 + 边界 + 记忆 + 合规红线 + 未成年人模式）
 * - 免费模型优先：未配置模型服务时回落免 key 网关，零配置可用
 * - 安全拦截：危机情境 / 退出意图 在请求发出前判定，命中则不调模型直接给干预回复
 * - 流式输出 + 会话持久化（复制/删除由用户自行控制，第十六条）
 */
import { buildPersonaPrompt, type Persona, type PersonaMemory } from './personas'
import {
  detectCrisis, crisisReply, detectExitIntent, EXIT_REPLY,
  minorGuardPrompt, type PersonaIdentity,
} from './personaSafety'

export interface PersonaMsg {
  role: 'user' | 'assistant'
  content: string
  ts: number
  /** AI 回复的危机干预标记（前端显示醒目提示） */
  crisis?: boolean
}

/** 上游 OpenAI 兼容响应中我们关心的字段 */
interface UpstreamReply {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string } | string
}

/** 免费回落配置：与 设置 → 免费模型 面板同源，保证零配置可用 */
const FREE_FALLBACKS = [
  { base: 'https://api.kilo.ai/api/gateway/v1', key: 'free', model: 'openrouter/free', name: 'Kilo 免费档' },
  { base: 'https://text.pollinations.ai/openai', key: 'free', model: 'openai-fast', name: 'Pollinations GPT-OSS' },
]

export interface PersonaChatConfig {
  /** 用户在设置里配置的服务；为空则走免费回落 */
  apiBaseUrl?: string
  apiKey?: string
  model?: string
}

export interface SendResult {
  msgs: PersonaMsg[]
  /** 未能真实调用模型时的提示（如配置缺失） */
  notice?: string
}

function pickEndpoint(cfg: PersonaChatConfig) {
  if (cfg.apiBaseUrl && cfg.model) {
    return { base: cfg.apiBaseUrl, key: cfg.apiKey || 'free', model: cfg.model, name: '已配置模型' }
  }
  return FREE_FALLBACKS[0]
}

/** 构造请求消息体 */
export function buildRequestMessages(
  persona: Persona,
  memories: PersonaMemory[],
  history: PersonaMsg[],
  identity: PersonaIdentity,
): { system: string; msgs: { role: string; content: string }[] } {
  const extraParts = [minorGuardPrompt(identity.age)].filter(Boolean).join('\n')
  const system = buildPersonaPrompt(persona, memories, extraParts)
  const msgs = history.slice(-20).map((m) => ({ role: m.role, content: m.content }))
  return { system, msgs }
}

/**
 * 发送一轮对话 —— 流式，带安全拦截。
 * 危机情境与退出意图在本地判定，不消耗额度、不经过模型（更可控，也避免模型给出不当回复）。
 *
 * onDelta 逐字回调（打字机效果）；返回最终消息列表。
 * onTiming 回传「思考中 → 首字」耗时（毫秒），用于 UI 显示"想了 N 秒"。
 */
export async function sendPersonaTurn(
  persona: Persona,
  memories: PersonaMemory[],
  history: PersonaMsg[],
  userText: string,
  identity: PersonaIdentity,
  cfg: PersonaChatConfig,
  opts?: {
    signal?: AbortSignal
    onDelta?: (chunk: string) => void
    onTiming?: (ms: number) => void
  },
): Promise<SendResult> {
  const { signal, onDelta, onTiming } = opts || {}
  const userMsg: PersonaMsg = { role: 'user', content: userText, ts: Date.now() }
  const next: PersonaMsg[] = [...history, userMsg]

  // ── 安全拦截 1：极端情境（第十三条） ──
  const crisis = detectCrisis(userText)
  if (crisis) {
    const text = crisisReply(crisis)
    onDelta?.(text)
    const reply: PersonaMsg = { role: 'assistant', content: text, ts: Date.now(), crisis: true }
    return { msgs: [...next, reply] }
  }

  // ── 安全拦截 2：退出意图（第十九条，不得挽留） ──
  if (detectExitIntent(userText)) {
    onDelta?.(EXIT_REPLY)
    const reply: PersonaMsg = { role: 'assistant', content: EXIT_REPLY, ts: Date.now() }
    return { msgs: [...next, reply] }
  }

  // ── 正常调用模型（流式） ──
  const ep = pickEndpoint(cfg)
  const { system, msgs } = buildRequestMessages(persona, memories, next, identity)
  const notice = !cfg.apiBaseUrl ? `当前使用免费模型（${ep.name}）· 如需更快可在 设置 → 推理 中配置` : undefined
  const t0 = Date.now()
  let sawFirst = false

  try {
    const res = await fetch('/api/llm-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-Base': ep.base,
        'X-Api-Key': ep.key,
      },
      body: JSON.stringify({
        model: ep.model,
        messages: [{ role: 'system', content: system }, ...msgs],
        max_tokens: 1200,
        stream: true,
        temperature: 0.85,
      }),
      signal,
    })
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null) as UpstreamReply | null
      const err = data?.error
      const errMsg = (typeof err === 'object' && err ? err.message : typeof err === 'string' ? err : '')
        || `HTTP ${res.status}`
      const reply: PersonaMsg = {
        role: 'assistant',
        content: `（消息未送达：${errMsg}）\n\n可在 设置 → 免费模型 换一个免费模型，或在 设置 → 推理 中配置你自己的服务。`,
        ts: Date.now(),
      }
      return { msgs: [...next, reply], notice }
    }
    // SSE 解析：data: {json}\n\n，取 delta.content
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload) as UpstreamReply & { choices?: { delta?: { content?: string } }[] }
          const delta = j?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            if (!sawFirst) { sawFirst = true; onTiming?.(Date.now() - t0) }
            full += delta
            onDelta?.(delta)
          }
        } catch { /* 半行/心跳，跳过 */ }
      }
    }
    if (!full.trim()) {
      const reply: PersonaMsg = {
        role: 'assistant',
        content: '（模型未返回内容，请重试或换一个免费模型）',
        ts: Date.now(),
      }
      return { msgs: [...next, reply], notice }
    }
    const reply: PersonaMsg = { role: 'assistant', content: full, ts: Date.now() }
    return { msgs: [...next, reply], notice }
  } catch (e: unknown) {
    const reply: PersonaMsg = {
      role: 'assistant',
      content: `（网络错误：${e instanceof Error ? e.message : String(e)}）\n\n请检查网络，或在 设置 中配置可用的模型服务。`,
      ts: Date.now(),
    }
    return { msgs: [...next, reply], notice }
  }
}

// ─────────────────────────── 角色 CRUD ───────────────────────────

export async function fetchPersonas(): Promise<Persona[]> {
  try {
    const res = await fetch('/api/personas')
    const data = await res.json().catch(() => null) as { items?: Persona[] } | null
    return Array.isArray(data?.items) ? data.items : []
  } catch { return [] }
}

export async function savePersona(p: Partial<Persona>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    })
    const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
    return { ok: !!data?.success, error: data?.error }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deletePersona(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/personas/${encodeURIComponent(id)}/delete`, { method: 'POST' })
    return res.ok
  } catch { return false }
}

// ─────────────────────────── 会话持久化 ───────────────────────────

export async function loadSession(personaId: string): Promise<PersonaMsg[]> {
  try {
    const res = await fetch(`/api/persona-sessions/${encodeURIComponent(personaId)}`)
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    return Array.isArray(data?.items) ? data.items : []
  } catch { return [] }
}

export async function saveMessage(personaId: string, m: PersonaMsg): Promise<void> {
  try {
    await fetch(`/api/persona-sessions/${encodeURIComponent(personaId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: m.role, content: m.content }),
    })
  } catch { /* 本地持久化失败不阻断对话 */ void 0 }
}

export async function clearSession(personaId: string): Promise<void> {
  try { await fetch(`/api/persona-sessions/${encodeURIComponent(personaId)}`, { method: 'DELETE' }) } catch { /* 清理失败可忽略 */ void 0 }
}

// ─────────────────────────── 角色记忆 ───────────────────────────

export async function loadMemories(personaId: string): Promise<PersonaMemory[]> {
  try {
    const res = await fetch(`/api/persona-memories/${encodeURIComponent(personaId)}`)
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    return Array.isArray(data?.items) ? data.items : []
  } catch { return [] }
}

export async function writeMemory(personaId: string, key: string, value: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/persona-memories/${encodeURIComponent(personaId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    return res.ok
  } catch { return false }
}

export async function deleteMemory(personaId: string, key: string): Promise<void> {
  try { await fetch(`/api/persona-memories/${encodeURIComponent(personaId)}/${encodeURIComponent(key)}/delete`, { method: 'DELETE' }) } catch { /* 清理失败可忽略 */ void 0 }
}

export async function purgeMemories(personaId: string): Promise<void> {
  try { await fetch(`/api/persona-memories/${encodeURIComponent(personaId)}/delete?purge=1`, { method: 'DELETE' }) } catch { /* 清理失败可忽略 */ void 0 }
}