import { useMemo } from 'react'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'
import { extractSymbols, kindGlyph, kindLabel } from './outline'

/**
 * 代码大纲面板（v13.7）—— VSCode 的 Outline
 *
 * 从当前文件提取函数/类/接口/标题等符号，点击跳到对应行。
 * 侧栏槽里与文件树、搜索、Git 互斥（沿用 CodeView 的唯一侧栏槽设计）。
 */
export default function OutlinePanel({ code, language, path, onJump }: {
  code: string
  language: string
  path: string
  onJump: (line: number) => void
}) {
  const { c } = useTheme()
  const { lang, t } = useLanguage()
  const symbols = useMemo(() => extractSymbols(code, language), [code, language])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 py-2 text-[11px] font-medium flex items-center gap-2"
        style={{ color: c.textTertiary, borderBottom: `1px solid ${c.borderLight}` }}>
        <span>{t('大纲', 'Outline')}</span>
        <span className="font-mono" style={{ color: c.textMuted }}>{symbols.length}</span>
        <span className="flex-1" />
        <span className="truncate max-w-[50%] text-[10.5px]" title={path} style={{ color: c.textMuted }}>
          {path.split(/[\\/]/).pop()}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {symbols.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11.5px]" style={{ color: c.textMuted }}>
            {t('这个文件没有可识别的符号', 'No symbols found in this file')}
          </div>
        ) : (
          symbols.map((s, i) => (
            <button key={`${s.line}-${s.name}-${i}`} onClick={() => onJump(s.line)}
              className="w-full flex items-center gap-2 px-3 py-1 text-left text-[12px] transition-colors"
              style={{ paddingLeft: 12 + s.depth * 10, color: c.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              title={`${kindLabel(s.kind, lang)} · ${t('第', 'line')} ${s.line}`}>
              <span className="shrink-0 w-3 text-center font-mono text-[10px]"
                style={{ color: s.kind === 'class' || s.kind === 'interface' ? '#8b5cf6' : s.kind === 'function' || s.kind === 'method' ? '#0ea5e9' : c.textMuted }}>
                {kindGlyph(s.kind)}
              </span>
              <span className="truncate">{s.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: c.textMuted }}>{s.line}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
