/**
 * updater.cjs — 应用内自更新(GitHub Releases,v8.1)
 *
 * 机制:Release 资产里放一个打包好的 **app.asar**(dist + electron + serve
 * + shared 全在里面,单文件 ~15MB)。更新 = 下载 → 校验 → 备份 → 原子替换
 * → 重启。无需签名、无需 electron-updater、零新依赖。
 *
 * 取舍:better-sqlite3 的原生 .node 在 app.asar.unpacked,不受 asar 替换
 * 影响;同 Electron 版本内 ABI 锁定,跨小版本更新稳定。
 *
 * IPC:
 *   update-check → { ok, available, current, latest, notes, asarUrl, ... }
 *   update-apply → 下载 + 原子替换 + 重启,返回 { ok } 或 { ok:false, error }
 */
const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const REPO = 'deepseekv5/jutian-agent'
const UA = 'jutian-agent-updater'

/** 已安装应用的数据目录(与 serve.cjs 的 DATA_DIR 一致) */
const DATA_DIR = path.join(require('os').homedir(), '.lyclaw', 'data')
const NOTICE_FILE = () => path.join(DATA_DIR, 'notices.json')

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
  // 打包态:getAppPath() 即 app.asar 文件路径;开发态返回项目根(不更新)
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
  // 更新资产:名字以 -app.asar 结尾的那个(打包好的应用 asar)
  const asar = (rel.assets || []).find(a => /-app\.asar$/i.test(a.name))
  const installer = (rel.assets || []).find(a => /\.(dmg|exe)$/i.test(a.name))
  return {
    available,
    current,
    latest: String(rel.tag_name).replace(/^v/, ''),
    notes: String(rel.body || '').slice(0, 2000),
    asarUrl: available && asar ? asar.browser_download_url : null,
    asarSize: asar ? asar.size : 0,
    installerUrl: installer ? installer.browser_download_url : null,
    publishedAt: rel.published_at || '',
  }
}

/** 下载 asar → 备份 → 原子替换 → 重启(app.relaunch + exit) */
async function applyUpdate(asarUrl, onStatus) {
  const target = asarPath()
  if (!target) throw new Error('开发模式下不支持自更新(未打包)')
  onStatus('下载更新包…')
  const r = await fetch(asarUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(600000) })
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
  onStatus('接收数据…')
  const buf = Buffer.from(await r.arrayBuffer())
  // asar 合法性:JSON 目录从某个 ≤64 字节的偏移开始(pickle 多层嵌套),
  // 以 `{"files"` 开头。搜前 64 字节即可确证,不依赖硬编码偏移。
  if (buf.length < 100000 || !buf.slice(0, 64).toString('latin1').includes('{"files"')) {
    throw new Error('更新包不是合法的 asar')
  }
  const tmp = target + '.new'
  const bak = target + '.bak'
  onStatus('写入更新…')
  fs.writeFileSync(tmp, buf)
  onStatus('备份当前版本…')
  try { fs.copyFileSync(target, bak) } catch {}
  onStatus('原子替换…')
  fs.renameSync(tmp, target)
  onStatus('重启应用…')
  setTimeout(() => { try { app.relaunch(); app.exit(0) } catch {} }, 800)
  return { ok: true, version: 'see release' }
}

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
      return await applyUpdate(url, () => {})
    } catch (e) {
      // rename 是原子的:失败时旧 asar 完好;若已写入 .new,残留无害(下次覆盖)
      return { ok: false, error: String(e.message || e) }
    }
  })

  // 开机静默自检(延迟 12s):有新版 → 通知中心提醒
  setTimeout(async () => {
    try {
      const info = await checkLatest()
      if (info.available) {
        pushUpdateNotice(`巨天agent v${info.latest} 已发布`, '当前 v' + info.current + ' — 到 设置 → 关于 一键更新')
      }
    } catch { /* 离线/限流,静默 */ }
  }, 12000)
}

module.exports = { register }
