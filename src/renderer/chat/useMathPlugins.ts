// KaTeX 数学公式渲染插件：全局懒加载单例。
//
// katex+插件 ~300KB（gzip ~90KB），不能进首屏 chunk（首屏体积是硬指标）。
// 这里用模块级单例 Promise：第一条含公式的消息触发加载，加载完成广播给
// 所有气泡一次性补渲染。加载失败静默降级为普通文本（公式照原样显示）。
import { useEffect, useState } from 'react'

export interface MathPlugins { remarkMath: any; rehypeKatex: any }

let cached: MathPlugins | null = null
let pending: Promise<MathPlugins | null> | null = null
const listeners = new Set<() => void>()

function load(): Promise<MathPlugins | null> {
  if (!pending) {
    pending = Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([rm, rk]) => {
      cached = { remarkMath: (rm as any).default, rehypeKatex: (rk as any).default }
      listeners.forEach((l) => l())
      return cached
    }).catch(() => null)
  }
  return pending
}

/** 返回已加载的插件（未加载完返回 null，加载完广播重渲染）。enabled=false 不触发加载。 */
export function useMathPlugins(enabled: boolean): MathPlugins | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!enabled || cached) { return }
    let alive = true
    const l = () => { if (alive) bump((n) => n + 1) }
    listeners.add(l)
    load()
    return () => { alive = false; listeners.delete(l) }
  }, [enabled])
  return cached
}

/** 纯函数：消息里是否出现公式语法（$$..$$ / \(..\) / \[..\]），没公式不触发加载 */
export function hasMathSyntax(text: string): boolean {
  if (!text) return false
  return /\$\$[\s\S]+\$\$/.test(text) || /\\\([\s\S]+?\\\)/.test(text) || /\\\[[\s\S]+?\\\]/.test(text) || /(?<!\\)\$(?!\s)[^\n$]{1,400}(?<!\\)\$(?!\d)/.test(text)
}

/**
 * 归一化公式定界符：主流模型输出惯用 \(..\) 与 \[....\]，而 remark-math
 * 只认 $..$ / $$..$$。在 fence 外做一次转换（fence 内的代码不能动）。
 */
export function normalizeMathDelimiters(text: string): string {
  if (!text || !/\\[([]/.test(text)) return text
  // 按 fenced code 切开：偶数段（fence 外）才转换
  const parts = String(text).split(/(```[\s\S]*?(?:```|$))/g)
  return parts.map((seg, i) => {
    if (i % 2 === 1) return seg
    return seg
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => `\n$$${inner}$$\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => `$${inner}$`)
  }).join('')
}
