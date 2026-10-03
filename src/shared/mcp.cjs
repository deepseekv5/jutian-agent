/**
 * mcp.cjs — MCP（Model Context Protocol）客户端管理器
 *
 * 学自 Zode 的核心范式：把外部工具生态标准化为可插拔的 MCP Server。
 * - 每个 server 以子进程运行（stdio，换行分隔 JSON-RPC 2.0）
 * - initialize 握手 → tools/list（缓存）→ tools/call
 * - 进程异常退出后，下次调用自动重启；请求带超时，不悬挂主流程
 *
 * 配置持久化：~/.laoyou-agent/data/mcp.json
 *   [{ id, name, command, args, env, enabled }]
 * 工具命名约定：mcp__<serverName>__<toolName>（与主流实现一致）
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let DATA_DIR = path.join(require('os').homedir(), '.laoyou-agent', 'data')
const CFG_FILE = () => path.join(DATA_DIR, 'mcp.json')
const PROTOCOL = '2024-11-05'
const REQ_TIMEOUT = 20000
const START_TIMEOUT = 12000

function init(dataDir) { if (dataDir) DATA_DIR = dataDir; try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch (e) {} }

function loadConfig() {
  try { const a = JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')); return Array.isArray(a) ? a : [] } catch { return [] }
}
function saveConfig(list) {
  try { fs.writeFileSync(CFG_FILE(), JSON.stringify(list, null, 2)) } catch (e) {}
  clients.clear()   // 配置变更后重建连接
}

/* ─── 单个 MCP Server 的 stdio 客户端 ─── */
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
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'jutian-agent', version: (() => { try { return require('../../package.json').version } catch { return '5.4.0' } })() },
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
    // MCP 结果统一转成 { success, output }
    const parts = []
    for (const c of (r.content || [])) {
      if (c.type === 'text') parts.push(c.text)
      else if (c.type === 'image') parts.push('[图片: ' + (c.mimeType || 'image') + ']')
      else if (c.type === 'resource') parts.push('[资源: ' + (c.uri || '') + ']')
    }
    const isError = r.isError === true
    return { success: !isError, output: parts.join('\n') || (isError ? '工具返回错误' : '（无输出）') }
  }

  kill() {
    try { this.proc && this.proc.kill() } catch (e) {}
    this.proc = null
    this.ready = false
  }
}

/* ─── 管理器 ─── */
const clients = new Map()   // serverId → McpClient

function getClient(cfg) {
  let c = clients.get(cfg.id)
  if (!c || c.cfg.command !== cfg.command || JSON.stringify(c.cfg.args) !== JSON.stringify(cfg.args)) {
    if (c) c.kill()
    c = new McpClient(cfg)
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
      id: cfg.id, name: cfg.name, command: cfg.command, args: cfg.args || [], enabled: cfg.enabled !== false,
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
      out.push(...tools)
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
    return await c.callTool(toolName, args)
  } catch (e) {
    return { success: false, output: '', error: String(e.message || e) }
  }
}

function upsertServer(input) {
  const list = loadConfig()
  const name = String(input.name || '').trim() || 'mcp-server'
  if (input.id) {
    const i = list.findIndex(s => s.id === input.id)
    if (i >= 0) { list[i] = { ...list[i], ...input, name }; saveConfig(list); return list[i] }
  }
  const srv = {
    id: 'mcp_' + crypto.randomBytes(4).toString('hex'),
    name, command: String(input.command || '').trim(),
    args: Array.isArray(input.args) ? input.args : String(input.args || '').split(/\s+/).filter(Boolean),
    env: input.env || {}, enabled: input.enabled !== false,
  }
  if (!srv.command) throw new Error('启动命令不能为空')
  list.push(srv)
  saveConfig(list)
  return srv
}

function removeServer(id) {
  const c = clients.get(id)
  if (c) { c.kill(); clients.delete(id) }
  saveConfig(loadConfig().filter(s => s.id !== id))
}

module.exports = { init, listServers, listTools, callTool, upsertServer, removeServer, saveConfig }
