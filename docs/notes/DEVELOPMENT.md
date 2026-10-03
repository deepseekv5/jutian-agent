# 巨天agent 开发文档（v4.0.0 内测）

> 本文是唯一的权威设计/开发规范。改动 UI 或架构前必读。
> 简版速查见根目录 `CLAUDE.md`。

---

## 1. 产品与架构

| 项 | 值 |
|---|---|
| 产品名 | 巨天agent（曾用名：老攸 Agent / lyclaw） |
| appId | `com.jutian.agent` |
| 版本 | 4.0.0（内测 Beta） |
| 技术栈 | Electron 33 + React 18 + TypeScript + Vite 5 + Tailwind 3 + zustand |
| 端口 | **3211** 主服务（fallback 3210）· 5173 vite dev · 5050 Edge TTS（惰性） |
| 架构 | 单进程：`electron/main.cjs` 直接 `require('serve.cjs')`（HTTP 服务跑在主进程内），渲染进程为 React SPA |
| 数据 | SQLite（better-sqlite3，原生模块在 `app.asar.unpacked`）+ `~/.lyclaw/` |

### 目录速览

```
electron/main.cjs        Electron 主进程（窗口/托盘/IPC/TTS/桌宠）
electron/loading.html    启动页（深空玻璃内测风格，每次启动显示）
serve.cjs                后端 HTTP 服务（37 工具 + 全部 /api/*，esbuild 打包产物，直接编辑）
src/renderer/            React 界面
  components/            全部 UI 组件（code/ 为代码模式子组件）
  hooks/useTheme.tsx     主题令牌（light/dark 两套对象）★设计系统核心
  engine/stream.ts       对话流引擎（走 /api/llm-proxy）
src/shared/              跨端共享（jtcode-cli.mjs、stt.py 等）
scripts/patch-update.mjs 补丁式更新脚本 ★
```

---

## 2. 设计语言：ChatGPT/Codex 白色极简 × 全局毛玻璃

总原则：**克制的 ChatGPT 式布局 + macOS 玻璃质感**。信息密度可以高，但视觉必须安静：无花哨渐变按钮、无大色块，所有面板半透明，让动态壁纸的光影透过层次流动。

### 2.1 主题令牌（`src/renderer/hooks/useTheme.tsx`）

- `light` / `dark` 两套对象，组件内 `const { c } = useTheme()` 取用，**禁止硬编码颜色**（KB/终端等个别深色专用区除外）。
- 关键约定：
  - `c.bg` / `c.surface`：**实底画布**（编辑器、正文可读性兜底），仅用于根容器与代码区
  - `c.bgCard / c.surfaceCard / c.bgInput / c.bgAlt`：**全部半透明 rgba**（面板/输入/徽章 55%~60%）
  - `c.border / c.borderLight`：**半透明边框**（玻璃质感的关键，实色边框会暴露假玻璃）
  - `c.bgHover / c.surfaceHover`：透明度叠加式悬浮态（light: `rgba(0,0,0,0.045)`，dark: `rgba(255,255,255,0.07)`）
  - 用户气泡 `c.userBubbleBg` 82%、弹窗 `c.modalBg` 80% —— 文字密集处更高不透明度
- 强调色系统 `ACCENT_PRESETS`：graphite(默认)/teal/amber/rose/blue，存 `lyclaw_accent`。ThemeProvider 会把 accent 写入 CSS 变量 `--accent / --accent-text / --accent-bg / --accent-border / --border-focus`，JS 令牌 `c.accent` 同步。焦点环、发送键、活动标签指示条、开关必须跟随 accent。

### 2.2 毛玻璃系统（`src/renderer/index.css` 尾部）

```css
--glass-bg: rgba(255,255,255,0.52)   /* light，dark: rgba(44,44,48,0.55) */
--glass-bg-strong: rgba(255,255,255,0.72)  /* dark: rgba(36,36,40,0.72) */
--glass-blur: 28px   --glass-saturate: 1.25
--glass-hairline: inset 0 1px 0 rgba(255,255,255,0.45)  /* 发丝高光，dark 0.09 */
```

- `.glass` —— 常规面板：侧边栏/标签栏/工作区栏/状态栏/各页面头部/卡片/列表行
- `.glass-strong` —— 浮层：+菜单/斜杠命令/思考弹层/命令面板/搜索条/弹窗/欢迎胶囊（更实更模糊 + 投影）
- 遮罩内元素**必须带 `html[data-wallpaper="off"]` 回退**（关壁纸时自动停用 blur，退化为纯色）
- 保留实底（刻意）：代码编辑区、终端（GitHub 深色 `#0d1117`）、表单输入框、幻灯片画布
- 注意：`.glass` 的 background 是 `!important`，元素自身的 JS 悬停变色会被覆盖 —— 玻璃容器**自身不要做 hover 背景动画**，hover 效果放在子元素上

### 2.3 布局与组件规范

- 主内容列宽：标准 860px / 宽屏 1100px（`lyclaw_chat_wide` 切换）
- 输入框：26px 圆角胶囊，textarea 在上、操作行在下；操作行只留 **`+` / 麦克风 / 发送**，一切模式按钮收进 `+` 菜单，激活项以彩色 chip 显示在行内（可点即关）
- 消息：用户右侧灰气泡（圆角 20/20/4/20），AI 无气泡全宽正文 + 左上小标识；工具调用用 `.tool-card`（CSS 变量版玻璃）
- 侧边栏：`新建对话`（中性描边按钮）→ 通话/Code/知识库 紧凑图标行 → 搜索 → 会话列表（星标置顶、批量管理、悬停操作）
- 多标签页：**保留**（用户明确要求），活动标签底部有 accent 指示条
- 悬停显形模式：工作区栏操作、侧边面板开关、消息操作按钮 —— 默认低透明度，`group-hover` 显形
- 拖拽区：无边框窗口（`titleBarStyle: hiddenInset`，红绿灯 `x:16 y:15`）。侧边栏头部和 TabBar 为 `.titlebar-drag`，按钮 `.titlebar-nodrag`；侧边栏头部 mac 下 `paddingLeft: 78` 避让红绿灯

### 2.4 字体 / 动效 / 圆角

- `--font-sans: -apple-system, 'SF Pro Display', 'PingFang SC'...`；`--font-mono: 'SF Mono', Menlo...`
- 正文 14.5~16px；消息字号用户可调（`--chat-font`）
- 圆角：胶囊 9999 / 输入框 26 / 卡片 12~20 / 弹窗 16~24
- 动效：`--transition-fast 120ms / base 180ms / slow 280ms` ease-out；入场 fade-in(4-8px 位移)；极光 `aurora-drift 14s`；所有动画带 `prefers-reduced-motion` 回退

---

## 3. 品牌

- 名称：**巨天agent**（`src/renderer/brand.ts` 的 `APP_NAME`）；简称"巨天"
- 标识 `BrandMark.tsx`：「巨」= 宽扁方框（≈1.4:1）+ 中横，圆头笔画，currentColor 单色
- **App 图标（深空玻璃）**：`electron/make_icon.py` 生成（arm64 python：`/opt/homebrew/bin/python3`）
  - 石墨对角渐变底板 `#3A3A46 → #0D0D12`、顶部玻璃高光带、字形内翡翠辉光、白色巨字形带投影、右下翡翠状态点（#34D399 + 柔光晕）、发丝描边
  - 改图标后必须跑 `make_icon.py` 重新产出 icns/ico/public/icon.png
- 主色辅助：翡翠绿 `#34d399 / #10b981`（在线状态、TTS 进度条、KB 强调）

---

## 4. 启动体验（每次启动都有）

1. **loading.html**（Electron 窗口第一屏）：深空渐变 + 三枚极光光球 + 细网格 + 玻璃品牌圆片 + `Beta v4.0.0 · 欢迎来到内测` 徽章 + 翡翠进度条。保留 id 钩子（status/bar-inner/errorBox/errorMsg/retryBtn）与 electronAPI 事件。
2. **WelcomeSplash**（React 浮层，App 挂载后 3.6s 内显示）：同风格全屏页，大字"欢迎来到内测"，2.6s 自动淡出/点击跳过；结束后触发 jtcode 安装邀请判断。
3. 顺序：loading.html →（服务就绪）→ React 挂载 → WelcomeSplash → CliInstallModal（仅未安装且未点"不再提醒"时）。

---

## 5. jtcode CLI

- 脚本：`src/shared/jtcode-cli.mjs`（随 asar 分发）
- API（serve.cjs）：`GET /api/cli/status`、`POST /api/cli/install`（写 `/usr/local/bin/jtcode`，失败回退 `~/.local/bin`，chmod 755）、`POST /api/cli/uninstall`
- 能力：`jtcode` 交互 REPL / `jtcode "问题"` 单次 / `jtcode status` / `-m` 指定模型；对话走 `GET /api/settings` + `POST /api/llm-proxy`（SSE 流式）
- 弹窗组件：`CliInstallModal.tsx`（玻璃卡片 + 终端演示 + 安装态/失败态/PATH 提示），"不再提醒"写 `lyclaw_jtcode_prompt=forever`

---

## 6. Git 检查点（对话级撤销）

- 每次发送消息前自动 `git -C workdir add -A && commit`（无改动跳过；仓库不存在自动 init，`.git/info/exclude` 排除 node_modules 等）
- 撤销 = `reset --hard <hash>` + `clean -fd`；撤销前自动"保底提交"当前状态（可再撤销找回）
- API：`/api/git/status|checkpoint|undo|log|diff`；UI：工作区栏「撤销本轮更改」chip + `GitPanel.tsx`（Code 模式工具栏「检查点」同款）

---

## 7. 构建与更新规范 ★最重要★

```bash
npm run build        # 仅前端构建
npm run patch        # 前端构建 + 补丁式更新已安装 App（约 10~30s）
npm run patch:fast   # 跳过构建纯补丁（秒级）
npm run electron:build  # ⚠️ 全量编译（仅限：Electron 版本变更 / 原生模块 / 新依赖 / 改打包配置）
```

- **日常更新一律走 patch**（用户电脑会卡，严禁动不动全量编译）。原理：asar 解包→热替换 dist/electron/serve.cjs/src/shared/package.json→重打包（`--unpack '**/*.node'`）→重启→健康检查。
- 补丁前自动备份 `app.asar.bak`；回滚 = 改名回去。
- electron-builder `files` 配置与补丁替换范围保持一致：`dist/** electron/** serve.cjs src/shared/** package.json`。

---

## 8. 稳定性与性能约定

- **EPIPE 防崩**（main.cjs 顶部）：stdout/stderr error 监听吞 EPIPE；`uncaughtException`/`unhandledRejection` 兜底不退出。后台/管道启动场景必须安全。
- **TTS 惰性启动**：开机不启动 Flask(5050)；`globalThis.ensureEdgeTTS()` 由 serve.cjs `/api/edge-tts` 首次调用拉起，就绪轮询 250ms 上限 10s。
- STT worker 懒加载（首次语音识别才拉 python）；壁纸视频 `document.hidden` 时暂停解码。
- 启动链路禁止新增阻塞等待；健康轮询 150ms。
- 长消息 >2500 字自动折叠；上下文仪表、token 估算保留。

---

## 9. 功能红线（用户明确要求）

1. **不得删除任何已有功能**，只能收纳/重组（收进菜单、悬停显形、弱化样式）
2. **多标签页必须保留**
3. 动态壁纸默认开启（`/bg_upload.mp4`），设置可关
4. UI 对齐 ChatGPT/Codex 极简，但全界面毛玻璃（浅色模式也要可见的磨砂）
5. 每次启动显示内测欢迎宣传页
6. 每轮对话后可通过 Git 检查点一键撤销
7. 用户说"不要一直测试" —— 改完用构建/补丁验证即可，不做浏览器截图循环测试

---

## 10. 已知 API 面（速查）

| 端点 | 说明 |
|---|---|
| `POST /api/llm-proxy` | OpenAI 兼容代理（X-Target-Base / X-Api-Key 头），SSE |
| `GET/POST /api/sessions` / `/api/sessions/:id/messages` | 会话与消息 CRUD |
| `GET /api/settings` `POST /api/settings` | 设置读写（含 apiKey/model/provider） |
| `/api/git/*` | status/checkpoint/undo/log/diff |
| `/api/cli/*` | jtcode status/install/uninstall |
| `POST /api/edge-tts` | 语音合成（惰性拉起 TTS） |
| `POST /api/speech-to-text` | 语音识别（STT worker） |
| `/api/skills/*` `/api/kb/*` `/api/memories` `/api/tasks` | 技能/知识库/记忆/定时任务 |
| `/api/health` | `{status, agent, tools, workDir}` |

---

## 11. 开发红线之外的小品味

- 空状态欢迎页：居中大字问候 + 6 枚建议胶囊（玻璃）+ 次级文字入口（场景/换一批/快速入口）
- 消息队列：输入框上方可视化面板，逐条展示、单条取消
- 斜杠命令：输入 `/` 弹出 12 条命令菜单（联网/规划/画画/造技能/集群/知识库/截图/编码/通用/思考×3）
- 快捷键：Cmd+K 面板 · Cmd+N 新对话 · Cmd+T 新标签 · Cmd+W 关标签 · Cmd+F 消息内搜索 · Cmd+Shift+S 截图
- 深色模式：ChatGPT 深灰（画布 #212121 / 侧栏 #171717），auto 跟随系统
