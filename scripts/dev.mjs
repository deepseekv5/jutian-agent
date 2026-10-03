#!/usr/bin/env node
/**
 * ly-next 开发启动器：同时运行后端 (serve.cjs:3211) 和前端 (vite:5173)
 * Ctrl-C 一起退出。前端 /api 由 vite 代理到后端。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const procs = []

function start(name, cmd, args, color) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, FORCE_COLOR: '1' } })
  procs.push(p)
  const tag = `\x1b[${color}m[${name}]\x1b[0m`
  p.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n') + '\n'))
  p.stderr.on('data', (d) => process.stderr.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n') + '\n'))
  p.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`${tag} 退出（code ${code}）`)
    shutdown()
  })
  return p
}

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of procs) { try { p.kill('SIGTERM') } catch {} }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('\x1b[36m[ly-next]\x1b[0m 启动开发环境：后端 :3211 + 前端 :5173')
start('server', process.execPath, ['serve.cjs'], '33')
start('vite', process.execPath, ['node_modules/vite/bin/vite.js', '--host'], '35')
