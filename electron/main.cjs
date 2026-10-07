const { app, BrowserWindow, ipcMain, Menu, dialog, desktopCapturer, globalShortcut, Tray, nativeImage, screen } = require('electron')
const { spawn, execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

// Chromium 的 GPU 进程崩溃可自动恢复；禁用硬件加速反而会全软件渲染导致严重卡顿（x64 Mac 实锤）。
// warn = 遇到 GPU 问题只告警不退出。
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

// ─── 应用内自更新(v8.1):检查/下载/原子替换 app.asar ───
require('./updater.cjs').register()

app.on('gpu-process-crashed', (_e, killed) => log(`GPU 进程崩溃(${killed ? 'killed' : 'crashed'})，Chromium 将自动恢复渲染`))

const IS_WIN = process.platform === 'win32'
// 版本唯一来源:package.json
const PKG_VERSION = (() => { try { return require('../package.json').version } catch (e) { return 'unknown' } })()
const isDev = !app.isPackaged

// ── 禁用 HTTP 磁盘缓存：本地应用无需缓存，杜绝补丁更新后窗口仍跑旧 JS ──
app.commandLine.appendSwitch('disable-http-cache')
const ROOT = isDev ? path.join(__dirname, '..') : path.join(__dirname, '..')
const RESOURCES = isDev ? ROOT : process.resourcesPath
const PYTHON_DIR = path.join(RESOURCES, 'python-runtime')
const PYTHON_BIN = IS_WIN ? path.join(PYTHON_DIR, 'Scripts', 'python.exe') : path.join(PYTHON_DIR, 'bin', 'python3')
// 供 serve.cjs 语音识别等调用
process.env.PYTHON_BIN = PYTHON_BIN
process.env.STT_SCRIPT = path.join(RESOURCES, 'stt', 'stt.py')
const EDGE_TTS_DIR = path.join(RESOURCES, 'edge-tts')
process.env.EDGE_TTS_DIR = EDGE_TTS_DIR
const HF_HOME = path.join(PYTHON_DIR, 'share', 'huggingface')

let mainWindow = null
let ttsProcess = null

// ── 进程稳定性：stdout/stderr 管道断开（后台启动场景）不得杀死应用 ──
process.stdout?.on?.('error', (err) => { if (err && err.code === 'EPIPE') return; throw err })
process.stderr?.on?.('error', (err) => { if (err && err.code === 'EPIPE') return; throw err })
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND')) {
    log(`忽略网络/管道错误: ${err.code}`)
    return
  }
  log(`未捕获异常(不退出): ${err?.stack || err}`)
})
process.on('unhandledRejection', (err) => log(`未处理的Promise拒绝(不退出): ${err?.stack || err}`))
let tray = null

function log(msg) { console.log(`[Electron] ${msg}`) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function sendStatus(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', msg)
  }
}

// Kill any process on a port (Windows: netstat+taskkill, macOS/Linux: lsof)
function killPort(port) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('netstat', ['-ano', '-p', 'TCP'], { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) return resolve()
        const lines = stdout.split('\n').filter(l => l.includes(`:${port} `) && l.includes('LISTENING'))
        const pids = [...new Set(lines.map(l => l.trim().split(/\s+/).pop()).filter(p => p && p !== '0'))]
        if (!pids.length) { log(`Port ${port} free`); return resolve() }
        log(`Port ${port} occupied by PID(s): ${pids.join(',')}, killing...`)
        for (const p of pids) {
          execFile('taskkill', ['/F', '/PID', p], { timeout: 5000 }, () => {})
        }
        setTimeout(resolve, 1000)
      })
      return
    }
    execFile('lsof', ['-ti', `:${port}`], { timeout: 5000 }, (err, stdout) => {
      const pid = (stdout || '').trim()
      if (!pid) { log(`Port ${port} free`); return resolve() }
      const pids = pid.split('\n')
      log(`Port ${port} occupied by PID(s): ${pids.join(',')}, killing...`)
      for (const p of pids) {
        try { process.kill(parseInt(p), 'SIGKILL') } catch {}
        execFile('kill', ['-9', p.trim()], { timeout: 3000 }, () => {})
      }
      setTimeout(resolve, 1000)
    })
  })
}

// Step 1: Start Edge TTS
async function startEdgeTTS() {
  const serverPy = path.join(EDGE_TTS_DIR, 'app', 'server.py')
  if (!fs.existsSync(serverPy)) {
    log('Edge TTS server.py not found, skipping')
    return
  }
  sendStatus('正在清理端口...')
  await killPort(5050)

  sendStatus('正在启动语音服务 (Edge TTS)...')
  return new Promise((resolve) => {
    // 强制 PORT=5050：主服务先启动时会把 PORT=3211 写进环境，TTS 继承后会与主服务抢端口
    ttsProcess = spawn(PYTHON_BIN, [serverPy], { cwd: EDGE_TTS_DIR, env: { ...process.env, PORT: '5050', PYTHONUNBUFFERED: '1', HF_HOME }, stdio: 'pipe' })
    ttsProcess.stderr?.on('data', d => log(`[TTS] ${d.toString().trim()}`))
    ttsProcess.on('error', e => log(`TTS error: ${e.message}`))
    // 轮询端口就绪（最长 10s），就绪即返回——不阻塞启动
    const t0 = Date.now()
    const poll = () => {
      const req = http.get('http://localhost:5050/health', r => { r.resume(); resolve(true) })
      req.on('error', () => {
        if (Date.now() - t0 > 10000) return resolve(false)
        setTimeout(poll, 250)
      })
      req.setTimeout(1200, () => { req.destroy(); setTimeout(poll, 250) })
    }
    setTimeout(poll, 800)
  })
}

// ── TTS 惰性启动：首次真正用到语音时才拉起 python 进程（省内存 + 加速开机）──
let ttsStarting = null
function ensureEdgeTTS() {
  if (ttsProcess && !ttsStarting) return Promise.resolve(true)
  if (!ttsStarting) {
    sendStatus('正在启动语音服务...')
    ttsStarting = startEdgeTTS().finally(() => { ttsStarting = null })
  }
  return ttsStarting
}
globalThis.ensureEdgeTTS = ensureEdgeTTS

// Start serve.cjs by requiring it directly (runs in main process, no fork needed)
async function startServer() {
  const serveJs = path.join(ROOT, 'serve.cjs')

  sendStatus('正在清理端口...')
  await killPort(3211)

  sendStatus('正在启动核心服务...')

  const pythonBinDir = path.join(PYTHON_DIR, IS_WIN ? 'Scripts' : 'bin')
  process.env.PORT = '3211'
  process.env.AI_FILE_LOCK = 'on'
  if (!IS_WIN) process.env.HF_HOME = HF_HOME
  const extraPaths = IS_WIN
    ? [pythonBinDir, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')]
    : [pythonBinDir, '/opt/homebrew/bin', '/usr/local/bin']
  process.env.PATH = `${extraPaths.join(IS_WIN ? ';' : ':')}${IS_WIN ? ';' : ':'}${process.env.PATH}`

  log(`Loading serve.cjs from: ${serveJs}`)
  try {
    require(serveJs)
    log('serve.cjs loaded, HTTP server should be starting...')
  } catch (e) {
    log(`Failed to load serve.cjs: ${e.message}`)
    throw e
  }

  // Give the server a moment to bind the port
  await sleep(1000)
}

// Wait for HTTP server to respond
async function waitForServer(url, retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(url, r => {
          r.resume()
          r.statusCode < 500 ? res() : rej(new Error(`Status ${r.statusCode}`))
        })
        req.on('error', rej)
        req.setTimeout(3000, () => { req.destroy(); rej(new Error('timeout')) })
      })
      return true
    } catch { await sleep(150) }
  }
  return false
}

// ─── 窗口状态记忆：大小/位置/最大化写盘，下次启动恢复（世界级应用的基本礼仪） ───
const WIN_STATE_FILE = 'window-state.json'

function loadWindowState() {
  try {
    const p = path.join(app.getPath('userData'), WIN_STATE_FILE)
    if (!fs.existsSync(p)) return null
    const st = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!st || typeof st.width !== 'number' || typeof st.height !== 'number') return null
    // 越界保护：窗口必须落在某个屏幕的工作区内，否则回落到默认尺寸
    const displays = screen ? screen.getAllDisplays() : []
    const inBounds = displays.length === 0 || displays.some(d => {
      const a = d.workArea
      return st.x >= a.x - 60 && st.y >= a.y - 60 && st.x < a.x + a.width - 200 && st.y < a.y + a.height - 200
    })
    if (!inBounds) return { width: st.width, height: st.height }
    return st
  } catch { return null }
}

function saveWindowState() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const bounds = mainWindow.getBounds()
    const st = { ...bounds, maximized: mainWindow.isMaximized(), fullscreen: mainWindow.isFullScreen() }
    fs.writeFileSync(path.join(app.getPath('userData'), WIN_STATE_FILE), JSON.stringify(st))
  } catch { /* ignore */ }
}

function createWindow() {
  const iconFile = IS_WIN ? 'icon.ico' : 'icon.icns'
  const iconPath = isDev
    ? path.join(__dirname, iconFile)
    : path.join(process.resourcesPath, iconFile)
  const saved = loadWindowState()
  mainWindow = new BrowserWindow({
    width: saved?.width || 1200,
    height: saved?.height || 800,
    x: saved?.x,
    y: saved?.y,
    minWidth: 800,
    minHeight: 600,
    title: '巨天agent',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#ffffff',
    show: false,
    restorable: false,
    // 隐藏原生标题栏（保留 macOS 红绿灯），界面直通窗口顶部
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 15 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  })

  // Intercept navigation: open external URLs in renderer webview overlay instead of navigating away
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentURL = mainWindow.webContents.getURL()
    // Only intercept if navigating away from the app (localhost:3211 or file:// loading)
    if (!url.startsWith('http://localhost:3211') && !url.startsWith('file://')) {
      event.preventDefault()
      mainWindow.webContents.send('open-browser-overlay', url)
    }
  })

  // Handle window.open (target="_blank" etc) - open in overlay instead of new window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.webContents.send('open-browser-overlay', url)
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    // macOS 状态恢复可能在 show 之后才套用坏尺寸（如桌宠的 180 尺寸），延迟再校正一次
    const enforce = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const [w, h] = mainWindow.getSize()
      if (w < 800 || h < 600) {
        mainWindow.setSize(1200, 800)
        mainWindow.center()
      }
    }
    enforce()
    setTimeout(enforce, 120)
    setTimeout(enforce, 600)
  })
  mainWindow.loadFile(path.join(__dirname, 'loading.html'), { query: { v: PKG_VERSION } })
  mainWindow.on('closed', () => { mainWindow = null })
  // 窗口状态记忆：尺寸/位置变化防抖落盘；恢复最大化状态（restorable:false，需自行还原）
  if (saved?.maximized) mainWindow.maximize()
  let winSaveTimer = null
  const scheduleWinSave = () => {
    if (winSaveTimer) clearTimeout(winSaveTimer)
    winSaveTimer = setTimeout(saveWindowState, 400)
  }
  mainWindow.on('resize', scheduleWinSave)
  mainWindow.on('move', scheduleWinSave)
  mainWindow.on('maximize', scheduleWinSave)
  mainWindow.on('unmaximize', scheduleWinSave)
  mainWindow.on('close', saveWindowState)
}

// Runtime security config (stored in-memory, persists via localStorage in renderer)
let securityConfig = { permissionLevel: 'standard', allowedFolders: [], shellAccess: false }

function setupIPC() {
  ipcMain.on('retry', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'loading.html'), { query: { v: PKG_VERSION } })
    }
    await sleep(500)
    try { await startAll() } catch (e) { log(`Retry failed: ${e.message}`) }
  })

  // File access security
  ipcMain.handle('get-file-access', () => securityConfig)

  ipcMain.handle('set-file-access', (_event, lock, dirs) => {
    if (typeof lock === 'string') securityConfig.permissionLevel = lock
    if (Array.isArray(dirs)) securityConfig.allowedFolders = dirs
    // Sync to env so serve.cjs can read it
    process.env.AI_FILE_LOCK = securityConfig.permissionLevel === 'restricted' ? 'on' : 'off'
    process.env.AI_ALLOWED_DIRS = securityConfig.allowedFolders.join(':')
    log(`Security config: level=${securityConfig.permissionLevel}, folders=${securityConfig.allowedFolders.length}`)
    return securityConfig
  })

  ipcMain.handle('set-shell-access', (_event, enabled) => {
    securityConfig.shellAccess = !!enabled
    process.env.AI_SHELL_ACCESS = securityConfig.shellAccess ? 'on' : 'off'
    return securityConfig
  })

  // 开机自启（macOS 登录项 / Windows 启动项）
  ipcMain.handle('set-auto-launch', (_event, enabled) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled })
      return { ok: true, enabled: !!enabled }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
  ipcMain.handle('get-auto-launch', () => {
    try { return app.getLoginItemSettings().openAtLogin } catch { return false }
  })


  

  // ─── 截图提问 ───
  ipcMain.handle('capture-screen', async (event) => {
    try {
      // 隐藏主窗避免截到自己；从哪个窗口发起就抓哪块屏
      const win = BrowserWindow.fromWebContents(event.sender)
      const wasVisible = win && win.isVisible()
      if (win && wasVisible) win.hide()
      await new Promise(r => setTimeout(r, 260))
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1600 } })
      const dataUrl = sources[0]?.thumbnail.toDataURL() || ''
      if (win && wasVisible) win.show()
      return dataUrl
    } catch (e) { return '' }
  })
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    try {
      // 隐藏主窗再抓屏（避免截到应用自己）
      const wasVisible = mainWindow && mainWindow.isVisible()
      if (wasVisible) mainWindow.hide()
      await new Promise(r => setTimeout(r, 260))
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1600 } })
      const dataUrl = sources[0]?.thumbnail.toDataURL() || ''
      if (dataUrl && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.webContents.send('screenshot-captured', dataUrl)
      } else if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
      }
    } catch { /* ignore */ }
  })

  // ─── 全局唤起/隐藏主窗口（Cmd+Shift+A）───
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide()
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    } catch { /* ignore */ }
  })

  // ─── 窗口置顶开关（设置页）───
  ipcMain.handle('set-always-on-top', (_event, enabled) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(!!enabled, 'normal')
      return true
    } catch { return false }
  })
  ipcMain.handle('get-always-on-top', () => {
    try { return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isAlwaysOnTop() : false } catch { return false }
  })

  // ─── 系统托盘：显示/新对话/退出 ───
  try {
    const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUElEQVR42mNkYPhfz0BEYBxUgMQgQ4YMGTJkyJAhQ4YMGTJkyJAhQ4YMGTJkyJAhQ4YMGTJkyJAhQ4YMGTJkyJAhQ4YMGTJk2GAAAC4gB7FzJjAAAAABJRU5ErkJggg==')
    tray = new Tray(icon)
    tray.setToolTip('巨天agent')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() } } },
      { label: '新建对话', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.webContents.send('tray-new-chat') } } },
      { type: 'separator' },
      { label: '退出', click: () => { app.quit() } },
    ]))
    tray.on('click', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } })
    log('系统托盘已启动')
  } catch (e) { log(`托盘启动失败: ${e.message}`) }


  ipcMain.handle('open-folder-dialog', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections'],
      title: '选择允许 AI 访问的文件夹',
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('open-file-dialog', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: '选择要上传的文件',
    })
    return result.canceled ? [] : result.filePaths
  })
}

async function startAll() {
  try {
    // Edge TTS 改为惰性启动（首次语音请求时拉起），开机不再等它
    sendStatus('正在启动核心服务...')
    await startServer()

    sendStatus('正在等待服务就绪...')
    const ready = await waitForServer('http://localhost:3211/api/health', 60)

    if (ready) {
      sendStatus('服务已就绪')
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ready')
      }
    } else {
      throw new Error('服务端口可达但 /api/health 未响应')
    }
  } catch (e) {
    log(`Startup failed: ${e.message}`)
    sendStatus('启动失败')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', e.message)
    }
  }
}

function cleanup() {
  log('Cleaning up...')
  try { if (ttsProcess) { ttsProcess.kill('SIGTERM'); ttsProcess = null } } catch {}
}

function showAbout() {
  const iconPath = isDev
    ? path.join(__dirname, 'icon.icns')
    : path.join(process.resourcesPath, 'icon.icns')
  dialog.showMessageBox({
    type: 'info',
    title: '关于 巨天agent',
    message: '巨天agent',
    detail: [
      `版本: ${app.getVersion()}`,
      `Electron: ${process.versions.electron}`,
      `Node.js: ${process.versions.node}`,
      `Chromium: ${process.versions.chrome}`,
      `架构: ${process.arch}`,
      '',
      'AI Agent 桌面助手，集成语音助手、文件管理、',
      '系统操作等能力，支持本地与云端大模型。',
    ].join('\n'),
    icon: iconPath,
    buttons: ['确定'],
    defaultId: 0,
  })
}

function setupMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: '关于 巨天agent', click: showAbout },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: '关于 巨天agent',
          click: showAbout,
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  log('巨天agent 启动中...')
  setupMenu()
  setupIPC()
  createWindow()
  await sleep(500)
  await startAll()
})

app.on('window-all-closed', () => { cleanup(); app.quit() })
app.on('before-quit', cleanup)
app.on('will-quit', cleanup)
