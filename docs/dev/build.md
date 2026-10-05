# 构建与发布

> [← 返回文档索引](../../README.md#docs)

## 命令总表

| 命令 | 作用 |
|---|---|
| `npm run dev` | 后端 :3211 + Vite :5173 同时启动(开发) |
| `npm run lint` | ESLint(CI 门禁:**零 error**) |
| `npm run check` | TypeScript 全量类型检查 |
| `npm run build:server` | `src/server/serve.ts` → `serve.cjs`(esbuild) |
| `npm run build` | build:server + Vite 前端构建 → `dist/` |
| `npm run electron:build` | macOS 打包(dmg + zip,arm64) |
| `npm run electron:build:win` | Windows 打包(NSIS 安装器,x64) |
| `npm run patch` / `patch:fast` | 已安装应用补丁更新(见下) |

## 产物边界

| 路径 | 性质 |
|---|---|
| `serve.cjs` | **构建产物,勿手改**——改 `src/server/serve.ts` 后重新 build |
| `dist/` | Vite 前端产物 |
| `release/` | electron-builder 打包输出 |
| `python-runtime/`、`tools/` | 本地目录,gitignore,不进仓库 |

## macOS 打包

```bash
npm run electron:build
```

脚本链:Vite 构建 → better-sqlite3 按 Electron ABI 重编 → electron-builder。语音功能依赖 edge-tts 运行时,通过 `EDGE_TTS_DIR` 环境变量注入源码目录(默认探测桌面路径,可显式覆盖)。

## Windows 打包

`npm run electron:build:win`。注意 `better-sqlite3` 必须换成 electron 对应 ABI 的 win32 预编译产物再打包,脚本已内置该流程。

## 补丁更新(已安装的应用)

不想重装,只改了部分文件时:

```bash
npm run patch         # 先构建,再把增量打进 /Applications 里的 app
npm run patch:fast    # 跳过构建,直接打
```

补丁内容:dist、electron、serve.cjs、src/shared。适合开发期快速验证线上包行为。

## CI 策略

`.github/workflows/ci.yml` 在 push/PR 时跑:**ESLint(零 error 门禁)→ 后端构建 → 前端构建**,产物留档 3 天。

**CI 不做 electron 发布**,原因:完整安装包需要 326MB 的 python-runtime 与 edge-tts 运行时注入,CI 环境没有,硬打包会产出静默降级语音功能的产物。发布保持本地构建。

## 发布 checklist

1. `package.json` 升版本(单一来源:brand / electron / CLI 自动跟随)
2. `CHANGELOG.md` 补条目
3. `npm run build && npm run lint` 全绿
4. `npm run electron:build`(Windows 另跑 `electron:build:win`)
5. GitHub Release:tag + 产物(dmg / zip / setup.exe)+ CHANGELOG 摘录
