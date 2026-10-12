// 拖拽入图（composer）的纯逻辑。
//
// 拖拽和文件选择对话框不同，坏情况多得多：
//  - 拖进来的可能是一个目录 / 一段 URL / 一张网页上的图片
//  - 0 字节文件（从某些应用拖出来会是空壳）
//  - 同一次拖入里重名文件
//  - 超大文件直接塞进请求体，模型调用会失败
// 所以判定逻辑抽出来单独测，DOM 接线只管调用。

/** 附件大小上限：超过就不收。多模态图片按 base64 内联，体积会膨胀 ~4/3 */
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024

/** 允许的附件类型前缀（不逐个枚举 MIME，按前缀放行，留扩展空间） */
const ALLOWED_PREFIXES = ['text/', 'image/', 'application/json', 'application/pdf']

/** 判定用的事实：名字/大小/MIME。File 与 {name,size,type} 都满足这个形状 */
export interface DragPick {
  name: string
  size: number
  type: string
}

export interface PickResult<T extends DragPick = DragPick> {
  accepted: T[]
  rejected: { name: string; reason: 'empty' | 'too-large' | 'unsupported' | 'duplicate' }[]
}

/**
 * 从一次拖入的文件列表里筛出可用的附件。
 * 泛型透传：传 File 进去拿回来的还是 File，调用方直接挂到附件列表上，
 * 不用再转一道。
 * @param files    本次拖入的文件
 * @param existing 已在附件列表里的文件名（用于去重）
 */
export function pickDroppedFiles<T extends DragPick>(files: T[], existing: string[] = []): PickResult<T> {
  const accepted: T[] = []
  const rejected: PickResult<T>['rejected'] = []
  const seen = new Set(existing)

  for (const f of files) {
    if (!f.name) { rejected.push({ name: '(未命名)', reason: 'unsupported' }); continue }
    if (seen.has(f.name)) { rejected.push({ name: f.name, reason: 'duplicate' }); continue }

    if (f.size === 0) { rejected.push({ name: f.name, reason: 'empty' }); continue }
    if (f.size > MAX_ATTACH_BYTES) { rejected.push({ name: f.name, reason: 'too-large' }); continue }

    // type 为空时按扩展名兜底判断（部分应用拖出文件不带 MIME）
    const ok = isSupported(f.name, f.type)
    if (!ok) { rejected.push({ name: f.name, reason: 'unsupported' }); continue }

    seen.add(f.name)
    accepted.push(f)
  }
  return { accepted, rejected }
}

/** 是否支持的附件：先看 MIME 前缀，MIME 缺失时退回扩展名判断 */
export function isSupported(name: string, mime: string): boolean {
  if (mime && ALLOWED_PREFIXES.some(p => mime.startsWith(p))) return true
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return SUPPORTED_EXT.has(ext)
}

/** 默认放行的扩展名（MIME 缺失时的兜底表） */
export const SUPPORTED_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.yaml', '.yml', '.toml', '.ini', '.xml',
  '.sql', '.sh', '.bat', '.ps1',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
  '.pdf',
])

/** 拖放提示文案：有拒绝项时说明原因，否则显示已收下的数量 */
export function dragHint(result: PickResult | null): string {
  if (!result || (result.accepted.length === 0 && result.rejected.length === 0)) return ''
  if (result.accepted.length === 0 && result.rejected.length > 0) {
    const r = result.rejected[0]
    const why = r.reason === 'empty' ? '空文件'
      : r.reason === 'too-large' ? `超过 ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)}MB`
      : r.reason === 'duplicate' ? '已在附件中'
      : '不支持的类型'
    return `未添加「${r.name}」：${why}${result.rejected.length > 1 ? `（另有 ${result.rejected.length - 1} 个）` : ''}`
  }
  if (result.rejected.length > 0) {
    return `已添加 ${result.accepted.length} 个，跳过 ${result.rejected.length} 个（空/超限/重复/不支持）`
  }
  return `已添加 ${result.accepted.length} 个文件`
}
