#!/usr/bin/env node
/**
 * 巨天 TUI 入口（jt）
 *
 *   jt                    连接本机巨天后端进入终端对话
 *   jt（后端未运行时）     自动拉起：仓库 serve.cjs → 已安装的巨天 App，就绪后进入
 *   jt --resume=<id>      恢复指定会话
 *
 * 冷启动不依赖桌面 App：serve.cjs 直接后台起后端（安全盾/51 工具全量可用）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPO_ROOT, PORT, health, startBackend, startApp, waitHealth } from './api.mjs'

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const accent = (s) => `\x1b[1;36m${s}\x1b[0m`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`巨天 TUI（终端版）
  jt                  进入终端对话（后端未运行时自动拉起）
  jt --resume=<id>    恢复指定会话
  JUTIAN_PORT=xxxx    指定后端端口（默认 3211）`)
  process.exit(0)
}

async function main() {
  // 1) 探测后端
  let info = await health()
  if (info) {
    console.log(accent('◆ 巨天 TUI') + dim(`  后端已就绪 v${info.version} · ${info.tools} 工具`))
  } else {
    // 2) 未运行 → 拉起
    const serveCjs = resolve(REPO_ROOT, 'serve.cjs')
    const via = existsSync(serveCjs)
      ? (() => { return 'serve' })()
      : null
    let starter
    if (via) starter = await startBackend()
    else starter = startApp()
    if (!starter) {
      console.log(`\x1b[31m✗ 未找到巨天：仓库缺少 serve.cjs，且未安装桌面版（/Applications/巨天agent.app）\x1b[0m`)
      process.exit(1)
    }
    console.log(accent('◆ 巨天 TUI') + dim(`  后端未运行 → 正在拉起（${starter.via === 'serve' ? '仓库 serve.cjs' : starter.via}）…`))
    info = await waitHealth(90_000, (sec) => process.stdout.write(dim(`\r  启动中 ${sec}s…`)))
    process.stdout.write('\n')
    if (!info) {
      console.log(`\x1b[31m✗ 后端启动超时，查看 /tmp/jutian-serve-tui.log\x1b[0m`)
      process.exit(1)
    }
    console.log(dim(`  后端就绪 v${info.version} · ${info.tools} 工具`))
  }

  // 3) 读取配置 + 工具清单（与桌面渲染层同一份 JSON）
  const settings = await fetch(`http://127.0.0.1:${PORT}/api/settings`).then((r) => r.json()).catch(() => ({}))
  let tools = []
  try {
    const list = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/shared/builtin-tools.json'), 'utf-8'))
    tools = list.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
  } catch { /* 工具清单缺失时服务端仍有兜底 */ }

  // 4) 进入 TUI（ink 为 ESM，App.jsx 由 esbuild 编译成 App.mjs；缺失时自动构建兜底）
  const appMjs = resolve(REPO_ROOT, 'tui', 'App.mjs')
  if (!existsSync(appMjs)) {
    console.log(dim('  首次运行：正在编译 TUI…'))
    const { spawnSync } = await import('node:child_process')
    const esbuild = resolve(REPO_ROOT, 'node_modules', '.bin', 'esbuild')
    const r = spawnSync(esbuild, ['tui/App.jsx', '--bundle', '--platform=node', '--format=esm', '--jsx=automatic',
      '--outfile=tui/App.mjs', '--external:react-devtools-core', '--external:ink', '--external:react',
      '--external:react-reconciler', '--external:marked', '--external:marked-terminal', '--external:ink-spinner', '--external:yoga-layout'],
      { cwd: REPO_ROOT, stdio: 'inherit' })
    if (r.status !== 0 || !existsSync(appMjs)) {
      console.error('\x1b[31m✗ TUI 编译失败——请先在仓库目录执行 npm install\x1b[0m')
      process.exit(1)
    }
  }
  const { startTui } = await import('./App.mjs')
  await startTui({ info, tools, settings, port: PORT })
}

main().catch((e) => {
  console.error(`\x1b[31m✗ ${e?.message || e}\x1b[0m`)
  process.exit(1)
})
