// 把 release 构建产物上传到 Gitee 发行版附件（v14.9.3）
//
// 由 release-* 工作流在「上传到 GitHub Release」之后调用。
// 文件已经在 runner 的 dist-out/ 里（刚构建出来的），直接读本地文件直传 Gitee——
// 零下载、零用户流量，也不依赖 GitHub CDN 速率。
//
// 环境变量（由 workflow 提供）：
//   GITEE_USER       Gitee 用户名
//   GITEE_TOKEN      Gitee 私人令牌
//   GITEE_TAG        tag 名（如 v14.9.0）
//   GITEE_DIST_DIR   产物目录（默认 dist-out）

import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

// GitHub Actions runner 的 Node fetch 连 Gitee 会 ConnectTimeoutError（境外→Gitee
// 的连接池问题），但 git push 走系统网络栈正常。这里统一用 curl（同系统栈）。
const curl = (args, timeoutSec = 60) => {
  const out = execFileSync('curl', ['-sS', '-m', String(timeoutSec), ...args], {
    encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
  })
  return out
}
const curlJson = (args, timeoutSec = 60) => JSON.parse(curl(args, timeoutSec) || '{}')
const giteeJsonSafe = (url) => {
  try { return curlJson(['-H', 'Accept: application/json', url], 20) } catch { return null }
}

const USER = process.env.GITEE_USER || ''
const TOKEN = process.env.GITEE_TOKEN || ''
const TAG = process.env.GITEE_TAG || ''
const DIR = process.env.GITEE_DIST_DIR || 'dist-out'
const REPO = `${USER}/jutian-agent`

if (!USER || !TOKEN || !TAG) {
  console.log('::warning::未配置 GITEE_USER/GITEE_TOKEN/GITEE_TAG，跳过 Gitee 附件上传')
  process.exit(0)
}

const GEE = (path, query = '') => `https://gitee.com/api/v5/repos/${REPO}${path}?access_token=${encodeURIComponent(TOKEN)}${query ? '&' + query : ''}`
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// 1. 找该 tag 的 Gitee 发行版 id（分页）
let releaseId = ''
for (let page = 1; page <= 3 && !releaseId; page++) {
  const list = curlJson(['-H', 'Accept: application/json', GEE('/releases', `per_page=100&page=${page}`)], 30)
  if (!Array.isArray(list)) break
  const hit = list.find(x => x.tag_name === TAG)
  if (hit) releaseId = String(hit.id)
  if (list.length < 100) break
}
if (!releaseId) {
  console.log(`::warning::Gitee 上还没有 ${TAG} 的发行版（sync-gitee 可能尚未创建），跳过附件上传`)
  process.exit(0)
}
console.log(`Gitee ${TAG} 发行版 id: ${releaseId}`)

// 2. 已有附件名（去重）
const have = new Set()
try {
  const list = curlJson(['-H', 'Accept: application/json', GEE(`/releases/${releaseId}/attach_files`)], 30)
  if (Array.isArray(list)) for (const a of list) have.add(a.name)
} catch { /* 查不到就按不去重 */ }
console.log(`已有附件: ${have.size}`)

// 3. 上传 dist-out 里的文件
// runner→Gitee 大文件（>30MB）实测连不上/卡 15min，只搬小体积文件：
// 24MB 的 app.asar 更新包 + 手机 APK（65KB）。完整安装包仍从 GitHub Release 下载。
const MAX_BYTES = 30 * 1024 * 1024
const files = readdirSync(DIR).filter(f => {
  if (f.endsWith('.blockmap') || f.startsWith('latest')) return false
  try { return readFileSync(join(DIR, f)).length <= MAX_BYTES } catch { return false }
})
let done = 0, fail = 0
for (const name of files) {
  if (have.has(name)) { console.log('· 已存在', name); continue }
  // 并发竞态：多个平台 job 同时上传同名文件，上传前再查一次 Gitee
  try {
    const cur = giteeJsonSafe(GEE(`/releases/${releaseId}/attach_files`))
    if (Array.isArray(cur) && cur.some(a => a.name === name)) { console.log('· 已被其他 job 上传', name); continue }
  } catch { /* 查失败就按原逻辑 */ }
  const buf = readFileSync(join(DIR, name))
  let ok = false
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      const tmp = join(mkdtempSync(join(tmpdir(), 'jt-')), name)
      writeFileSync(tmp, buf)
      const res = curl(['-X', 'POST', '-F', `file=@${tmp}`, '-w', '\n%{http_code}', GEE(`/releases/${releaseId}/attach_files`)], 300)
      const code = Number(res.trim().split('\n').pop())
      if (code >= 200 && code < 300) { done++; console.log(`✓ ${name}（${Math.round(buf.length / 1048576)}MB）`); ok = true }
      else throw new Error('HTTP ' + code + ' ' + res.slice(0, 120))
    } catch (e) {
      console.log(`· ${name} 失败：${String(e.message || e).slice(0, 120)}，重试...`)
      await sleep(3000 * (i + 1))
    }
  }
  if (!ok) fail++
}
console.log(`\n上传 ${done}，失败 ${fail}`)
