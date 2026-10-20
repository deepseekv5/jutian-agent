/**
 * 片段存储（v12）
 *
 * 单独成文件而不是放在 SnippetsPanel 里：MessageInput 需要读取片段做
 * 触发器展开，若从懒加载面板 import，会把整个面板并进首屏 chunk
 * （vite 懒加载坑，见记忆 jutian-vite-lazy-chunk-hazard）。
 */
import { readJson, writeJson } from '../utils/safeStorage'
import type { Snippet } from '../../shared/snippets'

const KEY = 'snippets'

export function loadSnippets(): Snippet[] {
  const list = readJson<Snippet[]>(KEY, [], (v): v is Snippet[] => Array.isArray(v))
  return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string' && typeof s.body === 'string') : []
}

export function saveSnippets(list: Snippet[]): void {
  writeJson(KEY, list)
  try { window.dispatchEvent(new CustomEvent('snippets-updated')) } catch { /* ignore */ }
}
