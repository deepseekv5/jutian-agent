# CLAUDE.md

巨天agent——本地优先的 AI 工作台（Electron 桌面 + Android 本地版 + 浏览器 WebUI）。与用户交流一律用中文。

## 常用命令

```bash
npm run check   # 门禁：tsc --noEmit && build:server（src/server 不在 tsc 覆盖内，build:server 必须跑）
npm run lint    # eslint src（0 error 才能合并）
npm test        # vitest run（全量 ~740 项）
npm run verify  # 发布门禁（工具数/协议版本比对等）
```

## 结构要点

- `src/server/serve.ts`：后端单文件（~5900 行，esbuild 打包成 serve.cjs）。所有 API 端点与 50+ 工具实现都在这里。改动时用精确锚点补丁，改完必跑 `npm run build:server` 验证。
- `src/shared/`：跨端共享模块（db/jsondb/mcp/websearch/tts/hermesTools/chatCompression 等），渲染端与安卓 nodejs-mobile 共用。
- `src/renderer/engine/stream.ts`：agent 主循环（工具并行、循环防护、性能打点）。
- `src/renderer/engine/toolLoopGuard.ts`：软硬两级循环防护（SOFT=3 提醒 / HARD=5 阻断）。
- 安卓：`android/`（nodejs-mobile 嵌入 Node 18），工具多端兼容见 `src/server/tools/framework.ts` 平台声明表。

## 约定

- 版本号小步递增（13.x.y patch 级），发版靠 GitHub Actions tag 触发（mac/win/linux/android 四工作流），不要本地打包。
- 工具返回必须是 `{ success, output }` 形状；文案面向用户（中文、可操作）。
- shared/*.cjs 改动后必须重启 serve 才生效；渲染端不要从 lazy 面板具名 import 辅助函数（会把整个面板并进首屏 chunk）。
- 新功能必须带 vitest 测试；提交前 `npm run check && npm run lint && npm test` 全绿。
- electron-builder 26 限制：产物名只认平台段 `mac.artifactName`（全 ASCII，productName 中文会间歇性炸 GitHub 上传）。
