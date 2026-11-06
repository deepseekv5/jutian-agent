/**
 * 用户扩展层（UXL）服务端模块 —— v14.11
 *
 * 作为独立 .cjs 被 serve.cjs 旁加载（与 skillMarket.cjs 同款）。
 * 职责：用户目录扫描 / manifest 校验 / 静态文件读取 / 管理动作 / AI 创建。
 *
 * 安全边界：
 *   · 一切路径都必须落在 ~/.lyclaw/extensions/ 内（realpath 双重校验）
 *   · 只放行白名单后缀 + 512KB 上限
 *   · AI 创建的扩展 approved=false，必须用户显式批准才进入 list
 *   · 不执行任何用户 JS；面板是 iframe sandbox 里的 HTML
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')

const EXT_DIR = path.join(os.homedir(), '.lyclaw', 'extensions')
const { EXT_API_VERSION, EXT_MAX_FILE_BYTES, validateExtManifest, normalizeExtId, isSafeExtPath, defaultExtManifest, isExtCompatible } = require('./extensions.cjs')

function ensureDir() {
  try { fs.mkdirSync(EXT_DIR, { recursive: true }) } catch { /* ignore */ }
  return EXT_DIR
}

/** 扩展目录绝对路径（id 已由 normalizeExtId 清洗） */
function extPath(id) {
  const clean = normalizeExtId(id)
  if (!clean) return null
  return path.join(EXT_DIR, clean)
}

/** 读取并校验单个扩展；返回 null 表示跳过（坏 manifest / 未批准 / 版本不兼容） */
async function readOne(dir, name) {
  const base = path.join(dir, name)
  let raw
  try { raw = JSON.parse(await fsp.readFile(path.join(base, 'manifest.json'), 'utf8')) } catch { return null }
  raw.id = name
  const v = validateExtManifest(raw)
  if (!v.ok || !v.manifest) return null
  if (!isExtCompatible(EXT_API_VERSION, v.manifest)) return null
  // entry 必须真实存在，否则挂载后白屏
  try { await fsp.access(path.join(base, v.manifest.entry)) } catch { return null }
  return { ...v.manifest, dir: base }
}

/** 列出全部扩展（含未批准/禁用，管理页要看到它们） */
async function listExtensions() {
  ensureDir()
  let names = []
  try { names = (await fsp.readdir(EXT_DIR, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name) } catch { return [] }
  const out = []
  for (const name of names) {
    const ext = await readOne(EXT_DIR, name).catch(() => null)
    // 坏 manifest 也要在管理页可见（标为 invalid），否则用户不知道有个坏目录
    if (!ext) {
      let status = 'invalid'
      try {
        const raw = JSON.parse(await fsp.readFile(path.join(EXT_DIR, name, 'manifest.json'), 'utf8'))
        if (raw.approved !== true) status = 'pending'
        else if (raw.enabled === false) status = 'disabled'
        else status = 'invalid'
        out.push({ id: name, name: String(raw.name || name), status, errors: ['manifest 校验失败或入口文件缺失'] })
      } catch {
        out.push({ id: name, name, status: 'invalid', errors: ['manifest.json 缺失或损坏'] })
      }
      continue
    }
    out.push({
      id: ext.id, name: ext.name, version: ext.version, description: ext.description,
      icon: ext.icon, slot: ext.slot, entry: ext.entry, capabilities: ext.capabilities,
      author: ext.author, createdAt: ext.createdAt,
      approved: ext.approved, enabled: ext.enabled,
      status: !ext.approved ? 'pending' : ext.enabled === false ? 'disabled' : 'active',
    })
  }
  return out
}

/** 只给渲染层：已批准且启用的（可挂载） */
async function activeExtensions() {
  const all = await listExtensions()
  return all.filter(x => x.status === 'active')
}

/** 读扩展内静态文件：路径安全 + 后缀 + 大小 + 类型 */
async function readFile(id, rel) {
  if (!isSafeExtPath(rel)) return { ok: false, error: '路径非法' }
  const base = extPath(id)
  if (!base) return { ok: false, error: 'id 非法' }
  const full = path.resolve(base, rel)
  if (full !== base && !full.startsWith(base + path.sep)) return { ok: false, error: '路径越界' }
  // 防符号链接穿越
  try {
    const real = await fsp.realpath(full)
    if (real !== full && !real.startsWith(base + path.sep)) return { ok: false, error: '符号链接越界' }
  } catch { return { ok: false, error: '文件不存在' } }
  let st
  try { st = await fsp.stat(full) } catch { return { ok: false, error: '文件不存在' } }
  if (!st.isFile()) return { ok: false, error: '不是文件' }
  if (st.size > EXT_MAX_FILE_BYTES) return { ok: false, error: '文件过大' }
  const buf = await fsp.readFile(full)
  const mime = mimeOf(rel)
  return { ok: true, buf, mime }
}

function mimeOf(rel) {
  const e = path.extname(rel).toLowerCase()
  return ({
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
  })[e] || 'application/octet-stream'
}

/** 管理动作：approve / enable / disable / delete。写回 manifest 或直接删目录 */
async function manage(id, action) {
  const dir = extPath(id)
  if (!dir) return { ok: false, error: 'id 非法' }
  const mf = path.join(dir, 'manifest.json')
  if (action === 'delete') {
    try { await fsp.rm(dir, { recursive: true, force: true }) } catch (e) { return { ok: false, error: e.message } }
    return { ok: true }
  }
  let raw
  try { raw = JSON.parse(await fsp.readFile(mf, 'utf8')) } catch { return { ok: false, error: 'manifest 缺失' } }
  if (action === 'approve') raw.approved = true
  else if (action === 'enable') raw.enabled = true
  else if (action === 'disable') raw.enabled = false
  else return { ok: false, error: '未知动作' }
  // 写回前再校验一次，防止把坏 manifest 落盘
  const v = validateExtManifest({ ...raw, id })
  if (!v.ok) return { ok: false, error: v.errors.join('；') }
  try { await fsp.writeFile(mf, JSON.stringify(v.manifest, null, 2), 'utf8') } catch (e) { return { ok: false, error: e.message } }
  return { ok: true }
}

/** AI 创建扩展（create_extension 工具的真实写入）：默认未批准 */
async function create(input) {
  const manifest = defaultExtManifest({
    id: input.id || input.name,
    name: input.name,
    description: input.description,
    icon: input.icon,
    slot: input.slot,
  })
  if (!normalizeExtId(manifest.id)) return { ok: false, error: '缺少合法 id/name' }
  const html = String(input.html || '')
  if (!html.trim()) return { ok: false, error: '缺少 panel.html 内容' }
  if (Buffer.byteLength(html, 'utf8') > EXT_MAX_FILE_BYTES) return { ok: false, error: 'panel.html 过大（上限 512KB）' }
  const dir = extPath(manifest.id)
  ensureDir()
  try {
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    await fsp.writeFile(path.join(dir, 'panel.html'), html, 'utf8')
    if (input.css && String(input.css).trim()) {
      await fsp.writeFile(path.join(dir, 'style.css'), String(input.css).slice(0, EXT_MAX_FILE_BYTES), 'utf8')
    }
  } catch (e) { return { ok: false, error: e.message } }
  return { ok: true, id: manifest.id, needsApproval: true }
}

module.exports = { EXT_DIR, ensureDir, extPath, listExtensions, activeExtensions, readFile, manage, create }
