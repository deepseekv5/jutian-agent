/**
 * JT Core Ultra / context —— gemini-cli services/ideContext.ts + fileDiscoveryService.ts
 * + core/coreToolScheduler 的工具输出裁剪概念移植。
 * 工作区上下文（打开文件/光标选区）、gitignore 感知的文件发现、工具输出 head/tail 裁剪。
 * 零依赖（Apache-2.0）。
 */
export interface IdeFile { path: string; isActive?: boolean; cursor?: { line: number; character: number }; selectedText?: string; timestamp?: number }
export class IdeContextStore {
  private files = new Map<string, IdeFile>()
  set(f: IdeFile): void { this.files.set(f.path, { ...f, timestamp: Date.now() }) }
  remove(path: string): void { this.files.delete(path) }
  clear(): void { this.files.clear() }
  /** 生成注入到系统提示词的上下文块（有选区时高亮） */
  toPromptBlock(): string {
    if (!this.files.size) return ''
    const active = [...this.files.values()].filter(f => f.isActive)
    const lines = active.map(f => {
      const sel = f.selectedText ? `（选区：${f.selectedText.slice(0, 200)}）` : ''
      const cur = f.cursor ? `:${f.cursor.line + 1}` : ''
      return `- ${f.path}${cur}${sel}`
    })
    return lines.length ? `【IDE 上下文】当前打开：\n${lines.join('\n')}\n修改文件前优先参考这些文件的真实内容。` : ''
  }
  get openFiles(): IdeFile[] { return [...this.files.values()] }
}

/** .gitignore 风格忽略判定（简单通配，无需 fs 遍历） */
export class IgnoreMatcher {
  private patterns: string[] = []
  constructor(patterns: string[] = []) { this.patterns = patterns }
  add(p: string): void { this.patterns.push(p) }
  isIgnored(relPath: string): boolean {
    const p = relPath.replace(/\\/g, '/')
    return this.patterns.some(raw => {
      const pat = raw.trim().replace(/^\//, '').replace(/\/$/, '')
      if (!pat || pat.startsWith('#')) return false
      if (pat.includes('*')) {
        const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '($|/)')
        return re.test(p)
      }
      return p === pat || p.startsWith(pat + '/') || p.split('/').includes(pat)
    })
  }
}
/** 文件发现：过滤忽略项 + 排序（目录优先、按路径） */
export function discoverFiles(paths: string[], matcher: IgnoreMatcher, limit = 200): string[] {
  return paths.filter(p => !matcher.isIgnored(p)).sort((a, b) => {
    const ad = a.includes('/') ? 0 : 1, bd = b.includes('/') ? 0 : 1
    return ad - bd || a.localeCompare(b)
  }).slice(0, limit)
}

/** 工具输出裁剪：保留头尾（gemini-cli 大输出折叠），可配置预算 */
export function clampOutput(text: string, maxChars = 40_000, headRatio = 0.7): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * headRatio)
  const tail = maxChars - head - 60
  return text.slice(0, head) + `\n\n…[省略 ${text.length - head - tail} 字符]…\n\n` + text.slice(-tail)
}
