/**
 * 巨天 TUI（终端版）—— Claude Code 同款交互：
 *   Static 历史流（对话/工具卡/计划）+ 底部活动区（流式输出/转圈/确认弹窗/输入框）
 * 与桌面端同一后端、同一工具、同一权限门禁。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { render, Static, Box, Text, useInput, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { chatRun, createSession, loadMessages, saveMessage } from './api.mjs'
import { buildTuiSystemPrompt } from './prompt.mjs'
import { renderMd } from './md.mjs'

const DIM = 'rgb(130,135,145)'
const ACCENT = 'rgb(64,196,140)'
const ERR = 'rgb(240,90,90)'
const USER_C = 'rgb(120,180,255)'

/** 工具参数摘要（一行） */
function argsLine(name, argsStr) {
  let a = {}
  try { a = JSON.parse(argsStr || '{}') } catch { /* ignore */ }
  const pick = [a.command, a.path, a.file_path, a.query, a.pattern, a.url, a.name, a.skill, a.topic, a.content]
    .find((v) => typeof v === 'string' && v)
  const s = String(pick || JSON.stringify(a)).replace(/\s+/g, ' ').slice(0, 90)
  return `${name}(${s})`
}

/** 工具输出预览（前几行） */
function outPreview(result, isError) {
  const s = String(result || '').trim()
  if (!s) return null
  const max = isError ? 5 : 4
  const lines = s.split('\n').slice(0, max).map((l) => l.slice(0, 110))
  return lines.join('\n') + (s.split('\n').length > max ? '\n…' : '')
}

/** 单条历史块 */
function Block({ b }) {
  if (b.kind === 'user') {
    return (
      <Box marginTop={1}>
        <Text color={USER_C} bold>▸ 你</Text>
        <Text color="white"> {b.text}</Text>
      </Box>
    )
  }
  if (b.kind === 'assistant') {
    const md = renderMd(b.text)
    if (!md.trim()) return null
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color={ACCENT} bold>◆ 巨天</Text>
        <Text>{md}</Text>
      </Box>
    )
  }
  if (b.kind === 'tool') {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Text>
          <Text color={b.status === 'error' ? ERR : ACCENT}>{b.status === 'error' ? '✗' : '⏺'}</Text>
          <Text color={DIM}> {b.label}{b.ms ? `  (${(b.ms / 1000).toFixed(1)}s)` : ''}</Text>
        </Text>
        {b.preview && <Text color={b.status === 'error' ? ERR : DIM}>{b.preview}</Text>}
      </Box>
    )
  }
  if (b.kind === 'plan') {
    return (
      <Box marginTop={1} paddingLeft={2} borderStyle="round" borderColor={DIM} flexDirection="column">
        {b.steps.map((s, i) => (
          <Text key={i} color={s.status === 'done' ? ACCENT : s.status === 'in_progress' ? 'yellow' : DIM}>
            {s.status === 'done' ? '☑' : s.status === 'in_progress' ? '◐' : '☐'} {s.content}
          </Text>
        ))}
      </Box>
    )
  }
  if (b.kind === 'error') return <Box marginTop={1}><Text color={ERR}>✗ {b.text}</Text></Box>
  if (b.kind === 'info') return <Box marginTop={1}><Text color={DIM}>{b.text}</Text></Box>
  return null
}

/** 确认弹窗（needs_client: confirm） */
function ConfirmBox({ tool, onDecide }) {
  return (
    <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text color="yellow" bold>⚠ 需要你的确认：{tool.name}</Text>
      <Text color={DIM}> {argsLine(tool.name, tool.arguments)}</Text>
      <Text> [y] 允许 · [n] 拒绝 · [a] 本会话始终允许</Text>
    </Box>
  )
}

function App({ info, tools, sysPrompt, initialMessages, initialSession, settings, port }) {
  const { exit } = useApp()
  const [blocks, setBlocks] = useState(initialMessages.length
    ? [{ kind: 'info', text: `已恢复会话「${initialSession?.title || ''}」（${initialMessages.length} 条消息）` }]
    : [])
  const [live, setLive] = useState(null)
  const [runningTools, setRunningTools] = useState([])
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [histIdx, setHistIdx] = useState(-1)
  const [plan, setPlan] = useState(null)
  const [session, setSession] = useState(initialSession || null)
  const abortRef = useRef(null)
  const convoRef = useRef([])
  const inputHistRef = useRef([])
  const liveTextRef = useRef('')
  const toolT0Ref = useRef(new Map())
  const busyRef = useRef(false)
  const inputRef = useRef('')
  const workDir = settings.workDir || info?.workDir || '~'
  const model = settings.model || '?'
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { liveTextRef.current = live?.text || '' }, [live])

  const push = useCallback((b) => setBlocks((prev) => [...prev, b]), [])

  // ─── 发送一轮 ───
  const send = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    inputHistRef.current.unshift(trimmed)
    setHistIdx(-1)
    push({ kind: 'user', text: trimmed })
    setBusy(true)
    liveTextRef.current = ''
    setLive({ text: '', thinking: '' })

    // 首条消息时建会话（TUI 对话同步到桌面端可见）
    let sid = session?.id
    if (!sid) {
      try {
        const s = await createSession(trimmed.slice(0, 18) || '终端对话')
        if (s?.id) { sid = s.id; setSession(s) }
      } catch { /* 持久化失败不影响对话 */ }
    }
    if (sid) saveMessage(sid, { id: `tui-u-${Date.now()}`, role: 'user', content: trimmed })

    const controller = new AbortController()
    abortRef.current = controller
    const toolFirst = new Set()

    try {
      await chatRun({
        messages: [{ role: 'system', content: sysPrompt }, ...convoRef.current, { role: 'user', content: trimmed }],
        tools,
        model: settings.model,
        apiBase: settings.apiBaseUrl,
        contextWindow: settings.contextWindow,
        hermesMode: settings.hermesProtocol,
        workDir: settings.workDir,
        permissionLevel: settings.permissionLevel || 'standard',
      }, {
        onEvent: (ev) => {
          if (ev.type === 'chunk') setLive((p) => ({ ...p, text: (p?.text || '') + (ev.text || '') }))
          else if (ev.type === 'thinking') setLive((p) => ({ ...p, thinking: (p?.thinking || '') + (ev.text || '') }))
          else if (ev.type === 'tool_start' && ev.tool) {
            toolT0Ref.current.set(ev.tool.id, Date.now())
            setRunningTools((prev) => [...prev, { id: ev.tool.id, label: argsLine(ev.tool.name, ev.tool.arguments) }])
          } else if (ev.type === 'tool_end' && ev.tool) {
            const ms = Date.now() - (toolT0Ref.current.get(ev.tool.id) || Date.now())
            const st = ev.tool.status === 'error' ? 'error' : 'done'
            setRunningTools((prev) => prev.filter((t) => t.id !== ev.tool.id))
            push({
              kind: 'tool', id: ev.tool.id, status: st,
              label: argsLine(ev.tool.name, ev.tool.arguments), ms,
              preview: outPreview(ev.tool.result, st === 'error'),
              noGap: !toolFirst.has(ev.tool.name) && (toolFirst.add(ev.tool.name), true),
            })
          }
        },
        onConfirm: (tool, _scopeKey) => new Promise((resolve) => {
          setConfirm({ tool, resolve: (v) => { setConfirm(null); resolve(v) } })
        }),
        onClientTool: async (tool) => {
          if (tool.name === 'update_plan') {
            let steps = []
            try { steps = JSON.parse(tool.arguments || '{}').steps || [] } catch { /* ignore */ }
            setPlan(steps)
            push({ kind: 'plan', steps })
            return '{"ok":true}'
          }
          return '{"ok":false,"error":"TUI 暂不支持此客户端工具（请在桌面端使用）"}'
        },
      }, controller.signal)

      // 收尾：流式文本落历史块
      const finalText = liveTextRef.current
      if (finalText.trim()) push({ kind: 'assistant', text: finalText })
      convoRef.current = [...convoRef.current, { role: 'user', content: trimmed }, { role: 'assistant', content: finalText }]
      if (sid) saveMessage(sid, { id: `tui-a-${Date.now()}`, role: 'assistant', content: finalText })
    } catch (e) {
      push({ kind: 'error', text: String(e?.message || e) })
    } finally {
      setBusy(false)
      setRunningTools([])
      setLive(null)
      abortRef.current = null
    }
  }, [push, session, sysPrompt, tools, settings])

  // ─── 斜杠命令 ───
  const handleCommand = useCallback(async (raw) => {
    const [cmd, ...rest] = raw.split(/\s+/)
    const arg = rest.join(' ')
    switch (cmd) {
      case '/help':
        push({ kind: 'info', text: '命令：/new 新对话 · /resume [序号] 恢复会话 · /status 状态 · /plan 计划 · /security 安全开关 · /pack 更新防护库 · /quit 退出\n快捷键：Esc 中断输出 · ↑↓ 输入历史 · Ctrl+C 中断/退出' })
        return
      case '/new':
        convoRef.current = []
        setSession(null); setPlan(null)
        push({ kind: 'info', text: '已开新对话（TUI 的会话在桌面端同样可见）' })
        return
      case '/resume': {
        try {
          const { listSessions } = await import('./api.mjs')
          const list = await listSessions(10)
          if (!list.length) { push({ kind: 'info', text: '还没有历史会话' }); return }
          if (!arg) {
            push({ kind: 'info', text: '最近会话（/resume <序号> 恢复）：\n' + list.map((s, i) => `${i + 1}. ${s.title} · ${String(s.updated_at || '').slice(5, 16)}`).join('\n') })
            return
          }
          const n = parseInt(arg, 10)
          if (!(n >= 1 && n <= list.length)) { push({ kind: 'error', text: `序号 1-${list.length}` }); return }
          const s = list[n - 1]
          const msgs = await loadMessages(s.id)
          convoRef.current = msgs.filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
          setSession(s)
          setBlocks(msgs.slice(-40).map((m) => (m.role === 'user' ? { kind: 'user', text: String(m.content || '') } : { kind: 'assistant', text: String(m.content || '') })))
          push({ kind: 'info', text: `已恢复「${s.title}」` })
        } catch (e) { push({ kind: 'error', text: String(e?.message || e) }) }
        return
      }
      case '/status':
        push({ kind: 'info', text: `模型 ${model} · 工作区 ${workDir} · 后端 v${info?.version || '?'} · 工具 ${info?.tools || '?'} 个 · 会话 ${session ? `「${session.title}」` : '未保存'}` })
        return
      case '/plan':
        push(plan ? { kind: 'plan', steps: plan } : { kind: 'info', text: '当前没有计划' })
        return
      case '/security': {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/settings`).then((x) => x.json())
          push({ kind: 'info', text: `巨天安全：危险命令拦截 ${r.security_cmd_guard !== '0' ? '开' : '关'} · 注入扫描 ${r.security_injection_scan !== '0' ? '开' : '关'} · 密钥屏蔽 ${r.security_key_shield !== '0' ? '开' : '关'}（桌面设置页可改）` })
        } catch { push({ kind: 'error', text: '读取失败' }) }
        return
      }
      case '/pack': {
        push({ kind: 'info', text: '正在更新恶意命令库…' })
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/security/pack/update`, { method: 'POST' }).then((x) => x.json())
          push({ kind: 'info', text: r?.ok ? `防护库已更新至 v${r.version}（${r.count} 条，生效 ${r.active} 条）` : `更新失败：${r?.error}` })
        } catch (e) { push({ kind: 'error', text: String(e?.message || e) }) }
        return
      }
      case '/quit': case '/exit': case '/q': exit(); return
      default: push({ kind: 'error', text: `未知命令 ${cmd}（/help 查看全部）` })
    }
  }, [push, info, model, workDir, session, plan, port])

  // ─── 键盘 ───
  useInput((ch, key) => {
    if (confirm) {
      if (ch === 'y') confirm.resolve('allow')
      else if (ch === 'a') confirm.resolve('always')
      else if (ch === 'n' || key.escape) confirm.resolve('deny')
      return
    }
    if (key.ctrl && ch === 'c') {
      if (busyRef.current) { abortRef.current?.abort(); return }
      exit(); return
    }
    if (key.escape && busyRef.current) { abortRef.current?.abort(); return }
    if (busyRef.current) return
    if (key.return) {
      const v = inputRef.current.trim()
      inputRef.current = ''
      setInput('')
      if (!v) return
      if (v.startsWith('/')) { handleCommand(v); return }
      send(v)
      return
    }
    if (key.upArrow) {
      const next = Math.min(histIdx + 1, inputHistRef.current.length - 1)
      if (next >= 0) { setHistIdx(next); inputRef.current = inputHistRef.current[next]; setInput(inputRef.current) }
      return
    }
    if (key.downArrow) {
      const next = histIdx - 1
      setHistIdx(next)
      inputRef.current = next >= 0 ? inputHistRef.current[next] : ''
      setInput(inputRef.current)
      return
    }
    if (key.backspace || key.delete) { inputRef.current = inputRef.current.slice(0, -1); setInput(inputRef.current); return }
    if (!ch || key.ctrl || key.meta) return
    // pty 一次写入整段（粘贴/expect 批量输入）时 ch 会整串到达——按换行拆分提交，尾段留在输入框
    if (ch.includes('\r') || ch.includes('\n')) {
      const parts = ch.split(/[\r\n]+/)
      inputRef.current += parts[0]
      const submit = () => {
        const v = inputRef.current.trim()
        inputRef.current = ''
        setInput('')
        if (!v) return
        if (v.startsWith('/')) { handleCommand(v); return }
        send(v)
      }
      if (parts[0] !== '' || parts.length > 1) { setInput(inputRef.current); submit() }
      if (parts[1]) { inputRef.current = parts[1]; setInput(inputRef.current) }
      return
    }
    inputRef.current += ch
    setInput(inputRef.current)
  })

  return (
    <Box flexDirection="column">
      <Static items={blocks}>
        {(b, i) => <Block key={`${b.kind}-${i}`} b={b} />}
      </Static>

      {/* 活动区 */}
      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        {live?.thinking && (
          <Text color={DIM} italic>{live.thinking.split('\n').filter(Boolean).slice(-1).join('').slice(-110)}</Text>
        )}
        {live?.text && <Text color={DIM}>{live.text.slice(-600)}</Text>}
        {runningTools.map((t) => (
          <Text key={t.id} color={ACCENT}>
            <Spinner type="dots" /> <Text color={DIM}>{t.label}</Text>
          </Text>
        ))}
        {confirm && <ConfirmBox tool={confirm.tool} />}
      </Box>

      {/* 输入区 */}
      <Box marginTop={1}>
        <Text color={ACCENT} bold>{busy ? '  … ' : '❯ '}</Text>
        <Text color="white">{input}</Text>
        {!busy && <Text color={DIM}>▌</Text>}
      </Box>
      <Box>
        <Text color={DIM}> {model} · {workDir} · /help 命令 · Ctrl+C 退出</Text>
      </Box>
    </Box>
  )
}

/** 由 index.mjs 调用 */
export async function startTui({ info, tools, settings, port }) {
  const resumeId = process.argv.find((a) => a.startsWith('--resume='))?.split('=')[1]
  let initialMessages = []
  let initialSession = null
  if (resumeId) {
    try {
      initialMessages = await loadMessages(resumeId)
      initialSession = { id: resumeId, title: '已恢复' }
    } catch { /* ignore */ }
  }
  // 关键语义：TUI 在哪个文件夹启动就操作哪个文件夹（对齐 Claude Code 的 cwd 行为）
  const cwdSettings = { ...settings, workDir: process.cwd() }
  const sysPrompt = buildTuiSystemPrompt(cwdSettings, info)
  const instance = render(
    <App info={info} tools={tools} settings={cwdSettings} sysPrompt={sysPrompt} port={port}
      initialMessages={initialMessages} initialSession={initialSession} />,
    { exitOnCtrlC: false },
  )
  await instance.waitUntilExit()
}
