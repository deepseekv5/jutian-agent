// Code editor component - based on CodeMirror 6

/** 编辑器字号（11–20px），CSS 变量即时生效，Cmd+= / Cmd−− 或工具栏 A± 调节 */
export function stepEditorFont(delta: number): number {
  try {
    const cur = parseInt(localStorage.getItem('lyclaw_editor_font') || '13', 10) || 13
    const next = Math.min(20, Math.max(11, cur + delta))
    localStorage.setItem('lyclaw_editor_font', String(next))
    document.documentElement.style.setProperty('--cm-font', `${next}px`)
    return next
  } catch { return 13 }
}
import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { effectiveApiKey } from '../store/storage'
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { EditorState, StateField, StateEffect, Compartment, type Range } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, undo, toggleComment, indentMore } from '@codemirror/commands'
import { bracketMatching, indentOnInput, foldKeymap, foldGutter } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { lintKeymap } from '@codemirror/lint'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import type { EditorTab, AICompletionEvent, ChangedLine } from '../types/code'
import type { Settings } from '../types'
import { useTheme } from '../hooks/useTheme'

// ============ Ghost Text (AI Inline 补全) ============

const ghostTextTheme = EditorView.baseTheme({
  '.cm-ghost-text': {
    color: '#555',
    fontStyle: 'italic',
    pointerEvents: 'none',
    userSelect: 'none',
  },
})

const setGhostText = StateEffect.define<string | null>()
const clearGhostText = StateEffect.define()

const ghostTextField = StateField.define<string | null>({
  create() { return null },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostText)) return e.value
      if (e.is(clearGhostText)) return null
    }
    // Auto clear ghost text on document change
    if (tr.docChanged) return null
    return value
  },
})

const ghostTextPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = Decoration.none
  }
  update(update: ViewUpdate) {
    const ghost = update.state.field(ghostTextField)
    if (ghost) {
      const pos = update.state.selection.main.head
      const deco = Decoration.widget({
        widget: new GhostWidget(ghost),
        side: 0,
      })
      this.decorations = Decoration.set([deco.range(pos)])
    } else {
      this.decorations = Decoration.none
    }
  }
}, { decorations: v => v.decorations })

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super() }
  eq(other: GhostWidget) { return other.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost-text'
    span.textContent = this.text
    return span
  }
  ignoreEvent() { return true }
}

// ============ Line Highlight (跟随模式) ============

const setHighlightLines = StateEffect.define<number[]>()
const clearHighlights = StateEffect.define()

const highlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlightLines)) {
        const lines = e.value
        if (lines.length === 0) return Decoration.none
        const deco = Decoration.line({ class: 'cm-follow-highlight' })
        return Decoration.set(lines.map(l => deco.range(tr.state.doc.line(l).from)))
      }
      if (e.is(clearHighlights)) return Decoration.none
    }
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

const highlightTheme = EditorView.baseTheme({
  '.cm-follow-highlight': {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    animation: 'cm-highlight-fade 3.5s ease-out forwards',
  },
  '@keyframes cm-highlight-fade': {
    '0%': { backgroundColor: 'rgba(59, 130, 246, 0.25)' },
    '100%': { backgroundColor: 'rgba(59, 130, 246, 0)' },
  },
})

// ============ Diff Highlight (AI 改动高亮) ============

const setDiffLines = StateEffect.define<ChangedLine[]>()
const clearDiffLines = StateEffect.define()

const diffField = StateField.define<DecorationSet>({
  create() { return Decoration.none },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffLines)) {
        const changed = e.value
        if (changed.length === 0) return Decoration.none
        const decos: Range<Decoration>[] = []
        for (const cl of changed) {
          try {
            const line = tr.state.doc.line(cl.line)
            const cls = cl.type === 'added' ? 'cm-diff-added'
              : cl.type === 'deleted' ? 'cm-diff-deleted'
              : 'cm-diff-modified'
            decos.push(Decoration.line({ class: cls }).range(line.from))
          } catch { /* 行号超出范围 */ }
        }
        return Decoration.set(decos, true)
      }
      if (e.is(clearDiffLines)) return Decoration.none
    }
    return decos
  },
  provide: f => EditorView.decorations.from(f),
})

const diffTheme = EditorView.baseTheme({
  '.cm-diff-added': {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderLeft: '3px solid rgba(34, 197, 94, 0.7)',
  },
  '.cm-diff-deleted': {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderLeft: '3px solid rgba(239, 68, 68, 0.7)',
  },
  '.cm-diff-modified': {
    backgroundColor: 'rgba(234, 179, 8, 0.18)',
    borderLeft: '3px solid rgba(234, 179, 8, 0.7)',
  },
})

// ============ AI 补全逻辑 ============

interface AIPrompt {
  language: string
  prefix: string
  suffix: string
}

async function fetchAICompletion(prompt: AIPrompt, settings: Settings): Promise<string | null> {
  try {
    const prefix = prompt.prefix.length > 2000 ? prompt.prefix.slice(-2000) : prompt.prefix
    const suffix = prompt.suffix.length > 500 ? prompt.suffix.slice(0, 500) : prompt.suffix

    const systemPrompt = `You are a code completion engine. Output ONLY the completion text, no explanation. Complete naturally at cursor position. For HTML: complete tag+content. For CSS: complete property/value. For JS/TS: complete expression/statement. Keep 1-3 lines max.`

    const userPrompt = `Language: ${prompt.language}\nBefore cursor:\n\`\`\`\n${prefix}\n\`\`\`\nAfter cursor:\n\`\`\`\n${suffix}\n\`\`\`\nComplete at cursor:`

    const r = await fetch('/api/llm-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-Base': settings.apiBaseUrl,
        'X-Api-Key': effectiveApiKey(settings.apiKey),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        max_tokens: 100,
        temperature: 0.1,
      }),
    })

    if (!r.ok) return null
    const data = await r.json()
    // OpenAI 非流式响应: choices[0].message.content
    const completion = data.choices?.[0]?.message?.content || data.content || data.text || ''
    const cleaned = completion.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '').trim()
    return cleaned || null
  } catch {
    return null
  }
}

// ============ Language扩展路由 ============

function getLanguageExtension(language: string) {
  switch (language) {
    case 'html': return html()
    case 'css': return css()
    case 'javascript':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: language === 'jsx' })
    case 'typescript':
    case 'ts':
    case 'tsx':
      return javascript({ jsx: language === 'tsx', typescript: true })
    case 'json':
      return javascript()
    default:
      return javascript()
  }
}

// ============ 主组件 ============

interface Props {
  tab: EditorTab | null
  tabs: EditorTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onCloseOtherTabs?: (path: string) => void
  onCloseRightTabs?: (path: string) => void
  onCloseAllTabs?: () => void
  onContentChange: (path: string, content: string) => void
  onSaveFile: (path: string) => void
  isRunnable: boolean
  onRun: () => void
  onStop: () => void
  running: boolean
  saving: boolean
  showMarkdownPreview?: boolean
  onToggleMarkdownPreview?: () => void
  modified: boolean
  settings: Settings
  onAICompletionEvent?: (event: AICompletionEvent) => void
  highlightLines?: number[]
  scrollTargetLine?: number
  changedLines?: ChangedLine[]
}

export default function CodeEditor({ tab, tabs, activeTabPath, onSelectTab, onCloseTab, onCloseOtherTabs, onCloseRightTabs, onCloseAllTabs, onContentChange, onSaveFile, isRunnable, onRun, onStop, running, saving, showMarkdownPreview, onToggleMarkdownPreview, modified, settings, onAICompletionEvent, highlightLines, scrollTargetLine, changedLines }: Props) {
  const { c, theme: currentTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompRef = useRef<Compartment>(new Compartment())
  const tabPathRef = useRef<string | null>(null)
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 编辑器主题随 App 深浅色（含语法高亮），effect 重配即热切换
const makeEditorTheme = (c: any, dark: boolean) => [
  EditorView.theme({
    '&': { fontSize: 'var(--cm-font, 13px)', fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace", height: '100%', backgroundColor: c.bg, color: c.text },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
    '.cm-scroller::-webkit-scrollbar': { width: '6px', height: '6px' },
    '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
    '.cm-scroller::-webkit-scrollbar-thumb': { background: c.borderLight, borderRadius: '3px' },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': { background: c.textMuted },
    '.cm-content': { fontFamily: 'inherit', padding: '12px 16px', lineHeight: '1.7' },
    '.cm-gutters': { fontFamily: "'SF Mono', Menlo, monospace", fontSize: 'calc(var(--cm-font, 13px) - 1px)', borderRight: `1px solid ${c.borderLight}`, backgroundColor: c.bg, color: c.textMuted },
    '.cm-activeLineGutter': { backgroundColor: `${c.accent}15` },
    '.cm-cursor': { borderLeftColor: c.accent },
    '.cm-selectionBackground': { backgroundColor: `${c.accent}40 !important` },
    '.cm-activeLine': { backgroundColor: `${c.accent}08` },
  }),
  // 注意：@codemirror/language@6.12 的 HighlightStyle.define 只接受数组，不接受函数式 spec
  syntaxHighlighting(HighlightStyle.define([
    { tag: t.keyword, color: dark ? '#d2a8ff' : '#a626a4' },
    { tag: t.string, color: dark ? '#a5d6ff' : '#50a14f' },
    { tag: t.comment, color: dark ? '#8b949e' : '#a0a1a7', fontStyle: 'italic' },
    { tag: t.number, color: dark ? '#ffa657' : '#986801' },
    { tag: t.typeName, color: dark ? '#e3b341' : '#e45649' },
    { tag: t.definition(t.variableName), color: dark ? '#d2a8ff' : '#4078f2' },
  ]), { fallback: true }),
]

const ghostCompRef = useRef<Compartment>(new Compartment())
  const completionIdRef = useRef('')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const tabRef = useRef(tab)
  tabRef.current = tab

  // ====== 强制触发 AI 补全（Context menu调用） ======

  const forceTriggerAICompletion = useCallback(async () => {
    const view = viewRef.current
    const currentTab = tabRef.current
    if (!view || !currentTab || !aiEnabled) return

    const eventId = Date.now().toString(36) + Math.random().toString(36).slice(2)
    completionIdRef.current = eventId

    setAiLoading(true)
    setAiError(false)

    const doc = view.state.doc.toString()
    const pos = view.state.selection.main.head
    const prefix = doc.slice(0, pos)
    const suffix = doc.slice(pos)

    onAICompletionEvent?.({
      id: eventId,
      type: 'loading',
      context: { language: currentTab.language, prefix: prefix.slice(-2000), suffix: suffix.slice(0, 500) },
      timestamp: new Date().toISOString(),
    })

    try {
      const snapshot = doc

      const completion = await fetchAICompletion({
        language: currentTab.language,
        prefix,
        suffix,
      }, settings)

      if (!completion || !viewRef.current) {
        setAiLoading(false)
        onAICompletionEvent?.({
          id: eventId,
          type: 'error',
          error: 'AI 未返回有效补全结果',
          timestamp: new Date().toISOString(),
        })
        return
      }
      if (viewRef.current.state.doc.toString() !== snapshot) {
        setAiLoading(false)
        onAICompletionEvent?.({
          id: eventId,
          type: 'error',
          error: '文档在补全期间已变更',
          timestamp: new Date().toISOString(),
        })
        return
      }

      viewRef.current.dispatch({ effects: setGhostText.of(completion) })
      setAiLoading(false)

      onAICompletionEvent?.({
        id: eventId,
        type: 'success',
        context: { language: currentTab.language, prefix: prefix.slice(-2000), suffix: suffix.slice(0, 500) },
        result: completion,
        timestamp: new Date().toISOString(),
      })
    } catch {
      setAiError(true)
      setAiLoading(false)
      onAICompletionEvent?.({
        id: eventId,
        type: 'error',
        error: '网络请求失败，请重试',
        timestamp: new Date().toISOString(),
      })
      setTimeout(() => setAiError(false), 2500)
    }
  }, [aiEnabled, onAICompletionEvent])

  // ====== Editor 生命周期 ======

  useEffect(() => {
    if (!containerRef.current || !tab) {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
      tabPathRef.current = null
      return
    }

    // 同一 tab 仅更新Content
    if (viewRef.current && tabPathRef.current === tab.path) {
      const currentContent = viewRef.current.state.doc.toString()
      if (currentContent !== tab.content && tab.content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentContent.length, insert: tab.content },
        })
      }
      return
    }

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    tabPathRef.current = tab.path
    const lang = getLanguageExtension(tab.language)

    const contentChangeListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        onContentChange(tab.path, update.state.doc.toString())
      }
    })

    const tabKeymap = keymap.of([{
      key: 'Tab',
      run: (view: EditorView) => {
        const ghost = view.state.field(ghostTextField)
        if (ghost) {
          const pos = view.state.selection.main.head
          view.dispatch({
            changes: { from: pos, insert: ghost },
            effects: clearGhostText.of(null),
          })
          return true
        }
        return indentMore(view)
      },
    }])

    const escKeymap = keymap.of([{
      key: 'Escape',
      run: (view: EditorView) => {
        const ghost = view.state.field(ghostTextField)
        if (ghost) {
          view.dispatch({ effects: clearGhostText.of(null) })
          return true
        }
        return false
      },
    }])

    const saveKeymap = keymap.of([
      { key: 'Mod-s', run: () => { onSaveFile(tab.path); return true }, preventDefault: true },
      { key: 'Mod-/', run: toggleComment, preventDefault: true },
      { key: 'Mod-=', run: () => { stepEditorFont(1); return true }, preventDefault: true },
      { key: 'Mod--', run: () => { stepEditorFont(-1); return true }, preventDefault: true },
    ])

    const state = EditorState.create({
      doc: tab.content,
      extensions: [
        lineNumbers(),
        foldGutter({
          markerDOM(open) {
            const s = document.createElement('span')
            s.textContent = open ? '▾' : '▸'
            s.style.cssText = 'cursor:pointer;opacity:.55;font-size:10px;width:12px;display:inline-block;text-align:center'
            return s
          },
        }),
        lang,
        themeCompRef.current.of(makeEditorTheme(c, currentTheme === 'dark')),
        ghostTextField,
        ghostTextPlugin,
        ghostTextTheme,
        highlightField,
        highlightTheme,
        diffField,
        diffTheme,
        contentChangeListener,
        tabKeymap,
        escKeymap,
        saveKeymap,
        closeTabKeymap,
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        autocompletion(),
        ghostCompRef.current.of([]),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          ...searchKeymap,
        ]),
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    // Context menu事件
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      const hasSelection = !view.state.selection.main.empty
      setContextMenu({ x: e.clientX, y: e.clientY, hasSelection })
    }
    view.dom.addEventListener('contextmenu', onContextMenu)

    return () => {
      view.dom.removeEventListener('contextmenu', onContextMenu)
      setContextMenu(null)
      view.destroy()
      viewRef.current = null
    }
  }, [tab?.path, tab?.language])

  // 主题热切换：深浅色变化即重配编辑器主题（含语法高亮）
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({ effects: themeCompRef.current.reconfigure(makeEditorTheme(c, currentTheme === 'dark')) })
  }, [c, currentTheme])

  // 应用持久化的编辑器字号（CSS 变量）
  useEffect(() => {
    try {
      const f = parseInt(localStorage.getItem('lyclaw_editor_font') || '13', 10) || 13
      document.documentElement.style.setProperty('--cm-font', `${f}px`)
    } catch { /* ignore */ }
  }, [])

  // ====== AI Ghost Text Extension ======

  const ghostExtension = useMemo(() => {
    return EditorView.updateListener.of((update: ViewUpdate) => {
      if (!aiEnabled || !update.docChanged || !viewRef.current || !tab) return

      if (aiTimerRef.current) {
        clearTimeout(aiTimerRef.current)
        aiTimerRef.current = null
      }

      aiTimerRef.current = setTimeout(async () => {
        if (!viewRef.current || !tab) return
        const currentState = viewRef.current.state
        const doc = currentState.doc.toString()
        const currentPos = currentState.selection.main.head

        if (currentPos < doc.length - 1) return

        const prefix = doc.slice(0, currentPos)
        if (prefix.trim().length < 3) return

        const eventId = Date.now().toString(36) + Math.random().toString(36).slice(2)
        completionIdRef.current = eventId

        setAiLoading(true)
        setAiError(false)

        onAICompletionEvent?.({
          id: eventId,
          type: 'loading',
          context: { language: tab.language, prefix: prefix.slice(-2000), suffix: doc.slice(currentPos).slice(0, 500) },
          timestamp: new Date().toISOString(),
        })

        try {
          const snapshot = doc
          const completion = await fetchAICompletion({
            language: tab.language,
            prefix,
            suffix: doc.slice(currentPos),
          }, settings)

          if (!completion || !viewRef.current) {
            setAiLoading(false)
            onAICompletionEvent?.({
              id: eventId,
              type: 'error',
              error: 'AI 未返回有效补全结果',
              timestamp: new Date().toISOString(),
            })
            return
          }
          if (viewRef.current.state.doc.toString() !== snapshot) {
            setAiLoading(false)
            onAICompletionEvent?.({
              id: eventId,
              type: 'error',
              error: '文档在补全期间已变更',
              timestamp: new Date().toISOString(),
            })
            return
          }

          viewRef.current.dispatch({ effects: setGhostText.of(completion) })
          setAiLoading(false)

          onAICompletionEvent?.({
            id: eventId,
            type: 'success',
            context: { language: tab.language, prefix: prefix.slice(-2000), suffix: doc.slice(currentPos).slice(0, 500) },
            result: completion,
            timestamp: new Date().toISOString(),
          })
        } catch {
          setAiError(true)
          setAiLoading(false)
          onAICompletionEvent?.({
            id: eventId,
            type: 'error',
            error: '网络请求失败，请重试',
            timestamp: new Date().toISOString(),
          })
          setTimeout(() => setAiError(false), 2500)
        }
      }, 500)
    })
  }, [aiEnabled, tab?.language, settings, onAICompletionEvent])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    view.dispatch({
      effects: ghostCompRef.current.reconfigure(ghostExtension),
    })
  }, [ghostExtension])

  // ====== 主题色跟随 ======

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: StateEffect.appendConfig.of(
          EditorView.theme({
            '.cm-gutters': {
              borderRight: `1px solid ${c.borderLight}`,
              backgroundColor: c.bg,
              color: c.textMuted,
            },
            '.cm-scroller::-webkit-scrollbar-thumb': {
              background: `${c.borderLight}`,
            },
            '.cm-scroller::-webkit-scrollbar-thumb:hover': {
              background: `${c.textMuted}`,
            },
            '.cm-activeLineGutter': { backgroundColor: `${c.accent}15` },
            '.cm-cursor': { borderLeftColor: c.accent },
            '.cm-selectionBackground': { backgroundColor: `${c.accent}40 !important` },
          })
        ),
      })
    }
  }, [c])

  // ====== 跟随模式：行高亮 ======

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setHighlightLines.of(highlightLines || []) })
  }, [highlightLines])

  // ====== AI 改动 diff 高亮 ======

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (changedLines && changedLines.length > 0) {
      view.dispatch({ effects: setDiffLines.of(changedLines) })
    } else {
      view.dispatch({ effects: clearDiffLines.of(null) })
    }
  }, [changedLines])

  // ====== 跟随模式：滚动到指定行 ======

  useEffect(() => {
    const view = viewRef.current
    if (!view || scrollTargetLine === undefined || scrollTargetLine < 1) return
    try {
      const line = view.state.doc.line(scrollTargetLine)
      const pos = line.from
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
    } catch { /* 行号超出范围 */ }
  }, [scrollTargetLine])

  useEffect(() => {
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current)
    }
  }, [])

  // ====== Tab Context menu ======
  const [tabCtxMenu, setTabCtxMenu] = useState<{ x: number; y: number; tabPath: string } | null>(null)

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabPath: string) => {
    e.preventDefault()
    setTabCtxMenu({ x: e.clientX, y: e.clientY, tabPath })
  }, [])

  // Close Tab 上下文菜单
  useEffect(() => {
    const close = () => setTabCtxMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // ====== 快捷键：Cmd+W Close当前标签页 ======

  const closeTabKeymap = useMemo(() => keymap.of([{
    key: 'Mod-w',
    run: () => { if (tab?.path) onCloseTab(tab.path); return true },
    preventDefault: true,
  }]), [tab, onCloseTab])

  if (!tab) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: c.bg }}>
        <div className="text-center space-y-3">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} style={{ color: c.textMuted }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
          </svg>
          <p className="text-sm" style={{ color: c.textTertiary }}>选择文件开始编辑</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: c.bg }}>
      {/* Tabs */}
      <div className="h-9 flex items-center shrink-0 overflow-hidden border-b" style={{ background: c.bgCard, borderColor: c.borderLight }}>
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
          {tabs.map(t => {
            const isActive = t.path === activeTabPath
            return (
              <div
                key={t.path}
                onClick={() => onSelectTab(t.path)}
                onContextMenu={e => handleTabContextMenu(e, t.path)}
                className="group flex items-center gap-1.5 px-3 h-full text-[12px] shrink-0 cursor-pointer border-r transition-colors max-w-[180px]"
                style={{
                  background: isActive ? c.bg : 'transparent',
                  color: isActive ? c.text : c.textTertiary,
                  borderColor: c.borderLight,
                  borderBottom: isActive ? `2px solid ${c.accent}` : '2px solid transparent',
                }}
              >
                <span className="truncate">{t.name}</span>
                {t.modified && (
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c.accent }} />
                )}
                <button
                  onClick={e => { e.stopPropagation(); onCloseTab(t.path) }}
                  className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 btn-liquid"
                  style={{ color: c.textMuted }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>

        {/* Action buttons */}
        {tab && (
          <div className="flex items-center gap-1 px-2 shrink-0">
            <button
              onClick={() => setAiEnabled(v => !v)}
              className="px-1.5 py-1 rounded text-[10px] font-medium transition-colors btn-liquid flex items-center gap-1"
              style={{
                background: aiEnabled ? `${c.accent}20` : c.bgInput,
                color: aiEnabled ? c.accent : c.textTertiary,
              }}
              title={aiEnabled ? 'AI 补全已开启' : 'AI 补全已Close'}
            >
              {aiLoading ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <span>AI</span>
              )}
            </button>
            {modified && (
              <span className="text-[10px] mr-1" style={{ color: c.accent }}>未Save</span>
            )}
            <button
              onClick={() => onSaveFile(tab.path)}
              className="px-2 py-1 rounded text-[10px] font-medium transition-colors btn-liquid"
              style={{
                background: modified ? c.accent : c.bgInput,
                color: modified ? '#fff' : c.textTertiary,
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
            {tab.name.endsWith('.md') && onToggleMarkdownPreview && (
              <button
                onClick={onToggleMarkdownPreview}
                className="px-2 py-1 rounded text-[10px] font-medium transition-colors btn-liquid"
                style={{
                  background: showMarkdownPreview ? `${c.accent}20` : c.bgInput,
                  color: showMarkdownPreview ? c.accent : c.textTertiary,
                }}
                title="Markdown 预览"
              >
                预览
              </button>
            )}
            {isRunnable && (
              <button
                onClick={running ? onStop : onRun}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors btn-liquid"
                style={{
                  background: running ? c.toolErr : c.toolOk,
                  color: '#fff',
                }}
              >
                {running ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
                {running ? '停止' : '运行'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* CodeMirror Container */}
      <div className="flex-1 relative" style={{ background: c.bg }}>
        <div ref={containerRef} className="absolute inset-0" />
        {/* AI error toast */}
        {aiError && (
          <div
            className="absolute bottom-3 right-3 z-10 px-2.5 py-1 rounded-md text-[11px] animate-fade-in"
            style={{ background: c.toolErr, color: '#fff' }}
          >
            AI 补全失败，请重试
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="h-6 flex items-center gap-3 px-3 shrink-0 border-t text-[10px]"
        style={{ background: c.bgCard, borderColor: c.borderLight, color: c.textMuted }}>
        <span>{tab.language.toUpperCase()}</span>
        <span>UTF-8</span>
        <span>行 {tab.content.split('\n').length}</span>
        <div className="flex-1" />
        <span>Cmd+Click 添加光标</span>
      </div>

      {/* Tab Context menu */}
      {tabCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTabCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setTabCtxMenu(null) }} />
          <div
            className="fixed z-50 py-1 rounded-lg shadow-lg border min-w-[140px]"
            style={{ left: tabCtxMenu.x, top: tabCtxMenu.y, background: c.bgCard, borderColor: c.borderLight }}
          >
            <button
              onClick={() => { onCloseTab(tabCtxMenu.tabPath); setTabCtxMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
              style={{ color: c.text }}
              onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Close</button>
            <button
              onClick={() => { onCloseOtherTabs?.(tabCtxMenu.tabPath); setTabCtxMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
              style={{ color: c.text }}
              onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Close其他</button>
            <button
              onClick={() => { onCloseRightTabs?.(tabCtxMenu.tabPath); setTabCtxMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
              style={{ color: c.text }}
              onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Close右侧</button>
            <button
              onClick={() => { onCloseAllTabs?.(); setTabCtxMenu(null) }}
              className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
              style={{ color: c.toolErr }}
              onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Close所有</button>
          </div>
        </>
      )}

      {/* 右键上下文菜单 */}
      {contextMenu && (() => {
        const handleUndo = () => {
          const view = viewRef.current
          if (view) undo(view)
          setContextMenu(null)
        }
        const handleCut = async () => {
          const view = viewRef.current
          if (!view || view.state.selection.main.empty) return
          const { from, to } = view.state.selection.main
          const text = view.state.sliceDoc(from, to)
          await navigator.clipboard.writeText(text)
          view.dispatch({ changes: { from, to, insert: '' } })
          setContextMenu(null)
        }
        const handleCopy = async () => {
          const view = viewRef.current
          if (!view || view.state.selection.main.empty) return
          const { from, to } = view.state.selection.main
          const text = view.state.sliceDoc(from, to)
          await navigator.clipboard.writeText(text)
          setContextMenu(null)
        }
        const handlePaste = async () => {
          const view = viewRef.current
          if (!view) return
          try {
            const text = await navigator.clipboard.readText()
            if (text) {
              const pos = view.state.selection.main.head
              view.dispatch({ changes: { from: pos, insert: text } })
            }
          } catch { /* clipboard read denied */ }
          setContextMenu(null)
        }
        // 格式化选区或全文 JSON（缩进 2 空格），失败保留原文并提示
        const handleFormatJson = () => {
          const view = viewRef.current
          if (!view) return
          const { from, to } = view.state.selection.main
          const selText = view.state.sliceDoc(from, to)
          const target = selText.trim() ? { from, to, text: selText } : { from: 0, to: view.state.doc.length, text: view.state.doc.toString() }
          try {
            const pretty = JSON.stringify(JSON.parse(target.text), null, 2)
            view.dispatch({ changes: { from: target.from, to: target.to, insert: pretty } })
          } catch { alert('不是合法的 JSON，无法格式化') }
          setContextMenu(null)
        }

        const hasSel = contextMenu.hasSelection
        const menuItemStyle: React.CSSProperties = {
          width: '100%',
          textAlign: 'left',
          padding: '4px 12px',
          fontSize: '12px',
          transition: 'background-color 0.15s',
          background: 'transparent',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }
        const disabledStyle: React.CSSProperties = {
          ...menuItemStyle,
          color: c.textTertiary,
          cursor: 'not-allowed',
        }

        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} />
            <div
              className="fixed z-50 py-1 rounded-lg shadow-lg border min-w-[180px]"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                background: c.bgCard,
                borderColor: c.borderLight,
              }}
            >
              {/* 撤销 */}
              <button
                onClick={handleUndo}
                className="w-full text-left transition-colors"
                style={menuItemStyle}
                onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span>撤销</span>
                <span style={{ color: c.textTertiary, fontSize: '10px' }}>Cmd+Z</span>
              </button>

              {/* 格式化 JSON */}
              <button
                onClick={handleFormatJson}
                className="w-full text-left transition-colors"
                style={menuItemStyle}
                onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span>格式化 JSON</span>
                <span style={{ color: c.textTertiary, fontSize: '10px' }}>选中或全文</span>
              </button>

              {/* 分隔线 */}
              <div style={{ height: '1px', margin: '2px 8px', background: c.borderLight }} />

              {/* 剪切 */}
              <button
                onClick={hasSel ? handleCut : undefined}
                disabled={!hasSel}
                className="w-full text-left transition-colors"
                style={hasSel ? menuItemStyle : disabledStyle}
                onMouseEnter={e => { if (hasSel) e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span>剪切</span>
                <span style={{ color: c.textTertiary, fontSize: '10px' }}>Cmd+X</span>
              </button>

              {/* 复制 */}
              <button
                onClick={hasSel ? handleCopy : undefined}
                disabled={!hasSel}
                className="w-full text-left transition-colors"
                style={hasSel ? menuItemStyle : disabledStyle}
                onMouseEnter={e => { if (hasSel) e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span>复制</span>
                <span style={{ color: c.textTertiary, fontSize: '10px' }}>Cmd+C</span>
              </button>

              {/* 粘贴 */}
              <button
                onClick={handlePaste}
                className="w-full text-left transition-colors"
                style={menuItemStyle}
                onMouseEnter={e => { e.currentTarget.style.background = c.bgHover }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span>粘贴</span>
                <span style={{ color: c.textTertiary, fontSize: '10px' }}>Cmd+V</span>
              </button>

              {/* 分隔线 */}
              <div style={{ height: '1px', margin: '2px 8px', background: c.borderLight }} />

              {/* AI 补全（已有） */}
              <button
                onClick={() => { forceTriggerAICompletion(); setContextMenu(null) }}
                disabled={!aiEnabled}
                className="w-full text-left transition-colors"
                style={aiEnabled ? menuItemStyle : disabledStyle}
                onMouseEnter={e => { if (aiEnabled) e.currentTarget.style.background = `${c.accent}15` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span>AI 补全</span>
                <span style={{ color: c.textTertiary, fontSize: '10px' }}>Tab</span>
              </button>
            </div>
          </>
        )
      })()}
    </div>
  )
}
