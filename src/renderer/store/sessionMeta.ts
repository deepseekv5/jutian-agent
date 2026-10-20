/**
 * 会话元信息存储（v12）：置顶 / 标签 / 归档
 *
 * 落 localStorage（经 safeStorage），结构是 { [sessionId]: SessionMeta }。
 * 与侧栏已有的"starred"收藏并存：starred 是快速标星，meta 是分类管理。
 */
import { useEffect, useState } from 'react'
import { readJson, writeJson } from '../utils/safeStorage'
import type { SessionMeta } from '../../shared/sessionMeta'
import { emptyMeta } from '../../shared/sessionMeta'

const KEY = 'session-meta'
export const META_EVENT = 'session-meta-updated'

export type MetaMap = Record<string, SessionMeta>

export function loadMetaMap(): MetaMap {
  const raw = readJson<MetaMap>(KEY, {}, (v): v is MetaMap => !!v && typeof v === 'object' && !Array.isArray(v))
  // 清洗：只保留形状对的条目，避免旧版本残留把 UI 弄崩
  const out: MetaMap = {}
  for (const [id, m] of Object.entries(raw || {})) {
    if (!m || typeof m !== 'object') continue
    out[id] = {
      id,
      tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
      pinnedAt: typeof m.pinnedAt === 'number' ? m.pinnedAt : undefined,
      note: typeof m.note === 'string' ? m.note.slice(0, 200) : undefined,
      archived: m.archived === true,
    }
  }
  return out
}

export function saveMeta(id: string, next: SessionMeta | null): void {
  const map = loadMetaMap()
  if (!next || (!next.tags.length && !next.pinnedAt && !next.archived && !next.note)) {
    // 全空就删掉，避免元信息表无限膨胀
    delete map[id]
  } else {
    map[id] = next
  }
  writeJson(KEY, map)
  try { window.dispatchEvent(new CustomEvent(META_EVENT)) } catch { /* ignore */ }
}

export function getMeta(id: string): SessionMeta {
  return loadMetaMap()[id] || emptyMeta(id)
}

/** 组件用：订阅元信息变化，返回当前映射 */
export function useMetaMap(): MetaMap {
  const [map, setMap] = useState<MetaMap>(loadMetaMap)
  useEffect(() => {
    const reload = () => setMap(loadMetaMap())
    window.addEventListener(META_EVENT, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(META_EVENT, reload)
      window.removeEventListener('storage', reload)
    }
  }, [])
  return map
}
