# 贡献指南

感谢关注巨天agent。本仓库接受 Issue 与 PR,以下几条能让协作更顺。

## 环境准备

- Node.js 18+(推荐 20)
- 克隆后执行 `./run.sh`(Windows 双击 `run.bat`),脚本会自动装依赖并启动开发环境
- 后端 :3211,前端 Vite :5173,浏览器访问 http://localhost:5173 或直接用 Electron 壳

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 后端 + 前端热更新同时启动 |
| `npm run lint` | ESLint 检查(提交前必须零 error) |
| `npm run check` | TypeScript 全量类型检查 |
| `npm run verify` | 契约校验(工具 schema / 约束知识库 / 免 key 常量 / 合规条款) |
| `npm test` | 单元与安全回归测试(vitest) |
| `npm run test:watch` | 测试监视模式 |
| `npm run build` | 构建后端(serve.cjs)+ 前端(dist/) |
| `npm run electron:build` | 打包 macOS dmg + zip |
| `npm run electron:build:win` | 打包 Windows 安装器 |

## 测试

测试在 `tests/`，用 vitest。提交前请跑一遍：

```bash
npm run check && npm run lint && npm test && npm run build
```

四道门禁都必须通过。CI 会在 PR 上自动跑同样的命令。

**两类测试的写法**

- **纯函数单测**（多数）：直接 import 被测模块。适合判定逻辑、格式化、策略计算
  ——`tests/sensitiveOps.test.ts`（敏感操作判定）、`tests/contextCompress.test.ts`
  （上下文压缩策略）、`tests/toolLoopGuard.test.ts`（工具循环护栏）。
  写这类测试时优先覆盖**边界与误判**：恰好到阈值、参数不同不该误拦、
  非法输入不抛错。
- **集成测试**（`tests/security.test.ts`）：`spawn` 真实的 `serve.cjs` 打 HTTP 端点。
  用于验证路径穿越、SSRF、跨站门卫这类必须走完整请求链路的防护。
  **前置**：需要先 `npm run build:server`（CI 里已排在 test 之前）。

**什么时候该加测试**

改判定/策略/解析逻辑时。这类代码的 bug 往往表现为「偶发」「难复现」，
没有测试就只能靠用户报告。新增防护时同时加一条**防误伤**用例——
判据过宽比漏判更难排查（用户会以为功能坏了）。

## 提交规范

- 提交信息用 `type: 描述` 格式:`feat` / `fix` / `refactor` / `docs` / `chore` / `security`
- 一件事一个提交;改动说明写「为什么」,不写「改了哪个文件」
- PR 只带一个主题,描述里写清楚动机与验证方式

## 红线

- **不要提交任何密钥、token、`.env`**——设置全部存在用户本机 SQLite(`~/.lyclaw/data.db`),仓库里不该出现任何真实凭据
- `python-runtime/`、`tools/`、`archive/`、`serve.cjs`(构建产物)不入库
- 改 `src/server/serve.ts` 后必须 `npm run build:server` 并跑通;改跨站/安全逻辑前先读该文件头部注释里的门卫语义

## Windows 打包注意

`better-sqlite3` 需要对应 Electron ABI 的预编译产物。交叉打包流程见 `scripts/buildarmdmg.sh` 与 `scripts/rebuild-for-electron.sh` 的注释;本地 Windows 打包直接跑 `npm run electron:build:win`。

## 行为准则

参与贡献即同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。
