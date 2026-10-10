// 存储层 — SQLite 后端 + localStorage 降级
import type { Session, Message, Settings, PermissionLevel } from '../types'

const API = ''  // 同源 API

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function now(): string {
  return new Date().toISOString()
}

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(API + path)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function apiPost<T>(path: string, body: any): Promise<T | null> {
  try {
    const res = await fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function apiPut<T>(path: string, body: any): Promise<T | null> {
  try {
    const res = await fetch(API + path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function apiDelete(path: string): Promise<boolean> {
  try {
    const res = await fetch(API + path, { method: 'DELETE' })
    return res.ok
  } catch { return false }
}

// --- 设置 ---
// v7.0：不内置任何 API 密钥/提供商/默认模型——用户在设置里自行配置（任意 OpenAI 兼容服务）
const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: '',
  apiKey: '',
  model: '',
  provider: 'api',
  localModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  voiceId: 'zh-CN-XiaoxiaoNeural',
  workDir: '',
  permissionLevel: 'standard',
  allowedFolders: [],
  shellAccess: false,
  sensitiveBlock: true,
  enterToSend: true,
  chatFontSize: 'standard',
  autoTitle: true,
  notifyDone: false,
  autoCompactPct: 70,
  ttsSpeed: '1.0',
  autoSpeak: false,
}

export function getSettingsSync(): Settings {
  try {
    const raw = localStorage.getItem('lyclaw_settings')
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    // 兼容旧数据：合并默认值确保新字段有兜底
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      provider: (parsed.provider === 'local' ? 'local' : 'api') as 'api' | 'local',
      allowedFolders: Array.isArray(parsed.allowedFolders) ? parsed.allowedFolders : [],
      workDir: typeof parsed.workDir === 'string' ? parsed.workDir : '',
      sensitiveBlock: parsed.sensitiveBlock !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function getSettings(): Promise<Settings> {
  const localSettings = getSettingsSync()
  const result = await apiGet<Record<string, string>>('/api/settings')
  if (result && result.apiBaseUrl === 'free') {
    // 免费车道已下线：清理残留的旧配置，回到未配置状态（用户自行设置）
    try { localStorage.removeItem('lyclaw_settings') } catch {}
    result.apiBaseUrl = ''
    result.model = ''
  }
  if (result && result.apiBaseUrl) {
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      apiBaseUrl: result.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl,
      apiKey: result.apiKey || DEFAULT_SETTINGS.apiKey,
      model: result.model || DEFAULT_SETTINGS.model,
      provider: (result.provider === 'local' ? 'local' : 'api') as 'api' | 'local',
      localModel: result.localModel || DEFAULT_SETTINGS.localModel,
      voiceId: result.voiceId || DEFAULT_SETTINGS.voiceId,
      workDir: result.workDir || localSettings.workDir || '',
      sensitiveBlock: result.sensitiveBlock !== undefined ? result.sensitiveBlock === 'true' : localSettings.sensitiveBlock,
      // 安全/外观字段从 API 不返回，保留 localStorage 中的值
      permissionLevel: (result.permissionLevel as PermissionLevel) || localSettings.permissionLevel || DEFAULT_SETTINGS.permissionLevel,
      allowedFolders: Array.isArray(result.allowedFolders) ? localSettings.allowedFolders : localSettings.allowedFolders,
      shellAccess: result.shellAccess !== undefined ? result.shellAccess === 'true' : localSettings.shellAccess,
      keepAwake: result.keepAwake !== undefined ? result.keepAwake === 'true' : localSettings.keepAwake !== false,
      providerName: result.providerName || localSettings.providerName || 'custom',
      contextWindow: Math.max(4000, result.contextWindow ? parseInt(result.contextWindow, 10) || 128000 : (localSettings.contextWindow || 128000)),
      multimodal: result.multimodal !== undefined ? result.multimodal === 'true' : !!localSettings.multimodal,
      models: (() => {
        try { const m = result.models ? JSON.parse(result.models) : null; return Array.isArray(m) ? m : (Array.isArray(localSettings.models) ? localSettings.models : []) }
        catch { return Array.isArray(localSettings.models) ? localSettings.models : [] }
      })(),
      enterToSend: result.enterToSend !== undefined ? result.enterToSend === 'true' : localSettings.enterToSend !== false,
      chatFontSize: (result.chatFontSize as Settings['chatFontSize']) || localSettings.chatFontSize || 'standard',
      autoTitle: result.autoTitle !== undefined ? result.autoTitle === 'true' : localSettings.autoTitle !== false,
      notifyDone: result.notifyDone !== undefined ? result.notifyDone === 'true' : !!localSettings.notifyDone,
      autoCompactPct: result.autoCompactPct ? parseInt(result.autoCompactPct, 10) || 70 : (localSettings.autoCompactPct ?? 70),
      ttsSpeed: result.ttsSpeed || localSettings.ttsSpeed || '1.0',
      autoSpeak: result.autoSpeak !== undefined ? result.autoSpeak === 'true' : !!localSettings.autoSpeak,
    }
    // 自愈：把服务器端最新值写回 localStorage，避免陈旧缓存永久覆盖
    try { localStorage.setItem('lyclaw_settings', JSON.stringify(s)) } catch {}
    return s
  }
  return localSettings
}

/** 发请求用的有效密钥:掩码回显(GET 返回)不是真钥匙,剥掉让服务端用存储密钥 */
export function effectiveApiKey(key?: string): string {
  const k = String(key || '')
  return k.indexOf('****') >= 0 ? '' : k
}

export async function saveSettings(s: Settings): Promise<void> {
  try { localStorage.setItem('lyclaw_settings', JSON.stringify(s)) } catch {}
  await apiPost('/api/settings', { key: 'apiBaseUrl', value: s.apiBaseUrl })
  // 掩码值(GET 回显)与空值都不回写:掩码只是显示,空值视为保留服务器现有密钥
  if (s.apiKey && s.apiKey.indexOf('****') < 0) {
    await apiPost('/api/settings', { key: 'apiKey', value: s.apiKey })
  }
  await apiPost('/api/settings', { key: 'model', value: s.model })
  await apiPost('/api/settings', { key: 'provider', value: s.provider })
  await apiPost('/api/settings', { key: 'localModel', value: s.localModel })
  await apiPost('/api/settings', { key: 'voiceId', value: s.voiceId })
  await apiPost('/api/settings', { key: 'workDir', value: s.workDir || '' })
  await apiPost('/api/settings', { key: 'sensitiveBlock', value: String(s.sensitiveBlock) })
  await apiPost('/api/settings', { key: 'permissionLevel', value: s.permissionLevel })
  await apiPost('/api/settings', { key: 'allowedFolders', value: JSON.stringify(s.allowedFolders) })
  await apiPost('/api/settings', { key: 'shellAccess', value: String(s.shellAccess) })
  await apiPost('/api/settings', { key: 'keepAwake', value: String(s.keepAwake !== false) })
  await apiPost('/api/settings', { key: 'providerName', value: s.providerName || '' })
  await apiPost('/api/settings', { key: 'contextWindow', value: String(Math.max(4000, s.contextWindow || 1000000)) })
  await apiPost('/api/settings', { key: 'multimodal', value: String(!!s.multimodal) })
  // 防清空：陈旧快照的空模型列表不允许覆盖已有列表
  if (Array.isArray(s.models) && s.models.length > 0) {
    await apiPost('/api/settings', { key: 'models', value: JSON.stringify(s.models) })
  }
  await apiPost('/api/settings', { key: 'enterToSend', value: String(s.enterToSend !== false) })
  await apiPost('/api/settings', { key: 'chatFontSize', value: s.chatFontSize || 'standard' })
  await apiPost('/api/settings', { key: 'autoTitle', value: String(s.autoTitle !== false) })
  await apiPost('/api/settings', { key: 'notifyDone', value: String(!!s.notifyDone) })
  await apiPost('/api/settings', { key: 'autoCompactPct', value: String(s.autoCompactPct ?? 70) })
  await apiPost('/api/settings', { key: 'ttsSpeed', value: s.ttsSpeed || '1.0' })
  await apiPost('/api/settings', { key: 'autoSpeak', value: String(!!s.autoSpeak) })
}

export function hasAnySettingsSync(): boolean {
  return !!localStorage.getItem('lyclaw_settings')
}

export async function hasAnySettings(): Promise<boolean> {
  const s = await getSettings()
  return !!(s.apiBaseUrl && s.apiKey && s.model)
}

// --- 会话 ---
export async function listSessions(): Promise<Session[]> {
  const result = await apiGet<any[]>('/api/sessions')
  if (result && Array.isArray(result)) {
    return result.map((s: any) => ({
      id: String(s.id || ''),
      title: typeof s.title === 'string' ? s.title : '新对话',
      created_at: String(s.created_at || ''),
      updated_at: String(s.updated_at || ''),
      project: typeof s.project === 'string' ? s.project : '',
    }))
  }
  try {
    const raw = localStorage.getItem('lyclaw_sessions')
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}

export async function createSession(title?: string, project?: string): Promise<Session> {
  const id = uid()
  const session: Session = { id, title: String(title || '新对话').slice(0, 200), project: project || '', created_at: now(), updated_at: now() }
  const result = await apiPost<any>('/api/sessions', { id, title: session.title, project: session.project })
  if (!result) {
    const raw = localStorage.getItem('lyclaw_sessions')
    const sessions = raw ? JSON.parse(raw) : []
    localStorage.setItem('lyclaw_sessions', JSON.stringify([session, ...sessions]))
  }
  return session
}

/** 更新会话所属项目（工作目录变化时同步分组标签） */
export async function setSessionProject(id: string, project: string): Promise<void> {
  await apiPut(`/api/sessions/${id}`, { project: project || '' })
  try {
    const raw = localStorage.getItem('lyclaw_sessions')
    if (raw) {
      const sessions = JSON.parse(raw).map((s: any) => (s.id === id ? { ...s, project: project || '' } : s))
      localStorage.setItem('lyclaw_sessions', JSON.stringify(sessions))
    }
  } catch {}
}

export async function deleteSession(id: string): Promise<void> {
  await apiDelete(`/api/sessions/${id}`)
  try {
    const raw = localStorage.getItem('lyclaw_sessions')
    if (raw) {
      const sessions = JSON.parse(raw).filter((s: any) => s.id !== id)
      localStorage.setItem('lyclaw_sessions', JSON.stringify(sessions))
    }
  } catch {}
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  await apiPut(`/api/sessions/${id}`, { title: String(title).slice(0, 200), updated_at: now() })
}

// --- 消息 ---
export async function listMessages(sessionId: string): Promise<Message[]> {
  const result = await apiGet<any[]>(`/api/sessions/${sessionId}/messages`)
  let apiMsgs: Message[] = []
  if (result && Array.isArray(result)) {
    apiMsgs = result.map((m: any) => ({
      id: m.id,
      session_id: m.session_id,
      role: m.role,
      content: m.content || '',
      thinking: m.thinking || undefined,
      tool_calls: m.tool_calls ? (typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : m.tool_calls) : [],
      swarm: m.swarm ? (typeof m.swarm === 'string' ? JSON.parse(m.swarm) : m.swarm) : undefined,
      variants: m.variants ? (typeof m.variants === 'string' ? JSON.parse(m.variants) : m.variants) : undefined,
      created_at: m.created_at || '',
      tool_call_id: m.tool_call_id || undefined,
    }))
  }
  // 读取 localStorage 中的消息，与 API 结果合并去重（API 优先）
  let localMsgs: Message[] = []
  try {
    const raw = localStorage.getItem('lyclaw_messages_' + sessionId)
    if (raw) localMsgs = JSON.parse(raw)
  } catch {}
  if (localMsgs.length === 0) return apiMsgs
  // 合并：API 已有的消息不重复，localStorage 中 API 没有的补充进去
  const apiIds = new Set(apiMsgs.map(m => m.id))
  const merged = [...apiMsgs, ...localMsgs.filter(m => !apiIds.has(m.id))]
  return merged
}

export async function createMessage(msg: { session_id: string; role: string; content: string; tool_calls?: any[] }): Promise<Message> {
  const message: Message = {
    id: uid(),
    session_id: msg.session_id,
    role: msg.role as Message['role'],
    content: String(msg.content || ''),
    tool_calls: msg.tool_calls || [],
    created_at: now(),
  }
  const result = await apiPost(`/api/sessions/${msg.session_id}/messages`, {
    id: message.id, role: message.role, content: message.content,
    tool_calls: JSON.stringify(message.tool_calls),
  })
  // API 失败时降级写入 localStorage，防止消息丢失
  if (!result) {
    try {
      const raw = localStorage.getItem('lyclaw_messages_' + msg.session_id)
      const msgs: Message[] = raw ? JSON.parse(raw) : []
      msgs.push(message)
      localStorage.setItem('lyclaw_messages_' + msg.session_id, JSON.stringify(msgs))
    } catch {}
  }
  return message
}

export async function updateMessageContent(id: string, sessionId: string, content: string): Promise<void> {
  await apiPut(`/api/messages/${id}`, { content })
}

export async function updateMessageThinking(id: string, sessionId: string, thinking: string): Promise<void> {
  await apiPut(`/api/messages/${id}`, { thinking })
}

export async function updateMessageToolCalls(id: string, sessionId: string, toolCalls: any[]): Promise<void> {
  await apiPut(`/api/messages/${id}`, { tool_calls: JSON.stringify(toolCalls) })
}

export async function updateMessageSwarm(id: string, sessionId: string, swarm: any): Promise<void> {
  await apiPut(`/api/messages/${id}`, { swarm: JSON.stringify(swarm) })
}

export async function updateMessageVariants(id: string, sessionId: string, variants: string[]): Promise<void> {
  await apiPut(`/api/messages/${id}`, { variants: JSON.stringify(variants) })
}

export async function deleteMessagesAfter(sessionId: string, lastKeepId: string): Promise<void> {
  // 按照时间顺序删除某条消息之后的全部消息
  await apiDelete(`/api/sessions/${sessionId}/messages/after/${lastKeepId}`)
  // localStorage fallback
  try {
    const raw = localStorage.getItem('lyclaw_messages_' + sessionId)
    if (raw) {
      const msgs: Message[] = JSON.parse(raw)
      const idx = msgs.findIndex(m => m.id === lastKeepId)
      if (idx >= 0) {
        localStorage.setItem('lyclaw_messages_' + sessionId, JSON.stringify(msgs.slice(0, idx + 1)))
      }
    }
  } catch {}
}

// --- 长期记忆 ---
export interface MemoryEntry {
  key: string
  value: string
  created_at: string
  updated_at: string
}

export async function getAllMemories(): Promise<Record<string, string>> {
  const data = await apiGet<any>('/api/memories')
  if (!data) return {}
  // 后端 API 返回 [{key, value}, ...]，转为 Record
  if (Array.isArray(data)) {
    const record: Record<string, string> = {}
    data.forEach((item: any) => {
      if (item && typeof item.key === 'string') {
        record[item.key] = item.value || ''
      }
    })
    return record
  }
  return data as Record<string, string>
}

export async function setMemory(key: string, value: string): Promise<boolean> {
  return (await apiPost('/api/memories', { key, value })) !== null
}

export async function deleteMemory(key: string): Promise<boolean> {
  return await apiDelete(`/api/memories/${encodeURIComponent(key)}`)
}
