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

  const create = useCallback(async (title?: string) => {
    const s = await storage.createSession(title)
    setSessions(prev => [s, ...prev])
    setActiveId(s.id)
    return s
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

  return { sessions, activeId, setActiveId, create, remove, updateTitle, refresh }
}
