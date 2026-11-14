/**
 * 免费模型清单的运行时来源（v12.5）
 *
 * 单独成文件而不是从 MessageInput 里 export：ComparePanel 也要用，
 * 而 MessageInput 是重组件——从它 import 会把整个输入框并进对比面板的
 * chunk（vite 懒加载坑，见记忆 jutian-vite-lazy-chunk-hazard）。
 *
 * 与服务端 fetch 失败时的离线兜底一致（src/shared/opencodeZen.ts）。
 */
export const FREE_FALLBACK = [
  'big-pickle', 'mimo-v2.6-flash-free', 'nemotron-3.5-lightning-free',
  'step-5-preview-free', 'longcat-2.5-preview-free', 'space-bunny-free', 'openai-fast',
]

let cached: string[] | null = null

export async function fetchFreeModels(): Promise<string[]> {
  if (cached) return cached
  try {
    const r = await fetch('/api/free-models')
    const d = await r.json()
    if (d?.ok) {
      const ids: string[] = (d.sources || []).flatMap((s: any) => (s.models || [])
        .filter((m: any) => !m.unavailable)
        .map((m: any) => String(m.id)))
      const uniq = [...new Set(ids)].filter(Boolean)
      if (uniq.length) { cached = uniq; return uniq }
    }
  } catch { /* 离线兜底 */ }
  return FREE_FALLBACK
}

/** 同步取（首次调用前是离线兜底，之后是缓存）——给不需要等待的场景 */
export const freeModels: string[] = FREE_FALLBACK

/** 预热缓存（挂载时调一次） */
export function warmFreeModels(): void {
  fetchFreeModels().then((ids) => {
    // 替换数组内容而不是换引用：同步导出的 freeModels 引用不能变
    freeModels.length = 0
    freeModels.push(...ids)
  }).catch(() => {})
}
