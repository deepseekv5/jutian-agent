/**
 * 调研工作台的跨组件桥 —— 单例标签页的"带问题打开"通道
 *
 * 调研页是单实例标签：从聊天输入框点「调研」时标签可能已经开着，
 * 此时不会重新挂载，所以用事件把初始问题送过去，而不是逐层传 props/state。
 * 单独成模块是为了保住 ResearchPanel 的懒加载——若 App.tsx 静态 import
 * 整个面板模块，vite 会把它并进首屏 chunk。
 */
export const RESEARCH_SEED_EVENT = 'research-seed'

export function sendResearchSeed(q: string) {
  window.dispatchEvent(new CustomEvent(RESEARCH_SEED_EVENT, { detail: String(q || '') }))
}

/** 面板侧订阅：返回取消函数 */
export function onResearchSeed(cb: (q: string) => void): () => void {
  const h = (e: Event) => {
    const q = String((e as CustomEvent).detail || '').trim()
    if (q) cb(q)
  }
  window.addEventListener(RESEARCH_SEED_EVENT, h)
  return () => window.removeEventListener(RESEARCH_SEED_EVENT, h)
}
