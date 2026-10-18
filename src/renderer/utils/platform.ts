// 平台判定 — 全站唯一来源。
//
// 之前每处都写 /Win/i.test(navigator.platform)，有三个问题：
//  1. navigator.platform 已废弃，Electron/Chromium 各版本拼写不一致
//     （"Win32" / "Windows" / 在部分 UA 缩减下甚至为空串）——判成 macOS
//     后模型就会拿到 zsh 语法提示，在 Windows 上写 `&&` 链、正斜杠路径，
//     命令必然失败；
//  2. 判错时失败是静默的：模型只是"命令报错"，然后以为工具不可用；
//  3. 散落十几处，改一处漏一处。
//
// preload 已经把 process.platform 透出来了（electronAPI.platform），
// 那是唯一可信来源；浏览器/远程 WebUI 没有它，才退回 navigator 猜测。
//
// 注意：远程 WebUI（手机）跑在浏览器里，拿到的是**手机**的平台，
// 但工具执行在桌面服务端。所以服务端场景不要用这里的判定，
// 服务端一律用 process.platform（见 serve.ts 的 IS_WIN）。

/** 原始平台串：'win32' | 'darwin' | 'linux' | ... ；未知时为空串 */
export function platformId(): string {
  const api = (globalThis as { electronAPI?: { platform?: string } }).electronAPI
  if (api?.platform) return String(api.platform)
  const nav = globalThis.navigator
  const s = `${nav?.platform || ''} ${nav?.userAgent || ''}`
  if (/win/i.test(s)) return 'win32'
  if (/mac|darwin/i.test(s)) return 'darwin'
  if (/linux|x11/i.test(s)) return 'linux'
  return ''
}

export function isWindows(): boolean {
  return platformId() === 'win32'
}

export function isMac(): boolean {
  return platformId() === 'darwin'
}

/** 人读的系统名，写进提示词 */
export function osName(): string {
  const id = platformId()
  if (id === 'win32') return 'Windows'
  if (id === 'darwin') return 'macOS'
  if (id === 'linux') return 'Linux'
  return 'macOS'
}

/** 默认 shell 名 */
export function shellName(): string {
  return isWindows() ? 'PowerShell' : 'zsh'
}

/**
 * 交给模型的运行环境说明。
 *
 * 这段不是装饰：模型据此决定写 `&&` 还是 `;`、用正斜杠还是反斜杠、
 * 用 ls 还是 Get-ChildItem。写错就是"指令执行不了"，而模型通常会把
 * 命令失败归因成"我没有权限调用工具"，于是再声称无法使用工具——
 * 这正是 Windows 上观感极差的根源。所以宁可啰嗦也要写全。
 */
export function runtimeEnvLine(): string {
  if (isWindows()) {
    return 'Windows（shell 是 PowerShell 5.1，不是 bash/zsh：'
      + '不要用 && 串联，用 `;` 或分开执行；'
      + '不要用 ls/cat/rm/mkdir -p/grep -r，用 Get-ChildItem/Get-Content/Remove-Item/New-Item -ItemType Directory/Search-Item；'
      + '路径用反斜杠 C:\\Users\\...，或直接用 / 也行但不要混着拼字符串）'
  }
  return 'macOS/Linux（shell 是 zsh/bash：可用 && 串联、用 ls/cat/rm/mkdir -p/grep；路径用正斜杠 /Users/...）'
}
