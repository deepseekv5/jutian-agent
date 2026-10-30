/**
 * 代码大纲提取（v13.7）—— VSCode 的 Outline 视图
 *
 * 纯正则实现，覆盖主流语言的高频符号：
 *   JS/TS  function / const fn = () => / class / interface / type / enum
 *   Python  def / class
 *   Go      func / type
 *   Rust    fn / struct / enum / impl / trait
 *   Java/Kotlin  class / interface / enum / void 方法
 *   Markdown  # 标题
 * 不是完整 parser（那要拖 10MB 的 tree-sitter），但足够做出可点击跳转的大纲。
 */

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'method' | 'heading' | 'const' | 'struct' | 'trait'

export interface CodeSymbol {
  name: string
  kind: SymbolKind
  /** 1-based 行号 */
  line: number
  /** 缩进层级（用于大纲树形缩进） */
  depth: number
}

const KIND_LABEL: Record<SymbolKind, { zh: string; en: string; glyph: string }> = {
  function: { zh: '函数', en: 'fn', glyph: 'ƒ' },
  method: { zh: '方法', en: 'method', glyph: 'ƒ' },
  class: { zh: '类', en: 'class', glyph: 'C' },
  struct: { zh: '结构体', en: 'struct', glyph: 'S' },
  interface: { zh: '接口', en: 'interface', glyph: 'I' },
  trait: { zh: 'trait', en: 'trait', glyph: 'T' },
  type: { zh: '类型', en: 'type', glyph: 'T' },
  enum: { zh: '枚举', en: 'enum', glyph: 'E' },
  const: { zh: '常量', en: 'const', glyph: '=' },
  heading: { zh: '标题', en: 'heading', glyph: '#' },
}

export function kindLabel(kind: SymbolKind, lang: 'zh' | 'en'): string {
  const k = KIND_LABEL[kind]
  return lang === 'en' ? k.en : k.zh
}

export function kindGlyph(kind: SymbolKind): string {
  return KIND_LABEL[kind].glyph
}

/** 从源码提取符号（按行扫描，保留出现顺序） */
export function extractSymbols(code: string, language: string): CodeSymbol[] {
  const out: CodeSymbol[] = []
  const lines = String(code || '').split('\n')
  const lang = (language || '').toLowerCase()

  const push = (name: string, kind: SymbolKind, idx: number, rawLine: string) => {
    if (!name || name.length > 80) return
    const indent = rawLine.match(/^\s*/)?.[0].length || 0
    out.push({ name, kind, line: idx + 1, depth: Math.min(6, Math.floor(indent / 2)) })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 跳过明显是注释的行（避免把注释里的 function 当符号）
    const trimmed = line.trim()
    if (/^(\/\/|\/\*|\*|#(?!\s*#)|--)/.test(trimmed) && lang !== 'markdown') continue

    if (lang === 'markdown' || lang === 'md') {
      const h = line.match(/^(#{1,6})\s+(.+)$/)
      if (h) push(h[2].trim(), 'heading', i, line)
      continue
    }

    // Python
    if (lang === 'python' || lang === 'py') {
      const m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/)
      if (m) { push(m[1], 'function', i, line); continue }
      const c = line.match(/^\s*class\s+([A-Za-z_]\w*)/)
      if (c) { push(c[1], 'class', i, line); continue }
      continue
    }

    // Go
    if (lang === 'go') {
      const f = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/)
      if (f) { push(f[1], 'function', i, line); continue }
      const t = line.match(/^type\s+([A-Za-z_]\w*)\s+(struct|interface)/)
      if (t) { push(t[1], t[2] === 'struct' ? 'struct' : 'interface', i, line); continue }
      continue
    }

    // Rust
    if (lang === 'rust' || lang === 'rs') {
      const f = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/)
      if (f) { push(f[1], 'function', i, line); continue }
      const s = line.match(/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/)
      if (s) { push(s[1], 'struct', i, line); continue }
      const e = line.match(/^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/)
      if (e) { push(e[1], 'enum', i, line); continue }
      const t = line.match(/^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/)
      if (t) { push(t[1], 'trait', i, line); continue }
      const im = line.match(/^\s*impl(?:<[^>]*>)?\s+([A-Za-z_]\w*)/)
      if (im) { push(im[1], 'class', i, line); continue }
      continue
    }

    // Java / Kotlin
    if (lang === 'java' || lang === 'kt' || lang === 'kotlin') {
      const c = line.match(/^\s*(?:public\s+|private\s+|protected\s+)?(?:final\s+|abstract\s+)?(class|interface|enum)\s+([A-Za-z_]\w*)/)
      if (c) { push(c[2], c[1] === 'class' ? 'class' : c[1] === 'interface' ? 'interface' : 'enum', i, line); continue }
      const m = line.match(/^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?[\w<>[\]]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{?$/)
      if (m && !/^(if|for|while|switch|catch|return)$/.test(m[1])) { push(m[1], 'method', i, line); continue }
      continue
    }

    // JS / TS / JSX / TSX（默认）
    const fn = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/)
    if (fn) { push(fn[1], 'function', i, line); continue }
    const cls = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)
    if (cls) { push(cls[1], 'class', i, line); continue }
    const iface = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/)
    if (iface) { push(iface[1], 'interface', i, line); continue }
    const typ = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/)
    if (typ) { push(typ[1], 'type', i, line); continue }
    const en = line.match(/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/)
    if (en) { push(en[1], 'enum', i, line); continue }
    const arrow = line.match(/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>/)
    if (arrow) { push(arrow[1], 'function', i, line); continue }
    const method = line.match(/^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/)
    if (method && !/^(if|for|while|switch|catch|return|function)$/.test(method[1])) { push(method[1], 'method', i, line); continue }
  }
  return out.slice(0, 500)
}
