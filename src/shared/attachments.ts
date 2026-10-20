/**
 * 附件与粘贴处理（v12 新功能）
 *
 * 解决三类真实痛点：
 *   1. 粘贴超长文本 → 转成文件附件（避免撑爆输入框与上下文）
 *   2. 图片粘贴 → 统一命名 + 去重（同图多次粘贴只留一份）
 *   3. 拖入文件夹 → 展开为文件清单（带数量上限，防卡死）
 */

export interface PendingAttachment {
  name: string
  path: string
  size: number
  kind: 'file' | 'image' | 'text'
  /** 文本类附件的内联内容（长文本粘贴时使用） */
  content?: string
}

/** 超过这个字符数的粘贴转成附件 */
export const PASTE_AS_FILE_THRESHOLD = 8000
/** 单次展开文件夹的文件上限 */
export const MAX_FOLDER_FILES = 200

/** 是否是图片 mime */
export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(String(mime || ''))
}

/** 是否是文本类 mime（可直接内联） */
export function isTextMime(mime: string): boolean {
  return /^text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml)/i.test(String(mime || ''))
}

/**
 * 判断粘贴内容该内联还是转附件。
 * 返回 'inline' 表示正常粘进输入框。
 */
export function pasteDisposition(textLength: number, mime = 'text/plain'): 'inline' | 'file' {
  if (isImageMime(mime)) return 'file'
  return textLength > PASTE_AS_FILE_THRESHOLD ? 'file' : 'inline'
}

/** 从粘贴的文本生成附件名：取首行做提示，加时间戳避免覆盖 */
export function pastedFileName(text: string, now = Date.now()): string {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || 'pasted'
  const base = first.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'pasted'
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${base}-${stamp}.txt`
}

/** 图片附件名 */
export function imageFileName(mime: string, now = Date.now(), seq = 0): string {
  const ext = String(mime).split('/')[1]?.replace('+xml', '') || 'png'
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `image-${stamp}${seq ? '-' + seq : ''}.${ext === 'jpeg' ? 'jpg' : ext}`
}

/** 人类可读体积 */
export function humanSize(bytes: number): string {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** 按路径去重（附件列表常见：同一文件拖两次） */
export function dedupeAttachments<T extends { path?: string; name: string; size?: number }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const a of list) {
    const key = (a.path || a.name || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

/** 附件总体积是否超限（部分上游限制请求体大小） */
export function exceedsSizeLimit(list: { size?: number }[], limitBytes = 20 * 1024 * 1024): boolean {
  return list.reduce((sum, a) => sum + (Number(a.size) || 0), 0) > limitBytes
}

/**
 * 拖入项展开策略：文件直接用；目录交给后端枚举（这里只做数量校验）。
 * 返回需要提示用户的告警文案，无告警返回 null。
 */
export function folderWarning(fileCount: number): string | null {
  if (fileCount <= 0) return '这个文件夹是空的'
  if (fileCount > MAX_FOLDER_FILES) return `文件夹里有 ${fileCount} 个文件，超过 ${MAX_FOLDER_FILES} 的上限；请先筛选后再拖入`
  return null
}
