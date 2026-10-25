/**
 * updater.cjs — 应用内自更新(v8.2:全屏更新覆盖层 + 实时进度)
 *
 * 机制:Release 资产里放打包好的 app.asar(含全部代码 ~60MB)。
 * v11.0.4:自动更新 —— 开机/周期检查发现新版即静默下载,下载完成只提示
 * (不自动重启,用户点「重启即用」或下次自行重启时生效);GitHub 连不通
 * 自动切换镜像站;更新 = 下载(实时进度)→ 校验 → 备份 → 原子替换 → 提示。
 * 零新依赖;未签名 mac 上 electron-updater 不可用,故自研原子替换。
 *
 * IPC:
 *   update-check    → { ok, available, current, latest, notes, asarUrl... }
 *   update-apply    → 开始更新(立即返回,进度/完成经 update-progress 事件推送)
 *   update-cancel   → 取消下载中的更新
 * 事件 → renderer: 'update-progress' { stage, got, total, pct, done, error }
 */
const { ipcMain, app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const REPO = 'deepseekv5/jutian-agent'
// GitHub 镜像站(国内访问失败时依次切换;全部失败则如实报错)
const GH_MIRRORS = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://hub.gitmirror.com/',
]
function withMirror(url, mirror) {
  return mirror + url.replace(/^https?:\/\//, '')
}
/** 带镜像回落地 fetch:先直连,失败依次换镜像 */
async function fetchWithMirror(url, opts) {
  try { return await fetch(url, opts) } catch {}
  for (const m of GH_MIRRORS) {
    try { const r = await fetch(withMirror(url, m), opts); if (r.ok) return r } catch {}
  }
  return null
}
const UA = 'jutian-agent-updater'
const DATA_DIR = path.join(os.homedir(), '.lyclaw', 'data')
const NOTICE_FILE = () => path.join(DATA_DIR, 'notices.json')

/** 向所有窗口广播进度事件 */
function sendProgress(payload) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('update-progress', payload) } catch {}
    }
  } catch {}
}

function pushUpdateNotice(title, body) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    let list = []
    try { list = JSON.parse(fs.readFileSync(NOTICE_FILE(), 'utf-8')); if (!Array.isArray(list)) list = [] } catch {}
    list.unshift({ id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), read: false, type: 'system', title, body })
    fs.writeFileSync(NOTICE_FILE(), JSON.stringify(list.slice(0, 50)))
  } catch {}
}

/** 广播「更新已就绪,重启即用」 */
function sendReady() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('update-ready') } catch {}
    }
  } catch {}
  // Windows 走「启动时替换」：必须完全退出再打开才生效（不是刷新窗口）。
  // 文案要说明这点，否则用户点了重启却发现没更新，会以为更新失败。
  const body = process.platform === 'win32'
    ? '更新已下载完成 — 请完全退出应用再重新打开，新版本才会生效（Windows 需在启动时完成替换）'
    : '更新已下载完成 — 重启应用后生效(设置 → 关于 → 重启即用)'
  pushUpdateNotice('新版本已就绪', body)
}

function asarPath() {
  const p = app.getAppPath()
  return p.endsWith('.asar') ? p : null
}

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number)
  const pb = String(b).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

async function checkLatest() {
  const r = await fetchWithMirror(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  })
  if (!r) throw new Error('无法连接 GitHub(已尝试镜像站),请检查网络')
  if (!r.ok) throw new Error(`GitHub API ${r.status}`)
  const rel = await r.json()
  if (!rel || !rel.tag_name) throw new Error('无发布信息')
  const current = app.getVersion()
  const available = cmpVer(rel.tag_name, current) > 0
  const asar = (rel.assets || []).find(a => /-app\.asar$/i.test(a.name))
  // v12.6：官方 SHA-256（GitHub 资产自带）。下载后必须校验——
  // 镜像站是第三方代理，可返回"格式合法但被篡改"的 asar，
  // 之前只查 {"files" 头，等于给供应链攻击开门（应用有本机全权限）。
  const asarDigest = asar && asar.digest ? String(asar.digest).replace(/^sha256:/, '') : ''
  const installer = (rel.assets || []).find(a => /\.(dmg|exe)$/i.test(a.name))
  return {
    available,
    current,
    latest: String(rel.tag_name).replace(/^v/, ''),
    notes: String(rel.body || '').slice(0, 4000),
    asarUrl: available && asar ? asar.browser_download_url : null,
    asarSize: asar ? asar.size : 0,
    asarSha256: asarDigest || null,
    installerUrl: installer ? installer.browser_download_url : null,
    publishedAt: rel.published_at || '',
  }
}

/** 下载 + 校验 + 备份 + 原子替换;完成后倒计时自动重启 */
async function applyUpdate(asarUrl, expectedSha256, expectedSize) {
  const target = asarPath()
  if (!target) throw new Error('开发模式下不支持自更新(未打包)')
  sendProgress({ stage: 'download', got: 0, total: 0, pct: 0 })
  const abortCtl = new AbortController()
  _currentAbort = abortCtl
  try {
    const r = await fetchWithMirror(asarUrl, { headers: { 'User-Agent': UA }, signal: abortCtl.signal })
    if (!r) throw new Error('下载失败(已尝试镜像站),请检查网络')
    if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
    // 流式接收,逐块广播进度
    const total = Number(r.headers.get('content-length') || 0)
    const reader = r.body.getReader()
    const chunks = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
      got += value.length
      sendProgress({ stage: 'download', got, total, pct: total ? Math.floor(got * 100 / total) : null })
    }
    const buf = Buffer.concat(chunks)
    sendProgress({ stage: 'verify' })
    // 完整性校验（v12.6）：优先 SHA-256 对照官方值；API 未提供时退回
    // 大小精确匹配（镜像改内容必然改大小；同长度碰撞需构造，门槛高得多）。
    // 仅靠 {"files" 头是格式检查，挡不住"合法但被篡改"的包。
    if (expectedSha256) {
      const got = require('crypto').createHash('sha256').update(buf).digest('hex')
      if (got !== expectedSha256) {
        throw new Error(`更新包校验失败（SHA-256 不匹配，可能被镜像篡改）\n期望 ${expectedSha256.slice(0, 16)}…\n实际 ${got.slice(0, 16)}…`)
      }
    } else if (expectedSize && buf.length !== expectedSize) {
      throw new Error(`更新包大小不符：期望 ${expectedSize} B，实际 ${buf.length} B（可能被镜像篡改）`)
    }
    // asar 格式检查（第二道）：JSON 目录从某个 ≤64 字节偏移开始
    if (buf.length < 100000 || !buf.slice(0, 64).toString('latin1').includes('{"files"')) {
      throw new Error('更新包不是合法的 asar')
    }
    // 原子替换三连:.new 落盘 → 旧包备份 → rename 换名
    const tmp = target + '.new'
    const bak = target + '.bak'
    sendProgress({ stage: 'apply' })
    fs.writeFileSync(tmp, buf)
    if (process.platform === 'win32') {
      // Windows 上运行中的 app.asar 被本进程锁着，renameSync 会抛 EPERM/EBUSY
      // ——这就是 v8.1 在 Windows 上「只能下载不能更新」的根因（macOS/Linux
      // 允许重命名已打开的文件，所以那边一直正常）。
      // 对策：不在运行时替换，只把 .new 落好，由下次启动在加载 asar 之前换名。
      sendProgress({ stage: 'done', pct: 100 })
      sendReady()
      return
    }
    try { fs.copyFileSync(target, bak) } catch {}
    fs.renameSync(tmp, target)
    sendProgress({ stage: 'done', pct: 100 })
    // v11.0.4:下载替换完成只提示「重启即用」,不自动重启
    sendReady()
  } catch (e) {
    const cancelled = _currentAbort && _currentAbort.signal.aborted
    sendProgress({ stage: 'error', error: cancelled ? '已取消' : String(e.message || e) })
  } finally {
    _currentAbort = null
  }
}

/**
 * 启动时应用待安装的更新（Windows 路径）。
 *
 * 必须在 Electron 加载 app.asar **之前**执行——所以 register() 是在 main.cjs
 * 顶部 require 的。此刻本进程还没打开 asar，rename 不会被文件锁挡住。
 * 失败（只读安装目录/权限不足）时保留 .new 并记录原因，下次启动再试。
 */
function applyPendingOnBoot() {
  try {
    const target = asarPath()
    if (!target) return
    const pending = target + '.new'
    if (!fs.existsSync(pending)) return
    const bak = target + '.bak'
    try { fs.copyFileSync(target, bak) } catch {}
    fs.renameSync(pending, target)
    console.log('[updater] 已应用待安装更新（启动时替换）')
  } catch (e) {
    console.error('[updater] 启动时替换失败:', e.message)
  }
}

let _currentAbort = null

function register() {
  // 先把上次下载好的 .new 换上去（Windows 专用路径）。
  // register() 在 main.cjs 顶部被 require，此刻 app.asar 还没被加载，
  // 文件锁不存在，rename 能成功。
  applyPendingOnBoot()
  ipcMain.handle('update-check', async () => {
    try { const info = await checkLatest(); return { ok: true, ...info } }
    catch (e) { return { ok: false, error: String(e.message || e) } }
  })

  ipcMain.handle('update-apply', async (_e, asarUrl) => {
    try {
      const info = await checkLatest()
      const url = asarUrl || info.asarUrl
      if (!url) throw new Error('该版本未提供 app.asar 更新包')
      const sha = info.asarSha256 || null
      const size = info.asarSize || 0
      // 不阻塞:进度与完成经 update-progress 事件推送
      applyUpdate(url, sha, size).catch(() => {})
      return { ok: true, started: true, version: info.latest }
    } catch (e) { return { ok: false, error: String(e.message || e) } }
  })

  ipcMain.handle('update-cancel', async () => {
    try { _currentAbort?.abort() } catch {}
    return { ok: true }
  })

  ipcMain.handle('update-restart', async () => {
    try { app.relaunch(); app.exit(0) } catch {}
    return { ok: true }
  })

  // v11.0.4 开机静默自检(延迟 12s):有新版 → 自动静默下载
  setTimeout(async () => {
    try {
      const info = await checkLatest()
      if (info.available && info.asarUrl) applyUpdate(info.asarUrl).catch(() => {})
    } catch { /* 离线/限流,静默 */ }
  }, 12000)

  // v11.0.4:使用中持续检查 —— 每 30 分钟自检,有新版自动静默下载
  const PERIODIC_MS = 30 * 60 * 1000
  setInterval(async () => {
    try {
      const info = await checkLatest()
      if (info.available && info.asarUrl) applyUpdate(info.asarUrl).catch(() => {})
    } catch { /* 离线/限流,静默 */ }
  }, PERIODIC_MS)
}

module.exports = { register }
