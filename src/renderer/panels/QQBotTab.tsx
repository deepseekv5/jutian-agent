import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '../hooks/useTheme'
import { getSettingsSync } from '../store/storage'
import { BUILTIN_TOOLS } from '../types'
import { executeTool } from '../engine/tools'

/**
 * QQ 机器人接入（双模式）
 *
 * 1. OneBot 11：连接本机 NapCat / LLOneBot / go-cqhttp 协议端（QQ 扫码登录在协议端完成）
 * 2. 官方机器人：官方 WebSocket 网关（wss://api.sgroup.qq.com/websocket/），
 *    使用 QQ 开放平台 (bot.q.qq.com) 的 AppID + Token，事件经 Gateway 推送，
 *    回复走官方 REST（/v2/groups|users/{openid}/messages），由本地后端代理转发（避免 CORS）。
 */

interface ChatMsg {
  id: string
  direction: 'in' | 'out'
  chatKey: string       // `private_<uid>` / `group_<gid>` (OneBot) | `group_<openid>` / `c2c_<openid>` (官方)
  chatLabel: string
  sender: string
  text: string
  time: string
  kind?: 'tool'         // 工具调用卡片
  status?: 'running' | 'done'
}

type Mode = 'onebot' | 'official'

const DEFAULT_WS = 'ws://127.0.0.1:3001'
const OFFICIAL_API = 'https://api.sgroup.qq.com'
const OFFICIAL_SANDBOX_API = 'https://sandbox.api.sgroup.qq.com'
// 官方网关 OpCode
const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 }
// 群聊 + 私聊(C2C) 消息事件
const INTENT_GROUP_C2C = 1 << 25

// AppID + AppSecret → AccessToken（经本地后端换取，2 小时有效）
async function getAccessToken(appId: string, secret: string, sandbox: boolean): Promise<string> {
  const r = await fetch('/api/qq/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, secret, sandbox }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.access_token) throw new Error(d.error || d.message || `换取失败 ${r.status}`)
  return d.access_token
}

export default function QQBotTab() {
  const { c } = useTheme()
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('qq_mode') as Mode) || 'onebot')
  const [wsUrl, setWsUrl] = useState(() => localStorage.getItem('qq_ws') || DEFAULT_WS)
  const [token, setToken] = useState(() => localStorage.getItem('qq_token') || '')   // OneBot access_token
  const [appId, setAppId] = useState(() => localStorage.getItem('qq_appid') || '')
  const [secret, setSecret] = useState(() => localStorage.getItem('qq_secret') || '')
  const [sandbox, setSandbox] = useState(() => localStorage.getItem('qq_sandbox') === '1')
  const [autoReply, setAutoReply] = useState(() => localStorage.getItem('qq_auto') === '1')
  const [replyMode, setReplyMode] = useState<'chat' | 'task'>(() => (localStorage.getItem('qq_reply_mode') as 'chat' | 'task') || 'chat')

  // QQ 配置持久化到 DB（localStorage 会被强杀丢失，DB 不会）：写即双存，启动时 DB 值优先恢复
  const saveQQ = useCallback((k: string, v: string) => {
    try { localStorage.setItem(k, v) } catch {}
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, value: v }) }).catch(() => {})
  }, [])
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => {
      for (const k of ['qq_mode', 'qq_ws', 'qq_token', 'qq_appid', 'qq_secret', 'qq_sandbox', 'qq_auto', 'qq_reply_mode']) {
        const v = (d as any)[k]
        if (v !== undefined && v !== '' && v !== null && v !== localStorage.getItem(k)) {
          try { localStorage.setItem(k, v) } catch {}
        }
      }
      // DB 恢复后同步 state（避免强杀丢配置后显示旧值）
      if (d.qq_mode && d.qq_mode !== localStorage.getItem('qq_mode')) setMode(d.qq_mode as Mode)
      if (d.qq_ws) setWsUrl(d.qq_ws)
      if (d.qq_token !== undefined) setToken(d.qq_token || '')
      if (d.qq_appid !== undefined) setAppId(d.qq_appid || '')
      if (d.qq_secret !== undefined) setSecret(d.qq_secret || '')
      if (d.qq_sandbox !== undefined) setSandbox(d.qq_sandbox === '1')
      if (d.qq_auto !== undefined) setAutoReply(d.qq_auto === '1')
      if (d.qq_reply_mode) setReplyMode(d.qq_reply_mode as 'chat' | 'task')
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [botName, setBotName] = useState('')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [manualText, setManualText] = useState('')
  const [replyTarget, setReplyTarget] = useState('')   // 手动回复目标 chatKey，空则回复最近会话
  const [replying, setReplying] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const hbTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualClose = useRef(false)
  const hbSeq = useRef<number | null>(null)
  const sessionId = useRef<string | null>(null)
  const accessTokenRef = useRef('')   // 官方模式：AppID+Secret 换取的 AccessToken
  const listRef = useRef<HTMLDivElement>(null)
  const echoSeq = useRef(1)
  // 每个会话保留最近 10 条作为 AI 回复上下文
  const chatHistories = useRef<Map<string, { role: string; content: string }[]>>(new Map())

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight)
  }, [msgs])

  const pushMsg = useCallback((m: Omit<ChatMsg, 'id' | 'time'>) => {
    setMsgs(prev => [...prev.slice(-99), { ...m, id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }])
  }, [])

  const shortId = (s: string) => (s && s.length > 8 ? `…${s.slice(-6)}` : s)

  const wsSendAction = useCallback((action: string, params: any) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ action, params, echo: `act_${echoSeq.current++}` }))
  }, [])

  // ─── 官方机器人：REST 发送（经本地后端代理） ───
  const sendOfficialText = useCallback(async (kind: 'group' | 'c2c', openid: string, text: string, msgId?: string) => {
    const at = accessTokenRef.current
    if (!at) return
    const apiBase = sandbox ? OFFICIAL_SANDBOX_API : OFFICIAL_API
    const url = kind === 'group' ? `${apiBase}/v2/groups/${openid}/messages` : `${apiBase}/v2/users/${openid}/messages`
    const body: any = { msg_type: 0, content: text }
    if (msgId) body.msg_id = msgId
      try {
        await fetch('/api/qq/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, method: 'POST', token: at, body }),
        })
      } catch { /* 静默 */ }
  }, [sandbox])

  // ─── 官方机器人：发送本地文件（上传 → 文件消息） ───
  const qqSendFile = useCallback(async (filePath: string, kind: 'group' | 'c2c', openid: string, msgId?: string): Promise<string> => {
    const at = accessTokenRef.current
    if (!at) return '缺少 AccessToken'
    try {
      const r = await fetch('/api/qq/send-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, kind, openid, msgId, sandbox, token: at }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return d.error || `发送文件失败 ${r.status}`
      return `文件已发送（${Math.round((d.size || 0) / 1024)} KB）`
    } catch (e: any) {
      return `发送文件失败：${e?.message || '未知错误'}`
    }
  }, [sandbox])

  // ─── 把过程步骤实时发到 QQ ───
  const sendQqProgress = useCallback((text: string, kind: string, id: string, msgId?: string) => {
    if (kind === 'group' || kind === 'c2c') sendOfficialText(kind as 'group' | 'c2c', id, text, msgId)
    else if (kind === 'private') wsSendAction('send_private_msg', { user_id: Number(id), message: [{ type: 'text', data: { text } }] })
    else wsSendAction('send_group_msg', { group_id: Number(id), message: [{ type: 'text', data: { text } }] })
  }, [sendOfficialText, wsSendAction])

  // ─── 界面展示工具调用卡片 ───
  const pushToolMsg = useCallback((chatKey: string, chatLabel: string, name: string, text: string, status: 'running' | 'done') => {
    setMsgs(prev => [...prev.slice(-99), {
      id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, direction: 'in', chatKey, chatLabel,
      sender: name, text, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), kind: 'tool', status,
    }])
  }, [])

  // ─── AI 自动回复：执行任务模式（可调用工具真实执行） ───
  const aiReplyTask = useCallback(async (chatKey: string, chatLabel: string, text: string, msgId?: string) => {
    const settings = getSettingsSync()
    if (!settings.apiBaseUrl || !settings.apiKey) return
    setReplying(true)
    const [kind, id] = chatKey.split('_')
    const hist = chatHistories.current.get(chatKey) || []
    hist.push({ role: 'user', content: text })
    const trimmed = hist.slice(-10)
    try {
      const toolDefs = [
        ...BUILTIN_TOOLS.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
        { type: 'function' as const, function: { name: 'send_file', description: '把本地文件发送给当前 QQ 聊天对象（群或私聊）。任务生成文件后，用此工具把文件发给用户。', parameters: { type: 'object', properties: { path: { type: 'string', description: '要发送的本地文件的绝对路径' } }, required: ['path'] } } },
      ]
      const messages: any[] = [
        { role: 'system', content: '你是巨天，运行在用户电脑上的 AI 助手，正在 QQ 群/私聊中处理任务。你可以调用工具（读写文件、执行命令、联网搜索等）真正完成任务。任务生成文件后调用 send_file 把文件发给用户。请主动调用合适的工具直到完成，完成后用简洁的中文总结结果，不超过 300 字，不用 markdown 表格。' },
        ...trimmed,
      ]
      let final = ''
      let toolCount = 0
      for (let round = 0; round < 50; round++) {
        const res = await fetch('/api/llm-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Target-Base': settings.apiBaseUrl, 'X-Api-Key': settings.apiKey || '' },
          body: JSON.stringify({ model: settings.model, messages, tools: toolDefs, max_tokens: 2000, stream: false }),
        })
        if (!res.ok) break
        const data = await res.json()
        const msg = data.choices?.[0]?.message
        if (!msg) break
        const toolCalls: any[] = msg.tool_calls || []
        if (toolCalls.length === 0) { final = (msg.content || '').trim(); break }
        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: toolCalls.map((tc: any) => ({ id: tc.id, type: 'function', function: { name: tc.function?.name, arguments: tc.function?.arguments } })),
        })
        for (const tc of toolCalls) {
          const tName = tc.function?.name || 'unknown'
          toolCount++
          let args: any = {}
          try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
          // 界面逐步展示 + 实时发到 QQ（带步骤序号）
          pushToolMsg(chatKey, chatLabel, tName, `参数：${JSON.stringify(args).slice(0, 150)}`, 'running')
          sendQqProgress(`[步骤 ${toolCount}] ${tName} 执行中…`, kind, id, msgId)
          let resultText: string
          if (tName === 'send_file') {
            resultText = (kind === 'group' || kind === 'c2c')
              ? await qqSendFile(String(args.path || ''), kind as 'group' | 'c2c', id, msgId)
              : '当前为 OneBot 连接，不支持直接发送文件，请告知用户文件路径'
          } else {
            const r = await executeTool({ name: tName, args }, settings.workDir || undefined)
            resultText = r.success ? r.output : `执行失败：${r.error || '未知错误'}`
          }
          pushToolMsg(chatKey, chatLabel, tName, resultText.slice(0, 300), 'done')
          messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText.slice(0, 6000) })
        }
      }
      if (!final) {
        final = `任务步骤较多未能一次完成：已经执行了 ${toolCount} 个工具调用，但任务还没有收敛。你可以直接回复"继续"，我会接着完成；或者补充更具体的下一步要求（比如把结果整理成文件发给我、或者换个方向处理），我会继续执行。`
      }
      trimmed.push({ role: 'assistant', content: final })
      chatHistories.current.set(chatKey, trimmed)
      if (kind === 'group' || kind === 'c2c') sendOfficialText(kind as 'group' | 'c2c', id, final, msgId)
      else wsSendAction('send_group_msg', { group_id: Number(id), message: [{ type: 'text', data: { text: final } }] })
      pushMsg({ direction: 'out', chatKey, chatLabel, sender: '巨天', text: final })
    } catch { /* 静默 */ }
    setReplying(false)
  }, [pushMsg, wsSendAction, sendOfficialText, pushToolMsg, sendQqProgress, qqSendFile])

  // ─── AI 自动回复 ───
  const aiReply = useCallback(async (chatKey: string, chatLabel: string, text: string, msgId?: string) => {
    const settings = getSettingsSync()
    if (!settings.apiBaseUrl || !settings.apiKey) return
    if (replyMode === 'task') { await aiReplyTask(chatKey, chatLabel, text, msgId); return }
    setReplying(true)
    const hist = chatHistories.current.get(chatKey) || []
    hist.push({ role: 'user', content: text })
    const trimmed = hist.slice(-10)
    try {
      const res = await fetch('/api/llm-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Target-Base': settings.apiBaseUrl, 'X-Api-Key': settings.apiKey || '' },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: '你是巨天（一个聪明友好的 AI 助手），正在 QQ 上和用户聊天。回复要简洁口语化、符合 QQ 聊天习惯，一般不超过 150 字，不用 markdown 格式。' },
            ...trimmed,
          ],
          max_tokens: 500,
          stream: false,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const reply = (data.choices?.[0]?.message?.content || '').trim()
        if (reply) {
          trimmed.push({ role: 'assistant', content: reply })
          chatHistories.current.set(chatKey, trimmed)
          const [kind, id] = chatKey.split('_')
          if (kind === 'group' || kind === 'c2c') sendOfficialText(kind, id, reply, msgId)
          else wsSendAction('send_group_msg', { group_id: Number(id), message: [{ type: 'text', data: { text: reply } }] })
          pushMsg({ direction: 'out', chatKey, chatLabel, sender: '巨天', text: reply })
        }
      }
    } catch { /* 静默 */ }
    setReplying(false)
  }, [pushMsg, wsSendAction, sendOfficialText, replyMode, aiReplyTask])

  const clearTimers = useCallback(() => {
    if (hbTimer.current) { clearInterval(hbTimer.current); hbTimer.current = null }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
  }, [])

  // ─── 官方机器人：网关事件分发 ───
  const handleOfficialEvent = useCallback((d: any, ws: WebSocket) => {
    if (d.op === OP.HELLO) {
      const interval = d.d?.heartbeat_interval || 41250
      // Identify 鉴权
      ws.send(JSON.stringify({
        op: OP.IDENTIFY,
        d: {
          token: `QQBot ${accessTokenRef.current}`,
          intents: INTENT_GROUP_C2C,
          shard: [0, 1],
          properties: {},
        },
      }))
      // 心跳
      clearTimers()
      hbTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: OP.HEARTBEAT, d: hbSeq.current }))
      }, interval)
      return
    }
    if (d.op === OP.HEARTBEAT_ACK) return
    if (d.op === OP.RECONNECT) {
      try { ws.close() } catch {}
      return
    }
    if (d.op === OP.INVALID_SESSION) {
      sessionId.current = null
      return
    }
    if (d.op === OP.DISPATCH) {
      if (d.s != null) hbSeq.current = d.s
      const t = d.t
      if (t === 'READY') {
        sessionId.current = d.d?.session_id || null
        const bot = d.d?.user || {}
        setBotName(bot.username || '')
        pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '网关', text: `鉴权成功，机器人 ${bot.username || ''} 已上线` })
        return
      }
      if (t === 'RESUMED') {
        pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '网关', text: '已恢复会话，事件续传中' })
        return
      }
      // 群 @ 消息
      if (t === 'GROUP_AT_MESSAGE_CREATE') {
        const ev = d.d || {}
        const groupOpenId = ev.group_openid || ''
        const content = String(ev.content || '').replace(/<@![^>]*>/g, '').trim()
        if (!content) return
        const chatKey = `group_${groupOpenId}`
        pushMsg({ direction: 'in', chatKey, chatLabel: `群 ${shortId(groupOpenId)}`, sender: shortId(ev.author?.member_openid || ''), text: content })
        if (autoReply) aiReply(chatKey, `群 ${shortId(groupOpenId)}`, content, ev.msg_id)
        return
      }
      // 私聊(C2C) 消息
      if (t === 'C2C_MESSAGE_CREATE') {
        const ev = d.d || {}
        const userOpenId = ev.author?.user_openid || ''
        const content = String(ev.content || '').replace(/<@![^>]*>/g, '').trim()
        if (!content) return
        const chatKey = `c2c_${userOpenId}`
        pushMsg({ direction: 'in', chatKey, chatLabel: `好友 ${shortId(userOpenId)}`, sender: shortId(userOpenId), text: content })
        if (autoReply) aiReply(chatKey, `好友 ${shortId(userOpenId)}`, content, ev.msg_id)
        return
      }
    }
  }, [autoReply, pushMsg, aiReply, clearTimers])

  // ─── 官方机器人：连接 ───
  const connectOfficial = useCallback(async () => {
    if (!appId.trim() || !secret.trim()) {
      pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '错误', text: '请先在 QQ 开放平台获取 AppID 与 AppSecret 并填入' })
      return
    }
    manualClose.current = false
    setConnecting(true)
    try {
      // 1. AppID + AppSecret 换取 AccessToken
      const at = await getAccessToken(appId.trim(), secret.trim(), sandbox)
      accessTokenRef.current = at
      pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '网关', text: `AccessToken 换取成功（${Math.round((at.length > 20 ? 6721 : 7200) / 3600)} 小时有效），连接网关…` })
      // 2. 获取通用 WSS 接入点
      const apiBase = sandbox ? OFFICIAL_SANDBOX_API : OFFICIAL_API
      let gatewayUrl = sandbox ? 'wss://sandbox.api.sgroup.qq.com/websocket/' : 'wss://api.sgroup.qq.com/websocket/'
      try {
        const r = await fetch('/api/qq/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: `${apiBase}/gateway`, method: 'GET', token: at }),
        })
        if (r.ok) {
          const g = await r.json()
          if (g?.url) gatewayUrl = g.url
        }
      } catch { /* 网关接口失败则用默认地址 */ }
      // 3. 建立 WebSocket
      if (wsRef.current) { try { wsRef.current.close() } catch {} }
      hbSeq.current = null
      sessionId.current = null
      const ws = new WebSocket(gatewayUrl)
      wsRef.current = ws
      ws.onopen = () => pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '网关', text: `已连接 ${gatewayUrl}，等待鉴权…` })
      ws.onmessage = (ev) => {
        let d: any
        try { d = JSON.parse(ev.data) } catch { return }
        handleOfficialEvent(d, ws)
      }
      ws.onclose = () => {
        setConnected(false)
        setConnecting(false)
        clearTimers()
        if (!manualClose.current) {
          pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '网关', text: '连接断开，3 秒后自动重连…' })
          reconnectTimer.current = setTimeout(() => { connectOfficial() }, 3000)
        }
      }
      ws.onerror = () => setConnecting(false)
      // 连接成功即视为在线（READY 后再标记已就绪）
      ws.addEventListener('open', () => setConnected(true))
    } catch (e: any) {
      setConnecting(false)
      pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '错误', text: `连接失败：${e?.message || '未知错误'}` })
    }
  }, [appId, secret, sandbox, pushMsg, handleOfficialEvent, clearTimers])

  // ─── OneBot 11：连接 ───
  const connectOneBot = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} }
    setConnecting(true)
    const url = token ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}` : wsUrl
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e: any) {
      setConnecting(false)
      pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '错误', text: `无法连接：${e.message}` })
      return
    }
    wsRef.current = ws
    ws.onopen = () => { setConnected(true); setConnecting(false); pushMsg({ direction: 'in', chatKey: 'sys', chatLabel: '系统', sender: '连接', text: `已连接 ${wsUrl}，实时同步已开启` }) }
    ws.onclose = () => { setConnected(false); setConnecting(false) }
    ws.onerror = () => { setConnecting(false) }
    ws.onmessage = (ev) => {
      let d: any
      try { d = JSON.parse(ev.data) } catch { return }
      if (d.post_type === 'message' && (d.message_type === 'private' || d.message_type === 'group')) {
        const isGroup = d.message_type === 'group'
        const chatKey = isGroup ? `group_${d.group_id}` : `private_${d.user_id}`
        const chatLabel = isGroup ? `群 ${d.group_name || d.group_id}` : `好友 ${d.sender?.nickname || d.user_id}`
        const sender = d.sender?.nickname || d.sender?.card || String(d.user_id)
        let text = ''
        if (typeof d.message === 'string') text = d.message
        else if (Array.isArray(d.message)) {
          text = d.message.map((seg: any) => seg.type === 'text' ? seg.data?.text || '' : seg.type === 'at' ? `@${seg.data?.qq || ''}` : seg.type === 'image' ? '[图片]' : `[${seg.type}]`).join('')
        }
        text = (text || d.raw_message || '').trim()
        if (!text) return
        pushMsg({ direction: 'in', chatKey, chatLabel, sender, text })
        if (autoReply) aiReply(chatKey, chatLabel, text)
      }
      if (d.post_type === 'meta_event' && d.meta_event_type === 'heartbeat') {
        setConnected(true)
      }
    }
  }, [wsUrl, token, autoReply, pushMsg, aiReply])

  const connect = useCallback(() => {
    if (mode === 'official') connectOfficial()
    else connectOneBot()
  }, [mode, connectOfficial, connectOneBot])

  const disconnect = useCallback(() => {
    manualClose.current = true
    clearTimers()
    try { wsRef.current?.close() } catch {}
    wsRef.current = null
    setConnected(false)
    setConnecting(false)
  }, [clearTimers])

  useEffect(() => () => { manualClose.current = true; clearTimers(); try { wsRef.current?.close() } catch {} }, [clearTimers])

  // ─── 手动回复（可选目标会话，默认最近会话） ───
  const sendManual = useCallback(() => {
    const text = manualText.trim()
    if (!text || !connected) return
    const chats = [...new Set(msgs.map(m => m.chatKey).filter(k => k !== 'sys'))]
    const target = replyTarget || chats[0]
    const last = msgs.slice().reverse().find(m => m.chatKey === target)
    if (!last) return
    const [kind, id] = last.chatKey.split('_')
    if (mode === 'official' && (kind === 'group' || kind === 'c2c')) sendOfficialText(kind as 'group' | 'c2c', id, text)
    else if (kind === 'group') wsSendAction('send_group_msg', { group_id: Number(id), message: [{ type: 'text', data: { text } }] })
    else wsSendAction('send_private_msg', { user_id: Number(id), message: [{ type: 'text', data: { text } }] })
    pushMsg({ direction: 'out', chatKey: last.chatKey, chatLabel: last.chatLabel, sender: '巨天(手动)', text })
    setManualText('')
  }, [manualText, connected, msgs, replyTarget, mode, wsSendAction, sendOfficialText, pushMsg])

  const statusColor = connected ? '#10b981' : connecting ? '#f59e0b' : '#6b7280'

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* 左侧：连接配置 + 使用说明 */}
      <div className="w-72 shrink-0 border-r flex flex-col overflow-y-auto scrollbar-thin glass" style={{ borderColor: c.borderLight }}>
        <div className="px-4 py-4 border-b space-y-3" style={{ borderColor: c.borderLight }}>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: statusColor, boxShadow: connected ? `0 0 10px ${statusColor}66` : 'none' }} />
            <span className="text-[15px] font-semibold" style={{ color: c.textHead }}>QQ 机器人</span>
            {botName && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${c.accent}12`, color: c.accent }}>{botName}</span>}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: c.textTertiary }}>接入 QQ 收发消息，支持 OneBot 与官方机器人双模式</p>

          {/* 模式切换 */}
          <div className="flex rounded-lg p-0.5" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
            {(['onebot', 'official'] as Mode[]).map(m => (
              <button key={m} onClick={() => { setMode(m); saveQQ('qq_mode', m); disconnect() }}
                className="flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all"
                style={mode === m ? { background: c.modalBg, color: c.textHead, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: c.textTertiary }}>
                {m === 'onebot' ? 'OneBot 11' : '官方机器人'}
              </button>
            ))}
          </div>

          {mode === 'official' ? (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium" style={{ color: c.textTertiary }}>AppID（QQ 开放平台）</label>
                <input value={appId} onChange={e => setAppId(e.target.value)} placeholder="申请机器人后获取，例如 102000000"
                  className="w-full px-2.5 py-2 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium" style={{ color: c.textTertiary }}>AppSecret（机密）</label>
                <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="开发设置里的 AppSecret" type="password"
                  className="w-full px-2.5 py-2 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sandbox} onChange={e => { setSandbox(e.target.checked); saveQQ('qq_sandbox', e.target.checked ? '1' : '0') }}
                  className="w-3.5 h-3.5 rounded" style={{ accentColor: c.accent }} />
                <span className="text-[11px]" style={{ color: c.textSecondary }}>沙箱环境（仅接收测试事件）</span>
              </label>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium" style={{ color: c.textTertiary }}>WebSocket 地址</label>
                <input value={wsUrl} onChange={e => setWsUrl(e.target.value)} placeholder="ws://127.0.0.1:3001"
                  className="w-full px-2.5 py-2 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium" style={{ color: c.textTertiary }}>access_token（可选）</label>
                <input value={token} onChange={e => setToken(e.target.value)} placeholder="协议端配置的令牌" type="password"
                  className="w-full px-2.5 py-2 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoReply} onChange={e => { setAutoReply(e.target.checked); saveQQ('qq_auto', e.target.checked ? '1' : '0') }}
              className="w-3.5 h-3.5 rounded" style={{ accentColor: c.accent }} />
            <span className="text-[11px]" style={{ color: c.textSecondary }}>AI 自动回复</span>
          </label>
          <div className="space-y-1">
            <label className="text-[10px] font-medium" style={{ color: c.textTertiary }}>回复模式</label>
            <div className="flex rounded-lg p-0.5" style={{ background: c.bgInput, border: `1px solid ${c.border}` }}>
              {([['chat', '仅聊天'], ['task', '执行任务']] as const).map(([m, label]) => (
                <button key={m} onClick={() => { setReplyMode(m); saveQQ('qq_reply_mode', m) }}
                  className="flex-1 py-1.5 rounded-md text-[11px] font-medium transition-all"
                  style={replyMode === m ? { background: c.modalBg, color: c.textHead, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' } : { color: c.textTertiary }}>
                  {label}
                </button>
              ))}
            </div>
            {replyMode === 'task' && (
              <p className="text-[10px] leading-relaxed" style={{ color: c.textMuted }}>
                AI 可调用工具真实执行（受安全策略限制），过程逐步展示并实时发到 QQ，生成的文件可直接发送
              </p>
            )}
          </div>
          <div className="flex gap-1.5">
            {!connected ? (
              <button onClick={() => { saveQQ('qq_mode', mode); if (mode === 'official') { saveQQ('qq_appid', appId); saveQQ('qq_secret', secret) } else { saveQQ('qq_ws', wsUrl); saveQQ('qq_token', token) } connect() }}
                disabled={connecting}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-white transition-all" style={{ background: c.accent }}>
                {connecting ? '连接中…' : '连接'}
              </button>
            ) : (
              <button onClick={disconnect} className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                style={{ background: c.bgInput, color: c.toolErr, border: `1px solid ${c.toolErr}40` }}>
                断开
              </button>
            )}
          </div>
        </div>

        <div className="px-4 py-4 text-[10.5px] leading-relaxed space-y-2" style={{ color: c.textMuted }}>
          {mode === 'official' ? (
            <>
              <div className="text-[11px] font-semibold" style={{ color: c.textSecondary }}>接入步骤（官方机器人）</div>
              <p>1. 前往 <span style={{ color: c.accent }}>bot.q.qq.com</span> 创建机器人，拿到 AppID 与 AppSecret</p>
              <p>2. 在"开发设置"中开启事件订阅（群消息/私聊消息）</p>
              <p>3. 将机器人拉入群 / 添加好友，私聊需先发消息建立会话</p>
              <p>4. 在本页填入 AppID 与 AppSecret，点连接（自动换取 AccessToken）</p>
              <p>5. 勾选"AI 自动回复"，群内 <span style={{ color: c.accent }}>@机器人</span> 或私聊即由 AI 代管</p>
              <div className="pt-1" style={{ borderTop: `1px solid ${c.borderLight}` }}>
                AccessToken 2 小时有效自动续期 · 官方网关自动心跳 · 断线 3 秒重连 · 回复走官方 REST（本地代理转发）
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-semibold" style={{ color: c.textSecondary }}>接入步骤（扫码方案）</div>
              <p>1. 安装 <span style={{ color: c.accent }}>NapCat</span> 或 LLOneBot（OneBot 11 协议端）</p>
              <p>2. 在协议端里<b>扫码登录</b> QQ 账号</p>
              <p>3. 开启 OneBot 的 WebSocket 服务（默认 3001 端口）</p>
              <p>4. 在本页填地址并点连接，消息即实时同步</p>
              <p>5. 勾选"AI 自动回复"，QQ 消息由 AI 代管</p>
              <div className="pt-1" style={{ borderTop: `1px solid ${c.borderLight}` }}>
                支持私聊 + 群聊 · 每个会话独立上下文 · 断线自动显示状态
              </div>
            </>
          )}
        </div>
      </div>

      {/* 右侧：实时消息流 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5 scrollbar-thin">
          {msgs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-3" style={{ color: c.textMuted }}>
              <svg className="w-12 h-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
              <p className="text-xs">连接后，QQ 消息将实时同步到这里</p>
            </div>
          )}
          {msgs.map(m => (
            <div key={m.id} className="flex flex-col animate-fade-in">
              {m.kind === 'tool' ? (
                <div className="self-start max-w-[85%] rounded-xl border px-3 py-2 mb-1"
                  style={{ borderColor: m.status === 'done' ? `${c.toolOk}45` : `${c.accent}45`, background: m.status === 'done' ? `${c.toolOk}0a` : `${c.accent}0a` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {m.status === 'running' ? (
                      <svg className="w-3 h-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: c.accent }}>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: c.toolOk }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={2.5} />
                      </svg>
                    )}
                    <span className="text-[11px] font-mono font-semibold" style={{ color: c.accent }}>{m.sender}</span>
                    <span className="text-[10px]" style={{ color: c.textMuted }}>{m.status === 'done' ? '完成' : '执行中'}</span>
                    <span className="ml-auto text-[10px]" style={{ color: c.textMuted }}>{m.time}</span>
                  </div>
                  <pre className="text-[11px] whitespace-pre-wrap break-words leading-relaxed" style={{ color: c.textSecondary, fontFamily: "'SF Mono', Menlo, monospace" }}>{m.text}</pre>
                </div>
              ) : (
                <>
                  <div className="text-[10px] mb-0.5" style={{ color: c.textMuted }}>
                    {m.chatLabel !== '系统' && <span style={{ color: c.textTertiary }}>{m.sender}</span>}
                    {m.chatLabel !== '系统' && ' · '}{m.time}
                    {m.direction === 'out' && <span className="ml-1 px-1 rounded" style={{ background: `${c.accent}15`, color: c.accent }}>机器人</span>}
                  </div>
                  <div className="text-[13px] leading-relaxed px-3 py-2 rounded-xl inline-block self-start max-w-[85%] whitespace-pre-wrap break-words"
                    style={{ background: m.direction === 'out' ? `${c.accent}12` : c.bgCard, border: `1px solid ${m.direction === 'out' ? `${c.accent}30` : c.borderLight}`, color: c.text }}>
                    {m.text}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 手动回复输入 */}
        <div className="p-3 border-t flex gap-2 shrink-0" style={{ borderColor: c.borderLight }}>
          <select value={replyTarget} onChange={e => setReplyTarget(e.target.value)}
            disabled={!connected}
            className="shrink-0 px-2 py-2 rounded-xl text-[11px] outline-none disabled:opacity-50 max-w-[140px]"
            style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.textTertiary }}
            title="选择回复的会话">
            <option value="">最近会话</option>
            {[...new Set(msgs.map(m => m.chatKey).filter(k => k !== 'sys'))].slice(0, 20).map(k => (
              <option key={k} value={k}>{k.split('_')[0] === 'group' ? `群 ${k.split('_').slice(1).join('_').slice(-8)}` : `私聊 ${k.split('_').slice(1).join('_').slice(-8)}`}</option>
            ))}
          </select>
          <input value={manualText} onChange={e => setManualText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) sendManual() }}
            placeholder={connected ? '手动回复最近的会话…' : '连接后可手动回复'}
            disabled={!connected}
            className="flex-1 px-3 py-2 rounded-xl text-[12.5px] outline-none disabled:opacity-50"
            style={{ background: c.bgInput, border: `1px solid ${c.border}`, color: c.text }} />
          <button onClick={sendManual} disabled={!connected || !manualText.trim()}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white disabled:opacity-40" style={{ background: c.accent }}>
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
