import { useState, useEffect, useCallback } from 'react'
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

  useEffect(() => { refresh() }, [])

  const create = useCallback(async (title?: string, project?: string) => {
    const s = await storage.createSession(title, project)
    setSessions(prev => [s, ...prev])
    setActiveId(s.id)
    return s
  }, [])

  const setProject = useCallback(async (id: string, project: string) => {
    // 值未变化则跳过，避免每次打开会话都写盘
    const cur = sessions.find(s => s.id === id)
    if (cur && (cur.project || '') === (project || '')) return
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, project } : s)))
    await storage.setSessionProject(id, project)
  }, [sessions])

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
