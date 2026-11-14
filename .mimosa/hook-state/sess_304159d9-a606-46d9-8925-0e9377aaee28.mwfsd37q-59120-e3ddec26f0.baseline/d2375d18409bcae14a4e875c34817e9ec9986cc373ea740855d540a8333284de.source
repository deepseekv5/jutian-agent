import { useState, useEffect, useCallback, useRef } from 'react'
import type { Session } from '../types'
import * as storage from '../store/storage'

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await storage.listSessions()
    setSessions(list)
    if (list.length > 0 && !activeId) {
      setActiveId(list[0].id)
    }
  }, [activeId])

  useEffect(() => {
    refresh()
    // refresh 依赖 activeId：纳入依赖会在每次切换会话时重复拉取列表，保持仅首屏加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const create = useCallback(async (title?: string, project?: string) => {
    const s = await storage.createSession(title, project)
    setSessions(prev => [s, ...prev])
    setActiveId(s.id)
    return s
  }, [])

  // 引用稳定化（v14.47.0）：ChatTab 的 onProjectChange effect 依赖本回调，
  // 旧实现 [sessions] 依赖让回调身份每次会话状态更新都变 → effect 无限重触发 →
  // PUT /api/sessions/:id 以 ~900 次/秒自激（实测 CPU 88%）。改为 ref 读最新值，依赖空数组。
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const setProject = useCallback(async (id: string, project: string) => {
    // 值未变化则跳过，避免每次打开会话都写盘
    const cur = sessionsRef.current.find(s => s.id === id)
    if (cur && (cur.project || '') === (project || '')) return
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, project } : s)))
    await storage.setSessionProject(id, project)
  }, [])

  const remove = useCallback(async (id: string) => {
    await storage.deleteSession(id)
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      if (activeId === id) {
        setActiveId(next.length > 0 ? next[0].id : null)
      }
      return next
    })
  }, [activeId])

  const updateTitle = useCallback(async (id: string, title: string) => {
    const safeTitle = String(title || '新对话')
    await storage.updateSessionTitle(id, safeTitle)
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: safeTitle } : s))
  }, [])

  return { sessions, activeId, setActiveId, create, remove, updateTitle, setProject, refresh }
}
