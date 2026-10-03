# Code 模式开发规范（v1.0）

> Code 模式下所有界面必须遵循本规范。重构目标：与 ChatGPT/Codex 一致的极简玻璃体验，
> 不引入新的设计语言。任何新组件使用 `components/code/ui.tsx` 中的基元，禁止内联造轮子。

## 1. 布局骨架

```
┌──────────────────────────────────────────────────────────┐
│ 顶栏 h-9  glass｜项目名 + 操作图标组                       │
├────────┬──────────────────────────────────┬──────────────┤
│        │ 工具栏 h-9 glass（图标组）        │              │
│ 文件树  ├──────────────────────────────────┤  AI 助手     │
│ 260px  │ 编辑区 Tabs（胶囊）                │  340px       │
│ glass  │ 编辑器（CodeMirror，主题跟随全局） │  glass       │
│        ├──────────────────────────────────┤  markdown    │
│        │ 输出/终端（可折叠）                │  渲染        │
└────────┴──────────────────────────────────┴──────────────┘
```

- 左边树默认 260px（120–420 可拖拽），右 AI 面板 320–420 可拖拽，可整体收起。
- 三栏背景 = `glass`（统一蒙版），编辑区画布 = 实底 `c.bg`。
- 部件高度刻度：顶栏/工具栏 h-9、面板头 h-9、分割线 h-px。

## 2. 基元（code/ui.tsx，必须复用）

| 基元 | 用途 | 规范 |
|---|---|---|
| `CMPanel` | 浮层/下拉容器 | rounded-xl、border、glass-strong、p-3 |
| `CMBtn` | 图标按钮 | 28px、rounded-lg、hover 显底、active 主题色 |
| `CMPopover` | 任意浮层 | 同上容器 + animate-fade-in |
| `CMEmpty` | 空状态 | 居中、图标灰底圆角 56px、标题 13px、副标题 11px |
| `CMInput` | 输入框 | h-9、rounded-lg、c.bgInput、12px |
| `CMHeader` | 面板头 | h-9、标题 13px semibold、右侧操作 |

禁止在内联定义 React 组件（会触发每次渲染重挂载——设置页输入框失焦事故的根因）。

## 3. 色彩

- 一律走 useTheme() 的 `c.*` 令牌，禁止硬编码十六进制；终端/控制台例外（固定深色）。
- 状态色：ok=toolOk / err=toolErr / warn=toolWarn；AI 强调用 c.accent。
- 语法高亮随主题（见 CodeEditor makeEditorTheme）。

## 4. 字体与留白

- 面板正文 12–13px，主聊天 15px；标题 13–15px semibold；辅助 10–11px。
- 内边距刻度：4/8/12/16；圆角刻度：sm/md/lg/pill。
- 图标 14–16px（工具栏 15px）。

## 5. 交互

- 所有 Icon 按钮必须带 title/aria-label。
- 破坏性操作必须二次确认（confirm 或应用内确认框）。
- 音频/转写等异步操作显示就地 loading。
- 快捷键延续：Cmd+Shift+F 搜索、Cmd+` 终端、Cmd+S 保存全部、Cmd+P 快速打开。

## 6. 重构进度

| 组件 | 状态 |
|---|---|
| CodeView 顶栏/工具栏 | ✅ v2 图标栏 |
| CodeEditor 主题化 | ✅ v2 |
| ChatPanel 头部+markdown | ✅ v2 |
| WelcomePage / ui.tsx 基元 | ✅ v2 |
| FileTree / QuickOpen / Snippets / CodeSearch / Terminal | 🚧 按本规范逐项迭代 |
