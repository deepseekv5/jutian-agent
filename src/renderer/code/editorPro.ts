import { EditorView, keymap, Decoration, DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { type Extension, type Range } from '@codemirror/state'
import { search, openSearchPanel, gotoLine, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel } from '@codemirror/search'

/**
 * 编辑器增强扩展（v13.7）—— 把 VSCode 的编辑器体验补齐
 *
 * 1. 可见的查找/替换面板（VSCode 同款交互：Ctrl+F 出现、Enter 下一个、
 *    Ctrl+H 替换、Esc 关闭）。CodeMirror 自带 panel 但样式与本站玻璃风不搭，
 *    这里统一注入主题变量。
 * 2. Ctrl+G 跳转到行（VSCode 同款）
 * 3. 缩进参考线：用 ViewPlugin 在缩进层级位置画竖线，深浅色自适应
 */

/** 查找替换面板（主题化） */
export const searchPanelTheme: Extension = EditorView.theme({
  '.cm-panels': { background: 'transparent', border: 'none' },
  '.cm-panels.cm-panels-top': { borderBottom: 'none' },
  '.cm-search': {
    display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
    padding: '8px 10px', fontSize: '12px',
    background: 'var(--cm-panel-bg, rgba(255,255,255,.96))',
    borderBottom: '1px solid var(--cm-panel-border, rgba(0,0,0,.08))',
    backdropFilter: 'blur(12px)',
  },
  '.cm-search input, .cm-search input[type=text]': {
    padding: '4px 8px', borderRadius: '6px', fontSize: '12px',
    border: '1px solid var(--cm-panel-border, rgba(0,0,0,.12))',
    background: 'var(--cm-input-bg, #fff)', color: 'inherit', outline: 'none',
    minWidth: '180px',
  },
  '.cm-search input:focus': { borderColor: 'var(--cm-accent, #10a37f)' },
  '.cm-search button': {
    padding: '4px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer',
    border: '1px solid var(--cm-panel-border, rgba(0,0,0,.12))',
    background: 'transparent', color: 'inherit',
  },
  '.cm-search button:hover': { background: 'var(--cm-hover, rgba(0,0,0,.05))' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', opacity: '.8' },
  '.cm-search .cm-button': { backgroundImage: 'none', padding: '4px 8px' },
  '.cm-search .cm-textfield': { padding: '4px 8px', borderRadius: '6px' },
  '.cm-searchMatch': { background: 'rgba(255, 213, 0, .35)', outline: '1px solid rgba(255, 193, 7, .5)' },
  '.cm-searchMatch.cm-searchMatch-selected': { background: 'rgba(16, 163, 127, .3)', outline: '1px solid #10a37f' },
})

/**
 * 缩进参考线：在每行缩进层级处画一条淡竖线（VSCode indent guides）。
 * 用 Decoration.line 挂 CSS 变量，行内再用渐变绘制——比逐字符 Widget 轻。
 */
const indentGuidePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.build(view) }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view)
  }
  build(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = []
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        // 用行首缩进空格数决定参考线数量（tab 按 4 计）
        const text = line.text
        let indent = 0
        for (const ch of text) {
          if (ch === ' ') indent++
          else if (ch === '\t') indent += 4
          else break
        }
        const levels = Math.floor(indent / 4)
        if (levels > 0) {
          ranges.push(Decoration.line({ attributes: { 'data-indent': String(Math.min(levels, 12)) } }).range(line.from))
        }
        pos = line.to + 1
      }
    }
    return Decoration.set(ranges, true)
  }
}, { decorations: v => v.decorations })

const indentGuideTheme: Extension = EditorView.baseTheme({
  '.cm-line[data-indent]': {
    // 用背景渐变画竖线：每 4 个字符宽度一条，透明度极低不抢内容
    backgroundImage: 'repeating-linear-gradient(to right, var(--cm-indent-guide, rgba(127,127,127,.16)) 0 1px, transparent 1px 4ch)',
    backgroundPosition: '0 0',
    backgroundRepeat: 'repeat-x',
    backgroundSize: '100% 100%',
  },
})

/** 跳转到行（Ctrl+G）：弹输入框，输入行号回车定位 */
export const gotoLineKeymap: Extension = keymap.of([
  // Mod-g：VSCode 习惯的行跳转（CodeMirror 内置实现自带输入框）
  { key: 'Mod-g', preventDefault: true, run: (view) => gotoLine(view) },
])

/** 一次性打包：搜索面板 + 缩进参考线 + 跳转行 */
export function editorProExtensions(): Extension[] {
  return [
    search({ top: true }),
    searchPanelTheme,
    indentGuidePlugin,
    indentGuideTheme,
    gotoLineKeymap,
  ]
}

export { openSearchPanel, closeSearchPanel, findNext, findPrevious, replaceNext, replaceAll }
