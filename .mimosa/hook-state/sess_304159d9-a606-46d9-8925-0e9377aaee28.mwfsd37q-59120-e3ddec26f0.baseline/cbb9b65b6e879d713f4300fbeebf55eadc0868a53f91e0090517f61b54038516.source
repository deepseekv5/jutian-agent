/**
 * 阻塞命令预检（v13.11）
 *
 * 背景：模型经常执行 `npm run dev`、`vim`、`python`（REPL）、`tail -f`、
 * `ssh host` 这类**不会自己结束**的命令。旧行为是干等到 180 秒硬超时，
 * 期间用户只看到转圈——一次误调用就白等三分钟，而且日志里什么也看不到。
 *
 * 这里在真正执行前做一次静态识别：命中就把「为什么会卡」和「怎么改」
 * 直接作为工具结果返回，模型立刻能换写法（加 -y、timeout 包裹、后台 &）。
 *
 * 保守原则：只拦**确定**会阻塞的形态；带 & / timeout / --yes 等已处理过的
 * 命令一律放行，宁可漏拦也不误伤正常命令。
 */

export interface ShellGuardResult {
  /** 是否判定为会阻塞 */
  blocked: boolean
  /** 命中的类别（用于文案） */
  kind?: 'editor' | 'repl' | 'follower' | 'server' | 'ssh'
  /** 给模型的可操作建议 */
  hint?: string
}

/** 已显式处理过阻塞的场景：后台运行、超时包裹、自动确认 */
const MITIGATED = /(^|\s)(&\s*$|&>|timeout\s|--yes\b|-y\b|--non-interactive\b|--no-input\b|CI=1\b|nohup\s)/i

/** 交互式编辑器 / 分页器：一定会抢占终端 */
const EDITOR = /^\s*(sudo\s+)?(vim|vi|nvim|nano|pico|emacs|micro|less|more|most|man|info)\b/
/** 裸 REPL：没有脚本参数时进入交互循环 */
const REPL = /^\s*(sudo\s+)?(python3?|node|deno|bun|irb|iex|ghci|php)\s*(-i)?\s*$/
/** 持续跟随输出 */
const FOLLOWER = /^\s*(sudo\s+)?(tail\s+(-[a-zA-Z]*f|--follow)|journalctl\s+-f|dmesg\s+-w|watch\s)/
/** 常驻服务：不会返回（开发服务器/监听进程） */
const SERVER = /^\s*(sudo\s+)?(npm\s+(run\s+)?(dev|start|serve)|pnpm\s+(run\s+)?(dev|start)|yarn\s+(dev|start)|vite|next\s+dev|nuxt\s+dev|flask\s+run|uvicorn|gunicorn|nodemon|webpack\s+serve|http-server|python3?\s+-m\s+http\.server)/
/** 无命令的 ssh：进入交互 shell */
const SSH = /^\s*ssh\s+[^-][^\s]*\s*$/

const HINTS: Record<NonNullable<ShellGuardResult['kind']>, string> = {
  editor: '交互式编辑器/分页器无法在非交互环境使用。改用 read_file 查看内容，或用 sed/head 打印片段。',
  repl: '裸 REPL 会一直等待输入。改用 `python script.py` / `node script.js`，或 `-c "..."` 直接执行代码。',
  follower: '该命令会持续输出不返回。改用 `tail -n 100 文件` 取一次快照，需要持续观察时用后台运行（`... &`）。',
  server: '常驻服务不会退出。请后台启动（`npm run dev > /tmp/dev.log 2>&1 &`）后用 sleep + tail 读日志；构建类任务用 `npm run build`。',
  ssh: '无命令的 ssh 会进入交互 shell。请写成 `ssh host "命令"` 形式。',
}

/**
 * 判断命令是否会阻塞。
 * @param command 模型给出的完整命令行
 * @param isInteractive 平台是否支持交互（桌面端 shell 有 TTY 也一样会卡住 agent）
 */
export function checkBlockingCommand(command: string): ShellGuardResult {
  const cmd = String(command || '').trim()
  if (!cmd) return { blocked: false }
  // 已做处理的（后台/超时/自动确认）一律放行
  if (MITIGATED.test(cmd)) return { blocked: false }

  const tests: [NonNullable<ShellGuardResult['kind']>, RegExp][] = [
    ['editor', EDITOR],
    ['repl', REPL],
    ['follower', FOLLOWER],
    ['server', SERVER],
    ['ssh', SSH],
  ]
  for (const [kind, re] of tests) {
    if (re.test(cmd)) return { blocked: true, kind, hint: HINTS[kind] }
  }
  return { blocked: false }
}

/** 面向用户的拦截文案（工具结果用） */
export function blockingMessage(result: ShellGuardResult): string {
  return `⚠️ 该命令会阻塞（不会自行结束），已跳过执行以免空等 180 秒。\n${result.hint || ''}`
}
