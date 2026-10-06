/**
 * computer-use.cjs — Computer Use 能力（v5.0 新增）
 *
 * 职责：把「看屏幕」与「操作电脑」封装为 IPC 能力，供渲染层代理循环调用。
 *   cu-permission   检测 屏幕录制 / 辅助功能 权限，以及 cliclick 是否可用
 *   cu-open-perms   打开对应的系统设置面板
 *   cu-displays     显示器清单（多显示器时的坐标基准）
 *   cu-capture      截取指定屏幕，返回 JPEG dataURL + 实际像素尺寸
 *   cu-action       执行一个原子动作（move/click/drag/type/key/scroll）
 *
 * 执行层（macOS）：优先 cliclick（brew install cliclick，支持拖拽），
 * 回退 osascript System Events（点击/键入/按键）。Windows 走 PowerShell。
 * 坐标一律为「屏幕逻辑坐标」(global display coordinates)。
 */
const { ipcMain, desktopCapturer, screen, shell, systemPreferences } = require('electron')
const { execFile } = require('child_process')

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'

/** 执行 shell 命令（promise + 超时） */
function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (done) return
      done = true
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })
    })
    child.on('error', () => { if (!done) { done = true; resolve({ ok: false, out: '', err: 'spawn failed' }) } })
  })
}

/* ─── cliclick 检测（macOS 最佳执行器） ─── */
let cliclickPath = null
async function findCliclick() {
  if (cliclickPath !== null) return cliclickPath
  for (const p of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
    if (require('fs').existsSync(p)) { cliclickPath = p; return p }
  }
  const w = await run('/usr/bin/which', ['cliclick'], 2000)
  cliclickPath = w.ok && w.out.trim() ? w.out.trim() : ''
  return cliclickPath
}

/* ─── 权限检测 ─── */
async function checkPermissions() {
  const state = { platform: process.platform, screen: true, accessibility: true, cliclick: false }
  if (IS_MAC) {
    // 屏幕录制:真实检测(mediaAccessStatus),不再写死 true
    try { state.screen = systemPreferences.getMediaAccessStatus('screen') === 'granted' } catch { state.screen = true }
    const ui = await run('osascript', ['-e', 'tell application "System Events" to get UI elements enabled'], 3000)
    state.accessibility = ui.ok && /true/i.test(ui.out)
    state.cliclick = !!(await findCliclick())
  } else if (IS_WIN) {
    state.accessibility = true
  }
  return state
}

/* ─── osascript 封装 ─── */
async function osa(script, timeoutMs = 8000) {
  return run('osascript', ['-e', script], timeoutMs)
}

/* ─── 键码表（macOS System Events key code） ─── */
const KEY_CODES = {
  enter: 36, return: 36, tab: 48, esc: 53, escape: 53, space: 49,
  up: 126, down: 125, left: 123, right: 124,
  delete: 51, backspace: 51, forwarddelete: 117, home: 115, end: 119,
  pageup: 116, pagedown: 121, f5: 96,
}

/** 把 'cmd+shift+a' 拆成 {mods:[...], key:'a'} */
function parseKeyCombo(combo) {
  const parts = String(combo || '').split('+').map(s => s.trim().toLowerCase()).filter(Boolean)
  const mods = parts.filter(p => ['cmd', 'command', 'alt', 'option', 'ctrl', 'control', 'shift', 'fn'].includes(p))
  const key = parts.filter(p => !mods.includes(p)).pop() || ''
  return { mods, key }
}

/* ─── 动作执行（macOS） ─── */
async function execMac(action) {
  const cc = await findCliclick()
  const { type } = action
  const R = { ok: false, echoed: type }

  if (type === 'move') {
    if (cc) { const r = await run(cc, ['m:' + Math.round(action.x) + ',' + Math.round(action.y)], 4000); R.ok = r.ok }
    else { R.ok = false; R.err = 'move 需要 cliclick（brew install cliclick）' }
    return R
  }
  if (type === 'click') {
    const x = Math.round(action.x), y = Math.round(action.y)
    if (cc) {
      const args = []
      if (action.double) args.push('dc:' + x + ',' + y)
      else if (action.button === 'right') args.push('rc:' + x + ',' + y)
      else args.push('c:' + x + ',' + y)
      const r = await run(cc, args, 5000); R.ok = r.ok
    } else {
      const btn = action.button === 'right' ? 'right' : 'left'
      const script = action.double
        ? `tell application "System Events" to click at {${x}, ${y}}\ndelay 0.08\ntell application "System Events" to click at {${x}, ${y}}`
        : `tell application "System Events" to ${btn === 'right' ? 'rightclick' : 'click'} at {${x}, ${y}}`
      const r = await osa(script, 6000)
      R.ok = r.ok
      if (!r.ok) R.err = '点击失败：请在 系统设置→隐私与安全性→辅助功能 中授权巨天agent' + (r.err ? '（' + r.err.slice(0, 80) + '）' : '')
    }
    R.at = { x, y }
    return R
  }
  if (type === 'drag') {
    if (!cc) { R.ok = false; R.err = '拖拽需要 cliclick（brew install cliclick）' ; return R }
    const r = await run(cc, [
      'dd:' + Math.round(action.fromX) + ',' + Math.round(action.fromY),
      'm:' + Math.round((action.fromX + action.toX) / 2) + ',' + Math.round((action.fromY + action.toY) / 2),
      'du:' + Math.round(action.toX) + ',' + Math.round(action.toY),
    ], 10000)
    R.ok = r.ok
    return R
  }
  if (type === 'type') {
    const text = String(action.text || '')
    if (cc) {
      // cliclick t: 文本（转义反斜杠与引号），较长文本分片
      const chunks = text.match(/.{1,180}/gs) || ['']
      let ok = true
      for (const ch of chunks) {
        const r = await run(cc, ['t:' + ch.replace(/\\/g, '\\\\').replace(/:/g, '\\:')], 8000)
        ok = ok && r.ok
      }
      R.ok = ok
    } else {
      const esc = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const r = await osa(`tell application "System Events" to keystroke "${esc}"`, 10000)
      R.ok = r.ok
      if (!r.ok) R.err = '键入失败：需要辅助功能权限'
    }
    return R
  }
  if (type === 'key') {
    const { mods, key } = parseKeyCombo(action.key)
    const modMap = { cmd: 'command down', command: 'command down', alt: 'option down', option: 'option down', ctrl: 'control down', control: 'control down', shift: 'shift down', fn: 'fn down' }
    if (cc && !mods.length) {
      // cliclick kp: 仅支持部分命名键
      const named = { enter: 'return', esc: 'escape', space: 'space', tab: 'tab', up: 'up', down: 'down', left: 'left', right: 'right', delete: 'delete' }
      if (named[key]) { const r = await run(cc, ['kp:' + named[key]], 4000); R.ok = r.ok; return R }
    }
    const code = KEY_CODES[key] !== undefined ? KEY_CODES[key] : null
    const charKey = !code && key.length === 1 ? key : null
    if (code === null && charKey === null) { R.ok = false; R.err = '不支持的按键: ' + key; return R }
    const using = mods.length ? ' using {' + mods.map(m => modMap[m] || m).join(', ') + '}' : ''
    const script = code !== null
      ? `tell application "System Events" to key code ${code}${using}`
      : `tell application "System Events" to keystroke "${charKey}"${using}`
    const r = await osa(script, 6000)
    R.ok = r.ok
    if (!r.ok) R.err = '按键失败：需要辅助功能权限'
    return R
  }
  if (type === 'scroll') {
    // 用 PageUp/PageDown 与方向键实现滚动（macOS 无系统级滚轮接口）
    const dir = action.direction === 'up' ? -1 : 1
    const amount = Math.max(1, Math.min(10, parseInt(action.amount, 10) || 3))
    let okAll = true
    for (let i = 0; i < Math.min(amount, 4); i++) {
      const code = amount >= 3 ? (dir > 0 ? 121 : 116) : (dir > 0 ? 125 : 126)
      const r = await osa(`tell application "System Events" to key code ${code}`, 4000)
      okAll = okAll && r.ok
    }
    R.ok = okAll
    if (!okAll) R.err = '滚动失败：需要辅助功能权限'
    return R
  }
  R.err = '未知动作: ' + type
  return R
}

/* ─── 动作执行（Windows，PowerShell） ─── */
async function execWin(action) {
  const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8000)
  const { type } = action
  const R = { ok: false, echoed: type }
  if (type === 'click') {
    const btn = action.button === 'right' ? 'Right' : 'Left'
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${Math.round(action.x)},${Math.round(action.y)});Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int i);' -Name U -Namespace W;[W.U]::mouse_event(${btn === 'Right' ? 8 : 2},0,0,0,0);[W.U]::mouse_event(${btn === 'Right' ? 16 : 4},0,0,0,0)`)
    R.ok = r.ok; return R
  }
  if (type === 'type') {
    const esc = String(action.text || '').replace(/'/g, "''")
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${esc}')`)
    R.ok = r.ok; return R
  }
  if (type === 'key') {
    const map = { enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', space: ' ', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}' }
    const { key } = parseKeyCombo(action.key)
    const code = map[key] || (key.length === 1 ? key : '')
    if (!code) { R.err = '不支持的按键: ' + key; return R }
    const r = await ps(`Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${code}')`)
    R.ok = r.ok; return R
  }
  R.err = 'Windows 暂支持 click/type/key'
  return R
}

/* ─── 截屏 ─── */
async function capture(displayId, purpose) {
  const primary = screen.getPrimaryDisplay()
  const target = displayId != null
    ? (screen.getAllDisplays().find(d => String(d.id) === String(displayId)) || primary)
    : primary
  // 性能关键：抓取分辨率封顶。2x 全屏(5120x3200)单帧 1MB+，是「电脑操作卡」的主因。
  // agent 1600px（模型足够看清）、preview 900px（监视预览更轻）。
  const capW = purpose === 'preview' ? 900 : 1600
  const scale = Math.min(target.scaleFactor || 1, 2)
  let w = Math.round(target.size.width * scale)
  let h = Math.round(target.size.height * scale)
  if (w > capW) { h = Math.round(h * capW / w); w = capW }
  // 空帧重试:Electron 首帧常为空;无屏幕录制权限时恒为纯黑帧
  let src = null
  for (let i = 0; i < 3; i++) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } })
    const hit = sources.find(s => String(s.display_id) === String(target.id)) || sources[0]
    if (hit && !hit.thumbnail.isEmpty()) { src = hit; break }
    await new Promise(r => setTimeout(r, 350))
  }
  if (!src) return { ok: false, error: '没有可截取的屏幕' }
  let dataUrl = ''
  try { dataUrl = src.thumbnail.toJPEG(purpose === 'preview' ? 55 : 68) } catch (e) { return { ok: false, error: '截图编码失败: ' + String(e?.message || e) } }
  // 过小帧 = 无权限时的纯色画面:明确报权限,不再静默显示黑屏
  if (!dataUrl || dataUrl.length < 2048) {
    let granted = true
    try { granted = systemPreferences.getMediaAccessStatus('screen') === 'granted' } catch {}
    if (IS_MAC && !granted) return { ok: false, needPerm: 'screen', error: '屏幕截图为空:请在 系统设置 → 隐私与安全性 → 屏幕录制 中勾选巨天agent,然后重启应用' }
    return { ok: false, error: '屏幕截图为空,请重试一次' }
  }
  return {
    ok: true,
    dataUrl,
    width: src.thumbnail.getSize().width,
    height: src.thumbnail.getSize().height,
    display: { id: target.id, w: target.size.width, h: target.size.height, scaleFactor: target.scaleFactor },
  }
}

/* ─── IPC 注册 ─── */
function register() {
  ipcMain.handle('cu-permission', () => checkPermissions())
  ipcMain.handle('cu-open-perms', (_e, kind) => {
    const pane = kind === 'screen'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    if (IS_MAC) shell.openExternal(pane)
    return true
  })
  ipcMain.handle('cu-displays', () => {
    return screen.getAllDisplays().map(d => ({ id: d.id, w: d.size.width, h: d.size.height, scaleFactor: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id }))
  })
  ipcMain.handle('cu-capture', (_e, displayId, purpose) => capture(displayId, purpose))
  ipcMain.handle('cu-action', async (_e, action) => {
    try {
      if (!action || typeof action !== 'object') return { ok: false, err: 'bad action' }
      // 坐标钳制：防止模型输出越界坐标把光标丢出屏幕
      if (action.x != null || action.y != null) {
        const d = screen.getPrimaryDisplay()
        const maxX = d.size.width - 1, maxY = d.size.height - 1
        if (action.x != null) action.x = Math.max(0, Math.min(maxX, Math.round(Number(action.x) || 0)))
        if (action.y != null) action.y = Math.max(0, Math.min(maxY, Math.round(Number(action.y) || 0)))
      }
      if (IS_MAC) return await execMac(action)
      if (IS_WIN) return await execWin(action)
      return { ok: false, err: '平台暂不支持: ' + process.platform }
    } catch (e) {
      return { ok: false, err: String(e?.message || e) }
    }
  })
}

module.exports = { register }
