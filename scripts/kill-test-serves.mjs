#!/usr/bin/env node
/**
 * 测试前置清理（v17.0.5）：杀掉上一轮测试遗留的 serve.cjs 僵尸进程。
 *
 * 背景：tests/editReliability 等测试会 spawn 独立 serve.cjs（监听 6900-7100
 * 随机端口），异常退出时 afterAll 不执行 → 僵尸积累（实测攒到 7 个、跨多天），
 * 下一轮测试撞端口时「health 200 来自加载旧代码的僵尸」→ 假失败/旧行为。
 *
 * 判据（只杀测试特征，不伤生产）：node 进程 + 命令行含本仓库 serve.cjs +
 * 监听端口落在测试端口段 6900-7100。
 */
import { execSync } from 'node:child_process'

const REPO = process.cwd().replace(/[/\\]$/, '')

let out = ''
try {
  out = execSync('ps aux', { encoding: 'utf8' })
} catch { process.exit(0) }

const victims = []
for (const line of out.split('\n')) {
  if (!line.includes('serve.cjs')) continue
  if (!line.includes(REPO.split('/').pop())) continue
  const pid = Number(line.trim().split(/\s+/)[0])
  if (!pid || pid === process.pid) continue
  // 查监听端口是否在测试段
  try {
    const lsof = execSync(`lsof -p ${pid} 2>/dev/null`, { encoding: 'utf8' })
    const portMatch = lsof.match(/TCP \*:(\d+) /)
    if (portMatch) {
      const port = Number(portMatch[1])
      if (port >= 6900 && port <= 7100) victims.push({ pid, port })
      continue
    }
    // 无监听也可能是刚崩的——cwd 是本仓库的 serve 一并视为测试残留
    if (lsof.includes('cwd')) victims.push({ pid, port: 0 })
  } catch { /* 进程已退出 */ }
}

for (const v of victims) {
  try { process.kill(v.pid, 'SIGKILL'); console.log(`[pretest] killed zombie serve pid=${v.pid} port=${v.port}`) } catch {}
}
console.log(`[pretest] 清理完成：${victims.length} 个测试僵尸进程`)
