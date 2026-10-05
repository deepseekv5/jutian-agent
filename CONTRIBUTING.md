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
| `npm run build` | 构建后端(serve.cjs)+ 前端(dist/) |
| `npm run electron:build` | 打包 macOS dmg + zip |
| `npm run electron:build:win` | 打包 Windows 安装器 |

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
