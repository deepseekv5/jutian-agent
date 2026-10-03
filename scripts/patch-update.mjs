#!/usr/bin/env node
/**
 * 补丁式更新 —— 只重打 app.asar（约 10-30 秒），不做全量编译：
 *   ✗ 不重新下载 Electron / 不重建 better-sqlite3 / 不打 DMG
 *   ✓ 前端 dist、主进程 electron/*.cjs、serve.cjs、src/shared 直接热替换
 *
 * 用法：
 *   npm run patch          # 先 vite build 再打补丁到已安装 App
 *   node scripts/patch-update.mjs --no-build   # 跳过构建直接打补丁
 *   APP_PATH=/path/to/App  # 自定义目标 App
 *
 * 安全：更新前自动备份 app.asar -> app.asar.bak；失败可用 .bak 回滚。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_PATH = process.env.APP_PATH || '/Applications/巨天agent.app'
const APP_NAME = path.basename(APP_PATH, '.app')
const RESOURCES = path.join(APP_PATH, 'Contents', 'Resources')
const ASAR = path.join(RESOURCES, 'app.asar')

const noBuild = process.argv.includes('--no-build')
const log = (m) => console.log(`[patch] ${m}`)

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`)
}

function asarBin() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js'),
    path.join(ROOT, 'node_modules', 'asar', 'bin', 'asar.js'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return ['node', c]
  }
  return [process.execPath, path.join(ROOT, 'node_modules', '.bin', 'asar')]
}

async function main() {
  const t0 = Date.now()

  if (!fs.existsSync(APP_PATH)) {
    console.error(`[patch] 找不到 ${APP_PATH}（可用 APP_PATH=... 指定）`)
    process.exit(1)
  }
  if (!fs.existsSync(ASAR)) {
    console.error('[patch] app.asar 不存在')
    process.exit(1)
  }

  // 1. 构建前端（可跳过）
  if (!noBuild) {
    log('构建前端 (vite build)...')
    run('npm', ['run', 'build'])
  } else {
    log('跳过构建 (--no-build)')
  }

  // 2. 解包现有 app.asar
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jutian-patch-'))
  const cur = path.join(tmp, 'cur')
  const outDir = path.join(tmp, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  const [ab, ...aa] = asarBin()
  log('解包 app.asar ...')
  run(ab, [...aa, 'extract', ASAR, cur])

  // 3. 热替换变更内容（与 electron-builder files 配置一致）
  const copyDir = (src, dest) => {
    if (!fs.existsSync(src)) return
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(src, dest, { recursive: true })
  }
  copyDir(path.join(ROOT, 'dist'), path.join(cur, 'dist'))
  copyDir(path.join(ROOT, 'electron'), path.join(cur, 'electron'))
  copyDir(path.join(ROOT, 'src', 'shared'), path.join(cur, 'src', 'shared'))
  fs.copyFileSync(path.join(ROOT, 'serve.cjs'), path.join(cur, 'serve.cjs'))
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(cur, 'package.json'))
  log('已替换 dist / electron / serve.cjs / src/shared / package.json')

  // 4. 重打包（.node 原生模块继续 unpack 到 app.asar.unpacked）
  log('重打包 app.asar ...')
  run(ab, [...aa, 'pack', cur, path.join(outDir, 'app.asar'), '--unpack', '**/*.node'])

  // 5. 原子替换 + 备份
  const isRunning = spawnSync('pgrep', ['-f', `${APP_NAME}`]).status === 0
  if (isRunning) {
    log('关闭运行中的 App ...')
    for (let i = 0; i < 5; i++) {
      spawnSync('pkill', ['-9', '-f', `${APP_NAME}.app/Contents/MacOS`])
      await new Promise((r) => setTimeout(r, 800))
      if (spawnSync('pgrep', ['-f', `${APP_NAME}.app/Contents/MacOS`]).status !== 0) break
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
  fs.rmSync(path.join(RESOURCES, 'app.asar.bak'), { force: true, recursive: true })
  fs.renameSync(ASAR, path.join(RESOURCES, 'app.asar.bak'))
  const oldUnpacked = path.join(RESOURCES, 'app.asar.unpacked')
  fs.rmSync(path.join(RESOURCES, 'app.asar.unpacked.bak'), { force: true, recursive: true })
  if (fs.existsSync(oldUnpacked)) fs.renameSync(oldUnpacked, path.join(RESOURCES, 'app.asar.unpacked.bak'))
  fs.renameSync(path.join(outDir, 'app.asar'), ASAR)
  if (fs.existsSync(path.join(outDir, 'app.asar.unpacked'))) {
    fs.cpSync(path.join(outDir, 'app.asar.unpacked'), path.join(RESOURCES, 'app.asar.unpacked'), { recursive: true })
  }
  log('已写入新 app.asar（备份: app.asar.bak）')

  // 6. 重启 App
  log('重启 App ...')
  spawnSync('open', ['-a', APP_PATH])

  // 7. 等待服务就绪
  const ports = [3211, 3210]
  let ok = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    for (const p of ports) {
      try {
        const res = await fetch(`http://localhost:${p}/api/health`, { signal: AbortSignal.timeout(800) })
        if (res.ok) { log(`服务已就绪: http://localhost:${p}`); ok = true; break }
      } catch { /* 未就绪 */ }
    }
    if (ok) break
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  log(`完成，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s${ok ? '' : '（服务仍在启动，请稍候）'}`)
  if (!ok) process.exit(2)
}

main().catch((e) => {
  console.error('[patch] 失败:', e.message)
  console.error('[patch] 如需回滚：将 app.asar.bak 改名回 app.asar')
  process.exit(1)
})