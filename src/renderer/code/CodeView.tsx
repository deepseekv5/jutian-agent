// Code mode main container
import { useState, useEffect, useCallback, useRef } from 'react'
import FileTree from './FileTree'
import CodeEditor, { stepEditorFont } from './CodeEditor'
import ChatPanel from './ChatPanel'
import CodeSearchPanel from './CodeSearchPanel'
import TerminalPanel from './TerminalPanel'
import MarkdownPreview from './MarkdownPreview'
import QuickOpenPanel from './QuickOpenPanel'
import SnippetPanel from './SnippetPanel'
import NewProjectDialog from './NewProjectDialog'
import WelcomePage from './WelcomePage'
import GitPanel from '../chat/GitPanel'
import { useCodeProject } from '../hooks/useCodeProject'
import { useTheme } from '../hooks/useTheme'
import type { CodeProject, AICompletionEvent, FollowTarget, ChangedLine, FileChangeInfo, GitStatusData, SearchResult } from '../types/code'
import * as CS from '../store/codeStorage'
import type { Settings } from '../types'

// Runnable file types
const RUNNABLE_EXTS = new Set(['sh', 'js', 'mjs', 'cjs', 'py', 'bash', 'zsh', 'rb', 'pl', 'php', 'ts', 'go'])

interface Props {
  settings: Settings
  onBack: () => void
}

// Codex 式图标工具栏按钮（模块级：避免内联组件每次渲染重挂载）
const TBtn = ({ icon, label, title, active, onClick, c, dirty }: { icon?: string; label?: string; title: string; active?: boolean; onClick: () => void; c: any; dirty?: boolean }) => (
  <button onClick={onClick} title={title} aria-label={title}
    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0"
    style={{ color: active || dirty ? c.accent : c.textTertiary, background: active ? c.accentBg : 'transparent' }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.bgHover }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
    {icon
      ? <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
      : <span className="text-[9px] font-bold">{label}</span>}
  </button>
)

export default function CodeView({ settings, onBack }: Props) {
  const { c } = useTheme()
  const code = useCodeProject()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false)
  const [runOutput, setRunOutput] = useState<string | null>(null)
  const [runError, setRunError] = useState(false)
  const [running, setRunning] = useState(false)
  const [showOutput, setShowOutput] = useState(false)
  const runIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [fileTreeWidth, setFileTreeWidth] = useState(224) // w-56 = 224px
  const [chatPanelWidth, setChatPanelWidth] = useState(320) // w-80 = 320px
  const [aiCompletionEvents, setAICompletionEvents] = useState<AICompletionEvent[]>([])
  const [followMode, setFollowMode] = useState(false)
  const [followTarget, setFollowTarget] = useState<FollowTarget | null>(null)
  const [highlightLines, setHighlightLines] = useState<number[]>([])
  const [scrollTargetLine, setScrollTargetLine] = useState<number | undefined>(undefined)
  const [changedLinesMap, setChangedLinesMap] = useState<Record<string, ChangedLine[]>>({})
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // New panel state
  const [showSearch, setShowSearch] = useState(false)
  const [searchInitial, setSearchInitial] = useState('')
  const [showTerminal, setShowTerminal] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  // Git 一键提交
  const [showGitCommit, setShowGitCommit] = useState(false)
  // 编辑器字号显示值
  const [fontPx, setFontPx] = useState(() => parseInt(localStorage.getItem('lyclaw_editor_font') || '13', 10) || 13)
  // 项目代码统计
  const [showStats, setShowStats] = useState(false)
  const [codeStats, setCodeStats] = useState<any>(null)
  const [codeStatsLoading, setCodeStatsLoading] = useState(false)
  useEffect(() => {
    if (!showStats || !code.activeProject || codeStats) return
    setCodeStatsLoading(true)
    fetch(`/api/code/stats?root=${encodeURIComponent(code.activeProject.rootPath)}`)
      .then(r => r.json()).then(d => { if (d.success) setCodeStats(d) }).catch(() => {})
      .finally(() => setCodeStatsLoading(false))
  }, [showStats, code.activeProject, codeStats])
  const [gitCommitMsg, setGitCommitMsg] = useState('')
  const [gitCommitting, setGitCommitting] = useState(false)
  const [showGitPanel, setShowGitPanel] = useState(false)
  const [gitCommitResult, setGitCommitResult] = useState('')

  // Restore last active project
  useEffect(() => {
    const activeId = CS.getActiveProjectId()
    if (activeId && code.projects.find(p => p.id === activeId)) {
      code.setActiveProjectId(activeId)
    }
  }, [code.projects])

  const handleBack = useCallback(() => {
    onBack()
  }, [onBack])

  const handleFollowTarget = useCallback((target: FollowTarget) => {
    setFollowTarget(target)
  }, [])

  // Handle followTarget: auto open file, jump to line, highlight
  useEffect(() => {
    if (!followTarget || !followMode) return

    // Clear previous highlight timer
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }

    // OpenFile
    const fileName = followTarget.filePath.split('/').pop() || followTarget.filePath
    code.openFile(followTarget.filePath, fileName)

    // Set scroll and highlight
    if (followTarget.line) {
      setScrollTargetLine(followTarget.line)
      setHighlightLines(followTarget.highlightLines || [followTarget.line])

      // Clear highlight after 3.5s
      highlightTimerRef.current = setTimeout(() => {
        setHighlightLines([])
        setScrollTargetLine(undefined)
      }, 3500)
    } else {
      setScrollTargetLine(undefined)
      setHighlightLines([])
    }

    setFollowTarget(null)
  }, [followTarget, followMode, code.openFile])

  // Handle AI file change highlight
  const handleFileChanged = useCallback((info: FileChangeInfo) => {
    setChangedLinesMap(prev => ({
      ...prev,
      [info.filePath]: info.lines,
    }))
  }, [])

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    }
  }, [])

  const activeTabExt = code.activeTab?.path?.split('.').pop()?.toLowerCase() || ''
  const isRunnable = RUNNABLE_EXTS.has(activeTabExt)

  const handleRun = useCallback(async () => {
    if (!code.activeTab || running) return
    setRunning(true)
    setShowOutput(true)
    setRunOutput(null)
    setRunError(false)
    try {
      const r = await fetch('/api/code/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: code.activeTab.path,
          cwd: code.activeProject?.rootPath || '',
        }),
      })
      const data = await r.json()
      runIdRef.current = data.runId
      // Poll run status
      pollRef.current = setInterval(async () => {
        if (!runIdRef.current) return // Already stopped
        try {
          const s = await fetch(`/api/code/run/status?runId=${runIdRef.current}`)
          const status = await s.json()
          if (status.status !== 'running') {
            clearInterval(pollRef.current!)
            pollRef.current = null
            runIdRef.current = null
            setRunning(false)
            if (status.status === 'killed') {
              setRunOutput('进程已终止')
              setRunError(false)
            } else {
              const out = [status.stdout, status.stderr ? `\n[stderr]\n${status.stderr}` : ''].filter(Boolean).join('\n')
              setRunOutput(out || '(无输出)')
              setRunError(status.status !== 'success')
            }
          }
        } catch {
          // Ignore polling error
        }
      }, 500)
    } catch (e: any) {
      setRunOutput(e.message || '执行失败')
      setRunError(true)
      setRunning(false)
    }
  }, [code.activeTab, code.activeProject?.rootPath, running])

  const handleStop = useCallback(async () => {
    const id = runIdRef.current
    if (!id) return
    try {
      await fetch('/api/code/run/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: id }),
      })
    } catch {}
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    runIdRef.current = null
    setRunning(false)
    setRunOutput('Process terminated')
    setRunError(false)
  }, [])

  // ====== Tab management ======

  const handleCloseOtherTabs = useCallback((path: string) => {
    const otherPaths = code.tabs.filter(t => t.path !== path).map(t => t.path)
    otherPaths.forEach(p => code.closeTab(p))
  }, [code.tabs, code.closeTab])

  const handleCloseRightTabs = useCallback((path: string) => {
    const idx = code.tabs.findIndex(t => t.path === path)
    if (idx === -1) return
    const rightPaths = code.tabs.slice(idx + 1).map(t => t.path)
    rightPaths.forEach(p => code.closeTab(p))
  }, [code.tabs, code.closeTab])

  const handleCloseAllTabs = useCallback(() => {
    code.tabs.map(t => t.path).forEach(p => code.closeTab(p))
  }, [code.tabs, code.closeTab])

  // ====== Markdown preview toggle ======

  const handleToggleMarkdownPreview = useCallback(() => {
    setMarkdownPreview(v => !v)
  }, [])

  // ====== Git 状态 ======

  const fetchGitStatus = useCallback(async () => {
    if (!code.activeProject) return
    setGitLoading(true)
    try {
      const r = await fetch(`/api/code/git-status?cwd=${encodeURIComponent(code.activeProject.rootPath)}`)
      if (r.ok) {
        const data = await r.json()
        setGitStatus(data)
      }
    } catch { /* git not available */ }
    setGitLoading(false)
  }, [code.activeProject])

  useEffect(() => {
    if (code.activeProject) fetchGitStatus()
  }, [code.activeProject, fetchGitStatus])
  const loadGitStatus = fetchGitStatus

  // ====== Global shortcuts ======

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.shiftKey && e.key === 'f') { e.preventDefault(); setShowSearch(v => !v); return }
      if (mod && e.key === 'p') { e.preventDefault(); setShowQuickOpen(v => !v); return }
      if (mod && e.key === 'b') { e.preventDefault(); setSidebarCollapsed(v => !v); return }
      if (mod && e.key === '`') { e.preventDefault(); setShowTerminal(v => !v); return }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (!code.activeProjectId || !code.activeProject) {
    return (
      <WelcomePage
        projects={code.projects}
        onOpenProject={(id) => code.setActiveProjectId(id)}
        onDeleteProject={code.removeProject}
        onCreateProject={(name, path, openFile) => code.createProject(name, path, openFile)}
        onBack={handleBack}
      />
    )
  }

  // Active project view
  const project = code.activeProject! // guard checked above

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: c.bg }}>
      {/* Top bar */}
      <div className="h-10 flex items-center px-3 shrink-0 border-b gap-2 glass" style={{ borderColor: c.border }}>
          <button
          onClick={handleBack}
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors btn-liquid"
          style={{ color: c.textTertiary }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: c.textHead }}>{project.name}</span>
          <span className="text-[10px] hidden sm:inline" style={{ color: c.textMuted }}>{project.rootPath}</span>
        </div>

        <div className="flex-1" />

        {/* Project switcher button */}
        <div className="relative">

            <button
            onClick={() => setShowProjectSwitcher(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors btn-liquid"
            style={{ color: c.textTertiary }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            切换项目
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showProjectSwitcher && (
            <div
              className="absolute right-0 top-full mt-1 w-64 rounded-xl shadow-lg p-2 z-50 space-y-1 btn-liquid"
              style={{ background: c.modalBg, border: `1px solid ${c.border}` }}
            >
              {code.projects.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  isActive={p.id === code.activeProjectId}
                  onOpen={() => { code.setActiveProjectId(p.id); setShowProjectSwitcher(false) }}
                  onDelete={() => code.removeProject(p.id)}
                  c={c}
                />
              ))}

                <button
                onClick={() => { setShowNewProject(true); setShowProjectSwitcher(false) }}
                className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-colors flex items-center gap-2 btn-liquid"
                style={{ color: c.accent }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                NewProject
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content: FileTree | Editor | ChatPanel */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Tree */}
        {!sidebarCollapsed && (
        <div className="shrink-0 border-r flex flex-col glass" style={{ width: fileTreeWidth, borderColor: c.border }}>
          <div className="flex-1 overflow-hidden">
            <FileTree
              nodes={code.fileTree}
              onSelectFile={code.openFile}
              loading={code.treeLoading}
              onRefresh={code.refreshTree}
              selectedPath={followTarget?.filePath}
              projectRoot={project.rootPath}
              onCreateFile={code.createFile}
              gitStatus={gitStatus}
              gitLoading={gitLoading}
            />
          </div>
          {/* Quick button to open project in Finder */}
          <div className="px-2 pb-2">

              <button
              onClick={() => {
                fetch('/api/open-finder?path=' + encodeURIComponent(project.rootPath)).catch(() => {})
              }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] transition-colors btn-liquid"
              style={{ color: c.textMuted }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Open in Finder
            </button>
          </div>
        </div>
        )}

        {/* Resize Handle: FileTree | Editor */}
        {!sidebarCollapsed && (
        <ResizeHandle onResize={delta => setFileTreeWidth(w => Math.max(140, Math.min(500, w + delta)))} c={c} />
        )}

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor Toolbar — Codex 极简图标栏 */}
          <div className="h-9 flex items-center px-2 gap-0.5 border-b glass relative" style={{ borderColor: c.borderLight }}>
            <span className="text-[10.5px] font-mono truncate max-w-[220px] shrink-0" style={{ color: c.textMuted }} title={code.activeTab?.path}>
              {code.activeTab ? (code.activeTab.modified ? '● ' : '') + (code.activeTab.path.split('/').pop() || '') : '未打开文件'}
            </span>
            <div className="flex-1" />
            <TBtn c={c} title="搜索 (Cmd+Shift+F)" active={showSearch && !searchInitial} onClick={() => { setSearchInitial(''); setShowSearch(v => !v) }} icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            <TBtn c={c} title="TODO / FIXME 扫描" active={showSearch && !!searchInitial} onClick={() => { setSearchInitial('TODO|FIXME'); setShowSearch(true) }} label="TODO" />
            <TBtn c={c} title="终端 (Cmd+`)" active={showTerminal} onClick={() => setShowTerminal(v => !v)} icon="M8 9l3 3-3 3m5 0h3M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
            <TBtn c={c} title="代码片段" active={showSnippets} onClick={() => setShowSnippets(v => !v)} icon="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5L8 13.8 2 9.2h7.6z" />
            <TBtn c={c} title="Git 检查点（可回滚）" active={showGitPanel} onClick={() => setShowGitPanel(v => !v)} icon="M12 3v18m-7-9h14" />
            <div className="w-px h-4 mx-1 shrink-0" style={{ background: c.borderLight }} />
            <TBtn c={c} title={followMode ? 'Follow mode 开启' : 'Follow mode 关闭'} active={followMode} onClick={() => setFollowMode(v => !v)} icon="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            <TBtn c={c} title="保存全部 (Cmd+S)" dirty={code.tabs.some(t => t.modified)} onClick={async () => { for (const t of code.tabs.filter(t => t.modified)) await code.saveFile(t.path) }} icon="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            <TBtn c={c} title="项目代码统计" active={showStats} onClick={() => setShowStats(v => !v)} icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 00 012-2v10a2 2 0 01-2 2h-2a2 2 0 01-2-2zM13 8a2 2 0 012-2h2a2 2 0 012 2v10a2 2 0 01-2 2h-2a2 2 0 01-2-2V8z" />
            <TBtn c={c} title="Git 提交" active={showGitCommit} onClick={() => setShowGitCommit(v => !v)} icon="M5 13l4 4L19 7" />
            <div className="flex items-center rounded-full ml-1 shrink-0" style={{ background: c.bgInput }}>
              <button onClick={() => setFontPx(stepEditorFont(-1))} className="w-6 h-6 flex items-center justify-center text-[10px] rounded-l-full" style={{ color: c.textTertiary }} title="减小字号 (Cmd+-)">A−</button>
              <span className="text-[9px] font-mono w-5 text-center" style={{ color: c.textMuted }}>{fontPx}</span>
              <button onClick={() => setFontPx(stepEditorFont(1))} className="w-6 h-6 flex items-center justify-center text-[10px] rounded-r-full" style={{ color: c.textTertiary }} title="增大字号 (Cmd+=)">A+</button>
            </div>

            {/* 统计浮层 */}
            {showStats && (
              <div className="absolute right-2 top-10 z-40 rounded-xl border shadow-lg p-3 w-64 glass-strong" style={{ borderColor: c.border }}>
                <div className="text-[11.5px] font-medium mb-2" style={{ color: c.textHead }}>项目代码统计</div>
                {!codeStats ? (
                  <div className="text-[11px] py-2" style={{ color: c.textTertiary }}>{codeStatsLoading ? '统计中…' : '暂无数据'}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {[{ l: '文件', v: codeStats.files }, { l: '行数', v: (codeStats.lines / 1000).toFixed(1) + 'k' }, { l: '大小', v: codeStats.sizeMb + 'MB' }].map(x => (
                        <div key={x.l} className="rounded-lg px-2 py-1.5 text-center" style={{ background: c.bgInput }}>
                          <div className="text-[13px] font-semibold" style={{ color: c.textHead }}>{x.v}</div>
                          <div className="text-[9.5px]" style={{ color: c.textTertiary }}>{x.l}</div>
                        </div>
                      ))}
                    </div>
                    {codeStats.languages.map((l: any) => (
                      <div key={l.name} className="flex items-center gap-2 py-0.5">
                        <span className="text-[10.5px] w-16 truncate" style={{ color: c.textSecondary }}>{l.name}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: c.bgInput }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max(3, (l.lines / codeStats.lines) * 100)}%`, background: c.accent, opacity: 0.75 }} />
                        </div>
                        <span className="text-[9.5px] font-mono w-10 text-right" style={{ color: c.textTertiary }}>{l.lines}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* 提交浮层 */}
            {showGitCommit && (
              <div className="absolute right-2 top-10 z-40 rounded-xl border shadow-lg p-2.5 w-64 glass-strong" style={{ borderColor: c.border }}>
                <div className="text-[11.5px] font-medium mb-1.5" style={{ color: c.textHead }}>提交到 Git</div>
                <input value={gitCommitMsg} onChange={e => setGitCommitMsg(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && gitCommitMsg.trim()) {
                      setGitCommitting(true)
                      try {
                        const r = await fetch('/api/code/git-commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: project.rootPath, message: gitCommitMsg.trim() }) }).then(r => r.json())
                        setGitCommitResult(r.success ? `已提交 ${r.summary || ''}` : (r.error || '提交失败'))
                        if (r.success) { setGitCommitMsg(''); setShowGitCommit(false) }
                      } catch (err: any) { setGitCommitResult(err.message) }
                      setGitCommitting(false)
                    }
                  }}
                  placeholder={gitCommitting ? '提交中…' : '提交信息（回车提交）'} disabled={gitCommitting}
                  className="w-full h-8 px-2.5 rounded-lg text-[12px] outline-none disabled:opacity-50"
                  style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }} />
                {gitCommitResult && <div className="text-[10.5px] mt-1.5" style={{ color: c.textTertiary }}>{gitCommitResult}</div>}
                <div className="text-[10px] mt-1.5" style={{ color: c.textMuted }}>将暂存项目内全部改动（git add -A）</div>
              </div>
            )}
          </div>

          <CodeEditor
            tab={code.activeTab}
            tabs={code.tabs}
            activeTabPath={code.activeTabPath}
            onSelectTab={(path: string) => {
              const name = path.split('/').pop() || path
              code.openFile(path, name)
            }}
            onCloseTab={code.closeTab}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseRightTabs={handleCloseRightTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onContentChange={(path, content) => {
              code.updateContent(path, content)
              // 用户手动Edit时清除 diff 高亮
              setChangedLinesMap(prev => {
                if (!prev[path]) return prev
                const next = { ...prev }
                delete next[path]
                return next
              })
            }}
            onSaveFile={code.saveFile}
            isRunnable={isRunnable}
            onRun={handleRun}
            onStop={handleStop}
            running={running}
            saving={code.saving}
            modified={!!code.activeTab?.modified}
            settings={settings}
            onAICompletionEvent={(event) => setAICompletionEvents(prev => [...prev, event])}
            highlightLines={highlightLines}
            scrollTargetLine={scrollTargetLine}
            changedLines={changedLinesMap[code.activeTab?.path || '']}
            showMarkdownPreview={markdownPreview}
            onToggleMarkdownPreview={handleToggleMarkdownPreview}
          />
          {/* Markdown Preview */}
          {markdownPreview && code.activeTab?.name?.endsWith('.md') && code.activeTab.content && (
            <div className="border-t flex-1 min-h-0" style={{ borderColor: c.borderLight }}>
              <div className="flex h-full">
                <div className="flex-1 min-w-0 relative">
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="p-4 h-full overflow-auto" style={{ background: c.bg }}>
                      <MarkdownPreview content={code.activeTab.content} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Output Panel */}
          {showOutput && (
            <div className="border-t" style={{ borderColor: c.borderLight }}>
              <div className="h-7 flex items-center justify-between px-3" style={{ background: c.bgCard }}>
                <span className="text-[10px] font-medium" style={{ color: c.textMuted }}>Run output</span>

                  <button
                  onClick={() => setShowOutput(false)}
                  className="w-5 h-5 rounded flex items-center justify-center btn-liquid"
                  style={{ color: c.textMuted }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="h-32 overflow-auto p-3" style={{ background: c.bg }}>
                {running ? (
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: c.textMuted }}>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    运行中...
                  </div>
                ) : (
                  <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono" style={{
                    color: runError ? c.toolErr : c.text,
                    fontFamily: "'SF Mono', Menlo, monospace",
                  }}>
                    {runOutput || '(无输出)'}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Resize Handle: Editor | ChatPanel */}
        <ResizeHandle onResize={delta => setChatPanelWidth(w => Math.max(200, Math.min(600, w - delta)))} c={c} reverse />

        {/* Chat Panel */}
        <div className="shrink-0" style={{ width: chatPanelWidth }}>
          <ChatPanel
          onFileMutated={(p: string) => { code.reloadFile(p) }}
            activeTab={code.activeTab}
            projectName={project.name}
            projectRoot={project.rootPath}
            settings={settings}
            aiCompletionEvents={aiCompletionEvents}
            followMode={followMode}
            onFollowTarget={handleFollowTarget}
            onFileChanged={handleFileChanged}
            fileTree={code.fileTree}
          />
        </div>

        {/* Git 检查点面板 */}
        {showGitPanel && (
          <div className="shrink-0 border-l" style={{ width: 300, borderColor: c.border }}>
            <GitPanel workDir={project.rootPath} onClose={() => setShowGitPanel(false)} />
          </div>
        )}
      </div>

      {showNewProject && (
        <NewProjectDialog onClose={() => setShowNewProject(false)} onCreateProject={code.createProject} />
      )}

      {/* 全局搜索面板 */}
      {showSearch && (
        <div className="border-t" style={{ borderColor: c.borderLight }}>
          <CodeSearchPanel
            projectRoot={project.rootPath}
            initialKeyword={searchInitial}
            onOpenFile={(filePath: string, name: string) => {
              code.openFile(filePath, name)
            }}
            onClose={() => setShowSearch(false)}
          />
        </div>
      )}

      {/* Terminal Panel */}
      {showTerminal && (
        <div className="border-t" style={{ borderColor: c.borderLight }}>
          <TerminalPanel
            cwd={project.rootPath}
          />
        </div>
      )}

      {/* Quick open panel */}
      {showQuickOpen && (
        <QuickOpenPanel
          fileTree={code.fileTree}
          projectRoot={project.rootPath}
          onOpenFile={(filePath: string, name: string) => {
            code.openFile(filePath, name)
          }}
          onClose={() => setShowQuickOpen(false)}
        />
      )}

      {/* Code snippet panel */}
      {showSnippets && (
        <div className="border-t" style={{ borderColor: c.borderLight }}>
          <SnippetPanel
            onInsert={(snippetCode: string) => {
              const tab = code.activeTab
              if (tab) {
                code.updateContent(tab.path, tab.content + '\n' + snippetCode)
              }
            }}
            onClose={() => setShowSnippets(false)}
          />
        </div>
      )}
    </div>
  )
}

function ResizeHandle({ onResize, c, reverse = false }: { onResize: (delta: number) => void; c: any; reverse?: boolean }) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const [hover, setHover] = useState(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - startX.current
      startX.current = ev.clientX
      onResize(reverse ? -delta : delta)
    }
    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [onResize, reverse])

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-1.5 shrink-0 cursor-col-resize relative flex items-center justify-center group"
      style={{
        background: hover ? `${c.accent}40` : 'transparent',
        transition: 'background 0.15s ease',
      }}
    >
      <div
        className="w-0.5 h-8 rounded-full transition-opacity"
        style={{
          background: hover ? c.accent : c.borderLight,
          opacity: hover ? 1 : 0.5,
        }}
      />
    </div>
  )
}

function ProjectCard({ project, isActive, onOpen, onDelete, c }: {
  project: CodeProject
  isActive: boolean
  onOpen: () => void
  onDelete: () => void
  c: any
}) {
  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors group btn-liquid"
      style={{
        background: isActive ? c.accentBg : 'transparent',
        border: isActive ? `1px solid ${c.accentBorder}` : '1px solid transparent',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = c.bgHover }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.accent }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate" style={{ color: c.text }}>{project.name}</div>
        <div className="text-[10px] truncate" style={{ color: c.textMuted }}>{project.rootPath}</div>
      </div>

        <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 btn-liquid"
        style={{ color: c.textMuted }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
