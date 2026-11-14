// 富代码块判定（纯函数，可测）：
//  - mermaid 块 → 渲染成图表（MermaidBlock）
//  - 完整 HTML 文档 → 提供「预览」页签（Artifacts 式 iframe 沙箱）

export function isMermaidLang(lang: string): boolean {
  return String(lang || '').trim().toLowerCase() === 'mermaid'
}

/**
 * 从 react-markdown 的 children 树提取纯文本。
 * 关键：rehype-highlight 会把代码变成嵌套 React 元素，String() 直接强转
 * 得到 "[object Object]"——预览判定和复制都必须走这棵树取真文本。
 */
export function extractCodeText(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractCodeText).join('')
  if (node.props && node.props.children !== undefined) return extractCodeText(node.props.children)
  return ''
}

/** 完整 HTML 文档判定：够长 + 像整份文档（有 doctype/html/body 之一），片段不给预览 */
export function isPreviewableHtml(lang: string, code: string): boolean {
  if (String(lang || '').trim().toLowerCase() !== 'html') return false
  if (typeof code !== 'string' || code.length < 300) return false
  return /<!doctype\s+html[\s>]|<html[\s>]/i.test(code)
}
