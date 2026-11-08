/** 消息收藏（v14.16.0）：hover ★ 收藏，跨会话聚合，命令面板/新标签页直达原消息 */
export interface Favorite {
  id: string
  sessionId: string
  msgId: string
  role: 'user' | 'assistant'
  excerpt: string
  ts: number
}

const KEY = 'lyclaw_favorites'
const MAX = 100

export function loadFavorites(): Favorite[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
export function isFavorited(msgId: string): boolean {
  return loadFavorites().some(f => f.msgId === msgId)
}
export function toggleFavorite(f: Omit<Favorite, 'id' | 'ts'>): boolean {
  const list = loadFavorites()
  const i = list.findIndex(x => x.msgId === f.msgId)
  if (i >= 0) { list.splice(i, 1); localStorage.setItem(KEY, JSON.stringify(list)); return false }
  list.unshift({ ...f, id: Math.random().toString(36).slice(2, 9), ts: Date.now() })
  if (list.length > MAX) list.length = MAX
  localStorage.setItem(KEY, JSON.stringify(list))
  try { window.dispatchEvent(new CustomEvent('favorites-changed')) } catch {}
  return true
}
export function removeFavorite(id: string): void {
  const list = loadFavorites().filter(x => x.id !== id)
  localStorage.setItem(KEY, JSON.stringify(list))
  try { window.dispatchEvent(new CustomEvent('favorites-changed')) } catch {}
}
