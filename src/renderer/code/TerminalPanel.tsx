// Terminal Panel
import { useState, useRef, useCallback, useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'

interface Props {
  cwd?: string
}

interface HistoryEntry {
  command: string
  output: string
  error: boolean
}

export default function TerminalPanel({ cwd }: Props) {
  const { c } = useTheme()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [input, setInput] = useState('')
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Command history（仅已提交的命令）
  const commandHistory = useRef<string[]>([])

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight)
  }, [history])

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim() || running) return
    commandHistory.current.push(cmd)
    setHistoryIdx(-1)
    setRunning(true)
    setInput('')
    try {
      const res = await fetch('/api/code/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, cwd }),
      })
      const data = await res.json()
      const output = data.success
        ? (data.stdout || '') + (data.stderr ? '\n' + data.stderr : '')
        : (data.error || '执行失败')
      setHistory(prev => [...prev, { command: cmd, output: output || '(无输出)', error: !data.success }])
    } catch {
      setHistory(prev => [...prev, { command: cmd, output: '请求失败', error: true }])
    }
    finally { setRunning(false) }
  }, [cwd, running])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand(input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const h = commandHistory.current
      if (h.length === 0) return
      const next = historyIdx < h.length - 1 ? historyIdx + 1 : h.length - 1
      setHistoryIdx(next)
      setInput(h[h.length - 1 - next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx <= 0) {
        setHistoryIdx(-1)
        setInput('')
        return
      }
      const next = historyIdx - 1
      setHistoryIdx(next)
      setInput(commandHistory.current[commandHistory.current.length - 1 - next])
    }
  }, [input, historyIdx, executeCommand])

  const handleClick = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col h-full" style={{ background: '#0d1117' }} onClick={handleClick}>
      {/* Fake title bar */}
      <div className="h-7 flex items-center px-3 gap-2 shrink-0" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#f85149' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#d29922' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#3fb950' }} />
        </div>
        <span className="text-[10px] ml-2" style={{ color: '#8b949e' }}>Terminal — {cwd ? (cwd.split('/').pop() || cwd) : '默认目录'}</span>
        <div className="flex-1" />
        <button onClick={() => navigator.clipboard.writeText(history.map(h => `$ ${h.command}\n${h.output}`).join('\n\n')).catch(() => {})}
          className="text-[10px] px-1.5 hover:text-white transition-colors" style={{ color: '#8b949e' }} title="复制全部输出">复制</button>
        <button onClick={() => setHistory([])}
          className="text-[10px] px-1.5 hover:text-white transition-colors" style={{ color: '#8b949e' }} title="清屏">清屏</button>
        <span className="text-[9px]" style={{ color: '#484f58' }}>zsh</span>
      </div>

      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px]">
        {history.length === 0 && (
          <div style={{ color: '#484f58' }}>
            Enter command (ls, cd, git, npm, node...) | Up/down arrows for history
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} className="mb-1">
            <div className="flex items-center gap-1.5">
              <span style={{ color: '#3fb950' }}>$</span>
              <span style={{ color: '#e6edf3' }}>{h.command}</span>
            </div>
            <pre className="whitespace-pre-wrap break-all text-[11px] mt-0.5 mb-1 leading-relaxed"
              style={{ color: h.error ? '#f85149' : '#c9d1d9' }}>
              {h.output}
            </pre>
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border rounded-full animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#58a6ff' }} />
            <span className="text-[11px]" style={{ color: '#8b949e' }}>运行中...</span>
          </div>
        )}
      </div>

      {/* Input line */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0" style={{ borderTop: '1px solid #30363d' }}>
        <span style={{ color: '#3fb950', fontFamily: 'monospace', fontSize: '12px' }}>$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入命令..."
          className="flex-1 bg-transparent border-none outline-none text-[12px] font-mono"
          style={{ color: '#e6edf3' }}
          disabled={running}
        />
      </div>
    </div>
  )
}
