// 路径取末段 / 取父目录。
//
// Windows 上后端返回的是反斜杠路径（C:\Users\me\proj\a.ts），
// 只 split('/') 会整条路径原样当地基名显示在 tab、附件条、
// 文件树、diff 卡片上；同理，用 split('/') + join('/') 反推父目录
// 在 Windows 上算出来的是**整条路径**（一个 '/' 都找不到），
// 于是"拖文件进来"会把 cwd 当成项目根，直接建错项目。
// 统一走这里，两种分隔符都认。

const SEP = /[\\/]/

/** 取路径最后一段；空路径或纯分隔符返回空串 */
export function baseName(p: unknown): string {
  const s = String(p ?? '').replace(/[\\/]+$/, '')
  if (!s) return ''
  const seg = s.split(SEP)
  return seg[seg.length - 1] || ''
}

/** 取路径最后一段，为空时回退到原值（用于必须有东西可显示的 UI） */
export function baseNameOr(p: unknown, fallback = ''): string {
  return baseName(p) || String(p ?? '') || fallback
}

/** 去掉结尾分隔符 */
export function stripTrailingSep(p: unknown): string {
  return String(p ?? '').replace(/[\\/]+$/, '')
}

/**
 * 取父目录，保留原路径的分隔符风格和 Windows 盘符。
 * 返回空串表示"没有父目录了"（根、单个文件名、空串）。
 *
 *   /a/b/c.ts     -> /a/b
 *   C:\a\b\c.ts   -> C:\a\b
 *   C:\c.ts       -> C:\
 *   c.ts          -> ''
 */
export function dirName(p: unknown): string {
  const s = stripTrailingSep(p)
  if (!s) return ''
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  if (i < 0) return ''
  if (i === 0) return s[0] // 根："/" 或 "\"
  // Windows 盘符根："C:\" 要保留反斜杠，不能退化成 "C:"
  if (i === 2 && /^[A-Za-z]:/.test(s)) return s.slice(0, 3)
  return s.slice(0, i)
}
