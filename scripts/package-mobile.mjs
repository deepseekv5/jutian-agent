#!/usr/bin/env node
/**
 * 手机独立包打包（v12.9）
 *
 * 产出 jutian-mobile-<ver>.zip：在 Android/Termux 上独立运行完整巨天agent
 * （不依赖电脑）。内容：
 *   serve.cjs            单文件后端（esbuild 产物，纯 JS）
 *   src/shared/*.cjs     运行时旁加载模块（db/mcp/jsondb 等）
 *   dist/                完整前端（桌面同一份，手机浏览器直跑）
 *   package.json         版本号单一来源
 *   install.sh           Termux 一键安装脚本
 *
 * 不含 node_modules：唯一原生依赖 better-sqlite3 在手机上不可用，
 * serve.cjs 自动切换 jsondb（真实落盘的 JSON 存储，对话数据照常保存）。
 * 知识库向量检索在手机上不可用——诚实降级为空，不假装有数据。
 *
 * 用法：node scripts/package-mobile.mjs  → /tmp/mobile-out/jutian-mobile-<ver>.zip
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const OUT = process.env.MOBILE_OUT || '/tmp/mobile-out'
const STAGE = path.join(OUT, `jutian-mobile-${VER}`)

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: opts.quiet ? 'ignore' : 'inherit', ...opts })
}

// 1) 确保产物存在（构建脚本不代劳——CI 里各步已分开跑）
for (const f of ['serve.cjs', 'dist/index.html']) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    console.error(`缺少 ${f}——请先运行 npm run build:server 和 npx vite build`)
    process.exit(1)
  }
}

// 2) 清理暂存区
fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(path.join(STAGE, 'src/shared'), { recursive: true })
fs.mkdirSync(path.join(STAGE, 'dist'), { recursive: true })

// 3) 后端单文件 + 旁加载模块 + 前端 + 版本来源
fs.copyFileSync(path.join(ROOT, 'serve.cjs'), path.join(STAGE, 'serve.cjs'))
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGE, 'package.json'))
for (const f of fs.readdirSync(path.join(ROOT, 'src/shared'))) {
  if (f.endsWith('.cjs')) fs.copyFileSync(path.join(ROOT, 'src/shared', f), path.join(STAGE, 'src/shared', f))
}
fs.cpSync(path.join(ROOT, 'dist'), path.join(STAGE, 'dist'), { recursive: true })

// 4) Termux 一键安装脚本
fs.writeFileSync(
  path.join(STAGE, 'install.sh'),
  `#!/data/data/com.termux/files/usr/bin/bash
# 巨天agent 手机独立安装（Termux）
# 用法：bash install.sh
set -e
cd "$(dirname "$0")"

echo "[1/3] 安装 Node.js（若已装则跳过）..."
command -v node >/dev/null || pkg install -y nodejs-lts

echo "[2/3] 安装巨天agent到 ~/jutian ..."
mkdir -p ~/jutian
cp -r serve.cjs src dist package.json ~/jutian/

echo "[3/3] 启动..."
echo ""
echo "  启动命令： cd ~/jutian && node serve.cjs"
echo "  然后浏览器打开 http://localhost:3211"
echo "  （或用巨天agent APK，会自动探测本机服务）"
echo ""
node serve.cjs
`
)

// 5) 打 zip
const zipPath = path.join(OUT, `jutian-mobile-${VER}.zip`)
fs.rmSync(zipPath, { force: true })
run('zip', ['-qr', zipPath, '.'], { cwd: STAGE, quiet: true })

const size = (fs.statSync(zipPath).size / 1048576).toFixed(1)
console.log(`手机独立包: ${zipPath} (${size} MB)`)
