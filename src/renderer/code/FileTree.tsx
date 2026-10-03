// File Tree Component
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { FileNode, GitStatusData } from '../types/code'
import { getLanguage } from '../types/code'
import { useTheme } from '../hooks/useTheme'

interface Props {
  nodes: FileNode[]
  onSelectFile: (path: string, name: string) => void
  loading: boolean
  onRefresh: () => void
  selectedPath?: string
  projectRoot: string
  onCreateFile: (dirPath: string, fileName: string, overwrite?: boolean) => Promise<{ success: boolean; error?: string; exists?: boolean; path?: string }>
  gitStatus?: GitStatusData | null
  gitLoading?: boolean
}

interface ContextMenuState {
  x: number
  y: number
  dirPath: string
  nodePath?: string
  isDir?: boolean
}

function getFileIcon(name: string, type: 'file' | 'directory'): string {
  if (type === 'directory') return 'folder'
  const lang = getLanguage(name)
  const map: Record<string, string> = {
    typescript: 'ts', tsx: 'react', javascript: 'js', jsx: 'react',
    python: 'python', rust: 'rust', go: 'go', java: 'java',
    json: 'json', yaml: 'yaml', html: 'html', css: 'css',
    markdown: 'md', sql: 'db',
  }
  return map[lang] || 'file'
}

/** Recursively filter file tree, keep matching nodes and parents */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes
  const q = query.toLowerCase()
  const result: FileNode[] = []
  for (const node of nodes) {
    const nameMatch = node.name.toLowerCase().includes(q)
    if (node.type === 'directory') {
      const filteredChildren = node.children ? filterTree(node.children, query) : null
      if (nameMatch || (filteredChildren && filteredChildren.length > 0)) {
        result.push({ ...node, children: filteredChildren ?? node.children })
      }
    } else if (nameMatch) {
      result.push(node)
    }
  }
  return result
}

function TreeNode({ node, depth, onSelectFile, searchQuery, selectedPath, onContextMenu, gitStatus, onDragStart, onDragOver, onDrop }: {
  node: FileNode; depth: number; onSelectFile: (path: string, name: string) => void;
  searchQuery: string; selectedPath?: string;
  onContextMenu: (e: React.MouseEvent, dirPath: string, nodePath: string, isDir: boolean) => void;
  gitStatus?: GitStatusData | null;
  onDragStart?: (e: React.DragEvent, path: string) => void;
  onDragOver?: (e: React.DragEvent, path: string) => void;
  onDrop?: (e: React.DragEvent, path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false)
  const preloaded = !!(node.children && node.children.length > 0)
  const loadedRef = useRef(preloaded)
  const [children, setChildren] = useState<FileNode[] | null>(preloaded ? node.children! : null)
  const [loadingChildren, setLoadingChildren] = useState(false)
  const autoExpandedRef = useRef(false)
  const { c } = useTheme()
  const isDir = node.type === 'directory'
  const iconType = getFileIcon(node.name, node.type)

  // Auto-expand directories when searching
  useEffect(() => {
    if (!isDir) return
    if (searchQuery) {
      if (!expanded) {
        setExpanded(true)
        autoExpandedRef.current = true
        if (!loadedRef.current) {
          loadedRef.current = true
          setLoadingChildren(true)
          fetch('/api/code/read-dir?path=' + encodeURIComponent(node.path))
            .then(res => res.ok ? res.json() : null)
            .then((data: FileNode[] | null) => setChildren(data && data.length > 0 ? data : null))
            .catch(() => setChildren(null))
            .finally(() => setLoadingChildren(false))
        }
      }
    } else if (autoExpandedRef.current) {
      setExpanded(false)
      autoExpandedRef.current = false
    }
  }, [searchQuery, isDir])

  const isAncestorOfSelected = useMemo(() => {
    if (!selectedPath || !isDir) return false
    return selectedPath.startsWith(node.path + '/') || selectedPath === node.path
  }, [selectedPath, isDir, node.path])

  useEffect(() => {
    if (isAncestorOfSelected && !expanded) {
      setExpanded(true)
      if (!loadedRef.current) {
        loadedRef.current = true
        setLoadingChildren(true)
        fetch('/api/code/read-dir?path=' + encodeURIComponent(node.path))
          .then(res => res.ok ? res.json() : null)
          .then((data: FileNode[] | null) => setChildren(data && data.length > 0 ? data : null))
          .catch(() => setChildren(null))
          .finally(() => setLoadingChildren(false))
      }
    }
  }, [isAncestorOfSelected, expanded])

  const handleClick = useCallback(async () => {
    if (isDir) {
      const next = !expanded
      setExpanded(next)
      autoExpandedRef.current = false
      if (next && !loadedRef.current) {
        loadedRef.current = true
        setLoadingChildren(true)
        try {
          const res = await fetch('/api/code/read-dir?path=' + encodeURIComponent(node.path))
          if (res.ok) {
            const data: FileNode[] = await res.json()
            setChildren(data.length > 0 ? data : null)
          } else {
            setChildren(null)
          }
        } catch {
          setChildren(null)
        } finally {
          setLoadingChildren(false)
        }
      }
    } else {
      onSelectFile(node.path, node.name)
    }
  }, [isDir, expanded, node.path, node.name, onSelectFile])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const dirPath = isDir ? node.path : node.path.substring(0, node.path.lastIndexOf('/'))
    onContextMenu(e, dirPath, node.path, isDir)
  }, [isDir, node.path, onContextMenu])

  const gitStatusDot = useMemo(() => {
    if (!gitStatus?.files || isDir) return null
    const gf = gitStatus.files.find(f => f.filePath === node.path)
    if (!gf) return null
    return gf.status
  }, [gitStatus, isDir, node.path])

  const paddingLeft = 8 + depth * 16
  const isSelected = !isDir && selectedPath === node.path

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', node.path)
    e.dataTransfer.effectAllowed = 'move'
  }, [node.path])

  return (
    <div>
      <div
        draggable
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop?.(e, node.path) }}
        className="flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer select-none transition-colors text-[13px] btn-liquid"
        style={{ paddingLeft, color: c.textSecondary, whiteSpace: 'nowrap', background: isSelected ? `${c.accent}18` : 'transparent' }}
        onMouseLeave={e => { e.currentTarget.style.background = isSelected ? `${c.accent}18` : 'transparent' }}
      >
        {isDir && (
          <svg
            className="w-3.5 h-3.5 shrink-0 transition-transform"
            style={{ color: c.textMuted, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        {!isDir && <div className="w-3.5 shrink-0" />}

        <FileIcon type={iconType} isDir={isDir} />
        <span className="truncate" style={{ color: isDir ? c.textSecondary : c.text }}>{node.name}</span>
        {gitStatusDot && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0 ml-1" style={{
            background: gitStatusDot === 'modified' ? '#d29922' : gitStatusDot === 'untracked' ? '#58a6ff' : '#f85149'
          }} />
        )}
      </div>

      {isDir && expanded && (
        <div>
          {loadingChildren ? (
            <div className="flex items-center py-2" style={{ paddingLeft: paddingLeft + 16 }}>
              <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: c.border, borderTopColor: c.accent }} />
            </div>
          ) : children && children.length > 0 ? (
            children.map(child => (
              <TreeNode key={child.path} node={child} depth={depth + 1} onSelectFile={onSelectFile} searchQuery={searchQuery} selectedPath={selectedPath} onContextMenu={onContextMenu} gitStatus={gitStatus} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} />
            ))
          ) : (
            <div className="text-[11px] py-1" style={{ paddingLeft: paddingLeft + 16, color: c.textMuted }}>
              (empty)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FileIcon({ type, isDir }: { type: string; isDir: boolean }) {
  const { c } = useTheme()

  if (isDir) {
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ color: '#f59e0b' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    )
  }

  const colors: Record<string, string> = {
    ts: '#3178c6', react: '#61dafb', js: '#f7df1e', python: '#3776ab',
    rust: '#dea584', go: '#00add8', java: '#b07219', json: '#f5a623',
    yaml: '#cb171e', html: '#e34f26', css: '#1572b6', md: '#8e8e93',
    db: '#336791', file: c.textMuted,
  }

  switch (type) {
    case 'ts':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill={colors.ts}><rect x="2" y="2" width="20" height="20" rx="4" /><text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="sans-serif">TS</text></svg>
    case 'react':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill={colors.react}><circle cx="12" cy="12" r="2" fill="#282c34" /><ellipse cx="12" cy="12" rx="10" ry="3.5" fill="none" stroke="#282c34" strokeWidth="1.5" /><ellipse cx="12" cy="12" rx="10" ry="3.5" fill="none" stroke="#282c34" strokeWidth="1.5" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="10" ry="3.5" fill="none" stroke="#282c34" strokeWidth="1.5" transform="rotate(120 12 12)" /></svg>
    case 'js':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill={colors.js} /><text x="12" y="17" textAnchor="middle" fill="#000" fontSize="11" fontWeight="bold" fontFamily="sans-serif">JS</text></svg>
    case 'python':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill={colors.python} /><text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="sans-serif">PY</text></svg>
    case 'json':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill={colors.json} /><text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold" fontFamily="sans-serif">{'{}'}</text></svg>
    case 'html':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill={colors.html} /><text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold" fontFamily="sans-serif">{'</>'}</text></svg>
    case 'css':
      return <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill={colors.css} /><text x="12" y="17" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold" fontFamily="sans-serif">#</text></svg>
    default:
      return (
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ color: colors.file }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )
  }
}

export default function FileTree({ nodes, onSelectFile, loading, onRefresh, selectedPath, projectRoot, onCreateFile, gitStatus, gitLoading }: Props) {
  const { c } = useTheme()
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // New file dialog state
  const [showNewFileDialog, setShowNewFileDialog] = useState(false)
  const [newFileDir, setNewFileDir] = useState(projectRoot)
  const [newFileName, setNewFileName] = useState('')
  const [newFileError, setNewFileError] = useState('')
  const [creating, setCreating] = useState(false)

  // New folder dialog state
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderDir, setNewFolderDir] = useState(projectRoot)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderError, setNewFolderError] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  // Rename dialog state
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [renamePath, setRenamePath] = useState('')
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePath, setDeletePath] = useState('')
  const [deleteName, setDeleteName] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)

  const filteredNodes = useMemo(() => filterTree(nodes, searchQuery), [nodes, searchQuery])

  const handleClear = () => {
    setSearchQuery('')
    inputRef.current?.focus()
  }

  // Open new file dialog
  const handleOpenNewFileDialog = useCallback(() => {
    setNewFileDir(projectRoot)
    setNewFileName('')
    setNewFileError('')
    setShowNewFileDialog(true)
    setCtxMenu(null)
    setTimeout(() => newFileInputRef.current?.focus(), 50)
  }, [projectRoot])

  const handleOpenNewFileFromMenu = useCallback((dirPath: string) => {
    setNewFileDir(dirPath)
    setNewFileName('')
    setNewFileError('')
    setShowNewFileDialog(true)
    setCtxMenu(null)
    setTimeout(() => newFileInputRef.current?.focus(), 50)
  }, [])

  // Open new folder dialog
  const handleOpenNewFolderFromMenu = useCallback((dirPath: string) => {
    setNewFolderDir(dirPath)
    setNewFolderName('')
    setNewFolderError('')
    setShowNewFolderDialog(true)
    setCtxMenu(null)
    setTimeout(() => newFolderInputRef.current?.focus(), 50)
  }, [])

  // Open rename dialog
  const handleOpenRename = useCallback((nodePath: string) => {
    const name = nodePath.split('/').pop() || ''
    setRenamePath(nodePath)
    setRenameName(name)
    setRenameError('')
    setShowRenameDialog(true)
    setCtxMenu(null)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }, [])

  // OpenDeleteConfirm
  const handleOpenDeleteConfirm = useCallback((nodePath: string, isDir: boolean) => {
    const name = nodePath.split('/').pop() || ''
    setDeletePath(nodePath)
    setDeleteName(`${isDir ? '文件夹' : '文件'} "${name}"`)
    setShowDeleteConfirm(true)
    setCtxMenu(null)
  }, [])

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, dirPath: string, nodePath: string, isDir: boolean) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, dirPath, nodePath, isDir })
  }, [])

  const handleTreeContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-tree-node]')) return
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, dirPath: projectRoot })
  }, [projectRoot])

  useEffect(() => {
    const close = () => setCtxMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [])

  // Confirm Create File
  const handleConfirmCreate = useCallback(async (overwrite = false) => {
    const name = newFileName.trim()
    if (!name) { setNewFileError('请输入文件名'); return }
    if (/[<>:"/\\|?*]/.test(name)) { setNewFileError('文件名包含无效字符'); return }
    setCreating(true)
    setNewFileError('')
    try {
      const result = await onCreateFile(newFileDir, name, overwrite)
      if (result.success && result.path) {
        setShowNewFileDialog(false)
        setNewFileName('')
        onRefresh()
        onSelectFile(result.path, name)
      } else if (result.exists) {
        setNewFileError(`文件 "${name}" 已存在，是否覆盖？`)
      } else {
        setNewFileError(result.error || '创建失败')
      }
    } catch {
      setNewFileError('创建文件失败')
    } finally { setCreating(false) }
  }, [newFileName, newFileDir, onCreateFile, onRefresh, onSelectFile])

  // Confirm Create Folder
  const handleConfirmCreateFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name) { setNewFolderError('请输入文件夹名称'); return }
    if (/[<>:"/\\|?*]/.test(name)) { setNewFolderError('文件夹名称包含无效字符'); return }
    setCreatingFolder(true)
    setNewFolderError('')
    try {
      const res = await fetch('/api/code/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: newFolderDir, folderName: name }),
      })
      const data = await res.json()
      if (data.success) {
        setShowNewFolderDialog(false)
        setNewFolderName('')
        onRefresh()
      } else {
        setNewFolderError(data.error || '创建失败')
      }
    } catch {
      setNewFolderError('创建文件夹失败')
    } finally { setCreatingFolder(false) }
  }, [newFolderName, newFolderDir, onRefresh])

  // ConfirmRename
  const handleConfirmRename = useCallback(async () => {
    const name = renameName.trim()
    if (!name) { setRenameError('请输入新名称'); return }
    setRenaming(true)
    setRenameError('')
    try {
      const res = await fetch('/api/code/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: renamePath, newName: name }),
      })
      const data = await res.json()
      if (data.success) {
        setShowRenameDialog(false)
        onRefresh()
      } else {
        setRenameError(data.error || '重命名失败')
      }
    } catch {
      setRenameError('重命名请求失败')
    } finally { setRenaming(false) }
  }, [renameName, renamePath, onRefresh])

  // ConfirmDelete
  const handleConfirmDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const res = await fetch('/api/code/file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: deletePath }),
      })
      const data = await res.json()
      if (data.success) {
        setShowDeleteConfirm(false)
        onRefresh()
      }
    } catch {
      // silent fail, just close
    } finally { setDeleting(false); setShowDeleteConfirm(false) }
  }, [deletePath, onRefresh])

  // Drag to move files
  const handleDrop = useCallback(async (e: React.DragEvent, targetPath: string) => {
    const srcPath = e.dataTransfer.getData('text/plain')
    if (!srcPath || srcPath === targetPath) return
    const targetIsDir = nodes.some(n => isDirPath(n, targetPath))
    const destDir = targetIsDir ? targetPath : targetPath.substring(0, targetPath.lastIndexOf('/'))
    if (srcPath.startsWith(destDir + '/')) return // can't move into descendant
    try {
      await fetch('/api/code/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: srcPath, destDir }),
      })
      onRefresh()
    } catch { /* ignore */ }
  }, [nodes, onRefresh])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirmCreate(false)
    else if (e.key === 'Escape') { setShowNewFileDialog(false); setNewFileName('') }
  }, [handleConfirmCreate])

  return (
    <div className="flex flex-col h-full" style={{ background: c.bgCard }}>
      {/* Header */}
      <div className="h-9 flex items-center justify-between px-3 shrink-0 border-b" style={{ borderColor: c.borderLight }}>
        <span className="text-[11px] font-medium" style={{ color: c.textTertiary }}>文件</span>
        <div className="flex items-center gap-0.5">
          {/* New file button */}
          <button
            onClick={handleOpenNewFileDialog}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors btn-liquid"
            style={{ color: c.textMuted }}
            title="新建文件"
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {/* Refresh button */}
          <button
            onClick={onRefresh}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors btn-liquid"
            style={{ color: c.textMuted }}
            title="Refresh"
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-2 py-1.5 shrink-0">
        <div
          className="flex items-center gap-1.5 rounded-md px-2 h-7 transition-all"
          style={{
            background: c.bgInput,
            border: `1px solid ${searchQuery ? c.accentBorder : c.borderLight}`,
            boxShadow: searchQuery ? `0 0 0 1px ${c.accentBorder}` : 'none',
          }}
        >
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: c.textMuted }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索文件..."
            className="flex-1 bg-transparent border-none outline-none text-[12px] placeholder-current"
            style={{ color: c.text, opacity: searchQuery ? 1 : undefined }}
          />
          {searchQuery && (
            <button
              onClick={handleClear}
              className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors btn-liquid"
              style={{ color: c.textMuted }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div
        className="flex-1 overflow-y-auto py-1 scrollbar-thin relative"
        onContextMenu={handleTreeContextMenu}
      >
        {loading && nodes.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: c.border, borderTopColor: c.accent }} />
          </div>
        ) : searchQuery && filteredNodes.length === 0 ? (
          <div className="text-center text-[11px] py-6" style={{ color: c.textMuted }}>
            No matching files found
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center text-[11px] py-6" style={{ color: c.textMuted }}>
            Empty directory
          </div>
        ) : (
          <div data-tree-node>
            {filteredNodes.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onSelectFile={onSelectFile}
                searchQuery={searchQuery}
                selectedPath={selectedPath}
                onContextMenu={handleContextMenu}
                gitStatus={gitStatus}
                onDrop={handleDrop}
              />
            ))}
          </div>
        )}
      </div>

      {/* New file dialog */}
      {showNewFileDialog && (
        <div
          className="absolute inset-0 z-50 flex items-start justify-center pt-12"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => { setShowNewFileDialog(false); setNewFileName('') }}
        >
          <div
            className="rounded-xl shadow-lg p-4 w-72 border"
            style={{ background: c.modalBg, borderColor: c.border }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[13px] font-semibold mb-1" style={{ color: c.textHead }}>
              新建文件
            </div>
            <div className="text-[10px] mb-3 truncate" style={{ color: c.textMuted }}>
              {newFileDir}
            </div>
            <input
              ref={newFileInputRef}
              type="text"
              value={newFileName}
              onChange={e => { setNewFileName(e.target.value); setNewFileError('') }}
              onKeyDown={handleKeyDown}
              placeholder="文件名（含扩展名）"
              className="w-full px-3 py-2 rounded-lg text-[13px] border outline-none transition-colors mb-2"
              style={{
                background: c.bgInput,
                borderColor: newFileError ? c.toolErr : c.borderLight,
                color: c.text,
              }}
              disabled={creating}
              autoFocus
            />
            {newFileError && (
              <div className="text-[11px] mb-2" style={{ color: c.toolErr }}>
                {newFileError}
                  {newFileError.includes('已存在') && (
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={() => handleConfirmCreate(true)}
                      className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                      style={{ background: c.accent, color: c.accentText }}
                    >
                      覆盖
                    </button>
                    <button
                      onClick={() => { setShowNewFileDialog(false); setNewFileName('') }}
                      className="px-2.5 py-1 rounded text-[11px] transition-colors"
                      style={{ background: c.bgHover, color: c.textSecondary }}
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end mt-3">
                <button
                onClick={() => { setShowNewFileDialog(false); setNewFileName('') }}
                className="px-3 py-1.5 rounded-lg text-[12px] transition-colors"
                style={{ color: c.textMuted }}
              >
                取消
              </button>
              <button
                onClick={() => handleConfirmCreate(false)}
                disabled={creating || !newFileName.trim()}
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40"
                style={{ background: c.accent, color: c.accentText }}
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-[100] rounded-lg shadow-xl border py-1 min-w-[150px]"
          style={{
            left: ctxMenu.x,
            top: ctxMenu.y,
            background: c.modalBg,
            borderColor: c.border,
          }}
        >
          <button
            onClick={() => handleOpenNewFileFromMenu(ctxMenu.dirPath)}
            className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors"
            style={{ color: c.text }}
            onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新建文件
          </button>
          <button
            onClick={() => handleOpenNewFolderFromMenu(ctxMenu.dirPath)}
            className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors"
            style={{ color: c.text }}
            onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17h6m-3-6v6m-8-3a9 9 0 1018 0 9 9 0 00-18 0z" />
            </svg>
            新建文件夹
          </button>
          {ctxMenu.nodePath && (
            <>
              <div className="border-t my-1" style={{ borderColor: c.borderLight }} />
              <button
                onClick={() => handleOpenRename(ctxMenu.nodePath!)}
                className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors"
                style={{ color: c.text }}
                onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                重命名
              </button>
              <button
                onClick={() => handleOpenDeleteConfirm(ctxMenu.nodePath!, !!ctxMenu.isDir)}
                className="w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors"
                style={{ color: c.toolErr }}
                onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                删除
              </button>
            </>
          )}
        </div>
      )}

      {/* New folder dialog */}
      {showNewFolderDialog && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-12"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => { setShowNewFolderDialog(false); setNewFolderName('') }}>
          <div className="rounded-xl shadow-lg p-4 w-72 border"
            style={{ background: c.modalBg, borderColor: c.border }}
            onClick={e => e.stopPropagation()}>
            <div className="text-[13px] font-semibold mb-1" style={{ color: c.textHead }}>新建文件夹</div>
            <div className="text-[10px] mb-3 truncate" style={{ color: c.textMuted }}>{newFolderDir}</div>
            <input ref={newFolderInputRef} type="text" value={newFolderName}
              onChange={e => { setNewFolderName(e.target.value); setNewFolderError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmCreateFolder(); else if (e.key === 'Escape') { setShowNewFolderDialog(false); setNewFolderName('') } }}
              placeholder="文件夹名称" className="w-full px-3 py-2 rounded-lg text-[13px] border outline-none mb-2"
              style={{ background: c.bgInput, borderColor: newFolderError ? c.toolErr : c.borderLight, color: c.text }} />
            {newFolderError && <div className="text-[11px] mb-2" style={{ color: c.toolErr }}>{newFolderError}</div>}
            <div className="flex gap-2 justify-end mt-3">
              <button onClick={() => { setShowNewFolderDialog(false); setNewFolderName('') }} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textMuted }}>取消</button>
              <button onClick={handleConfirmCreateFolder} disabled={creatingFolder || !newFolderName.trim()}
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ background: c.accent, color: c.accentText }}>
                {creatingFolder ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {showRenameDialog && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-12"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => { setShowRenameDialog(false); setRenameName('') }}>
          <div className="rounded-xl shadow-lg p-4 w-72 border"
            style={{ background: c.modalBg, borderColor: c.border }}
            onClick={e => e.stopPropagation()}>
            <div className="text-[13px] font-semibold mb-1" style={{ color: c.textHead }}>重命名</div>
            <div className="text-[10px] mb-3 truncate" style={{ color: c.textMuted }}>{renamePath}</div>
            <input ref={renameInputRef} type="text" value={renameName}
              onChange={e => { setRenameName(e.target.value); setRenameError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(); else if (e.key === 'Escape') { setShowRenameDialog(false) } }}
              placeholder="新名称" className="w-full px-3 py-2 rounded-lg text-[13px] border outline-none mb-2"
              style={{ background: c.bgInput, borderColor: renameError ? c.toolErr : c.borderLight, color: c.text }} />
            {renameError && <div className="text-[11px] mb-2" style={{ color: c.toolErr }}>{renameError}</div>}
            <div className="flex gap-2 justify-end mt-3">
              <button onClick={() => { setShowRenameDialog(false) }} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textMuted }}>取消</button>
              <button onClick={handleConfirmRename} disabled={renaming || !renameName.trim()}
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ background: c.accent, color: c.accentText }}>
                {renaming ? '重命名中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-12"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setShowDeleteConfirm(false)}>
          <div className="rounded-xl shadow-lg p-4 w-80 border"
            style={{ background: c.modalBg, borderColor: c.border }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5" style={{ color: c.toolErr }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="text-[13px] font-semibold" style={{ color: c.textHead }}>确认删除</div>
            </div>
            <div className="text-[12px] mb-4" style={{ color: c.textSecondary }}>
              Delete {deleteName} 此操作不可撤销。
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 rounded-lg text-[12px]" style={{ color: c.textMuted }}>取消</button>
              <button onClick={handleConfirmDelete} disabled={deleting}
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ background: c.toolErr, color: '#fff' }}>
                {deleting ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git status bar */}
      {gitStatus && gitStatus.isGitRepo && (
        <div className="h-7 flex items-center px-3 gap-2 shrink-0 border-t text-[10px]" style={{ borderColor: c.borderLight, background: c.bgInput, color: c.textMuted }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          </svg>
          <span style={{ color: c.textSecondary }}>{gitStatus.branch}</span>
          <span className="ml-auto flex gap-2">
            {gitStatus.stats.modified > 0 && <span style={{ color: '#d29922' }}>M:{gitStatus.stats.modified}</span>}
            {gitStatus.stats.untracked > 0 && <span style={{ color: '#58a6ff' }}>U:{gitStatus.stats.untracked}</span>}
            {gitStatus.stats.added > 0 && <span style={{ color: '#3fb950' }}>A:{gitStatus.stats.added}</span>}
          </span>
          {gitLoading && <div className="w-2.5 h-2.5 border rounded-full animate-spin ml-1" style={{ borderColor: c.border, borderTopColor: c.accent }} />}
        </div>
      )}
    </div>
  )
}

/** Recursively check if path is directory */
function isDirPath(node: FileNode, target: string): boolean {
  if (node.path === target && node.type === 'directory') return true
  if (node.children) return node.children.some(c => isDirPath(c, target))
  return false
}
