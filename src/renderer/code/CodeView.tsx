// Code mode main container — v9 重写版
//
// 布局原则(结构上杜绝重叠):
//   ┌ top bar ─────────────────────────────────────┐
//   │ rail │ sidebar槽 │ editor列 ├ bottom drawer │ chat │
//   └──────────────────────────────────────────────┘
//   - 左侧活动栏(rail)里的每个按钮对应一个**唯一**的面板槽:
//     文件树 / 搜索 / 片段 / Git / 统计 —— 同一时刻至多一个,互不覆盖
//   - 终端与运行输出共用**底部抽屉**(互斥),不再推挤主布局
//   - 快速打开(⌘P)是唯一允许的浮层(模态语义,一击即走)
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
import GitPanel from '../chat/GitPanel'
import WelcomePage from './WelcomePage'
import { useCodeProject } from '../hooks/useCodeProject'
import { useTheme } from '../hooks/useTheme'
import type { CodeProject, AICompletionEvent, FollowTarget, ChangedLine, FileChangeInfo, GitStatusData, SearchResult } from '../types/code'
import * as CS from '../store/codeStorage'
import type { Settings } from '../types'

// Runnable file types
const RUNNABLE_EXTS = new Set(['sh', 'js', 'mjs', 'cjs', 'py', 'bash', 'zsh', 'rb', 'pl', 'php', 'ts', 'go'])

/** 左侧活动栏槽位(互斥,一次只开一个) */
type SidePanel = 'files' | 'search' | 'todo' | 'snippets' | 'git' | 'stats' | null
/** 底部抽屉(互斥) */
type BottomPanel = 'terminal' | 'output' | null

interface Props {
  settings: Settings
  onBack: () => void
}

// 活动栏按钮(模块级:避免内联组件每次渲染重挂载)
const RailBtn = ({ icon, label, title, active, onClick, c }: {
  icon: string; label?: string; title: string; active?: boolean; onClick: () => void; c: any
}) => (
  <button onClick={onClick} title={title} aria-label={title}
    className="w-9 h-9 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors shrink-0"
    style={{ color: active ? c.accent : c.textTertiary, background: active ? c.accentBg : 'transparent' }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.bgHover }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
    {label && <span className="text-[8px] leading-none">{label}</span>}
  </button>
)

// 编辑器工具条小按钮
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
  // 运行
  const [runOutput, setRunOutput] = useState<string | null>(null)
  const [runError, setRunError] = useState(false)
  const [running, setRunning] = useState(false)
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null)
  const runIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 布局
  const [fileTreeWidth, setFileTreeWidth] = useState(224)
  const [chatPanelWidth, setChatPanelWidth] = useState(320)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const prevChatW = useRef(320)
  const [sidePanel, setSidePanel] = useState<SidePanel>('files')
  // AI 联动
  const [aiCompletionEvents, setAICompletionEvents] = useState<AICompletionEvent[]>([])
  const [followMode, setFollowMode] = useState(false)
  const [followTarget, setFollowTarget] = useState<FollowTarget | null>(null)
  const [highlightLines, setHighlightLines] = useState<number[]>([])
  const [scrollTargetLine, setScrollTargetLine] = useState<number | undefined>(undefined)
  const [changedLinesMap, setChangedLinesMap] = useState<Record<string, ChangedLine[]>>({})
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchInitial, setSearchInitial] = useState('')
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitCommitMsg, setGitCommitMsg] = useState('')
  const [gitCommitting, setGitCommitting] = useState(false)
  const [gitCommitResult, setGitCommitResult] = useState('')
  const [fontPx, setFontPx] = useState(() => parseInt(localStorage.getItem('lyclaw_editor_font') || '13', 10) || 13)
  const [showStats, setShowStats] = useState(false)
  const [codeStats, setCodeStats] = useState<any>(null)
  const [codeStatsLoading, setCodeStatsLoading] = useState(false)

  // Restore last active project
  useEffect(() => {
    const activeId = CS.getActiveProjectId()
    if (activeId && code.projects.find(p => p.id === activeId)) {
      code.setActiveProjectId(activeId)
    }
  }, [code.projects])

  const handleBack = useCallback(() => { onBack() }, [onBack])
  const handleFollowTarget = useCallback((target: FollowTarget) => { setFollowTarget(target) }, [])

  // Follow mode: AI 提到文件 → 打开 + 跳行 + 高亮
  useEffect(() => {
    if (!followTarget || !followMode) return
    if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null }
    const fileName = followTarget.filePath.split('/').pop() || followTarget.filePath
    code.openFile(followTarget.filePath, fileName)
    if (followTarget.line) {
      setScrollTargetLine(followTarget.line)
      setHighlightLines(followTarget.highlightLines || [followTarget.line])
      highlightTimerRef.current = setTimeout(() => {
        setHighlightLines([]); setScrollTargetLine(undefined)
      }, 3500)
    } else { setScrollTargetLine(undefined); setHighlightLines([]) }
    setFollowTarget(null)
  }, [followTarget, followMode, code.openFile])

  const handleFileChanged = useCallback((info: FileChangeInfo) => {
    setChangedLinesMap(prev => ({ ...prev, [info.filePath]: info.lines }))
  }, [])

  useEffect(() => () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current) }, [])

  const activeTabExt = code.activeTab?.path?.split('.').pop()?.toLowerCase() || ''
  const isRunnable = RUNNABLE_EXTS.has(activeTabExt)

  const handleRun = useCallback(async () => {
    if (!code.activeTab || running) return
    setRunning(true)
    setBottomPanel('output')
    setRunOutput(null); setRunError(false)
    try {
      const r = await fetch('/api/code/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: code.activeTab.path, cwd: code.activeProject?.rootPath || '' }),
      })
      const data = await r.json()
      runIdRef.current = data.runId
      pollRef.current = setInterval(async () => {
        if (!runIdRef.current) return
        try {
          const s = await fetch(`/api/code/run/status?runId=${runIdRef.current}`)
          const status = await s.json()
          if (status.status !== 'running') {
            clearInterval(pollRef.current!)
            pollRef.current = null
            runIdRef.current = null
            setRunning(false)
            if (status.status === 'killed') { setRunOutput('进程已终止'); setRunError(false) }
            else {
              const out = [status.stdout, status.stderr ? `\n[stderr]\n${status.stderr}` : ''].filter(Boolean).join('\n')
              setRunOutput(out || '(无输出)')
              setRunError(status.status !== 'success')
            }
          }
        } catch { /* Ignore polling error */ }
      }, 500)
    } catch (e: any) {
      setRunOutput(e.message || '执行失败'); setRunError(true); setRunning(false)
    }
  }, [code.activeTab, code.activeProject?.rootPath, running])

  const handleStop = useCallback(async () => {
    const id = runIdRef.current
    if (!id) return
    try { await fetch('/api/code/run/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: id }) }) } catch {}
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    runIdRef.current = null
    setRunning(false)
    setRunOutput('Process terminated'); setRunError(false)
  }, [])

  // ====== Tab management ======
  const handleCloseOtherTabs = useCallback((path: string) => {
    code.tabs.filter(t => t.path !== path).map(t => t.path).forEach(p => code.closeTab(p))
  }, [code.tabs, code.closeTab])
  const handleCloseRightTabs = useCallback((path: string) => {
    const idx = code.tabs.findIndex(t => t.path === path)
    if (idx === -1) return
    code.tabs.slice(idx + 1).map(t => t.path).forEach(p => code.closeTab(p))
  }, [code.tabs, code.closeTab])
  const handleCloseAllTabs = useCallback(() => {
    code.tabs.map(t => t.path).forEach(p => code.closeTab(p))
  }, [code.tabs, code.closeTab])

  const handleToggleMarkdownPreview = useCallback(() => { setMarkdownPreview(v => !v) }, [])

  // ====== Git 状态 ======
  const fetchGitStatus = useCallback(async () => {
    if (!code.activeProject) return
    setGitLoading(true)
    try {
      const r = await fetch(`/api/code/git-status?cwd=${encodeURIComponent(code.activeProject.rootPath)}`)
      if (r.ok) setGitStatus(await r.json())
    } catch { /* git not available */ }
    setGitLoading(false)
  }, [code.activeProject])
  useEffect(() => { if (code.activeProject) fetchGitStatus() }, [code.activeProject, fetchGitStatus])

  // ====== 项目统计 ======
  useEffect(() => {
    if (sidePanel !== 'stats' || !code.activeProject || codeStats) return
    setCodeStatsLoading(true)
    fetch(`/api/code/stats?root=${encodeURIComponent(code.activeProject.rootPath)}`)
      .then(r => r.json()).then(d => { if (d.success) setCodeStats(d) }).catch(() => {})
      .finally(() => setCodeStatsLoading(false))
  }, [sidePanel, code.activeProject, codeStats])

  // ====== Global shortcuts(与原版一致)======
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.shiftKey && e.key === 'f') { e.preventDefault(); setSidePanel(p => (p === 'search' ? null : 'search')); setSearchInitial(''); return }
      if (mod && e.key === 'p') { e.preventDefault(); setShowQuickOpen(v => !v); return }
      if (mod && e.key === 'b') { e.preventDefault(); setSidePanel(p => (p ? null : 'files')); return }
      if (mod && e.key === '`') { e.preventDefault(); setBottomPanel(p => (p === 'terminal' ? null : 'terminal')); return }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const [showQuickOpen, setShowQuickOpen] = useState(false)
  // 活动栏统一切换:点已激活的 = 收起
  const toggleSide = (p: Exclude<SidePanel, null>) => setSidePanel(cur => (cur === p ? null : p))
  const openSearch = (initial: string) => { setSearchInitial(initial); setSidePanel('search') }

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

  const project = code.activeProject!
  const chatVisible = !chatCollapsed && chatPanelWidth > 0

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: c.bg }}>
      {/* ═══ Top bar:返回 / 项目 / 切换 / 聊天开关 ═══ */}
      <div className="h-10 flex items-center px-3 shrink-0 border-b gap-2 glass" style={{ borderColor: c.border }}>
        <button onClick={handleBack} title="返回"
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
          style={{ color: c.textTertiary }}
          onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold truncate" style={{ color: c.textHead }}>{project.name}</span>
          <span className="text-[10px] truncate hidden sm:inline" style={{ color: c.textMuted }}>{project.rootPath}</span>
        </div>
        <div className="flex-1" />
        {/* 聊天开关 */}
        <button onClick={() => {
          if (chatCollapsed) { setChatPanelWidth(prevChatW.current); setChatCollapsed(false) }
          else { prevChatW.current = chatPanelWidth || 320; setChatCollapsed(true) }
        }} title={chatCollapsed ? '展开 AI 面板' : '收起 AI 面板'}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors"
          style={{ color: chatCollapsed ? c.textTertiary : c.accent, background: chatCollapsed ? 'transparent' : c.accentBg }}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          {chatCollapsed ? t2('AI') : t2('收起 AI')}
        </button>
        {/* 项目切换 */}
        <div className="relative">
          <button onClick={() => setShowProjectSwitcher(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors"
            style={{ color: c.textTertiary }}
            onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            {t2('切换项目')}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showProjectSwitcher && (
            <div className="absolute right-0 top-full mt-1 w-72 rounded-xl shadow-xl p-2 z-50 space-y-1 border" style={{ background: c.modalBg, borderColor: c.border }}>
              {code.projects.map(p => (
                <ProjectCard key={p.id} project={p} isActive={p.id === code.activeProjectId}
                  onOpen={() => { code.setActiveProjectId(p.id); setShowProjectSwitcher(false) }}
                  onDelete={() => code.removeProject(p.id)} c={c} />
              ))}
              <button onClick={() => { setShowNewProject(true); setShowProjectSwitcher(false) }}
                className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-colors flex items-center gap-2"
                style={{ color: c.accent }}
                onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                {t2('新建项目')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ 主体:rail | sidebar | editor | chat ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── 活动栏(44px)── */}
        <div className="w-11 shrink-0 border-r flex flex-col items-center py-2 gap-1 glass" style={{ borderColor: c.border }}>
          <RailBtn c={c} label={t2('文件')} title="文件树 (⌘B)" active={sidePanel === 'files'} onClick={() => toggleSide('files')}
            icon="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          <RailBtn c={c} label={t2('搜索')} title="全局搜索 (⌘⇧F)" active={sidePanel === 'search' || sidePanel === 'todo'} onClick={() => openSearch(sidePanel === 'search' ? '' : '')}
            icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          <RailBtn c={c} label="TODO" title="TODO / FIXME 扫描" active={sidePanel === 'todo'} onClick={() => { const on = sidePanel === 'todo'; if (!on) { setSearchInitial('TODO|FIXME'); setSidePanel('search') } else setSidePanel(null) }}
            icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          <RailBtn c={c} label={t2('片段')} title="代码片段" active={sidePanel === 'snippets'} onClick={() => toggleSide('snippets')}
            icon="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5L8 13.8 2 9.2h7.6z" />
          <RailBtn c={c} label="Git" title="Git 检查点" active={sidePanel === 'git'} onClick={() => toggleSide('git')}
            icon="M12 3v18m-7-9h14" />
          <RailBtn c={c} label={t2('统计')} title="项目代码统计" active={sidePanel === 'stats'} onClick={() => toggleSide('stats')}
            icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10a2 2 0 01-2 2h-2a2 2 0 01-2-2zM13 8a2 2 0 012-2h2a2 2 0 012 2v10a2 2 0 01-2 2h-2a2 2 0 01-2-2V8z" />
          <div className="flex-1" />
          <RailBtn c={c} label={t2('终端')} title="终端 (⌘`)" active={bottomPanel === 'terminal'} onClick={() => setBottomPanel(p => (p === 'terminal' ? null : 'terminal'))}
            icon="M8 9l3 3-3 3m5 0h3M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
        </div>

        {/* ── 侧栏槽(唯一,互斥)── */}
        {sidePanel && (
          <>
            <div className="shrink-0 border-r flex flex-col overflow-hidden glass" style={{ width: fileTreeWidth, borderColor: c.border }}>
              {/* 面板标题栏 */}
              <div className="h-8 flex items-center px-2.5 border-b shrink-0" style={{ borderColor: c.borderLight }}>
                <span className="text-[10.5px] font-semibold tracking-wide" style={{ color: c.textMuted }}>
                  {sidePanel === 'files' ? t2('文件树') : sidePanel === 'search' ? t2('搜索') : sidePanel === 'todo' ? 'TODO / FIXME'
                    : sidePanel === 'snippets' ? t2('代码片段') : sidePanel === 'git' ? 'Git' : t2('代码统计')}
                </span>
                <button onClick={() => setSidePanel(null)} title={t2('收起')}
                  className="ml-auto w-5 h-5 rounded flex items-center justify-center" style={{ color: c.textTertiary }}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                {sidePanel === 'files' && (
                  <>
                    <div className="flex-1 overflow-hidden min-h-0">
                      <FileTree nodes={code.fileTree} onSelectFile={code.openFile} loading={code.treeLoading}
                        onRefresh={code.refreshTree} selectedPath={followTarget?.filePath} projectRoot={project.rootPath}
                        onCreateFile={code.createFile} gitStatus={gitStatus} gitLoading={gitLoading} />
                    </div>
                    <div className="px-2 pb-2 shrink-0">
                      <button onClick={() => { fetch('/api/open-finder?path=' + encodeURIComponent(project.rootPath)).catch(() => {}) }}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] transition-colors"
                        style={{ color: c.textMuted }}
                        onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                        Finder
                      </button>
                    </div>
                  </>
                )}
                {(sidePanel === 'search' || sidePanel === 'todo') && (
                  <CodeSearchPanel projectRoot={project.rootPath} initialKeyword={sidePanel === 'todo' ? 'TODO|FIXME' : searchInitial}
                    onOpenFile={(filePath: string, name: string) => code.openFile(filePath, name)}
                    onClose={() => setSidePanel(null)} />
                )}
                {sidePanel === 'snippets' && (
                  <SnippetPanel onInsert={(snippetCode: string) => {
                    const tab = code.activeTab
                    if (tab) code.updateContent(tab.path, tab.content + '\n' + snippetCode)
                  }} onClose={() => setSidePanel(null)} />
                )}
                {sidePanel === 'git' && (
                  <div className="flex-1 overflow-auto min-h-0">
                    {/* 快捷提交(并入 Git 侧栏,不再用浮层) */}
                    <div className="p-2.5 border-b" style={{ borderColor: c.borderLight }}>
                      <div className="text-[11px] font-medium mb-1.5" style={{ color: c.textHead }}>{t2('提交到 Git')}</div>
                      <input value={gitCommitMsg} onChange={e => setGitCommitMsg(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter' && gitCommitMsg.trim()) {
                            setGitCommitting(true)
                            try {
                              const r = await fetch('/api/code/git-commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: project.rootPath, message: gitCommitMsg.trim() }) }).then(r => r.json())
                              setGitCommitResult(r.success ? `已提交 ${r.summary || ''}` : (r.error || '提交失败'))
                              if (r.success) { setGitCommitMsg(''); fetchGitStatus() }
                            } catch (err: any) { setGitCommitResult(err.message) }
                            setGitCommitting(false)
                          }
                        }}
                        placeholder={gitCommitting ? '提交中…' : '提交信息(回车提交)'} disabled={gitCommitting}
                        className="w-full h-8 px-2.5 rounded-lg text-[12px] outline-none disabled:opacity-50"
                        style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.border}` }} />
                      {gitCommitResult && <div className="text-[10.5px] mt-1.5" style={{ color: c.textTertiary }}>{gitCommitResult}</div>}
                      <div className="text-[10px] mt-1" style={{ color: c.textMuted }}>{t2('将暂存项目内全部改动(git add -A)')}</div>
                    </div>
                    <GitPanel workDir={project.rootPath} onClose={() => setSidePanel(null)} />
                  </div>
                )}
                {sidePanel === 'stats' && (
                  <div className="p-3 overflow-auto">
                    <div className="text-[11.5px] font-medium mb-2" style={{ color: c.textHead }}>{t2('项目代码统计')}</div>
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
              </div>
            </div>
            <ResizeHandle onResize={delta => setFileTreeWidth(w => Math.max(140, Math.min(500, w + delta)))} c={c} />
          </>
        )}

        {/* ── 编辑器列 ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 工具条:文件状态 + 高频操作(低频操作全部收入活动栏) */}
          <div className="h-9 flex items-center px-2 gap-0.5 border-b glass shrink-0" style={{ borderColor: c.borderLight }}>
            <span className="text-[10.5px] font-mono truncate max-w-[220px] shrink-0" style={{ color: c.textMuted }} title={code.activeTab?.path}>
              {code.activeTab ? (code.activeTab.modified ? '● ' : '') + (code.activeTab.path.split('/').pop() || '') : t2('未打开文件')}
            </span>
            {code.activeTab?.name?.endsWith('.md') && (
              <TBtn c={c} title="Markdown 预览" active={markdownPreview} onClick={handleToggleMarkdownPreview}
                icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            )}
            <div className="flex-1" />
            <TBtn c={c} title={followMode ? 'Follow mode 开启' : 'Follow mode 关闭'} active={followMode}
              onClick={() => setFollowMode(v => !v)}
              icon="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            <TBtn c={c} title="保存全部 (Cmd+S)" dirty={code.tabs.some(t => t.modified)}
              onClick={async () => { for (const t of code.tabs.filter(t => t.modified)) await code.saveFile(t.path) }}
              icon="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            <div className="flex items-center rounded-full ml-1 shrink-0" style={{ background: c.bgInput }}>
              <button onClick={() => setFontPx(stepEditorFont(-1))} className="w-6 h-6 flex items-center justify-center text-[10px] rounded-l-full" style={{ color: c.textTertiary }} title="减小字号 (Cmd+-)">A−</button>
              <span className="text-[9px] font-mono w-5 text-center" style={{ color: c.textMuted }}>{fontPx}</span>
              <button onClick={() => setFontPx(stepEditorFont(1))} className="w-6 h-6 flex items-center justify-center text-[10px] rounded-r-full" style={{ color: c.textTertiary }} title="增大字号 (Cmd+=)">A+</button>
            </div>
          </div>

          <CodeEditor
            tab={code.activeTab}
            tabs={code.tabs}
            activeTabPath={code.activeTabPath}
            onSelectTab={(path: string) => { code.openFile(path, path.split('/').pop() || path) }}
            onCloseTab={code.closeTab}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseRightTabs={handleCloseRightTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onContentChange={(path, content) => {
              code.updateContent(path, content)
              setChangedLinesMap(prev => { if (!prev[path]) return prev; const next = { ...prev }; delete next[path]; return next })
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
          {/* Markdown 预览(与编辑器分屏) */}
          {markdownPreview && code.activeTab?.name?.endsWith('.md') && code.activeTab.content && (
            <div className="border-t flex-1 min-h-0 overflow-auto p-4" style={{ borderColor: c.borderLight, background: c.bg }}>
              <MarkdownPreview content={code.activeTab.content} />
            </div>
          )}
          {/* 底部抽屉:运行输出(与终端互斥) */}
          {bottomPanel === 'output' && (
            <div className="border-t shrink-0" style={{ borderColor: c.borderLight }}>
              <div className="h-7 flex items-center justify-between px-3" style={{ background: c.bgCard }}>
                <span className="text-[10px] font-medium" style={{ color: c.textMuted }}>Run output</span>
                <button onClick={() => setBottomPanel(null)} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: c.textMuted }}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="h-36 overflow-auto p-3" style={{ background: c.bg }}>
                {running ? (
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: c.textMuted }}>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    运行中...
                  </div>
                ) : (
                  <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono" style={{ color: runError ? c.toolErr : c.text, fontFamily: "'SF Mono', Menlo, monospace" }}>
                    {runOutput || '(无输出)'}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── AI 面板(可折叠)── */}
        {chatVisible && (
          <>
            <ResizeHandle onResize={delta => setChatPanelWidth(w => Math.max(200, Math.min(600, w - delta)))} c={c} reverse />
            <div className="shrink-0 min-w-0" style={{ width: chatPanelWidth }}>
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
          </>
        )}
      </div>

      {/* ═══ 底部抽屉:终端(全宽,独立于编辑器列)═══ */}
      {bottomPanel === 'terminal' && (
        <div className="border-t shrink-0" style={{ borderColor: c.borderLight }}>
          <TerminalPanel cwd={project.rootPath} />
        </div>
      )}

      {showNewProject && (
        <NewProjectDialog onClose={() => setShowNewProject(false)} onCreateProject={code.createProject} />
      )}

      {/* 快速打开(唯一保留的浮层:模态语义) */}
      {showQuickOpen && (
        <QuickOpenPanel fileTree={code.fileTree} projectRoot={project.rootPath}
          onOpenFile={(filePath: string, name: string) => code.openFile(filePath, name)}
          onClose={() => setShowQuickOpen(false)} />
      )}
    </div>
  )

  function t2(zh: string) { return zh }
}

// ═══ ═══ ═══ 子组件 ═══ ═══ ═══

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
    <div onMouseDown={onMouseDown} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="w-1.5 shrink-0 cursor-col-resize relative flex items-center justify-center group"
      style={{ background: hover ? `${c.accent}40` : 'transparent', transition: 'background 0.15s ease' }}>
      <div className="w-0.5 h-8 rounded-full transition-opacity"
        style={{ background: hover ? c.accent : c.borderLight, opacity: hover ? 1 : 0.5 }} />
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
    <div onClick={onOpen}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors group"
      style={{ background: isActive ? c.accentBg : 'transparent', border: isActive ? `1px solid ${c.accentBorder}` : '1px solid transparent' }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = c.bgHover }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: c.accent }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate" style={{ color: c.text }}>{project.name}</div>
        <div className="text-[10px] truncate" style={{ color: c.textMuted }}>{project.rootPath}</div>
      </div>
      <button onClick={e => { e.stopPropagation(); onDelete() }}
        className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        style={{ color: c.textMuted }}>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
