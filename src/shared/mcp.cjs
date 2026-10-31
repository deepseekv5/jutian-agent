/**
 * mcp.cjs — MCP（Model Context Protocol）客户端管理器
 *
 * 学自 Zode 的核心范式：把外部工具生态标准化为可插拔的 MCP Server。
 *
 * v14 起支持三种传输（此前只有 stdio）：
 *   stdio  子进程，换行分隔 JSON-RPC 2.0（本地 server，如 filesystem/git）
 *   http   Streamable HTTP（MCP 2025-03-26 规范，现代远程 server）
 *   sse    旧版 HTTP+SSE（2024-11-05，很多线上 server 仍只支持这个）
 *
 * 统一生命周期：initialize 握手 → tools/list（缓存）→ tools/call；
 * 连接异常后下次调用自动重连；每个请求带超时，不悬挂主流程。
 *
 * 服务级权限（v14）：每个 server 可配置 allowTools / denyTools / readOnly，
 * 在真正发出 tools/call 之前拦截——远程 server 常带写操作，用户需要
 * 「这个服务只准读」这种粒度，而不是整个开关。
 *
 * 配置持久化：~/.lyclaw/data/mcp.json
 *   [{ id, name, type, command, args, env, url, headers, enabled,
 *      allowTools, denyTools, readOnly }]
 * 工具命名约定：mcp__<serverName>__<toolName>（与主流实现一致）
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const nodeCrypto = require('crypto')

let DATA_DIR = path.join(require('os').homedir(), '.lyclaw', 'data')
const CFG_FILE = () => path.join(DATA_DIR, 'mcp.json')
const PROTOCOL = '2025-03-26'
const LEGACY_PROTOCOL = '2024-11-05'
const REQ_TIMEOUT = 20000
const START_TIMEOUT = 12000
/** 远程 server 的单次请求超时（网络比本地慢） */
const REMOTE_REQ_TIMEOUT = 30000

function init(dataDir) { if (dataDir) DATA_DIR = dataDir; try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch (e) {} }

function loadConfig() {
  try { const a = JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')); return Array.isArray(a) ? a : [] } catch { return [] }
}
function saveConfig(list) {
  try { fs.writeFileSync(CFG_FILE(), JSON.stringify(list, null, 2)) } catch (e) {}
  clients.clear()   // 配置变更后重建连接
}

/** server 类型推断：显式 type 优先；只有 url 的是 http；只有 command 的是 stdio */
function serverType(cfg) {
  if (cfg.type === 'http' || cfg.type === 'sse' || cfg.type === 'stdio') return cfg.type
  return cfg.url ? 'http' : 'stdio'
}

/* ─── SSE 解析（两种远程传输共用）─── */
/** 从一段 SSE 文本里取事件列表；返回 [events, rest] */
function parseSseChunk(buf) {
  const events = []
  let rest = buf
  let idx
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const raw = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    let event = 'message'
    const data = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return [events, rest]
}

/* ─── 远程客户端基类：统一 pending / id / 超时 ─── */
class RemoteBase {
  constructor(cfg) {
    this.cfg = cfg
    this.pending = new Map()
    this.tools = null
    this.nextId = 1
    this.lastError = ''
    this.ready = false
    this.sessionId = ''
  }

  _settle(msg) {
    if (!msg || msg.id == null) return false
    const p = this.pending.get(msg.id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message || 'MCP 错误'))
    else p.resolve(msg.result)
    return true
  }

  _post(body, headers) {
    return fetch(this.cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        ...(this.cfg.headers || {}),
        ...(headers || {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REMOTE_REQ_TIMEOUT),
    })
  }

  /** 流式响应里逐条读 SSE，直到匹配到 id 的响应 */
  async _readSseUntil(res, id, timeout = REMOTE_REQ_TIMEOUT) {
    if (!res.body) throw new Error('远程 server 未返回响应体')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const deadline = Date.now() + timeout
    try {
      while (Date.now() < deadline) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const [events, rest] = parseSseChunk(buf)
        buf = rest
        for (const ev of events) {
          if (!ev.data) continue
          let msg
          try { msg = JSON.parse(ev.data) } catch { continue }
          // 服务端可能在响应里下发 session id
          if (msg.id === id || (msg.result !== undefined || msg.error !== undefined)) {
            if (this._settle(msg)) return true
          }
        }
      }
    } finally {
      try { await reader.cancel() } catch { /* 已结束 */ }
    }
    throw new Error('远程 server 未在超时内返回结果')
  }
  // 远程客户端共用：tools/list 缓存 + schema 校验 + 调用（与 stdio 同语义）
  async listTools(force) {
    if (this.tools && !force) return this.tools
    if (!this.ready) await this.start()
    const r = await this._request('tools/list', {})
    this.tools = (r.tools || []).map(t => ({
      name: 'mcp__' + this.cfg.name + '__' + t.name,
      rawName: t.name,
      server: this.cfg.name,
      serverId: this.cfg.id,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
      readOnlyHint: !!(t.annotations && t.annotations.readOnlyHint),
    }))
    return this.tools
  }

  validateAgainstSchema(toolName, args) {
    const t = (this.tools || []).find(x => x.rawName === toolName)
    if (!t) return null
    const schema = t.parameters || {}
    const required = Array.isArray(schema.required) ? schema.required : []
    const missing = required.filter(k => args == null || args[k] === undefined || args[k] === null || args[k] === '')
    if (missing.length) {
      const hints = missing.map(k => {
        const prop = (schema.properties || {})[k] || {}
        return `${k}(${prop.description || prop.type || '必填'})`
      }).join('、')
      return `缺少必填参数：${hints}`
    }
    for (const [k, v] of Object.entries(args || {})) {
      const prop = (schema.properties || {})[k] || {}
      if (prop.type === 'number' && typeof v !== 'number' && isNaN(Number(v))) return `参数 ${k} 应为数字`
      if (prop.type === 'boolean' && typeof v !== 'boolean') return `参数 ${k} 应为布尔值`
    }
    return null
  }

  async callTool(toolName, args) {
    if (!this.ready) await this.start()
    const invalid = this.validateAgainstSchema(toolName, args)
    if (invalid) return { success: false, output: '', error: invalid }
    const r = await this._request('tools/call', { name: toolName, arguments: args || {} }, 60000)
    return normalizeCallResult(r)
  }
}

/* ─── Streamable HTTP（2025-03-26）─── */
class McpHttpClient extends RemoteBase {
  async start() {
    if (this.ready) return
    if (!this.cfg.url) throw new Error('未配置服务地址')
    const id = this.nextId++
    const res = await this._post({
      jsonrpc: '2.0', id, method: 'initialize',
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'jutian-agent', version: version() },
      },
    })
    if (!res.ok) throw new Error('initialize 失败：HTTP ' + res.status)
    // session id 可能在响应头（规范）或响应体里
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid

    const ct = String(res.headers.get('content-type') || '')
    if (ct.includes('text/event-stream')) {
      await this._readSseUntil(res, id)
    } else {
      const data = await res.json().catch(() => null)
      if (!data) throw new Error('initialize 返回非 JSON')
      this._settle(data)
    }
    // 通知 initialized（失败不阻断，部分实现不校验）
    try {
      await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    } catch { /* 忽略 */ }
    this.ready = true
  }

  async _request(method, params, timeout = REMOTE_REQ_TIMEOUT) {
    await this.start()
    const id = this.nextId++
    const res = await this._post({ jsonrpc: '2.0', id, method, params })
    if (!res.ok) throw new Error(method + ' 失败：HTTP ' + res.status)
    const ct = String(res.headers.get('content-type') || '')
    if (ct.includes('text/event-stream')) {
      // 先把 pending 放好再读流，_settle 才能命中
      let settled = false
      const waiter = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 超时')) }, timeout)
        this.pending.set(id, { resolve: (v) => { settled = true; resolve(v) }, reject: (e) => { settled = true; reject(e) }, timer })
      })
      const reader = this._readSseUntil(res, id, timeout).catch((e) => { if (!settled) throw e })
      const [value] = await Promise.all([waiter, reader])
      return value
    }
    const data = await res.json()
    if (data && data.error) throw new Error(data.error.message || 'MCP 错误')
    if (data && data.result !== undefined) return data.result
    // 少数实现回 202 无 body：再轮询一次同名请求
    throw new Error(method + ' 返回空响应')
  }

  kill() { this.ready = false; this.sessionId = ''; for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('连接已关闭')) } this.pending.clear() }
}

/* ─── 旧版 HTTP+SSE（2024-11-05）：GET 长连接 + POST 到 endpoint ─── */
class McpSseClient extends RemoteBase {
  constructor(cfg) {
    super(cfg)
    this.endpoint = ''
    this.ctrl = null
    this.postUrl = ''
  }

  async start() {
    if (this.ready) return
    if (!this.cfg.url) throw new Error('未配置服务地址')
    this.ctrl = new AbortController()
    const res = await fetch(this.cfg.url, {
      headers: { 'Accept': 'text/event-stream', ...(this.cfg.headers || {}) },
      signal: this.ctrl.signal,
    })
    if (!res.ok || !res.body) throw new Error('SSE 连接失败：HTTP ' + res.status)

    // 等 endpoint 事件（含 sessionId 的 POST 地址）
    const endpointReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('未收到 endpoint 事件（' + START_TIMEOUT / 1000 + 's）')), START_TIMEOUT)
      this._endpointResolve = (u) => { clearTimeout(timer); resolve(u) }
      this._endpointReject = (e) => { clearTimeout(timer); reject(e) }
    })

    this._pump(res).catch((e) => {
      this.ready = false
      this.lastError = String(e.message || e)
      if (this._endpointReject) this._endpointReject(e)
    })

    const ep = await endpointReady
    this.postUrl = new URL(ep, this.cfg.url).toString()

    // 握手（响应从 SSE 流回来）
    await this._rpc('initialize', {
      protocolVersion: LEGACY_PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'jutian-agent', version: version() },
    }, START_TIMEOUT)
    try { await this._rpcNotify('notifications/initialized') } catch { /* 忽略 */ }
    this.ready = true
  }

  async _pump(res) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const [events, rest] = parseSseChunk(buf)
      buf = rest
      for (const ev of events) {
        if (ev.event === 'endpoint') {
          if (this._endpointResolve) this._endpointResolve(ev.data)
          continue
        }
        if (!ev.data) continue
        let msg
        try { msg = JSON.parse(ev.data) } catch { continue }
        this._settle(msg)
      }
    }
  }

  async _postJson(body) {
    const res = await fetch(this.postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REMOTE_REQ_TIMEOUT),
    })
    // 旧版协议：POST 只回 202，结果走 SSE；少数实现会直接回 JSON
    if (!res.ok) throw new Error('请求失败：HTTP ' + res.status)
    const ct = String(res.headers.get('content-type') || '')
    if (ct.includes('application/json')) {
      const data = await res.json().catch(() => null)
      if (data) this._settle(data)
    }
  }

  _rpc(method, params, timeout = REMOTE_REQ_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 超时')) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this._postJson({ jsonrpc: '2.0', id, method, params }).catch((e) => {
        clearTimeout(timer); this.pending.delete(id); reject(e)
      })
    })
  }

  async _rpcNotify(method) {
    await fetch(this.postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal: AbortSignal.timeout(REMOTE_REQ_TIMEOUT),
    })
  }

  async _request(method, params, timeout = REMOTE_REQ_TIMEOUT) {
    await this.start()
    return this._rpc(method, params, timeout)
  }

  kill() {
    try { this.ctrl && this.ctrl.abort() } catch { /* 已关闭 */ }
    this.ready = false
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('连接已关闭')) }
    this.pending.clear()
  }
}

function version() { try { return require('../../package.json').version } catch { return '14.0.0' } }

/* ─── 本地 stdio 客户端 ─── */
class McpClient {
  constructor(cfg) {
    this.cfg = cfg
    this.proc = null
    this.buf = ''
    this.pending = new Map()   // id → {resolve, reject, timer}
    this.tools = null          // tools/list 缓存
    this.nextId = 1
    this.lastError = ''
    this.ready = false
  }

  _send(obj) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error('server 未运行')
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  _request(method, params, timeout = REQ_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(method + ' 超时'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try { this._send({ jsonrpc: '2.0', id, method, params }) }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e) }
    })
  }

  _handleLine(line) {
    const s = line.trim()
    if (!s) return
    let msg
    try { msg = JSON.parse(s) } catch { return }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id)
      clearTimeout(timer)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || 'MCP 错误'))
      else resolve(msg.result)
      return
    }
    // 通知：暂只忽略
  }

  start() {
    if (this.proc && this.proc.exitCode === null) return Promise.resolve()
    const { command, args = [], env = {} } = this.cfg
    if (!command) return Promise.reject(new Error('未配置启动命令'))
    this.buf = ''
    this.ready = false
    this.tools = null
    return new Promise((resolve, reject) => {
      let settled = false
      try {
        this.proc = spawn(command, args, {
          env: { ...process.env, ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        })
      } catch (e) { return reject(e) }
      const startTimer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('server 启动超时（' + START_TIMEOUT / 1000 + 's）')) }
      }, START_TIMEOUT)
      this.proc.stdout.on('data', (d) => {
        this.buf += d.toString()
        let idx
        while ((idx = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, idx)
          this.buf = this.buf.slice(idx + 1)
          try { this._handleLine(line) } catch (e) { /* 单行解析失败不影响整体 */ }
        }
      })
      this.proc.stderr.on('data', (d) => { this.lastError = d.toString().slice(0, 400) })
      this.proc.on('exit', (code) => {
        this.ready = false
        this.proc = null
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('server 退出 (' + code + ')')) }
        this.pending.clear()
      })
      // 握手
      this._request('initialize', {
        protocolVersion: LEGACY_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'jutian-agent', version: version() },
      }, START_TIMEOUT).then(() => {
        this._send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        this.ready = true
        if (!settled) { settled = true; clearTimeout(startTimer); resolve() }
      }).catch((e) => {
        if (!settled) { settled = true; clearTimeout(startTimer); reject(e) }
      })
    })
  }

  async listTools(force) {
    if (this.tools && !force) return this.tools
    if (!this.ready) await this.start()
    const r = await this._request('tools/list', {})
    this.tools = (r.tools || []).map(t => ({
      name: 'mcp__' + this.cfg.name + '__' + t.name,
      rawName: t.name,
      server: this.cfg.name,
      serverId: this.cfg.id,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
      /** 只读提示：远程 server 可声明，readOnly 模式下据此放行（v14） */
      readOnlyHint: !!(t.annotations && t.annotations.readOnlyHint),
    }))
    return this.tools
  }

  /** 学自 Zode 的严格 schema：调用前按 inputSchema 校验必填参数，缺了给明确错误而不是让远端报含糊失败 */
  validateAgainstSchema(toolName, args) {
    const t = (this.tools || []).find(x => x.rawName === toolName)
    if (!t) return null
    const schema = t.parameters || {}
    const required = Array.isArray(schema.required) ? schema.required : []
    const missing = required.filter(k => args == null || args[k] === undefined || args[k] === null || args[k] === '')
    if (missing.length) {
      const hints = missing.map(k => {
        const prop = (schema.properties || {})[k] || {}
        return `${k}(${prop.description || prop.type || '必填'})`
      }).join('、')
      return `缺少必填参数：${hints}`
    }
    // 类型粗校验：number/string 不匹配时提前拦截
    for (const [k, v] of Object.entries(args || {})) {
      const prop = (schema.properties || {})[k] || {}
      if (prop.type === 'number' && typeof v !== 'number' && isNaN(Number(v))) return `参数 ${k} 应为数字`
      if (prop.type === 'boolean' && typeof v !== 'boolean') return `参数 ${k} 应为布尔值`
    }
    return null
  }

  async callTool(toolName, args) {
    if (!this.ready) await this.start()
    const invalid = this.validateAgainstSchema(toolName, args)
    if (invalid) return { success: false, output: '', error: invalid }
    const r = await this._request('tools/call', { name: toolName, arguments: args || {} }, 60000)
    return normalizeCallResult(r)
  }

  kill() {
    try { if (this.proc) { this.proc.kill() } } catch (e) {}
    this.proc = null
    this.ready = false
  }
}

/** MCP tools/call 结果 → { success, output }（三种传输共用） */
function normalizeCallResult(r) {
  const parts = []
  for (const c of ((r && r.content) || [])) {
    if (c.type === 'text') parts.push(c.text)
    else if (c.type === 'image') parts.push('[图片: ' + (c.mimeType || 'image') + ']')
    else if (c.type === 'resource') parts.push('[资源: ' + (c.uri || '') + ']')
  }
  const isError = !!(r && r.isError === true)
  return { success: !isError, output: parts.join('\n') || (isError ? '工具返回错误' : '（无输出）') }
}

/* ─── 权限判定（v14）：服务级 allow/deny/readOnly ─── */
function wildcardMatch(pattern, name) {
  if (pattern === '*' || pattern === name) return true
  if (!pattern.includes('*')) return false
  const re = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
  return re.test(name)
}

/** 返回 null=放行，字符串=拒绝原因 */
function checkPermission(cfg, toolName, toolsCache) {
  const allow = Array.isArray(cfg.allowTools) ? cfg.allowTools.filter(Boolean) : []
  const deny = Array.isArray(cfg.denyTools) ? cfg.denyTools.filter(Boolean) : []
  if (deny.some(p => wildcardMatch(p, toolName))) {
    return `该服务已禁用工具「${toolName}」（设置 → MCP 服务的禁用清单）`
  }
  if (allow.length && !allow.some(p => wildcardMatch(p, toolName))) {
    return `该服务只允许调用：${allow.join('、')}。「${toolName}」不在允许清单内`
  }
  if (cfg.readOnly) {
    const t = (toolsCache || []).find(x => x.rawName === toolName)
    if (!t || !t.readOnlyHint) {
      return `该服务处于「只读」模式，工具「${toolName}」未声明只读，已拦截（如需执行请在设置中关闭只读）`
    }
  }
  return null
}

/* ─── 管理器 ─── */
const clients = new Map()   // serverId → client

function clientKey(cfg) {
  return [serverType(cfg), cfg.command || '', JSON.stringify(cfg.args || []), cfg.url || '', JSON.stringify(cfg.headers || {})].join('|')
}

function getClient(cfg) {
  let c = clients.get(cfg.id)
  if (!c || c._key !== clientKey(cfg)) {
    if (c) c.kill()
    const type = serverType(cfg)
    c = type === 'stdio' ? new McpClient(cfg) : type === 'sse' ? new McpSseClient(cfg) : new McpHttpClient(cfg)
    c._key = clientKey(cfg)
    clients.set(cfg.id, c)
  } else {
    c.cfg = cfg
  }
  return c
}

function listServers() {
  return loadConfig().map(cfg => {
    const c = clients.get(cfg.id)
    return {
      id: cfg.id, name: cfg.name, type: serverType(cfg),
      command: cfg.command, args: cfg.args || [], url: cfg.url || '', enabled: cfg.enabled !== false,
      allowTools: cfg.allowTools || [], denyTools: cfg.denyTools || [], readOnly: !!cfg.readOnly,
      running: !!(c && c.ready),
      toolCount: (c && c.tools) ? c.tools.length : null,
      lastError: c ? c.lastError : '',
    }
  })
}

async function listTools(force) {
  const out = []
  const errors = []
  for (const cfg of loadConfig()) {
    if (cfg.enabled === false) continue
    try {
      const c = getClient(cfg)
      const tools = await c.listTools(force)
      // 权限过滤：被禁用的工具不暴露给模型（模型看不到就不会尝试）
      const visible = tools.filter(t => !checkPermission(cfg, t.rawName, c.tools))
      out.push(...visible)
    } catch (e) {
      errors.push({ server: cfg.name, error: String(e.message || e) })
    }
  }
  return { tools: out, errors }
}

async function callTool(serverName, toolName, args) {
  const cfg = loadConfig().find(s => s.name === serverName && s.enabled !== false)
  if (!cfg) return { success: false, output: '', error: '未找到启用的 MCP 服务: ' + serverName }
  try {
    const c = getClient(cfg)
    // 调用前再校验一次：listTools 过滤可能被缓存绕过（如刚改了配置）
    const denied = checkPermission(cfg, toolName, c.tools)
    if (denied) return { success: false, output: '', error: denied }
    return await c.callTool(toolName, args)
  } catch (e) {
    return { success: false, output: '', error: String(e.message || e) }
  }
}

/** 连通性测试（v14）：不落库，直接按给定配置握手 + 列工具 */
async function testServer(input) {
  const cfg = {
    id: 'test_' + Date.now(),
    name: String(input.name || 'test'),
    type: input.type, command: input.command, args: input.args, env: input.env,
    url: input.url, headers: input.headers,
  }
  const type = serverType(cfg)
  const c = type === 'stdio' ? new McpClient(cfg) : type === 'sse' ? new McpSseClient(cfg) : new McpHttpClient(cfg)
  const t0 = Date.now()
  try {
    const tools = await c.listTools(true)
    return {
      ok: true, type, ms: Date.now() - t0,
      tools: tools.map(t => ({ name: t.rawName, description: t.description, readOnly: t.readOnlyHint })),
    }
  } catch (e) {
    return { ok: false, type, ms: Date.now() - t0, error: String(e.message || e) }
  } finally {
    try { c.kill() } catch { /* 忽略 */ }
  }
}

function upsertServer(input) {
  const list = loadConfig()
  const name = String(input.name || '').trim() || 'mcp-server'
  const type = serverType(input)
  if (type !== 'stdio' && !String(input.url || '').trim()) throw new Error('远程服务需要填写地址（url）')
  if (type === 'stdio' && !String(input.command || '').trim()) throw new Error('本地服务需要填写启动命令')

  const patch = {
    name,
    type,
    command: String(input.command || '').trim(),
    args: Array.isArray(input.args) ? input.args : String(input.args || '').split(/\s+/).filter(Boolean),
    env: input.env || {},
    url: String(input.url || '').trim(),
    headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
    enabled: input.enabled !== false,
    allowTools: Array.isArray(input.allowTools) ? input.allowTools.filter(Boolean) : [],
    denyTools: Array.isArray(input.denyTools) ? input.denyTools.filter(Boolean) : [],
    readOnly: !!input.readOnly,
  }

  if (input.id) {
    const i = list.findIndex(s => s.id === input.id)
    if (i >= 0) {
      list[i] = { ...list[i], ...patch }
      saveConfig(list)
      return list[i]
    }
  }
  const srv = { id: 'mcp_' + nodeCrypto.randomBytes(4).toString('hex'), ...patch }
  list.push(srv)
  saveConfig(list)
  return srv
}

function removeServer(id) {
  const c = clients.get(id)
  if (c) { c.kill(); clients.delete(id) }
  saveConfig(loadConfig().filter(s => s.id !== id))
}

module.exports = {
  init, listServers, listTools, callTool, upsertServer, removeServer, saveConfig,
  testServer, serverType, checkPermission, wildcardMatch, parseSseChunk,
}
