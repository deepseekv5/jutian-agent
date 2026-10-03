// Code 项目状态管理 Hook
import { useState, useCallback, useEffect, useRef } from 'react'
import type { CodeProject, FileNode, EditorTab } from '../types/code'
import { getLanguage } from '../types/code'
import * as CS from '../store/codeStorage'

export function useCodeProject() {
  const [projects, setProjects] = useState<CodeProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [projectRoot, setProjectRoot] = useState<string>('')
  const [treeLoading, setTreeLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // ref 用于回调中获取最新的 activeProjectId，无需加入 deps 导致重复创建
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId

  // 待打开的文件（创建项目时指定，等待文件树加载完成后打开）
  const pendingOpenFile = useRef<string | null>(null)
  // ref 用于 loadFileTree 回调中获取最新的 openFile
  const openFileRef = useRef<(path: string, name: string) => void>(() => {})

  // 加载项目列表（localStorage 优先，空时从 SQLite 恢复）
  useEffect(() => {
    const load = async () => {
      const projects = await CS.restoreFromBackend()
      setProjects(projects)
    }
    load()
  }, [])

  const activeProject = projects.find(p => p.id === activeProjectId) || null

  // 当激活项目变化时，加载文件树和之前打开的 Tab
  useEffect(() => {
    if (!activeProjectId) {
      setFileTree([])
      setTabs([])
      setProjectRoot('')
      // 不清空存储的激活项目：下次进入自动恢复（"重新进入"）
      return
    }
    CS.setActiveProjectId(activeProjectId)
    const project = projects.find(p => p.id === activeProjectId)
    if (!project) return
    setProjectRoot(project.rootPath)
    loadFileTree(project.rootPath)

    // 恢复之前打开的 Tab 信息
    const savedTabs = CS.getOpenTabs()
    if (savedTabs.length > 0) {
      const editorTabs: EditorTab[] = savedTabs.map(t => ({
        path: t.path,
        name: t.name,
        language: t.language,
        content: '',
        modified: false,
        originalContent: '',
      }))
      setTabs(editorTabs)
      setActiveTabPath(savedTabs[0].path)
    }
  }, [activeProjectId, projects])

  // 通过 API 加载文件树
  const loadFileTree = useCallback(async (rootPath: string) => {
    setTreeLoading(true)
    try {
      const res = await fetch('/api/code/read-dir?path=' + encodeURIComponent(rootPath))
      if (!res.ok) throw new Error('Failed to read directory')
      const nodes: FileNode[] = await res.json()
      setFileTree(nodes)
      // 检查是否有待打开的文件
      if (pendingOpenFile.current) {
        const filePath = pendingOpenFile.current
        pendingOpenFile.current = null
        const fileName = filePath.split('/').pop() || filePath
        // 延迟一帧，确保文件树状态已更新
        requestAnimationFrame(() => {
          openFileRef.current?.(filePath, fileName)
        })
      }
    } catch {
      setFileTree([])
    } finally {
      setTreeLoading(false)
    }
  }, [])

  // 创建项目
  const createProject = useCallback((name: string, rootPath: string, openFilePath?: string) => {
    const project = CS.createProject(name, rootPath)
    setProjects(prev => [project, ...prev])
    setActiveProjectId(project.id)
    // 如果指定了要打开的文件，存储到 ref 中，等 effect 加载完成后打开
    if (openFilePath) {
      pendingOpenFile.current = openFilePath
    }
    return project
  }, [])

  // 删除项目
  const removeProject = useCallback((id: string) => {
    CS.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) {
      setActiveProjectId(null)
    }
  }, [activeProjectId])

  // 打开文件到编辑器
  const openFile = useCallback(async (filePath: string, fileName: string) => {
    // 检查是否已经打开
    const existing = tabs.find(t => t.path === filePath)
    if (existing) {
      setActiveTabPath(filePath)
      // 如果已有 tab 但内容为空（从 localStorage 恢复的占位 tab），需要重新加载
      if (!existing.content) {
        try {
          const res = await fetch('/api/code/read-file?path=' + encodeURIComponent(filePath))
          if (!res.ok) return
          const data = await res.json()
          const content = data.content || ''
          setTabs(prev => prev.map(t =>
            t.path === filePath
              ? { ...t, content, originalContent: content, modified: false }
              : t
          ))
        } catch { /* 加载失败，保持空内容 */ }
      }
      return
    }

    // 加载文件内容
    try {
      const res = await fetch('/api/code/read-file?path=' + encodeURIComponent(filePath))
      if (!res.ok) throw new Error('Failed to read file')
      const data = await res.json()
      const content = data.content || ''
      const tab: EditorTab = {
        path: filePath,
        name: fileName,
        language: getLanguage(fileName),
        content,
        modified: false,
        originalContent: content,
      }
      setTabs(prev => {
        const updated = [...prev, tab]
        // 保存 Tab 状态（localStorage + 后台 SQLite）
        const savedTabs = updated.map(t => ({ path: t.path, name: t.name, language: t.language }))
        CS.saveOpenTabs(savedTabs)
        CS.syncTabsToBackend(activeProjectIdRef.current || '', savedTabs)
        return updated
      })
      setActiveTabPath(filePath)
    } catch {
      // 文件读取失败，静默处理
    }
  }, [tabs])
  openFileRef.current = openFile

  // 关闭 Tab
  const closeTab = useCallback((filePath: string) => {
    setTabs(prev => {
      const updated = prev.filter(t => t.path !== filePath)
      const savedTabs = updated.map(t => ({ path: t.path, name: t.name, language: t.language }))
      CS.saveOpenTabs(savedTabs)
      CS.syncTabsToBackend(activeProjectIdRef.current || '', savedTabs)
      if (activeTabPath === filePath) {
        const idx = prev.findIndex(t => t.path === filePath)
        const next = updated[idx] || updated[Math.max(0, idx - 1)]
        setActiveTabPath(next?.path || null)
      }
      return updated
    })
  }, [activeTabPath])

  // 更新编辑器内容
  const updateContent = useCallback((filePath: string, content: string) => {
    setTabs(prev => prev.map(t =>
      t.path === filePath ? { ...t, content, modified: content !== t.originalContent } : t
    ))
  }, [])

  // 保存文件
  const saveFile = useCallback(async (filePath: string) => {
    const tab = tabs.find(t => t.path === filePath)
    if (!tab) return false
    setSaving(true)
    try {
      const res = await fetch('/api/code/write-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: tab.content }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setTabs(prev => prev.map(t =>
        t.path === filePath ? { ...t, modified: false, originalContent: tab.content } : t
      ))
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }, [tabs])

  // 刷新文件树
  const refreshTree = useCallback(() => {
    if (projectRoot) loadFileTree(projectRoot)
  }, [projectRoot, loadFileTree])

  // 创建新文件
  const createFile = useCallback(async (dirPath: string, fileName: string, overwrite = false): Promise<{ success: boolean; error?: string; exists?: boolean; path?: string }> => {
    try {
      const res = await fetch('/api/code/create-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath, fileName, overwrite }),
      })
      return await res.json()
    } catch {
      return { success: false, error: '网络请求失败' }
    }
  }, [])

  const activeTab = tabs.find(t => t.path === activeTabPath) || null


  // 强制重新读取磁盘内容到已打开的标签(diff 撤销/应用后刷新)
  const reloadFile = useCallback(async (filePath: string) => {
    try {
      const res = await fetch('/api/code/read-file?path=' + encodeURIComponent(filePath))
      if (!res.ok) return
      const data = await res.json()
      const content = data.content || ''
      setTabs(prev => {
        const hit = prev.some(t => t.path === filePath)
        if (!hit) return prev
        return prev.map(t => t.path === filePath ? { ...t, content, originalContent: content, modified: false } : t)
      })
    } catch { /* ignore */ }
  }, [])

  return {
    projects, activeProjectId, activeProject, fileTree, treeLoading,
    tabs, activeTabPath, activeTab, projectRoot,
    setActiveProjectId, createProject, removeProject,
    openFile, closeTab, updateContent, saveFile, refreshTree, reloadFile,
    saving, loadFileTree, createFile,
  }
}
