/**
 * AGENTS.md 项目指令（v11.0.1，跨工具标准，CLAUDE.md 回退）
 * 工作目录根的 AGENTS.md 自动注入主对话系统提示词。
 * 同步读取走缓存：send 前 refreshAgentsMd(workDir) 刷新一次。
 */

let cache = { workDir: '', content: '', fetchedAt: 0 }

/** 拉取工作目录的 AGENTS.md（回退 CLAUDE.md），5 分钟内不重复请求 */
export async function refreshAgentsMd(workDir: string): Promise<void> {
  const dir = String(workDir || '').trim()
  if (!dir) { cache = { workDir: '', content: '', fetchedAt: Date.now() }; return }
  if (cache.workDir === dir && Date.now() - cache.fetchedAt < 5 * 60 * 1000) return
  cache = { workDir: dir, content: '', fetchedAt: Date.now() }
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    try {
      const res = await fetch(`/api/code/read-file?path=${encodeURIComponent(dir + '/' + name)}`)
      if (!res.ok) continue
      const d = await res.json().catch(() => null)
      const content = String(d?.content || '').trim()
      if (d?.success && content) { cache.content = content.slice(0, 8000); return }
    } catch { /* 服务不可用则无注入 */ }
  }
}

/** 当前缓存的 AGENTS.md 内容（未加载返回空串） */
export function getAgentsMd(workDir: string): string {
  const dir = String(workDir || '').trim()
  return cache.workDir === dir ? cache.content : ''
}
