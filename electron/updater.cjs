/**
 * updater.cjs — 应用内自更新(v8.2:全屏更新覆盖层 + 实时进度)
 *
 * 机制:Release 资产里放打包好的 app.asar(含全部代码 ~60MB)。
 * 更新 = 下载(实时进度)→ 校验 → 备份 → 原子替换 → 倒计时重启。
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
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error(`GitHub API ${r.status}`)
  const rel = await r.json()
  if (!rel || !rel.tag_name) throw new Error('无发布信息')
  const current = app.getVersion()
  const available = cmpVer(rel.tag_name, current) > 0
  const asar = (rel.assets || []).find(a => /-app\.asar$/i.test(a.name))
  const installer = (rel.assets || []).find(a => /\.(dmg|exe)$/i.test(a.name))
  return {
    available,
    current,
    latest: String(rel.tag_name).replace(/^v/, ''),
    notes: String(rel.body || '').slice(0, 4000),
    asarUrl: available && asar ? asar.browser_download_url : null,
    asarSize: asar ? asar.size : 0,
    installerUrl: installer ? installer.browser_download_url : null,
    publishedAt: rel.published_at || '',
  }
}

/** 下载 + 校验 + 备份 + 原子替换;完成后倒计时自动重启 */
async function applyUpdate(asarUrl) {
  const target = asarPath()
  if (!target) throw new Error('开发模式下不支持自更新(未打包)')
  sendProgress({ stage: 'download', got: 0, total: 0, pct: 0 })
  const abortCtl = new AbortController()
  _currentAbort = abortCtl
  try {
    const r = await fetch(asarUrl, { headers: { 'User-Agent': UA }, signal: abortCtl.signal })
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
    // asar 合法性:JSON 目录从某个 ≤64 字节偏移开始(pickle 多层嵌套),以 {"files" 开头
    if (buf.length < 100000 || !buf.slice(0, 64).toString('latin1').includes('{"files"')) {
      throw new Error('更新包不是合法的 asar')
    }
    // 原子替换三连:.new 落盘 → 旧包备份 → rename 换名
    const tmp = target + '.new'
    const bak = target + '.bak'
    sendProgress({ stage: 'apply' })
    fs.writeFileSync(tmp, buf)
    try { fs.copyFileSync(target, bak) } catch {}
    fs.renameSync(tmp, target)
    sendProgress({ stage: 'done', pct: 100 })
    // 3 秒倒计时后优雅重启
    let left = 3
    const tick = () => {
      sendProgress({ stage: 'restarting', left })
      if (left <= 0) { try { app.relaunch(); app.exit(0) } catch {}; return }
      left -= 1
      setTimeout(tick, 1000)
    }
    setTimeout(tick, 300)
  } catch (e) {
    const cancelled = _currentAbort && _currentAbort.signal.aborted
    sendProgress({ stage: 'error', error: cancelled ? '已取消' : String(e.message || e) })
  } finally {
    _currentAbort = null
  }
}

let _currentAbort = null

function register() {
  ipcMain.handle('update-check', async () => {
    try { const info = await checkLatest(); return { ok: true, ...info } }
    catch (e) { return { ok: false, error: String(e.message || e) } }
  })

  ipcMain.handle('update-apply', async (_e, asarUrl) => {
    try {
      const info = await checkLatest()
      const url = asarUrl || info.asarUrl
      if (!url) throw new Error('该版本未提供 app.asar 更新包')
      // 不阻塞:进度与完成经 update-progress 事件推送
      applyUpdate(url).catch(() => {})
      return { ok: true, started: true, version: info.latest }
    } catch (e) { return { ok: false, error: String(e.message || e) } }
  })

  ipcMain.handle('update-cancel', async () => {
    try { _currentAbort?.abort() } catch {}
    return { ok: true }
  })

  // 开机静默自检(延迟 12s):有新版 → 通知中心提醒
  setTimeout(async () => {
    try {
      const info = await checkLatest()
      if (info.available) {
        pushUpdateNotice(`巨天agent v${info.latest} 已发布`, `当前 v${info.current} — 到 设置 → 关于 一键更新`)
      }
    } catch { /* 离线/限流,静默 */ }
  }, 12000)
}

module.exports = { register }
