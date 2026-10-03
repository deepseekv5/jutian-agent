// Code mode homepage — Feature introduction + File quick reference
import { useState, useCallback, useRef, type DragEvent } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { CodeProject } from '../types/code'

interface Props {
  projects: CodeProject[]
  onOpenProject: (id: string) => void
  onDeleteProject: (id: string) => void
  onCreateProject: (name: string, rootPath: string, openFile?: string) => void
  onBack: () => void
}

// Feature card data
const FEATURES = [
  {
    icon: 'brain',
    title: 'AI context chat',
    desc: 'AI can read project files, write code, and execute commands directly',
  },
  {
    icon: 'folder',
    title: '项目文件管理',
    desc: '文件树浏览、标签页编辑、语法高亮',
  },
  {
    icon: 'play',
    title: '一键运行代码',
    desc: '支持 JS/Python/TS/Go/Bash 等 12 种语言，实时输出',
  },
]

type DropState = 'idle' | 'over' | 'processing'

export default function WelcomePage({ projects, onOpenProject, onDeleteProject, onCreateProject, onBack }: Props) {
  const { c } = useTheme()
  const [dropState, setDropState] = useState<DropState>('idle')
  const [error, setError] = useState<string | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setDropState('over')
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDropState('idle')
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDropState('processing')
    setError(null)

    const items = e.dataTransfer?.items
    if (!items || items.length === 0) {
      setDropState('idle')
      return
    }

    // Get first dragged item
    const item = items[0]
    // Electron webkitGetAsEntry can get filesystem entries
    const entry = item.webkitGetAsEntry?.() as any

    try {
      if (entry?.isDirectory) {
        // Drag folder -> use as project root directory
        const dirPath = entry.fullPath || (e.dataTransfer?.files[0] as any)?.path
        const name = dirPath.split('/').filter(Boolean).pop() || '未命名项目'
        onCreateProject(name, dirPath)
        setDropState('idle')
      } else if (entry?.isFile) {
        // Drag file -> use parent directory as project root and open file
        const file = e.dataTransfer?.files[0] as any
        const filePath = file?.path || entry.fullPath
        if (filePath) {
          const parts = filePath.split('/')
          const fileName = parts.pop() || '未命名文件'
          const dirPath = parts.join('/') || '/'
          const projectName = dirPath.split('/').filter(Boolean).pop() || '未命名项目'
          onCreateProject(projectName, dirPath, filePath)
        }
        setDropState('idle')
      } else {
        // Fallback: use dataTransfer.files
        const file = e.dataTransfer?.files[0] as any
        if (file?.path) {
          if (file.type === '' && !file.name.includes('.')) {
            // Might be folder
            onCreateProject(file.name, file.path)
          } else {
            const parts = file.path.split('/')
            parts.pop()
            const dirPath = parts.join('/')
            const projectName = dirPath.split('/').filter(Boolean).pop() || '未命名项目'
            onCreateProject(projectName, dirPath, file.path)
          }
        }
        setDropState('idle')
      }
    } catch (err: any) {
      setError(err.message || '处理文件失败')
      setDropState('idle')
    }
  }, [onCreateProject])

  // Click Browse for folder
  const handleBrowseFolder = useCallback(async () => {
    try {
      const res = await fetch('/api/code/select-directory', { method: 'POST' })
      const data = await res.json()
      if (data.path) {
        const name = data.path.split('/').filter(Boolean).pop() || 'Untitled Project'
        onCreateProject(name, data.path)
      }
    } catch (e: any) {
      setError(e.message || '选择文件夹失败')
    }
  }, [onCreateProject])

  // Click Browse for file
  const handleBrowseFile = useCallback(async () => {
    try {
      const res = await fetch('/api/code/select-file', { method: 'POST' })
      const data = await res.json()
      if (data.path) {
        const parts = data.path.split('/')
        const fileName = parts.pop() || '未命名文件'
        const dirPath = parts.join('/') || '/'
        const projectName = dirPath.split('/').filter(Boolean).pop() || 'Untitled Project'
        onCreateProject(projectName, dirPath, data.path)
      }
    } catch (e: any) {
      setError(e.message || '选择文件失败')
    }
  }, [onCreateProject])

  const dropBg = dropState === 'over'
    ? `${c.accent}11`
    : dropState === 'processing'
      ? 'transparent'
      : c.bgInput
  const dropBorder = dropState === 'over' ? c.accent : c.border

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: c.bg }}>
      {/* Top bar */}
      <div className="h-12 flex items-center px-4 shrink-0 border-b" style={{ background: c.bgCard, borderColor: c.border }}>
          <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center mr-3 transition-colors btn-liquid"
          style={{ color: c.textTertiary }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold" style={{ color: c.textHead }}>Code</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">

          {/* ─── Hero ─── */}
          <div className="text-center space-y-3">
            <div
              className="w-16 h-16 mx-auto rounded-xl flex items-center justify-center btn-liquid"
              style={{ background: `${c.accent}15` }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: c.accent }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
            </div>
            <h1 className="text-[20px] font-semibold tracking-tight" style={{ color: c.textHead }}>代码模式</h1>
            <p className="text-[12px] leading-relaxed" style={{ color: c.textTertiary }}>
              在项目上下文中与 AI 协作：阅读代码、编写功能、运行测试、审查 diff
            </p>
          </div>

          {/* ─── Feature Cards ─── */}
          <div className="grid grid-cols-3 gap-3">
            {FEATURES.map(f => (
              <div
                key={f.icon}
                className="rounded-xl p-4 border glass transition-colors btn-liquid"
                style={{ borderColor: c.borderLight }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2.5" style={{ background: `${c.accent}12` }}>
                  <FeatureIcon icon={f.icon} color={c.accent} />
                </div>
                <h3 className="text-[13px] font-semibold mb-1" style={{ color: c.textHead }}>{f.title}</h3>
                <p className="text-[11px] leading-relaxed" style={{ color: c.textTertiary }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* ─── Drop Zone ─── */}
          <div className="space-y-3">
            <h2 className="text-[13px] font-semibold" style={{ color: c.textHead }}>快速开始</h2>
            <div
              ref={dropRef}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 btn-liquid"
              style={{
                background: dropBg,
                borderColor: dropBorder,
              }}
            >
              {dropState === 'processing' ? (
                <div className="flex flex-col items-center gap-3">
                  <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: c.accent }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[12px]" style={{ color: c.textMuted }}>处理中...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center" style={{ background: `${c.accent}10` }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color: c.accent }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: c.text }}>
                      {dropState === 'over' ? '释放以添加' : '拖拽文件或文件夹到此处'}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>
                      自动创建项目并打开
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-px flex-1 max-w-16" style={{ background: c.borderLight }} />
                    <span className="text-[10px]" style={{ color: c.textMuted }}>或</span>
                    <div className="h-px flex-1 max-w-16" style={{ background: c.borderLight }} />
                  </div>
                  <div className="flex items-center justify-center gap-2">
                      <button
                      onClick={handleBrowseFolder}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 btn-liquid"
                      style={{ background: c.accentBg, color: c.accent }}
                      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.95)' }}
                      onMouseLeave={e => { e.currentTarget.style.filter = '' }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      选择文件夹
                    </button>
                      <button
                      onClick={handleBrowseFile}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 btn-liquid"
                      style={{ color: c.textTertiary, border: `1px solid ${c.borderLight}` }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      选择文件
                    </button>
                  </div>
                </div>
              )}
            </div>
            {error && (
              <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: `${c.toolErr}10`, color: c.toolErr }}>
                {error}
              </div>
            )}
          </div>

          {/* ─── Existing Projects ─── */}
          {projects.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-[13px] font-semibold" style={{ color: c.textHead }}>
                已有项目
                <span className="ml-1.5 text-[11px] font-normal" style={{ color: c.textMuted }}>({projects.length})</span>
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {projects.map(project => (
                  <WelcomeProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => onOpenProject(project.id)}
                    onDelete={() => onDeleteProject(project.id)}
                    c={c}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function FeatureIcon({ icon, color }: { icon: string; color: string }) {
  switch (icon) {
    case 'brain':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      )
    case 'folder':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      )
    case 'play':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      )
    default:
      return null
  }
}

function WelcomeProjectCard({ project, onOpen, onDelete, c }: {
  project: CodeProject
  isActive?: boolean
  onOpen: () => void
  onDelete: () => void
  c: any
}) {
  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all group border btn-liquid"
      style={{ background: c.bgCard, borderColor: c.borderLight }}
      onMouseLeave={e => { e.currentTarget.style.background = c.bgCard }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${c.accent}10` }}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color: c.accent }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate" style={{ color: c.textHead }}>{project.name}</div>
        <div className="text-[10px] truncate" style={{ color: c.textTertiary }}>{project.rootPath}</div>
      </div>

        <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 btn-liquid"
        style={{ color: c.textTertiary }}
        onMouseEnter={e => { e.currentTarget.style.background = c.bgInput }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
