// Mermaid 图表渲染：AI 输出的 ```mermaid 块自动渲染成流程图/时序图/甘特图。
//
// mermaid 体积巨大（~1MB），必须整体留在按需 chunk：本组件只被
// React.lazy(() => import('./MermaidBlock')) 引用，mermaid 也只在组件
// 真正挂载时才动态 import——不进首屏，没有图表的会话零成本。
// securityLevel: 'strict' 让 mermaid 自己做 SVG 消毒，防图表里的注入。
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'

let mermaidPromise: Promise<any> | null = null
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mm = m.default
      mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
      return mm
    })
  }
  return mermaidPromise
}

let seq = 0

export default function MermaidBlock({ code }: { code: string }) {
  const { c } = useTheme()
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState('')
  const [showSrc, setShowSrc] = useState(false)
  const renderSeq = useRef(0)

  useEffect(() => {
    let alive = true
    const mine = ++renderSeq.current
    setErr('')
    loadMermaid().then(async (mm) => {
      try {
        const out = await mm.render(`mmd-${mine}-${Date.now()}`, code)
        if (alive && mine === renderSeq.current) { setSvg(out.svg); setShowSrc(false) }
      } catch (e: any) {
        if (alive && mine === renderSeq.current) { setErr(String(e?.message || e)); setShowSrc(true) }
      }
    }).catch((e) => { if (alive && mine === renderSeq.current) setErr(String(e?.message || e)) })
    return () => { alive = false }
  }, [code])

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>mermaid</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSrc(v => !v)} title="切换源码/图形">
            {showSrc ? '图形' : '源码'}
          </button>
        </div>
      </div>
      {showSrc || (!svg && !err) ? (
        <pre style={{ maxHeight: 420, overflow: 'auto' }}><code>{code}</code></pre>
      ) : err ? (
        <div className="px-4 py-3 text-[12px] leading-relaxed" style={{ color: c.textTertiary, background: c.bgInput }}>
          图表渲染失败（语法问题），源码保留如下：
          <pre className="mt-2 whitespace-pre-wrap text-[11.5px]" style={{ color: c.textSecondary }}>{code}</pre>
        </div>
      ) : (
        <div className="px-4 py-4 overflow-auto" style={{ maxHeight: 460, background: '#fff' }}
          dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  )
}
