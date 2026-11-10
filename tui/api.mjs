/**
 * 巨天 TUI · 后端 API 客户端
 *
 * 与桌面渲染层完全同一条协议：
 *   - POST /api/agent/run（SSE）— 服务端 agent 循环，工具在服务端直接执行
 *   - needs_client 事件需要客户端介入（确认 / 客户端工具）→ 带 resume 续跑
 *   - 后端未启动时本模块负责把它拉起来（仓库 serve.cjs 或已安装的 App）
 */
import { spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dir, '..')
export const PORT = Number(process.env.JUTIAN_PORT || 3211)
export const BASE = `http://127.0.0.1:${PORT}`

async function jfetch(path, opts = {}, timeoutMs = 10_000) {
  const res = await fetch(BASE + path, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } } catch { return { ok: res.ok, status: res.status, data: text } }
}

export async function health() {
  try {
    const r = await jfetch('/api/health', {}, 1500)
    return r.ok && r.data?.status === 'ok' ? r.data : null
  } catch { return null }
}

/** 后端未运行时拉起：优先仓库 serve.cjs（开发环境），否则启动已安装的巨天 App */
export async function startBackend() {
  const serveCjs = resolve(REPO_ROOT, 'serve.cjs')
  if (existsSync(serveCjs)) {
    const out = openSync('/tmp/jutian-serve-tui.log', 'a')
    const child = spawn(process.execPath, [serveCjs], {
      detached: true, stdio: ['ignore', out, out],
      env: { ...process.env, PORT: String(PORT), JUTIAN_HEADLESS: '1' },
      cwd: REPO_ROOT,
    })
    child.unref()
    return { via: 'serve.cjs', pid: child.pid }
  }
  return startApp()
}

/** 启动已安装的桌面 App（其主进程会自带后端） */
export function startApp() {
  const plat = process.platform
  const candidates = plat === 'darwin'
    ? ['/Applications/巨天agent.app', `${process.env.HOME}/Applications/巨天agent.app`]
    : plat === 'win32'
      ? [`${process.env.LOCALAPPDATA}\\Programs\\巨天agent\\巨天agent.exe`, `C:\\Program Files\\巨天agent\\巨天agent.exe`]
      : [`${process.env.HOME}/.local/share/applications/巨天agent`, `/opt/巨天agent/巨天agent`]
  const found = candidates.find((p) => existsSync(p))
  if (!found) return null
  if (plat === 'darwin') spawn('open', ['-a', found], { detached: true, stdio: 'ignore' }).unref()
  else spawn(found, [], { detached: true, stdio: 'ignore' }).unref()
  return { via: found }
}

/** 轮询 /api/health 直到就绪（App 冷启动要十几秒） */
export async function waitHealth(timeoutMs = 60_000, onTick) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const h = await health()
    if (h) return h
    onTick?.(Math.round((Date.now() - t0) / 1000))
    await new Promise((r) => setTimeout(r, 700))
  }
  return null
}

export async function getSettings() {
  const r = await jfetch('/api/settings')
  return r.data || {}
}

// ─── 会话持久化：TUI 的对话在桌面端也能看到 ───
export async function listSessions(limit = 10) {
  const r = await jfetch('/api/sessions')
  const items = Array.isArray(r.data) ? r.data : []
  return items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, limit)
}
export async function createSession(title) {
  const r = await jfetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
  return r.data
}
export async function loadMessages(sid) {
  const r = await jfetch(`/api/sessions/${encodeURIComponent(sid)}/messages`)
  return Array.isArray(r.data) ? r.data : []
}
export async function saveMessage(sid, m) {
  await jfetch(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...m, created_at: m.created_at || new Date().toISOString() }),
  }, 15_000).catch(() => {})
}

// ─── SSE ───
async function* sseLines(body) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of raw.split('\n')) {
        if (line.startsWith('data: ')) yield line.slice(6)
      }
    }
  }
}

/**
 * 服务端 agent 循环客户端——与 src/renderer/engine/serverStream.ts 同协议同语义。
 * hooks: {
 *   onEvent(ev),                                  // 每个 SSE 事件
 *   async onConfirm(tool, scopeKey),              // kind=confirm → 'allow' | 'always' | 'deny'
 *   async onClientTool(tool),                     // kind=client_tool → 返回 JSON 结果字符串
 * }
 */
export async function chatRun(payload, hooks, signal) {
  let msgs = payload.messages
  let resume
  let pendingTool
  const confirmations = {}
  const approvedScopes = [...(payload.approvedScopes || [])]

  for (let hop = 0; hop < 30; hop++) {
    if (signal?.aborted) return
    let res
    try {
      res = await fetch(BASE + '/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs,
          tools: payload.tools,
          model: payload.model,
          apiBase: payload.apiBase,
          apiKey: '', // 留空 → 服务端回落到本机存储的真实密钥（密钥不出电脑）
          contextWindow: payload.contextWindow,
          hermesMode: payload.hermesMode,
          disabledTools: payload.disabledTools || [],
          workDir: payload.workDir || undefined,
          permissionLevel: payload.permissionLevel || 'standard',
          resume,
          pendingTool,
          confirmations,
          approvedScopes,
          engine: payload.engine || undefined,
        }),
        signal,
      })
    } catch (e) {
      if (e?.name === 'AbortError') return
      hooks.onEvent({ type: 'error', message: `无法连接本地服务：${e?.message || e}` })
      return
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      hooks.onEvent({ type: 'error', message: `agent 启动失败（HTTP ${res.status}）${text ? '：' + text.slice(0, 200) : ''}` })
      return
    }

    let needs = null
    try {
      for await (const data of sseLines(res.body)) {
        let ev
        try { ev = JSON.parse(data) } catch { continue }
        if (ev.type === 'needs_client') { needs = ev; break }
        hooks.onEvent(ev)
        if (ev.type === 'done' || ev.type === 'error' || ev.type === 'aborted') return
      }
    } catch (e) {
      if (e?.name === 'AbortError') return
      hooks.onEvent({ type: 'error', message: `连接中断：${e?.message || e}` })
      return
    }

    if (!needs) { hooks.onEvent({ type: 'error', message: '连接中断：服务端未返回结果' }); return }
    msgs = needs.messages || msgs
    resume = needs.partial

    if (needs.kind === 'client_tool' && needs.tool) {
      let out = '{"ok":true}'
      try { out = (await hooks.onClientTool?.(needs.tool)) || out } catch (e) {
        out = '{"ok":false,"error":"' + String(e?.message || e).replace(/"/g, "'") + '"}'
      }
      msgs = [...msgs, { role: 'tool', tool_call_id: needs.tool.id, content: out }]
      pendingTool = undefined
      continue
    }
    if (needs.kind === 'confirm' && needs.tool) {
      const verdict = (await hooks.onConfirm?.(needs.tool, needs.scopeKey)) || 'deny'
      if (verdict === 'deny') pendingTool = { toolCall: needs.tool, decision: '用户拒绝了此操作。不要尝试用其他方式绕过，直接向用户说明并继续。' }
      else {
        confirmations[needs.tool.id] = true
        pendingTool = { toolCall: needs.tool, decision: null }
        if (verdict === 'always' && needs.scopeKey) approvedScopes.push(needs.scopeKey)
      }
      continue
    }
    hooks.onEvent({ type: 'error', message: 'agent 需要未知的客户端操作，已停止' })
    return
  }
  hooks.onEvent({ type: 'error', message: 'agent 续跑次数过多，已停止（可能存在循环确认）' })
}
