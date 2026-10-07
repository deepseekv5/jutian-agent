import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useChat } from '../hooks/useChat'
import { useTheme } from '../hooks/useTheme'
import ChatView from './ChatView'
import MessageInput from './MessageInput'
import ChatSidePanel from './ChatSidePanel'
import WelcomeHero from './WelcomeHero'
import GitPanel from './GitPanel'
import type { Settings } from '../types'

const WD_KEY = 'lyclaw_session_workdirs'
const CP_KEY = 'lyclaw_last_checkpoint'

function loadSessionWorkDirs(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(WD_KEY) || '{}') } catch { return {} }
}

interface Checkpoint { hash: string; label: string; ts: number }

function loadLastCheckpoint(sessionId: string): Checkpoint | null {
  try { return JSON.parse(localStorage.getItem(CP_KEY) || '{}')[sessionId] || null } catch { return null }
}

export default function ChatTab({ sessionId, settings, onTitleGenerated, onAiTitle, onOpenBrowser, onStreamingChange, onModelChange, active, onOpenTab, incomingScreenshot, onScreenshotConsumed }: {
  sessionId: string
  settings: Settings
  onTitleGenerated: (sessionId: string, firstMsg: string) => void
  onAiTitle?: (sessionId: string, title: string) => void
  onOpenBrowser: (url: string) => void
  onStreamingChange?: (sessionId: string, streaming: boolean) => void
  onModelChange?: (model: string) => void
  active: boolean
  onOpenTab?: (type: any) => void
  incomingScreenshot?: string | null
  onScreenshotConsumed?: () => void
}) {
  const { c } = useTheme()
  const [ownWorkDir, setOwnWorkDir] = useState<string>(() => loadSessionWorkDirs()[sessionId] || '')
  const [showPanel, setShowPanel] = useState(false)
  const [panelTab, setPanelTab] = useState<'assistant' | 'review' | 'terminal' | 'browser'>('assistant')

  const chatSettings = useMemo<Settings>(
    () => ({ ...settings, workDir: ownWorkDir || settings.workDir || '' }),
    [settings, ownWorkDir]
  )

  const setSessionWorkDir = useCallback((dir: string) => {
    setOwnWorkDir(dir)
    try {
      const map = loadSessionWorkDirs()
      if (dir) map[sessionId] = dir
      else delete map[sessionId]
      localStorage.setItem(WD_KEY, JSON.stringify(map))
    } catch { /* ignore */ }
  }, [sessionId])

  const browseWorkDir = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.openFolderDialog) return
    const dirs = await api.openFolderDialog()
    if (dirs?.length) setSessionWorkDir(dirs[0])
  }, [setSessionWorkDir])

  const { messages, streamingId, error, send, abort, rollbackTo, editMessage, regenerateMessage } = useChat(sessionId, chatSettings, (firstMsg: string) => onTitleGenerated(sessionId, firstMsg), onAiTitle)
  const sendRef = useRef(send)
  sendRef.current = send
  const lastSendRef = useRef<{ content: string; skillIds?: string[] }>({ content: '' })

  // ─── Git 检查点：每次对话发送前自动快照工作目录，对话后可一键撤销本轮文件更改 ───
  const [lastCheckpoint, setLastCheckpoint] = useState<Checkpoint | null>(() => loadLastCheckpoint(sessionId))
  const [gitBusy, setGitBusy] = useState(false)
  const [gitTip, setGitTip] = useState('')
  const [showGit, setShowGit] = useState(false)
  const [gitRefresh, setGitRefresh] = useState(0)
  useEffect(() => { setLastCheckpoint(loadLastCheckpoint(sessionId)) }, [sessionId])

  const saveCheckpointLocal = useCallback((cp: Checkpoint | null) => {
    try {
      const map = JSON.parse(localStorage.getItem(CP_KEY) || '{}')
      if (cp) map[sessionId] = cp; else delete map[sessionId]
      localStorage.setItem(CP_KEY, JSON.stringify(map))
    } catch { /* ignore */ }
  }, [sessionId])

  const createCheckpointForTurn = useCallback((content: string) => {
    const dir = (ownWorkDir || settings.workDir || '').trim()
    if (!dir) return
    const label = `对话 · ${(content || '').replace(/\s+/g, ' ').slice(0, 30) || new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    fetch('/api/git/checkpoint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, label }) })
      .then(r => r.json())
      .then(r => {
        if (r.success && r.hash) {
          const cp = { hash: r.hash, label, ts: Date.now() }
          setLastCheckpoint(cp); saveCheckpointLocal(cp)
        }
      })
      .catch(() => {})
  }, [ownWorkDir, settings.workDir, saveCheckpointLocal])

  const undoLastTurn = useCallback(async () => {
    if (!lastCheckpoint || gitBusy) return
    const dir = (ownWorkDir || settings.workDir || '').trim()
    if (!dir) return
    if (!confirm('撤销本轮对话对工作区文件的更改？\n\n恢复到本轮开始前的检查点；当前未提交的改动会先自动保底提交（可找回）。')) return
    setGitBusy(true)
    try {
      const r = await fetch('/api/git/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir, hash: lastCheckpoint.hash }) }).then(r => r.json())
      if (r.success) {
        setLastCheckpoint(null); saveCheckpointLocal(null); setGitRefresh(v => v + 1)
        setGitTip('已撤销本轮更改'); setTimeout(() => setGitTip(''), 2600)
      } else { alert('撤销失败：' + (r.error || '未知错误')) }
    } catch { alert('撤销失败：服务不可用') }
    finally { setGitBusy(false) }
  }, [lastCheckpoint, gitBusy, ownWorkDir, settings.workDir, saveCheckpointLocal])

  // 消息队列：流式回复中发送不丢失，排队等待上一条完成自动发出
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [kbSavedTip, setKbSavedTip] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const doExport = useCallback((fmt: 'md' | 'txt' | 'json' | 'kb') => {
    if (messages.length === 0) return
    const date = new Date().toISOString().slice(0, 10)
    if (fmt === 'kb') {
      // 整个会话存为一篇知识库笔记
      const md = messages.map(m => m.role === 'user' ? `## ❯ 用户\n\n${m.content}\n` : `## ● 巨天\n\n${m.content}\n`).join('\n')
      fetch('/api/kb/entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `对话摘录 ${date}`, content: md, tags: ['对话导出'], source: 'ai', notebook: '对话' }),
      }).then(() => { setKbSavedTip(true); setTimeout(() => setKbSavedTip(false), 2200) }).catch(() => {})
      return
    }
    let blob: Blob
    let name: string
    if (fmt === 'json') {
      blob = new Blob([JSON.stringify({ session: sessionId, exported_at: new Date().toISOString(), messages: messages.map(m => ({ role: m.role, content: m.content, created_at: m.created_at })) }, null, 2)], { type: 'application/json;charset=utf-8' })
      name = `巨天对话-${date}.json`
    } else if (fmt === 'txt') {
      const txt = messages.map(m => `${m.role === 'user' ? '【用户】' : '【巨天】'}\n${m.content}\n`).join('\n')
      blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
      name = `巨天对话-${date}.txt`
    } else {
      const md = ['# 对话导出', `> ${new Date().toLocaleString()} · 巨天agent`, '', ...messages.map(m => m.role === 'user' ? `## ❯ 用户\n\n${m.content}\n` : `## ● 巨天\n\n${m.content}\n`)].join('\n')
      blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      name = `巨天对话-${date}.md`
    }
    const a2 = document.createElement('a')
    a2.href = URL.createObjectURL(blob)
    a2.download = name
    a2.click()
    URL.revokeObjectURL(a2.href)
  }, [messages, sessionId])
  const [queue, setQueue] = useState<{ id: string; content: string; skillIds?: string[]; attachedFiles?: any[]; sendOpts?: any }[]>([])
  const queueRef = useRef<{ id: string; content: string; skillIds?: string[]; attachedFiles?: any[]; sendOpts?: any }[]>([])
  const sendingRef = useRef(false)
  const enqueue = useCallback((content: string, skillIds?: string[], attachedFiles?: any[], sendOpts?: any) => {
    const item = { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, content, skillIds, attachedFiles, sendOpts }
    queueRef.current = [...queueRef.current, item]
    setQueue(queueRef.current)
  }, [])
  const removeQueued = useCallback((qid: string) => {
    queueRef.current = queueRef.current.filter(x => x.id !== qid)
    setQueue(queueRef.current)
  }, [])

  const dequeueSend = useCallback(() => {
    if (sendingRef.current) return
    const [next, ...rest] = queueRef.current
    if (!next) return
    queueRef.current = rest
    setQueue(rest)
    sendingRef.current = true
    lastSendRef.current = { content: next.content, skillIds: next.skillIds }
    createCheckpointForTurn(next.content)
    sendRef.current(next.content, next.skillIds, next.attachedFiles, next.sendOpts)
    // send 同步返回后 streamingId 会变；等待流结束由下方 effect 继续发下一条
    setTimeout(() => { sendingRef.current = false }, 300)
  }, [createCheckpointForTurn])

  // 流结束后自动发出队列中的下一条
  useEffect(() => {
    if (streamingId === null && queueRef.current.length > 0) {
      const t = setTimeout(() => dequeueSend(), 250)
      return () => clearTimeout(t)
    }
  }, [streamingId, queue.length, dequeueSend])

  const handleSendQueued = useCallback((content: string, skillIds?: string[], attachedFiles?: any[], sendOpts?: any) => {
    if (streamingId !== null) enqueue(content, skillIds, attachedFiles, sendOpts)
    else {
      lastSendRef.current = { content, skillIds }
      createCheckpointForTurn(content)
      send(content, skillIds, attachedFiles, sendOpts)
    }
  }, [streamingId, enqueue, send, createCheckpointForTurn])

  useEffect(() => {
    onStreamingChange?.(sessionId, streamingId !== null)
  }, [streamingId, sessionId, onStreamingChange])

  const effectiveWorkDir = chatSettings.workDir

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Work dir bar —— 默认极简，仅在悬停时展开操作项（ChatGPT/Codex 的克制感） */}
      <div className="group h-8 flex items-center gap-2 px-4 border-b shrink-0 text-[11px] relative glass" style={{ borderColor: c.borderLight }}>
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.textTertiary }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="font-mono truncate max-w-[45%]" style={{ color: c.textTertiary }} title={effectiveWorkDir}>
          {effectiveWorkDir || '系统默认工作区'}
        </span>
        {ownWorkDir && (
          <span className="px-1.5 py-0.5 rounded text-[9.5px] shrink-0"
            style={{ background: `${c.accent}15`, color: c.accent }}>
            本对话独立
          </span>
        )}
        <span className="flex-1" />
        {gitTip && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full shrink-0" style={{ background: '#d9f2e6', color: '#0b6b4f' }}>{gitTip}</span>
        )}
        {/* 每次对话后可撤销本轮文件更改（Git 检查点） */}
        {lastCheckpoint && streamingId === null && (
          <button onClick={undoLastTurn} disabled={gitBusy}
            className="h-6 px-2 rounded-full flex items-center gap-1 text-[10.5px] font-medium shrink-0 transition-colors disabled:opacity-40"
            style={{ background: `${c.accent}12`, color: c.accent }}
            title={`恢复到本轮开始前的检查点 ${lastCheckpoint.hash}（${lastCheckpoint.label}）`}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5M3.05 13A9 9 0 106 5.3L3 8" />
            </svg>
            {gitBusy ? '撤销中…' : '撤销本轮更改'}
          </button>
        )}
        {kbSavedTip && (
          <span className="text-[10.5px] px-2 py-0.5 rounded-full shrink-0" style={{ background: '#d9f2e6', color: '#0b6b4f' }}>
            已存入知识库（对话 笔记本）
          </span>
        )}
        {/* Git 检查点面板入口 */}
        <button onClick={() => setShowGit(v => !v)}
          className="h-6 px-2 rounded-full flex items-center gap-1 text-[10.5px] font-medium shrink-0 transition-colors"
          style={{ background: showGit ? `${c.accent}12` : c.bgInput, color: showGit ? c.accent : c.textTertiary }}
          title="Git 检查点：状态 / 历史 / 差异 / 回滚">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m-7-9h14" />
          </svg>
          Git
        </button>
        {/* 操作项：悬停显形，功能全保留 */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={browseWorkDir} className="px-2 py-0.5 rounded-md text-[10.5px] font-medium shrink-0"
          style={{ background: c.bgInput, color: c.textTertiary }}>
          选择…
        </button>
        {ownWorkDir && (
          <button onClick={() => setSessionWorkDir('')} className="px-2 py-0.5 rounded-md text-[10.5px] shrink-0"
            style={{ color: c.textMuted }} title="恢复跟随全局">
            重置
          </button>
        )}
        {/* 宽屏模式：加宽正文到 1100px */}
        <button onClick={() => {
          const next = localStorage.getItem('lyclaw_chat_wide') === '1' ? '0' : '1'
          try { localStorage.setItem('lyclaw_chat_wide', next) } catch {}
          window.dispatchEvent(new Event('chat-wide-changed'))
        }}
          className="px-2 py-0.5 rounded-md text-[10.5px] shrink-0"
          style={{ color: localStorage.getItem('lyclaw_chat_wide') === '1' ? c.accent : c.textTertiary }}
          title="宽屏 / 标准 正文宽度切换">
          宽屏
        </button>
        {/* 大纲导航：列出全部用户消息，点击滚动定位 */}
        {messages.length > 3 && (
          <div className="relative">
            <button onClick={() => setShowOutline(v => !v)}
              className="px-2 py-0.5 rounded-md text-[10.5px] shrink-0"
              style={{ color: showOutline ? c.accent : c.textTertiary }} title="对话大纲：快速跳转任意提问">
              大纲
            </button>
            {showOutline && (
              <div className="absolute right-0 top-7 z-40 rounded-lg py-1 shadow-lg w-64 max-h-72 overflow-y-auto scrollbar-thin glass-strong"
                style={{ border: `1px solid ${c.border}` }} onMouseLeave={() => setShowOutline(false)}>
                {messages.map((m, i) => m.role === 'user' ? (
                  <button key={m.id} onClick={() => {
                    setShowOutline(false)
                    const el = document.querySelector(`[data-msg-idx="${i}"]`)
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                    className="w-full text-left px-3 py-1.5 text-[11.5px] truncate transition-colors hover:opacity-70"
                    style={{ color: c.text }} title={m.content}>
                    {i / 2 + 1}. {m.content.replace(/\n/g, ' ').slice(0, 40) || '（空）'}
                  </button>
                ) : null)}
              </div>
            )}
          </div>
        )}
        <button onClick={() => setShowExportMenu(v => !v)} disabled={messages.length === 0}
          className="px-2 py-0.5 rounded-md text-[10.5px] shrink-0 disabled:opacity-30"
          style={{ color: c.textTertiary }} title="导出对话（Markdown / 纯文本 / JSON）">
          导出
        </button>
        </div>
        {showExportMenu && (
          <div className="absolute right-4 top-9 z-30 rounded-lg py-1 shadow-lg w-40 glass-strong"
            style={{ border: `1px solid ${c.border}` }} onMouseLeave={() => setShowExportMenu(false)}>
            {([['md', 'Markdown 文档'], ['txt', '纯文本'], ['json', 'JSON 数据'], ['kb', '存入知识库']] as const).map(([fmt, label]) => (
              <button key={fmt} onClick={() => { doExport(fmt); setShowExportMenu(false) }}
                className="w-full text-left px-3 py-1.5 text-[12px] transition-colors hover:opacity-70"
                style={{ color: fmt === 'kb' ? '#0b6b4f' : c.text }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Main chat column */}
        <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex flex-col min-h-0">
          {messages.length === 0 ? (
            <>
              <WelcomeHero onPick={(text: string) => { setTimeout(() => sendRef.current(text), 100) }} onOpenTab={onOpenTab} />
              <div className="shrink-0">
                <MessageInput
                  sessionId={sessionId}
                  incomingScreenshot={incomingScreenshot}
                  onScreenshotConsumed={onScreenshotConsumed}
                  onSend={handleSendQueued}
                  queueCount={queue.length}
                  currentModel={chatSettings.model}
                  onModelChange={onModelChange}
                  messages={messages}
                  settings={chatSettings}
                />
              </div>
            </>
          ) : (
            <>
              <ChatView
                messages={messages}
                streamingId={streamingId}
                onAbort={abort}
                onQuickSend={(text: string) => { setTimeout(() => sendRef.current(text), 100) }}
                onRegenerate={() => { const { content, skillIds } = lastSendRef.current; if (content) send(content, skillIds) }}
                onRegenerateAt={(idx) => regenerateMessage(idx)}
                onOpenBrowser={onOpenBrowser}
                onRollback={(idx) => rollbackTo(idx)}
                onEditMessage={(idx, text) => editMessage(idx, text)}
              />
              <MessageInput
                sessionId={sessionId}
                incomingScreenshot={incomingScreenshot}
                onScreenshotConsumed={onScreenshotConsumed}
                onSend={handleSendQueued}
                queueCount={queue.length}
                queueItems={queue}
                onRemoveQueued={removeQueued}
                currentModel={chatSettings.model}
                onModelChange={onModelChange}
                messages={messages}
                settings={chatSettings}
              />
            </>
          )}
          {error && (
            <div className="px-6 py-2 text-xs shrink-0" style={{ color: '#ef4444' }}>{error}</div>
          )}
        </div>
        </div>

        {/* Side panel toggle —— 默认极淡，悬停显形（ChatGPT 风格克制的边缘控件） */}
        <button
          onClick={() => setShowPanel(v => !v)}
          className="group/panel w-6 shrink-0 flex flex-col items-center justify-center gap-2 border-l transition-colors"
          style={{ borderColor: c.borderLight, background: showPanel ? `${c.accent}10` : 'transparent' }}
          title={showPanel ? '收起面板' : '打开辅助面板（对话/审查/终端/浏览器）'}>
          <svg className="w-3.5 h-3.5 opacity-25 group-hover/panel:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
            style={{ color: showPanel ? c.accent : c.textMuted, transform: showPanel ? 'rotate(180deg)' : 'none', transition: 'transform .2s, opacity .15s' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-3 3 3 3m8 0h3M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
          </svg>
          {!showPanel && (
            <div className="flex flex-col items-center gap-2 opacity-0 group-hover/panel:opacity-100 transition-opacity">
              <MiniDot label="辅" active={panelTab === 'assistant'} onClick={(e) => { e.stopPropagation(); setShowPanel(true); setPanelTab('assistant') }} />
              <MiniDot label="审" active={panelTab === 'review'} onClick={(e) => { e.stopPropagation(); setShowPanel(true); setPanelTab('review') }} />
              <MiniDot label="端" active={panelTab === 'terminal'} onClick={(e) => { e.stopPropagation(); setShowPanel(true); setPanelTab('terminal') }} />
              <MiniDot label="浏" active={panelTab === 'browser'} onClick={(e) => { e.stopPropagation(); setShowPanel(true); setPanelTab('browser') }} />
            </div>
          )}
        </button>

        {/* Side panel */}
        {showPanel && (
          <div className="w-[340px] shrink-0 min-h-0">
            <ChatSidePanel workDir={effectiveWorkDir} mainMessages={messages} settings={chatSettings} />
          </div>
        )}

        {/* Git 检查点面板 */}
        {showGit && (
          <div className="w-[340px] shrink-0 min-h-0 border-l" style={{ borderColor: c.border }}>
            <GitPanel workDir={effectiveWorkDir} onClose={() => setShowGit(false)} refreshSignal={gitRefresh} />
          </div>
        )}
      </div>
    </div>
  )
}

function MiniDot({ label, active, onClick }: { label: string; active: boolean; onClick: (e: React.MouseEvent) => void }) {
  const { c } = useTheme()
  return (
    <button onClick={onClick}
      className="w-4 h-4 rounded text-[8px] font-medium flex items-center justify-center transition-colors"
      style={{ background: active ? c.accent : c.bgInput, color: active ? '#fff' : c.textTertiary }}>
      {label}
    </button>
  )
}
