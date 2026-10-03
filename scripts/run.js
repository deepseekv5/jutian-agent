#!/usr/bin/env node
/**
 * 巨天agent - 一键启动
 * 用法: node run.js
 */
const { execSync, spawn } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')
const { homedir } = require('os')

const dir = join(__dirname, '..')

// 确保 node/npm 路径可用
process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`

console.log(`
╔════════════════════════════════════════╗
║     🐾 巨天agent 启动中...            ║
╚════════════════════════════════════════╝
`)

// 首次运行安装依赖
if (!existsSync(join(dir, 'node_modules'))) {
  console.log('📥 首次运行，安装依赖...')
  execSync('npm install', { cwd: dir, stdio: 'inherit' })
}

// 清理残留端口
try { execSync("lsof -ti:3211 | xargs kill -9 2>/dev/null; sleep 1", { cwd: dir }) } catch {}
// 确保彻底杀干净
try { execSync("pkill -f 'node serve.cjs' 2>/dev/null; sleep 1", { cwd: dir }) } catch {}

// Build
console.log('🔨 构建前端...')
execSync('npm run build', { cwd: dir, stdio: 'inherit' })

// 启动
console.log(`
🚀 启动完成！
   → http://localhost:3211
   按 Ctrl+C 停止
`)

const child = spawn(process.execPath, ['--max-old-space-size=128', 'serve.cjs'], {
  cwd: dir,
  stdio: 'inherit',
  env: { ...process.env }
})

child.on('exit', code => {
  console.log(code === 0 ? '\n👋 已停止' : `\n❌ 异常退出 (${code})`)
  process.exit(code || 0)
})

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
