/**
 * 草稿存储（v12.1）
 *
 * 走 safeStorage，按 sessionId 分桶。切换会话/意外关窗后还能拿回打了一半的内容。
 */
import { readJson, writeJson } from '../utils/safeStorage'
import { upsertDraft, removeDraft, getDraft, pruneDrafts, type Draft } from '../../shared/drafts'

const KEY = 'drafts'

export function loadDrafts(): Draft[] {
  const list = readJson<Draft[]>(KEY, [], (v): v is Draft[] => Array.isArray(v))
  return Array.isArray(list) ? pruneDrafts(list.filter((d) => d && typeof d.sessionId === 'string')) : []
}

export function saveDraft(sessionId: string, text: string): void {
  if (!sessionId) return
  writeJson(KEY, upsertDraft(loadDrafts(), sessionId, text))
}

export function dropDraft(sessionId: string): void {
  if (!sessionId) return
  writeJson(KEY, removeDraft(loadDrafts(), sessionId))
}

export function readDraft(sessionId: string): string {
  if (!sessionId) return ''
  return getDraft(loadDrafts(), sessionId)
}
