/**
 * 只读文件查看器（右栏 · 文件面板）
 *
 * 之前这里是一块 <pre> 纯文本：没有行号、没有语法高亮，
 * 读代码要一行行数位置，也看不出关键字/字符串。对标布局里的
 * 代码编辑器形态，差距就在这里。
 *
 * 刻意复用 CodeEditor 用的那套 HighlightStyle（同源配色，深浅一致），
 * 但不引入 CodeEditor 本身——那个组件耦合了文件 tab、保存、AI 补全、
 * 右键菜单等一大堆状态，右侧窄面板里用不上。CodeMirror 在这里只做
 * 只读渲染：行号 + 高亮 + 软换行，不可编辑。
 */
import { useEffect, useMemo, useRef } from 'react'
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { bracketMatching, foldGutter } from '@codemirror/language'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { useTheme } from '../hooks/useTheme'

/** 按扩展名选语言；未命中不给语言（仍显示行号，不做语法着色）。
 *  只接了项目已装的 html/js/css 三个语言包——json/markdown 的
 *  官方包不在依赖里，不为一个预览面板新增依赖。JSON 借用 javascript
 *  的词法规则（键与字符串着色基本够用），markdown 退化为纯行号视图。 */
function languageFor(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.html': case '.htm': case '.vue': case '.svg': return html()
    case '.js': case '.jsx': case '.mjs': case '.cjs': return javascript()
    case '.ts': case '.tsx': return javascript()
    case '.css': case '.scss': case '.less': return css()
    case '.json': return javascript()
    default: return null
  }
}

/** 与 CodeEditor 同源的语法配色，避免两个地方各调一套 */
function highlightStyle(dark: boolean) {
  return HighlightStyle.define([
    { tag: t.keyword, color: dark ? '#d2a8ff' : '#a626a4' },
    { tag: t.string, color: dark ? '#a5d6ff' : '#50a14f' },
    { tag: t.comment, color: dark ? '#8b949e' : '#a0a1a7', fontStyle: 'italic' },
    { tag: t.number, color: dark ? '#ffa657' : '#986801' },
    { tag: t.typeName, color: dark ? '#e3b341' : '#e45649' },
    { tag: t.definition(t.variableName), color: dark ? '#d2a8ff' : '#4078f2' },
  ])
}

export default function FileViewer({ name, content }: { name: string; content: string }) {
  const { c, theme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const dark = theme === 'dark'

  const lang = useMemo(() => languageFor(name), [name])

  // 内容/语言变化 → 整体替换 state（只读查看器没有增量编辑需求）
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          foldGutter(),
          bracketMatching(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          ...(lang ? [lang] : []),
          syntaxHighlighting(highlightStyle(dark), { fallback: true }),
          EditorView.theme({
            '&': { fontSize: '11.5px', fontFamily: "'SF Mono', Menlo, monospace", height: '100%', backgroundColor: 'transparent', color: c.textSecondary },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
            '.cm-scroller::-webkit-scrollbar': { width: '6px', height: '6px' },
            '.cm-scroller::-webkit-scrollbar-thumb': { background: c.borderLight, borderRadius: '3px' },
            '.cm-content': { fontFamily: 'inherit', padding: '8px 10px', lineHeight: '1.65' },
            '.cm-gutters': { fontFamily: "'SF Mono', Menlo, monospace", backgroundColor: 'transparent', color: c.textMuted, borderRight: `1px solid ${c.borderLight}` },
            '.cm-activeLineGutter': { backgroundColor: `${c.accent}15` },
            '.cm-activeLine': { backgroundColor: `${c.accent}08` },
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [content, lang, dark, c.textSecondary, c.borderLight, c.textMuted, c.accent])

  return <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden" />
}